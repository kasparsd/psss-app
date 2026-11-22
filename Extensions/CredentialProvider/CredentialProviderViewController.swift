import AuthenticationServices

#if os(iOS)
import SwiftUI
import UIKit

/// Prototype provider. It shows real system-driven fill, save and generate requests against the sample
/// vault. There is no unlock yet, so every request behaves as if the vault were already unlocked.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    // MARK: Fill

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let host = serviceIdentifiers.first.map { SharedVault.host($0.identifier) } ?? ""
        present(FillList(host: host, items: SharedVault.allItems.filter { $0.kind == .login && !$0.secret.isEmpty },
                         choose: { [weak self] in self?.complete(with: $0) },
                         cancel: { [weak self] in self?.cancel(.userCanceled) }))
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        // Until the vault can unlock itself, ask the system to show our interface.
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        guard let item = SharedVault.allItems.first(where: { $0.id.uuidString == credentialIdentity.recordIdentifier }) else {
            return cancel(.credentialIdentityNotFound)
        }
        present(FillConfirm(item: item,
                            fill: { [weak self] in self?.complete(with: item) },
                            cancel: { [weak self] in self?.cancel(.userCanceled) }))
    }

    // MARK: Save (iOS 26.2 and later)

    override func performWithoutUserInteractionIfPossible(savePasswordRequest: ASSavePasswordRequest) {
        cancel(.userInteractionRequired)
    }

    override func prepareInterface(for savePasswordRequest: ASSavePasswordRequest) {
        let host = SharedVault.host(savePasswordRequest.serviceIdentifier.identifier)
        let credential = savePasswordRequest.credential
        let existing = SharedVault.allItems.first { SharedVault.matches($0, host: host) && $0.account == credential.user }
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
            SharedVault.save(item)
            self?.extensionContext.completeSavePasswordRequest { _ in }
        }, cancel: { [weak self] in self?.cancel(.userCanceled) }))
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
        guard let request = registrationRequest as? ASPasskeyCredentialRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
            return cancel(.failed)
        }
        guard request.supportedAlgorithms.isEmpty || request.supportedAlgorithms.contains(.ES256) else {
            return cancel(.failed)
        }
        // The system sheet has already asked "Save a passkey?", so there is no second confirmation here.
        // A real vault asks for Face ID or Touch ID at this point instead.
        let rpID = identity.relyingPartyIdentifier
        let registration = Passkeys.register(rpID: rpID, userHandle: identity.userHandle,
                                             clientDataHash: request.clientDataHash)
        var item = VaultItem(kind: .login, account: identity.userName, website: rpID)
        item.passkey = registration.record
        item.lastUsed = .now
        SharedVault.save(item)
        SharedVault.registerIdentities(for: SharedVault.allItems)
        extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(
            relyingParty: rpID, clientDataHash: request.clientDataHash,
            credentialID: registration.record.credentialID,
            attestationObject: registration.attestationObject))
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier],
                                        requestParameters: ASPasskeyCredentialRequestParameters) {
        let rpID = requestParameters.relyingPartyIdentifier
        let allowed = requestParameters.allowedCredentials
        let items = SharedVault.allItems.filter { item in
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

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        cancel(.userInteractionRequired)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        if let request = credentialRequest as? ASPasskeyCredentialRequest,
           let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity {
            guard let item = SharedVault.allItems.first(where: { $0.id.uuidString == identity.recordIdentifier }),
                  item.passkey != nil else { return cancel(.credentialIdentityNotFound) }
            assert(item, clientDataHash: request.clientDataHash)
        } else if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            prepareInterfaceToProvideCredential(for: identity)
        } else {
            cancel(.failed)
        }
    }

    private func assert(_ item: VaultItem, clientDataHash: Data) {
        guard let passkey = item.passkey, let result = try? Passkeys.assert(passkey, clientDataHash: clientDataHash) else {
            return cancel(.failed)
        }
        var used = item
        used.lastUsed = .now
        used.useCount += 1
        SharedVault.save(used)
        extensionContext.completeAssertionRequest(using: ASPasskeyAssertionCredential(
            userHandle: passkey.userHandle, relyingParty: passkey.rpID, signature: result.signature,
            clientDataHash: clientDataHash, authenticatorData: result.authenticatorData,
            credentialID: passkey.credentialID))
    }

    // MARK: Helpers

    private func complete(with item: VaultItem) {
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
