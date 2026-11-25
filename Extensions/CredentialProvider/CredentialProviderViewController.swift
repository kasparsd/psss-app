import AuthenticationServices
import LocalAuthentication
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// AutoFill provider for iPhone, iPad and Mac. Fill, passkey and verification code requests run against the person's encrypted
/// vault, opened with the key Face ID or Touch ID releases (no password typing, no KDF); iOS also saves and generates passwords
/// (macOS has no such requests). Without a vault set up for Face ID or Touch ID, or with no vault at all, it says so and offers
/// nothing. It never reads or writes a credential anywhere but the encrypted vault file. Only hosting differs by platform.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    /// The vault opened for the current request.
    private var vault: (any VaultStore)?
    /// The session behind `vault`. It lives as long as the request so the Vault row can lock it and open another vault.
    private let session = VaultSession()
    /// What the current request shows once the vault is open. Choosing another vault in the Vault row runs it again.
    private var resume: (() -> Void)?
    /// The title of the current request's screen ("Choose a Login", "Save Password"), also on the screens of a vault that is not open.
    private var requestTitle: LocalizedStringKey = "Choose a Login"
    /// The screen of a request that wants more than a notice while its vault is not open (a save keeps its form), or nil.
    private var lockedScreen: LockedScreen?
    typealias LockedScreen = (_ vaults: ProviderVaultSwitch?, _ notice: ProviderNotice) -> AnyView
    /// What the screen of a vault that is not open showed last, so Cancel on the password screen returns to it.
    private var lastLock: (state: VaultState, notice: ProviderNotices.Notice, canUnlock: Bool)?

    /// The Vault row shows only with two or more vaults. `state` is the current vault's; the default is open when the vault is.
    private func makeVaultSwitch(state: VaultState? = nil, unlock: (() -> Void)? = nil) -> ProviderVaultSwitch? {
        guard VaultSwitcher.isShown(session) else { return nil }
        return ProviderVaultSwitch(session: session, state: state ?? (vault != nil ? .open : .locked),
                                   choose: { [weak self] in self?.switchVault(to: $0) }, unlock: unlock)
    }

    /// The Vault row of a screen shown while the vault is open.
    private var vaultSwitch: ProviderVaultSwitch? { makeVaultSwitch() }

    /// True once the extension's screen is in front. Face ID cannot be asked for before that: the system refuses with "Caller is
    /// not running foreground". Requests wait for it, and `BiometricKey` also retries a refusal.
    private var visible = false
    /// Set when the request's first save starts, never cleared: a request saves once. A second tap, or a second call for the same
    /// request, does nothing (the screen also dims its button, but the save path does not trust the screen).
    private var saveStarted = false
    /// True while the screen of an open vault (the list, a form) is in front. The system sometimes runs one request twice; showing
    /// the same screen again would replace it with a new one and drop what the person had typed in the search field.
    private var openScreenShown = false
    private var waitingForScreen: [CheckedContinuation<Void, Never>] = []

    #if os(iOS)
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        screenAppeared()
    }
    #else
    override func viewDidAppear() {
        super.viewDidAppear()
        screenAppeared()
    }
    #endif

    private func screenAppeared() {
        visible = true
        let waiting = waitingForScreen
        waitingForScreen = []
        waiting.forEach { $0.resume() }
    }

    /// Returns at once when the screen is in front, else when it appears, or after one second at the most so a request never hangs.
    private func untilVisible() async {
        guard !visible else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            screenAppeared()
        }
        await withCheckedContinuation { waitingForScreen.append($0) }
    }

    private var items: [VaultItem] { vault?.items() ?? [] }

    // MARK: Fill

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        unlocked(title: "Choose a Login") { [self] in
            present(FillList(site: FillSite(serviceIdentifiers: serviceIdentifiers.map(\.identifier)),
                             items: PickerSearch.offerable(items),
                             vaults: vaultSwitch, vaultName: session.reference?.name,
                             choose: { [weak self] in self?.complete(with: $0) },
                             cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    #if os(iOS)
    /// The system’s text insertion (iOS 18 and later): the person tapped a field and chose Psss. One value goes into that field.
    override func prepareInterfaceForUserChoosingTextToInsert() {
        unlocked(title: "Choose Text to Insert") { [self] in
            present(TextPicker(items: PickerSearch.offerable(items), vaults: vaultSwitch,
                               insert: { [weak self] item, text in self?.complete(insertingText: text, from: item) },
                               cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    private func complete(insertingText text: String, from item: VaultItem) {
        vault?.markUsed(item.id)
        AutoFillProof.record()
        extensionContext.completeRequest(withTextToInsert: text) { _ in }
    }
    #endif

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        // Biometrics need a visible prompt, so ask the system to show our interface, which unlocks first.
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        // A tapped suggestion shows the same list as the key button, for the suggestion's site: one matching login has the main
        // Fill button, and the search field and the Vault row are there. There is no one-login Fill screen. Nothing leaves the
        // vault until a row is chosen.
        showVault(of: credentialIdentity.recordIdentifier)
        unlocked(title: "Choose a Login") { [self] in presentLoginList(site: credentialIdentity.serviceIdentifier.identifier) }
    }

    /// Makes the vault a suggestion belongs to the one this request opens and lists from, so the system's suggestion for a login in
    /// another vault opens that vault (unlocked here with Face ID, Touch ID or its password) and not whichever the app last showed.
    /// Returns the item the record names, or nil for a record that is not this app's (the shown vault stays).
    @discardableResult
    private func showVault(of record: String?) -> UUID? {
        guard let parsed = IdentityRecord.parse(record) else { return nil }
        if session.knownVaults.contains(where: { $0.id == parsed.vault }) { session.show(parsed.vault) }
        return parsed.item
    }

    #if os(iOS)
    // MARK: Save (iOS 26.2 and later; macOS has no save or generate requests)

    override func performWithoutUserInteractionIfPossible(savePasswordRequest: ASSavePasswordRequest) {
        cancel(.userInteractionRequired)
    }

    override func prepareInterface(for savePasswordRequest: ASSavePasswordRequest) {
        let host = SharedVault.host(savePasswordRequest.serviceIdentifier.identifier)
        guard !host.isEmpty else {
            // Never save against an empty host: it could update an unrelated login or create one with no website.
            present(SaveFailed(subject: .login, reason: String(localized: "This website’s address could not be read, so nothing was changed."),
                               close: { [weak self] in self?.cancel(.failed) }))
            return
        }
        let credential = savePasswordRequest.credential
        let requestTitle = DisplayText.safe(savePasswordRequest.title ?? "", empty: "")
        // The new login's identity is made once for the request, so saving it again (a second tap, a retry) writes the same
        // entry and can never add a second one.
        let newItemID = UUID()
        if savePasswordRequest.event == .generatedPasswordFilled {
            // The system filled a generated password into a form that is not submitted yet. It cannot take any answer back to the
            // page, so there is no question: save a new login now, unless `SaveMatch.generated` says the submit will ask to Update
            // one. Never touch a login that already exists. Package 3 of docs/plans/password-generator.md replaces this with the full event table.
            unlocked(title: "Save Password") { [self] in
                guard SaveMatch.generated(in: items, host: host, user: credential.user, password: credential.password) == .saveNew else {
                    extensionContext.completeSavePasswordRequest { _ in }
                    return
                }
                var item = VaultItem(id: newItemID, kind: .login, website: host)
                item.title = SaveWords.newTitle(requestTitle: requestTitle, host: host)
                item.account = credential.user
                item.secret = credential.password
                item.lastUsed = .now
                persist(item, subject: .login) { [weak self] in AutoFillProof.record(); self?.extensionContext.completeSavePasswordRequest { _ in } }
            }
            return
        }
        // While the destination is locked the form stays on screen, with the Vault row and Unlock, and Save is dimmed. Changing
        // vault keeps the form: the website, username and password are the request's, and only the destination changes.
        let lockedForm: LockedScreen = { [weak self] vaults, notice in
            AnyView(SaveForm(kind: .password, host: host, account: credential.user, existing: nil, vaults: vaults, notice: notice,
                             save: {}, cancel: { self?.cancel(.userCanceled) }))
        }
        unlocked(title: "Save Password", locked: lockedForm) { [self] in
            let existing: VaultItem?
            switch SaveMatch.submitted(in: items, host: host, user: credential.user, password: credential.password) {
            case .alreadySaved:
                extensionContext.completeSavePasswordRequest { _ in }
                return
            case .update(let login): existing = login
            case .new: existing = nil
            case .completePending(var pending):
                // The login Psss saved moments ago from this page's generated password, before the username was known: it gets the
                // username, without a question.
                pending.account = credential.user
                pending.lastUsed = .now
                persist(pending, subject: .login) { [weak self] in AutoFillProof.record(); self?.extensionContext.completeSavePasswordRequest { _ in } }
                return
            }
            present(SaveForm(kind: .password, host: host, account: credential.user, existing: existing, vaults: vaultSwitch,
                             alreadySaved: existing.map { $0.secret == credential.password } ?? false,
                             save: { [weak self] in
                // Update changes the password and nothing else: never the username, the name or the website the login has.
                var item = existing ?? VaultItem(id: newItemID, kind: .login, website: host)
                if existing == nil {
                    item.title = SaveWords.newTitle(requestTitle: requestTitle, host: host)
                    item.account = credential.user
                }
                item.secret = credential.password
                if item.website.isEmpty { item.website = host }
                item.lastUsed = .now
                self?.persist(item, subject: .login) { [weak self] in AutoFillProof.record(); self?.extensionContext.completeSavePasswordRequest { _ in } }
            }, cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    #endif

    // MARK: Saving (a password on iOS, a passkey on iOS and macOS)

    /// Writes one login and completes the save request. Only a vault file that was really written counts as saved. Once per request:
    /// a second call does nothing. The time the file write and the system's suggestion list take is logged (numbers only).
    private func persist(_ saved: VaultItem, subject: SaveFailed.Subject, complete: @escaping () -> Void) {
        guard !saveStarted else { return }
        saveStarted = true
        let closeFailed = { [weak self] in self?.cancel(.failed) }
        Task { @MainActor in
            // The vault file is written on the main thread, which cannot draw while it works. Let the screen show “Saving…” first.
            try? await Task.sleep(for: .milliseconds(100))
            let clock = ContinuousClock()
            let start = clock.now
            do {
                guard let vault = self.vault else { throw VaultStoreError.fileMissing }
                try vault.save([saved])
                let written = clock.now
                unlockLog.notice("provider save: vault file written in \(Self.milliseconds(start.duration(to: written))) ms")
                await Self.registerBriefly(saved, in: vault)
                unlockLog.notice("provider save: suggestions registered after \(Self.milliseconds(written.duration(to: clock.now))) ms more")
            } catch {
                self.present(SaveFailed(subject: subject, reason: Self.reason(for: error), close: { closeFailed() }))
                return
            }
            complete()
        }
    }

    /// The system's suggestion list learns of the saved item. Waits for it so the extension is not torn down mid-call, but never
    /// longer than a few seconds: the file is already written, and the app registers every login again the next time it opens.
    @MainActor private static func registerBriefly(_ item: VaultItem, in vault: any VaultStore) async {
        guard let id = (vault as? KeePassVaultStore)?.reference.id else { return }
        // Every vault this sheet has opened, each tied to its own vault (the replacement path must not drop the others').
        // Plain values the system only reads; only the registering task touches this copy.
        nonisolated(unsafe) let all = VaultIdentities.record(vault: id, items: vault.items())
        var finished = false
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            // Whichever comes first ends the wait; the other is ignored (a structured group would wait for both).
            func finish() { if !finished { finished = true; continuation.resume() } }
            Task { await SharedVault.registerSavedAndWait([item], in: id, all: all); finish() }
            Task { try? await Task.sleep(for: .seconds(2)); finish() }
        }
    }

    private static func milliseconds(_ duration: Duration) -> Int {
        Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
    }

    #if os(iOS)
    // MARK: Generate (iOS 26.2 and later)

    override func performWithoutUserInteraction(generatePasswordsRequest: ASGeneratePasswordsRequest) {
        // The page's own rules, its confirm field's and the system's list for known sites, merged: every password returned
        // satisfies all of them. The person's type comes first, then the other kinds.
        let rules = PasswordRules.merged(parsing: [generatePasswordsRequest.passwordFieldPasswordRules,
                                                   generatePasswordsRequest.confirmPasswordFieldPasswordRules,
                                                   generatePasswordsRequest.passwordRulesFromQuirks])
        var generator = SystemRandomNumberGenerator()
        let offers = PasswordGenerator.offers(GeneratorSettings.load(), rules: rules, using: &generator)
        guard !offers.isEmpty else { return cancel(.failed) }
        extensionContext.completeGeneratePasswordRequest(results: offers.map {
            ASGeneratedPassword(kind: Self.systemKind($0.kind), value: $0.value)
        }) { _ in }
    }

    private static func systemKind(_ kind: GeneratedPassword.Kind) -> ASGeneratedPassword.Kind {
        switch kind {
        case .strong: .strong
        case .alphanumeric: .alphanumeric
        case .passphrase: .passphrase
        }
    }

    #endif

    // MARK: Passkeys

    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        let failed = { [weak self] (reason: String) -> Void in
            guard let self else { return }
            self.present(SaveFailed(subject: .passkey, reason: reason, close: { [weak self] in self?.cancel(.failed) }))
        }
        guard let request = registrationRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
            return failed(String(localized: "Psss could not read the request, so nothing was changed."))
        }
        guard request.supportedAlgorithms.isEmpty || request.supportedAlgorithms.contains(.ES256) else {
            return failed(String(localized: "This site asks for a kind of passkey Psss cannot make yet, so nothing was changed."))
        }
        let rpID = identity.relyingPartyIdentifier
        let userName = identity.userName
        let newItemID = UUID()
        // The system sheet has already asked "Save a passkey?", so with one vault that is open the only prompt is Face ID or Touch
        // ID. With two or more vaults, or a vault that is locked, the Create Passkey screen shows where the passkey goes.
        let lockedForm: LockedScreen = { [weak self] vaults, notice in
            AnyView(SaveForm(kind: .passkey, host: rpID, account: userName, existing: nil, vaults: vaults, notice: notice,
                             save: {}, cancel: { self?.cancel(.userCanceled) }))
        }
        unlocked(title: "Create Passkey", locked: lockedForm) { [self] in
            // The passkey joins the login with the same website and username when that login has none yet; otherwise a new login
            // is made. A login that already has a passkey is never overwritten: its old passkey may still be the one another
            // device or the site knows.
            let existing = Self.loginForPasskey(in: items, host: rpID, userName: userName)
            let create: () -> Void = { [weak self] in
                self?.finishRegistration(request: request, rpID: rpID, userName: userName, userHandle: identity.userHandle,
                                         existing: existing, newItemID: newItemID, failed: failed)
            }
            if VaultSwitcher.isShown(session) {
                present(SaveForm(kind: .passkey, host: rpID, account: userName, existing: existing, vaults: vaultSwitch,
                                 save: create, cancel: { [weak self] in self?.cancel(.userCanceled) }))
            } else {
                create()
            }
        }
    }

    /// The login a new passkey joins: same website and username, and no passkey yet.
    private static func loginForPasskey(in items: [VaultItem], host: String, userName: String) -> VaultItem? {
        for item in items where item.kind == .login && item.passkey == nil && item.account == userName {
            if SharedVault.matches(item, host: host) { return item }
        }
        return nil
    }

    /// Makes the passkey, writes it into the vault and only then hands it to the system: the site gets the passkey once the vault
    /// file really holds it.
    private func finishRegistration(request: ASPasskeyCredentialRequest, rpID: String, userName: String, userHandle: Data,
                                    existing: VaultItem?, newItemID: UUID, failed: @escaping (String) -> Void) {
        // One passkey per request: a second call must not make another key pair.
        guard !saveStarted else { return }
        let registration = Passkeys.register(rpID: rpID, userHandle: userHandle, clientDataHash: request.clientDataHash)
        var item = existing ?? VaultItem(id: newItemID, kind: .login, title: SaveWords.newTitle(requestTitle: "", host: rpID), account: userName, website: rpID)
        item.passkey = registration.record
        item.lastUsed = .now
        persist(item, subject: .passkey) { [weak self] in
            AutoFillProof.record()
            self?.extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(
                relyingParty: rpID, clientDataHash: request.clientDataHash,
                credentialID: registration.record.credentialID,
                attestationObject: registration.attestationObject)) { _ in }
        }
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier],
                                        requestParameters: ASPasskeyCredentialRequestParameters) {
        unlocked(title: "Choose a Login") { [self] in
            let rpID = requestParameters.relyingPartyIdentifier
            let clientDataHash = requestParameters.clientDataHash
            // The page may have asked for a passkey first (Google does), so the list also offers the saved logins, as the plain list does.
            let request = PasskeyRequestList(items: items, serviceIdentifiers: serviceIdentifiers.map(\.identifier), rpID: rpID,
                                             allowedCredentials: requestParameters.allowedCredentials)
            // Counts and the relying party only (a site name, never a credential): enough to tell from a device log whether a
            // request listed no passkey because the vault has none, because it has one under a sibling identifier, or because the
            // request's allowed credentials named others.
            let d = request.diagnostics
            unlockLog.notice("passkey request for \(rpID, privacy: .public): \(d.passkeysInVault) passkeys in the vault, \(d.forRelyingParty) for this relying party, \(d.forSiblingRelyingParty) for a sibling identifier of the same domain, \(d.allowedCredentials) allowed credentials named, \(d.excludedByAllowedCredentials) excluded by them, \(d.listed) listed, \(request.siteLogins.count) logins for the page")
            if request.signsInWithoutList, let only = request.passkeys.first {
                return assert(only, relyingParty: rpID, clientDataHash: clientDataHash)
            }
            present(FillList(site: request.site,
                             items: PickerSearch.offerable(items),
                             passkeys: PasskeyChoice(rpID: rpID, items: request.passkeys,
                                                     choose: { [weak self] in self?.assert($0, relyingParty: rpID, clientDataHash: clientDataHash) }),
                             vaults: vaultSwitch, vaultName: session.reference?.name,
                             choose: { [weak self] in self?.complete(with: $0) },
                             cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    // MARK: Verification codes (iOS 18, macOS 15)

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        unlocked(title: "Choose a Code") { [self] in
            // The site's logins with a code are listed. Other logins with a code sit behind the search and a confirmation that
            // names both sites, as in the login list.
            // The site is the first identifier that has a host.
            presentCodeList(identifier: serviceIdentifiers.map(\.identifier).first { !SharedVault.host($0).isEmpty })
        }
    }

    /// The login list with search for one site, as the key button shows it.
    private func presentLoginList(site: String) {
        present(FillList(site: FillSite(serviceIdentifiers: [site]),
                         items: PickerSearch.offerable(items),
                         vaults: vaultSwitch, vaultName: session.reference?.name,
                         choose: { [weak self] in self?.complete(with: $0) },
                         cancel: { [weak self] in self?.cancel(.userCanceled) }))
    }

    /// The code list with search: the site's logins with a code first, every other one behind the search and a confirmation.
    private func presentCodeList(identifier: String?) {
        let host = identifier.map { SharedVault.host($0) }
        let matching = identifier.map { identifier in
            items.filter { ReleaseCheck.oneTimeCode(item: $0, serviceIdentifier: identifier) }
        } ?? []
        present(CodeList(host: host, items: matching,
                         others: items.filter { SharedVault.hasReadableCode($0) },
                         vaults: vaultSwitch,
                         choose: { [weak self] in self?.complete(code: $0) },
                         cancel: { [weak self] in self?.cancel(.userCanceled) }))
    }

    private func complete(code item: VaultItem) {
        guard let code = ReleaseCheck.currentCode(for: item) else { return cancel(.failed) }
        vault?.markUsed(item.id)
        AutoFillProof.record()
        extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code)) { _ in }
    }

    // MARK: Requests that arrive as ASCredentialRequest (passkeys and codes)

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        // Passkeys and codes need the unlock, which needs the interface.
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        let isCode = credentialRequest.credentialIdentity is ASOneTimeCodeCredentialIdentity
        let itemID = showVault(of: credentialRequest.credentialIdentity.recordIdentifier)
        unlocked(title: isCode ? "Choose a Code" : "Choose a Login") { [self] in
            if let request = credentialRequest as? ASPasskeyCredentialRequest,
               let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity {
                // Sign only with the passkey the identity names: same relying party and same credential ID.
                guard let itemID, let item = items.first(where: { $0.id == itemID }),
                      let passkey = item.passkey,
                      ReleaseCheck.passkey(record: passkey, relyingParty: identity.relyingPartyIdentifier,
                                           credentialID: identity.credentialID) else { return cancel(.credentialIdentityNotFound) }
                assert(item, relyingParty: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash)
            } else if let identity = credentialRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity {
                // The code list for the suggestion's site, with the search and the Vault row, as the key button shows it.
                presentCodeList(identifier: identity.serviceIdentifier.identifier)
            } else if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
                // Not through the identity method: that unlocks again, which asked for Face ID a second time.
                presentLoginList(site: identity.serviceIdentifier.identifier)
            } else {
                cancel(.failed)
            }
        }
    }

    private func assert(_ item: VaultItem, relyingParty: String, clientDataHash: Data) {
        guard let passkey = item.passkey,
              let result = try? Passkeys.assert(passkey, relyingParty: relyingParty, clientDataHash: clientDataHash) else {
            return cancel(.failed)
        }
        vault?.markUsed(item.id)
        AutoFillProof.record()
        extensionContext.completeAssertionRequest(using: ASPasskeyAssertionCredential(
            userHandle: passkey.userHandle, relyingParty: passkey.rpID, signature: result.signature,
            clientDataHash: clientDataHash, authenticatorData: result.authenticatorData,
            credentialID: passkey.credentialID))
    }

    // MARK: Opening the vault

    /// Runs `work` once the current vault is open. A locked vault shows its screen instead (`showLocked`): the Vault row with
    /// Unlock, and a notice. Closing the sheet is only ever Cancel; nothing here closes it by itself.
    private func unlocked(title: LocalizedStringKey, locked: LockedScreen? = nil, _ work: @escaping () -> Void) {
        resume = work
        requestTitle = title
        lockedScreen = locked
        reopen()
    }

    private func reopen() {
        Task { @MainActor in await openVault() }
    }

    /// Opens the current vault the way it opens: Face ID, Touch ID or the passcode when the saved key is ready, otherwise the
    /// locked screen (its Unlock opens the password screen). A vault that is not available shows its notice and no Unlock.
    private func openVault() async {
        unlockLog.notice("provider unlock requested")
        await untilVisible()
        // No vault yet (or no shared storage): nothing to open and nothing may be written.
        guard let reference = session.reference else {
            present(NoVaultYet(close: { self.cancel(.userCanceled) }))
            return
        }
        // The system can ask for the same request twice in a row (the log showed two unlocks 90 ms apart). The vault is open by
        // then, so the second one only shows its screen: a second Face ID prompt would ask for nothing new.
        if let open = session.store {
            unlockLog.notice("provider unlock skipped: vault already open")
            vault = open
            // The screen for this vault is already in front: showing it again would start it over and lose the search text.
            if !openScreenShown { openScreenShown = true; resume?() }
            return
        }
        let name = reference.name
        let method = BiometryKind.nameForMessages
        let state = session.state(of: reference)
        switch state {
        case .notDownloaded, .notFound, .unreadable:
            return showUnavailable(state)
        case .needsPassword:
            if let notice = ProviderNotices.needsPassword(state, name: name, method: method) {
                return showLocked(state: state, notice: notice, canUnlock: true)
            }
        case .open, .locked:
            break
        }
        do {
            try await session.unlockWithBiometrics()
            vault = session.store
            openScreenShown = true
            resume?()
        } catch BiometricKeyError.cancelled {
            // Not the end of the request: Unlock asks again, and another vault is one choice away.
            showLocked(state: .locked, notice: ProviderNotices.cancelled(method: method), canUnlock: true)
        } catch VaultStoreError.fileMissing {
            showUnavailable(.notFound)
        } catch BiometricKeyError.invalidated {
            // The saved key is off or gone. Without a device passcode the system keeps no key, which is a different fix.
            var passcodeError: NSError?
            let hasPasscode = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &passcodeError)
            let now = session.reference.map { session.state(of: $0) } ?? .needsPassword(.off)
            let passwordState: VaultState
            if case .needsPassword = now { passwordState = now } else { passwordState = .needsPassword(.off) }
            if !hasPasscode {
                showLocked(state: passwordState, notice: ProviderNotices.noPasscode(name: name), canUnlock: true)
            } else if let notice = ProviderNotices.needsPassword(passwordState, name: name, method: method) {
                showLocked(state: passwordState, notice: notice, canUnlock: true)
            }
        } catch is BiometricKeyError {
            // The key exists but biometry cannot be used now (lockout, unavailable, a failed read).
            let unavailable = VaultState.needsPassword(.unavailableNow)
            if let notice = ProviderNotices.needsPassword(unavailable, name: name, method: method) {
                showLocked(state: unavailable, notice: notice, canUnlock: true)
            }
        } catch {
            // A vault or store error: the file is damaged or cannot be read.
            showUnavailable(.unreadable)
        }
    }

    /// The screen of a vault that is locked or needs its password: the Vault row with Unlock, and the notice. A request that keeps
    /// a form (a save) shows the form with the notice instead.
    private func showLocked(state: VaultState, notice: ProviderNotices.Notice, canUnlock: Bool) {
        openScreenShown = false
        lastLock = (state, notice, canUnlock)
        let unlock: (() -> Void)? = canUnlock ? { [weak self] in self?.unlockTapped(state) } : nil
        let shown = ProviderNotice(notice, unlock: unlock)
        let row = makeVaultSwitch(state: state, unlock: unlock)
        if let lockedScreen {
            present(lockedScreen(row, shown))
        } else {
            present(ProviderLockedScreen(title: requestTitle, vaults: row, notice: shown, cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    /// A vault that cannot be opened at all: the notice says what Psss will do, and there is no Unlock here.
    private func showUnavailable(_ state: VaultState) {
        guard let name = session.reference?.name, let notice = ProviderNotices.unavailable(state, name: name) else { return }
        showLocked(state: state, notice: notice, canUnlock: false)
    }

    /// Unlock was chosen: Face ID again when the saved key is ready, the password screen when only the password opens the vault.
    private func unlockTapped(_ state: VaultState) {
        if case .needsPassword = state { showPasswordScreen() } else { reopen() }
    }

    /// The app's lock screen inside the sheet. Refuses up front, without asking for a password, when this vault's key derivation
    /// would not fit the extension's memory (`ExtensionUnlockBudget`): "Open Psss to unlock <name>."
    private func showPasswordScreen() {
        guard let reference = session.reference else { return }
        openScreenShown = false
        let state = session.state(of: reference)
        if let kdf = session.keyDerivationMemory(), !ExtensionUnlockBudget.allows(kdfBytes: kdf) {
            unlockLog.notice("provider password unlock refused before asking: key derivation \(kdf / ExtensionUnlockBudget.mebibyte) MiB, \(ProcessMemory.snapshot().text)")
            return showLocked(state: state, notice: ProviderNotices.openPsss(name: reference.name), canUnlock: false)
        }
        present(ProviderPasswordUnlock(
            name: VaultName.sentence(reference.name),
            vaults: makeVaultSwitch(state: state),
            usesKeyFile: reference.usesKeyFile,
            unlock: { [weak self] in try await self?.unlockWithPassword($0) },
            cancel: { [weak self] in
                guard let self else { return }
                if let last = self.lastLock {
                    self.showLocked(state: last.state, notice: last.notice, canUnlock: last.canUnlock)
                } else {
                    self.cancel(.userCanceled)
                }
            }))
    }

    /// Opens the vault with a typed password. The memory is logged around the key derivation (numbers only), and the derivation is
    /// refused when it would not fit. No Face ID key is saved from here: the app does that after its own unlock.
    private func unlockWithPassword(_ credentials: KDBXCredentials) async throws {
        unlockLog.notice("provider password unlock starts: \(ProcessMemory.snapshot().text)")
        do {
            try await session.unlock(credentials: credentials, savingQuickUnlockKey: false) { data in
                let kdf = KDBX.keyDerivationMemory(of: data) ?? 0
                let before = ProcessMemory.snapshot()
                unlockLog.notice("provider key derivation about to run, asks for \(kdf / ExtensionUnlockBudget.mebibyte) MiB: \(before.text)")
                guard ExtensionUnlockBudget.allows(kdfBytes: kdf, availableBytes: before.availableBytes) else {
                    throw ExtensionUnlockError.tooMuchMemory
                }
            }
        } catch VaultStoreError.fileMissing {
            showUnavailable(.notFound)
            return
        } catch let error as KDBXError {
            switch error {
            case .notAVault, .corrupted, .unsupported:
                showUnavailable(.unreadable)
                return
            default:
                throw error
            }
        }
        unlockLog.notice("provider password unlock done: \(ProcessMemory.snapshot().text)")
        vault = session.store
        openScreenShown = true
        resume?()
    }

    /// The Vault row's choice: the vault becomes the shown vault of the app (nothing is locked: a vault this sheet already opened stays
    /// open and lists at once, and each open vault lives only in this process), then the request runs again, which opens that vault
    /// with Face ID or Touch ID (or shows its Unlock) and lists its logins. A values screen is replaced by that list; a save screen is
    /// replaced by the same form for the new destination. Nothing here closes the sheet.
    private func switchVault(to id: UUID) {
        guard resume != nil else { return }
        unlockLog.notice("provider switches vault")
        vault = nil
        openScreenShown = false
        session.show(id)
        // The old list, its search text and its results go at once: the person sees the new vault's name and that it is opening
        // while Face ID asks. A save keeps its form, which has nothing to clear.
        if lockedScreen == nil {
            present(ProviderLoadingScreen(title: requestTitle, vaults: makeVaultSwitch(state: session.isOpen ? .open : .locked),
                                          cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
        reopen()
    }

    // MARK: Helpers

    /// The whole sentence the save-failed screen shows. It says each thing once and never shows the system's own description,
    /// which names the vault's internal file.
    private static func reason(for error: Error) -> String {
        if let store = error as? VaultStoreError {
            if case .writeFailed = store {
                return String(localized: "The vault file could not be written, so nothing was changed. Check that this device has free space and that the vault file is not locked or read-only, then try again.")
            }
            return store.messageInProvider
        }
        if let kdbx = error as? KDBXError { return kdbx.message }
        return String(localized: "Psss could not save this, so nothing was changed. Try again.")
    }

    private func complete(with item: VaultItem) {
        guard let password = item.fillValue(for: .password) else { return cancel(.credentialIdentityNotFound) }
        vault?.markUsed(item.id)
        AutoFillProof.record()
        extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: item.fillValue(for: .username) ?? "", password: password))
    }

    private func cancel(_ code: ASExtensionError.Code) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: code.rawValue))
    }

    private func present<Content: View>(_ content: Content) {
        #if os(iOS)
        children.forEach { $0.willMove(toParent: nil); $0.view.removeFromSuperview(); $0.removeFromParent() }
        let host = UIHostingController(rootView: content)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(host.view)
        host.didMove(toParent: self)
        #else
        children.forEach { $0.view.removeFromSuperview(); $0.removeFromParent() }
        // The system shows the extension's view in a sheet that takes its size from the preferred content size.
        let host = NSHostingController(rootView: content)
        host.sizingOptions = []
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        preferredContentSize = NSSize(width: 480, height: 420)
        #endif
    }
}
