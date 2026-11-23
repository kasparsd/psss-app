import AuthenticationServices

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
    private var items: [VaultItem] { vault?.items() ?? [] }

    // MARK: Fill

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        unlocked { [self] in
        present(FillList(site: FillSite(serviceIdentifier: serviceIdentifiers.first?.identifier),
                         items: items.filter { $0.kind == .login && !$0.secret.isEmpty },
                         choose: { [weak self] in self?.complete(with: $0) },
                         cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        // Biometrics need a visible prompt, so ask the system to show our interface, which unlocks first.
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        unlocked { [self] in
        // Release only what the request names: a login with a password whose website matches the identity's site.
        guard let item = items.first(where: { $0.id.uuidString == credentialIdentity.recordIdentifier }),
              ReleaseCheck.password(item: item, serviceIdentifier: credentialIdentity.serviceIdentifier.identifier) else {
            return cancel(.credentialIdentityNotFound)
        }
        present(FillConfirm(item: item,
                            fill: { [weak self] in self?.complete(with: item) },
                            cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    #if os(iOS)
    // MARK: Save (iOS 26.2 and later; macOS has no save or generate requests)

    override func performWithoutUserInteractionIfPossible(savePasswordRequest: ASSavePasswordRequest) {
        cancel(.userInteractionRequired)
    }

    override func prepareInterface(for savePasswordRequest: ASSavePasswordRequest) {
        unlocked { [self] in
        let host = SharedVault.host(savePasswordRequest.serviceIdentifier.identifier)
        guard !host.isEmpty else {
            // Never save against an empty host: it could update an unrelated login or create one with no website.
            present(SaveFailed(subject: .login, reason: String(localized: "This website’s address could not be read."),
                               close: { [weak self] in self?.cancel(.failed) }))
            return
        }
        let credential = savePasswordRequest.credential
        let existing = items.first { SharedVault.matches($0, host: host) && $0.account == credential.user }
        present(SaveLogin(host: host, account: credential.user, password: credential.password,
                          title: "",
                          existing: existing,
                          save: { [weak self] title in
            var item = existing ?? VaultItem(kind: .login, website: host)
            item.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            item.account = credential.user
            item.secret = credential.password
            if item.website.isEmpty { item.website = host }
            item.lastUsed = .now
            let saved = item
            guard let self else { return }
            let closeFailed = { [weak self] in self?.cancel(.failed) }
            Task { @MainActor in
                // Only a vault file that was really written counts as saved.
                do {
                    guard let vault = self.vault else { throw VaultStoreError.fileMissing }
                    try vault.save([saved])
                    await SharedVault.registerSavedAndWait([saved], all: vault.items())
                } catch {
                    self.present(SaveFailed(subject: .login, reason: Self.reason(for: error),
                                            close: { closeFailed() }))
                    return
                }
                self.extensionContext.completeSavePasswordRequest { _ in }
            }
        }, cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    // MARK: Generate (iOS 26.2 and later)

    override func performWithoutUserInteraction(generatePasswordsRequest: ASGeneratePasswordsRequest) {
        extensionContext.completeGeneratePasswordRequest(results: [
            ASGeneratedPassword(kind: .strong, value: PasswordGenerator.strong()),
            ASGeneratedPassword(kind: .alphanumeric, value: PasswordGenerator.alphanumeric())
        ]) { _ in }
    }

    #endif

    // MARK: Passkeys

    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        unlocked { [self] in
        let failed = { [weak self] (reason: String) -> Void in
            guard let self else { return }
            self.present(SaveFailed(subject: .passkey, reason: reason, close: { [weak self] in self?.cancel(.failed) }))
        }
        guard let request = registrationRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
            return failed(String(localized: "Psss could not read the request."))
        }
        guard request.supportedAlgorithms.isEmpty || request.supportedAlgorithms.contains(.ES256) else {
            return failed(String(localized: "This site asks for a kind of passkey Psss cannot make yet."))
        }
        // The system sheet has already asked "Save a passkey?", so the only prompt here is Face ID or Touch ID.
        let rpID = identity.relyingPartyIdentifier
        let registration = Passkeys.register(rpID: rpID, userHandle: identity.userHandle,
                                             clientDataHash: request.clientDataHash)
        var item = VaultItem(kind: .login, account: identity.userName, website: rpID)
        item.passkey = registration.record
        item.lastUsed = .now
        let saved = item
        Task { @MainActor in
            // The site only gets the passkey once the vault file really holds it.
            do {
                guard let vault = self.vault else { throw VaultStoreError.fileMissing }
                try vault.save([saved])
                await SharedVault.registerSavedAndWait([saved], all: vault.items())
            } catch {
                return failed(Self.reason(for: error))
            }
            self.extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(
                relyingParty: rpID, clientDataHash: request.clientDataHash,
                credentialID: registration.record.credentialID,
                attestationObject: registration.attestationObject)) { _ in }
        }
        }
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier],
                                        requestParameters: ASPasskeyCredentialRequestParameters) {
        unlocked { [self] in
        let rpID = requestParameters.relyingPartyIdentifier
        let allowed = requestParameters.allowedCredentials
        let items = items.filter { item in
            guard let passkey = item.passkey, passkey.rpID == rpID else { return false }
            return allowed.isEmpty || allowed.contains(passkey.credentialID)
        }
        if items.count == 1, let only = items.first {
            return assert(only, relyingParty: rpID, clientDataHash: requestParameters.clientDataHash)
        }
        present(PasskeyPick(rpID: rpID, items: items,
                            choose: { [weak self] in self?.assert($0, relyingParty: rpID, clientDataHash: requestParameters.clientDataHash) },
                            cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    // MARK: Verification codes (iOS 18, macOS 15)

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        unlocked { [self] in
            // Only logins with a code that belong to the site. There is no list of other logins for codes.
            let identifier = serviceIdentifiers.first?.identifier
            let host = identifier.map { SharedVault.host($0) }.flatMap { $0.isEmpty ? nil : $0 }
            let matching = identifier.map { identifier in
                items.filter { ReleaseCheck.oneTimeCode(item: $0, serviceIdentifier: identifier) }
            } ?? []
            present(CodeList(host: host, items: matching,
                             choose: { [weak self] in self?.complete(code: $0) },
                             cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    private func complete(code item: VaultItem) {
        guard let code = ReleaseCheck.currentCode(for: item) else { return cancel(.failed) }
        vault?.markUsed(item.id)
        extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code)) { _ in }
    }

    // MARK: Requests that arrive as ASCredentialRequest (passkeys and codes)

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        // Passkeys and codes need the unlock, which needs the interface.
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        unlocked { [self] in
        if let request = credentialRequest as? ASPasskeyCredentialRequest,
           let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity {
            // Sign only with the passkey the identity names: same relying party and same credential ID.
            guard let item = items.first(where: { $0.id.uuidString == identity.recordIdentifier }),
                  let passkey = item.passkey,
                  ReleaseCheck.passkey(record: passkey, relyingParty: identity.relyingPartyIdentifier,
                                       credentialID: identity.credentialID) else { return cancel(.credentialIdentityNotFound) }
            assert(item, relyingParty: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash)
        } else if let identity = credentialRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity {
            // Release only what the request names: a login with a readable code whose website matches the identity's site.
            guard let item = items.first(where: { $0.id.uuidString == identity.recordIdentifier }),
                  ReleaseCheck.oneTimeCode(item: item, serviceIdentifier: identity.serviceIdentifier.identifier) else {
                return cancel(.credentialIdentityNotFound)
            }
            present(FillConfirm(item: item, verb: "Use Code",
                                fill: { [weak self] in self?.complete(code: item) },
                                cancel: { [weak self] in self?.cancel(.userCanceled) }))
        } else if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            prepareInterfaceToProvideCredential(for: identity)
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
        extensionContext.completeAssertionRequest(using: ASPasskeyAssertionCredential(
            userHandle: passkey.userHandle, relyingParty: passkey.rpID, signature: result.signature,
            clientDataHash: clientDataHash, authenticatorData: result.authenticatorData,
            credentialID: passkey.credentialID))
    }

    // MARK: Helpers

    /// Runs `work` only after the person authenticates. Cancelling returns to the system sheet.
    private func unlocked(_ work: @escaping () -> Void) {
        Task { @MainActor in
            do {
                // No vault yet (or no shared storage): nothing to open and nothing may be written.
                guard VaultReference.load() != nil else {
                    present(NotReady(close: { self.cancel(.userCanceled) }))
                    return
                }
                let session = VaultSession()
                try await session.unlockWithBiometrics()
                vault = session.store
                work()
            } catch BiometricKeyError.cancelled {
                cancel(.userCanceled)
            } catch {
                present(NotReady(close: { self.cancel(.userCanceled) }))
            }
        }
    }

    private static func reason(for error: Error) -> String {
        (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? error.localizedDescription
    }

    private func complete(with item: VaultItem) {
        vault?.markUsed(item.id)
        extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: item.account, password: item.secret))
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
