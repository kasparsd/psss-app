import Darwin
import Foundation

// A test-only relay server over REAL encrypted vaults, for the relay harness (scripts/test-relay.sh, relay.test.mjs). It is the app's
// `BrowserRelayServer` and `BrowserProtocol` over a `VaultSession` and `SessionVaultService`, exactly as the app wires them, with an
// accepting peer policy, so a test can `kill -9` it in the middle of a `save` and then open the vault file again.
//
//   psss-relay-vault prepare                     make two vaults, "Save A" and "Save B", each with one login; prints `ids A B`
//   psss-relay-vault serve --directory RELAY_DIR  unlock both and serve; prints `ready <socket>`
//   psss-relay-vault check --vault ID            open the vault from its file in a new process; prints one JSON line of its logins
//   environment: PSSS_TEST_ROOT (every file lives there; the build refuses to run without it), PSSS_VAULT_PASSWORD
//
// Fixtures only. It never runs against real vaults: the hostless build has no App Group and stops without PSSS_TEST_ROOT.

func argument(_ name: String) -> String? {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
func fail(_ words: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("\(words)\n".utf8))
    exit(code)
}

let password = ProcessInfo.processInfo.environment["PSSS_VAULT_PASSWORD"] ?? ""
guard !password.isEmpty else { fail("PSSS_VAULT_PASSWORD is not set", code: 64) }
let credentials = KDBXCredentials(password: password)

@MainActor func prepare() async {
    let session = VaultSession()
    do {
        let a = VaultItem(kind: .login, title: "Gitforge (A)", account: "a@example.net", website: "gitforge.example", secret: "Seed-A-secret-1")
        let b = VaultItem(kind: .login, title: "Gitforge (B)", account: "b@example.net", website: "gitforge.example", secret: "Seed-B-secret-1")
        try await session.create(name: "Save A", credentials: credentials, items: [a])
        let first = session.reference!.id
        try await session.create(name: "Save B", credentials: credentials, items: [b])
        print("ids \(first.uuidString) \(session.reference!.id.uuidString)")
    } catch {
        fail("prepare failed")
    }
}

@MainActor func openAll(_ session: VaultSession) async throws {
    for vault in session.knownVaults {
        session.show(vault.id)
        try await session.unlock(credentials: credentials, savingQuickUnlockKey: false)
    }
}

@MainActor func serve() async {
    guard let directory = argument("--directory") else { fail("usage: serve --directory RELAY_DIR", code: 64) }
    let session = VaultSession()
    do { try await openAll(session) } catch { fail("could not open the vaults") }
    BrowserProtocol.vaultService = SessionVaultService(session: session)
    let server = BrowserRelayServer(.init(
        directory: URL(fileURLWithPath: directory, isDirectory: true),
        policy: PeerPolicy.testing("accept"),
        callerAllowed: { _ in true },
        allowedTypes: ["ping", "vaults", "candidates", "search", "credential", "generate", "save"],
        handler: { request in
            guard let object = RelayFrame.object(request) else { return RelayFrame.error("unsupported") }
            return (try? JSONSerialization.data(withJSONObject: BrowserProtocol.handle(object))) ?? RelayFrame.error("failed")
        }))
    switch server.start() {
    case .listening(let path): print("ready \(path)"); fflush(stdout)
    default: fail("could not listen", code: 5)
    }
    // Stay up until killed.
    while true { try? await Task.sleep(nanoseconds: 3_600_000_000_000) }
}

@MainActor func check() async {
    guard let id = argument("--vault").flatMap(UUID.init(uuidString:)) else { fail("usage: check --vault ID", code: 64) }
    let session = VaultSession()
    guard session.knownVaults.contains(where: { $0.id == id }) else { fail("unknown vault") }
    session.show(id)
    do { try await session.unlock(credentials: credentials, savingQuickUnlockKey: false) } catch { fail("the vault file does not open") }
    guard let store = session.store(for: id) else { fail("the vault is not open") }
    let items = store.items().map { ["title": $0.displayTitle, "account": $0.account, "website": $0.website, "secret": $0.secret] }
    let history = store.items().map { store.previousPasswords(of: $0.id).count }
    let json = try? JSONSerialization.data(withJSONObject: ["items": items, "history": history])
    print(String(decoding: json ?? Data("{}".utf8), as: UTF8.self))
}

switch CommandLine.arguments.dropFirst().first {
case "prepare": await prepare()
case "serve": await serve()
case "check": await check()
default: fail("usage: psss-relay-vault prepare | serve --directory DIR | check --vault ID", code: 64)
}
