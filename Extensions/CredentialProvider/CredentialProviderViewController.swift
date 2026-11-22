import AuthenticationServices

#if os(iOS)
import SwiftUI
import UIKit

/// AutoFill provider. Fill, save, generate and passkey requests run against the person's encrypted vault, opened with the key
/// Face ID or Touch ID releases (no password typing, no KDF). Without a vault set up for Face ID it says so and offers
/// nothing; the sample vault still works for the demo.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    /// The vault opened for the current request.
    private var vault: (any VaultStore)?
    private var items: [VaultItem] { vault?.items() ?? [] }

    // MARK: Fill

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        unlocked { [self] in
        let host = serviceIdentifiers.first.map { SharedVault.host($0.identifier) } ?? ""
        present(FillList(host: host, items: items.filter { $0.kind == .login && !$0.secret.isEmpty },
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
        guard let item = items.first(where: { $0.id.uuidString == credentialIdentity.recordIdentifier }) else {
            return cancel(.credentialIdentityNotFound)
        }
        present(FillConfirm(item: item,
                            fill: { [weak self] in self?.complete(with: item) },
                            cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    // MARK: Save (iOS 26.2 and later)

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
            return assert(only, clientDataHash: requestParameters.clientDataHash)
        }
        present(PasskeyPick(rpID: rpID, items: items,
                            choose: { [weak self] in self?.assert($0, clientDataHash: requestParameters.clientDataHash) },
                            cancel: { [weak self] in self?.cancel(.userCanceled) }))
        }
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        unlocked { [self] in
        if let request = credentialRequest as? ASPasskeyCredentialRequest,
           let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity {
            guard let item = items.first(where: { $0.id.uuidString == identity.recordIdentifier }),
                  item.passkey != nil else { return cancel(.credentialIdentityNotFound) }
            assert(item, clientDataHash: request.clientDataHash)
        } else if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            prepareInterfaceToProvideCredential(for: identity)
        } else {
            cancel(.failed)
        }
        }
    }

    private func assert(_ item: VaultItem, clientDataHash: Data) {
        guard let passkey = item.passkey, let result = try? Passkeys.assert(passkey, clientDataHash: clientDataHash) else {
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
                if VaultReference.load() == nil {
                    // No vault of their own yet: the demo sample vault, behind the device passcode or biometrics.
                    try await Unlock.authenticate(reason: String(localized: "Unlock your passwords to sign in."))
                    vault = SampleVaultStore()
                } else {
                    let session = VaultSession()
                    try await session.unlockWithBiometrics()
                    vault = session.store
                }
                work()
            } catch Unlock.Failure.cancelled {
                cancel(.userCanceled)
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
        children.forEach { $0.willMove(toParent: nil); $0.view.removeFromSuperview(); $0.removeFromParent() }
        let host = UIHostingController(rootView: content)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}
#else
final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) { unavailable() }
    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) { unavailable() }
    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) { unavailable() }

    private func unavailable() {
        extensionContext.cancelRequest(withError: NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.failed.rawValue
        ))
    }
}
#endif
