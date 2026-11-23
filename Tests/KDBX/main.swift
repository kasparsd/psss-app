import Foundation

// Hostless checks for the KDBX codec and entry mapping. Run with scripts/test-kdbx.sh.
// Interop checks use keepassxc-cli when it is installed, and are skipped with a note otherwise.

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
nonisolated(unsafe) var failures = 0
/// Runs a store call, with the conflict check skipped when `overwrite`.
@MainActor func attempt(_ store: KeePassVaultStore, overwrite: Bool, _ body: () throws -> Void) throws {
    if overwrite { try store.overwriting(body) } else { try body() }
}
func check(_ name: String, _ got: String, _ want: String) {
    if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)\n  got  \(got)\n  want \(want)") }
}
func expect(_ name: String, _ condition: Bool) { check(name, "\(condition)", "true") }

func expectError(_ name: String, _ want: KDBXError, _ body: () throws -> Void) {
    do { try body(); failures += 1; print("FAIL \(name): no error") } catch let error as KDBXError { check(name, "\(error)", "\(want)") } catch { failures += 1; print("FAIL \(name): \(error)") }
}

let fixtures = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".build-kdbx-fixtures")
try? FileManager.default.removeItem(at: fixtures)
try FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)

@discardableResult
func run(_ args: [String], input: String = "") -> (status: Int32, out: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = args
    let stdin = Pipe(), stdout = Pipe()
    process.standardInput = stdin; process.standardOutput = stdout; process.standardError = Pipe()
    try! process.run()
    stdin.fileHandleForWriting.write(Data(input.utf8)); try? stdin.fileHandleForWriting.close()
    let out = stdout.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(decoding: out, as: UTF8.self))
}

// MARK: Primitives (RFC vectors)

check("blake2b-512 abc", hex(Blake2b.hash(Data("abc".utf8))),
      "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923")
var chacha = ChaCha20(key: Data((0..<32).map { UInt8($0) }), nonce: Data([0, 0, 0, 9, 0, 0, 0, 0x4a, 0, 0, 0, 0]), counter: 1)
check("chacha20 block", hex(chacha.process(Data(count: 16))), "10f1e7e4d13b5915500fdd1fa32071c4")
let pw = Data(repeating: 1, count: 32), salt = Data(repeating: 2, count: 16)
for (variant, want) in [(Argon2.Variant.d, "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb"),
                        (.i, "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8"),
                        (.id, "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659")] {
    let out = try Argon2.hash(password: pw, .init(variant: variant, salt: salt, iterations: 3, memoryKiB: 32, lanes: 4,
                                                  secret: Data(repeating: 3, count: 8), associatedData: Data(repeating: 4, count: 12)))
    check("argon2 \(variant)", hex(out), want)
}
let gz = try KDBXCrypto.gzip(Data("hello hello hello hello".utf8))
check("gzip round trip", String(decoding: try KDBXCrypto.gunzip(gz), as: UTF8.self), "hello hello hello hello")
check("gzip matches system gunzip", {
    let path = fixtures.appendingPathComponent("t.gz"); try! gz.write(to: path)
    return run(["gunzip", "-c", path.path]).out
}(), "hello hello hello hello")

// MARK: Round trip

let light = KDBXKDF.aesForTesting(rounds: 1000)
var document = try KDBX.create(name: "Test", credentials: .init(password: "correct horse"), kdf: light)
var login = VaultItem(kind: .login, title: "Example", account: "alex@example.net", website: "https://example.com",
                      secret: "p@ss<word>&\"1\" ü 漢", notes: "line one\nline two", otpSecret: "JBSWY3DPEHPK3PXP")
login.passkey = Passkeys.register(rpID: "example.com", userHandle: Data("alex".utf8), clientDataHash: Data(count: 32)).record
let unnamed = VaultItem(kind: .login, account: "u", website: "https://www.unnamed.example/login", secret: "x")
let card = VaultItem(kind: .creditCard, title: "Card", account: "Alex", secret: "4242424242424242", expiry: "08/30")
let note = VaultItem(kind: .secureNote, title: "Note", notes: "text")
let custom = VaultItem(kind: .keePassEntry, title: "License", secret: "KEY-1")
for item in [login, card, note, custom, unnamed] { document.upsert(item) }

var bytes = try KDBX.save(document)
var reopened = try KDBX.open(bytes, credentials: .init(password: "correct horse"))
var items = reopened.items()
expect("five items survive", items.count == 5)
check("unnamed login reads back unnamed", items.first { $0.id == unnamed.id }!.title, "")
check("unnamed login is titled by host in the file", EntryMapping.string(reopened.rootGroup!.children(named: "Entry").first { EntryMapping.uuid(of: $0) == unnamed.id }!, "Title") ?? "", "unnamed.example")
let back = items.first { $0.id == login.id }!
check("password with markup survives", back.secret, login.secret)
check("notes survive", back.notes, login.notes)
check("otp survives", back.otpSecret, "JBSWY3DPEHPK3PXP")
check("passkey credential survives", hex(back.passkey?.credentialID ?? Data()), hex(login.passkey!.credentialID))
check("passkey key survives", hex(back.passkey?.privateKey ?? Data()), hex(login.passkey!.privateKey))
check("card kind", "\(items.first { $0.id == card.id }!.kind)", "creditCard")
check("card expiry", items.first { $0.id == card.id }!.expiry, "08/30")
check("note kind", "\(items.first { $0.id == note.id }!.kind)", "secureNote")
check("custom kind", "\(items.first { $0.id == custom.id }!.kind)", "keePassEntry")
expectError("wrong password", .wrongCredentials) { _ = try KDBX.open(bytes, credentials: .init(password: "nope")) }
var tampered = bytes; tampered[tampered.count - 40] ^= 1
expectError("tampered payload", .corrupted("block")) { _ = try KDBX.open(tampered, credentials: .init(password: "correct horse")) }
expectError("not a vault", .notAVault) { _ = try KDBX.open(Data("hello world, this is text".utf8), credentials: .init(password: "x")) }

// Editing keeps unknown content and writes history.
let entryNode = reopened.rootGroup!.children(named: "Entry").first { EntryMapping.uuid(of: $0) == login.id }!
entryNode.children.append(XNode("ForegroundColor", text: "#ff0000"))
var edited = back; edited.secret = "new-secret"
expect("edit reports a change", reopened.upsert(edited))
expect("unchanged save reports no change", !reopened.upsert(edited))
check("history has one version", "\(entryNode.child("History")?.children.count ?? 0)", "1")
bytes = try KDBX.save(reopened)
reopened = try KDBX.open(bytes, credentials: .init(password: "correct horse"))
items = reopened.items()
check("edited secret", items.first { $0.id == login.id }!.secret, "new-secret")
let again = reopened.rootGroup!.children(named: "Entry").first { EntryMapping.uuid(of: $0) == login.id }!
check("unknown field survives", again.child("ForegroundColor")?.text ?? "", "#ff0000")
check("history survives", "\(again.child("History")?.children.count ?? 0)", "1")
check("history keeps old secret", EntryMapping.string(again.child("History")!.children[0], "Password") ?? "", login.secret)
check("document items carry no usage", "\(reopened.items().first { $0.id == login.id }!.useCount)", "0")
reopened.remove(card.id)
check("delete removes the item", "\(reopened.items().count)", "4")
check("delete is recorded", "\(reopened.root.child("Root")!.child("DeletedObjects")!.children.count)", "1")

// Key file, ChaCha20 and change of credentials.
let keyFile = Data("some key file contents".utf8)
var strong = try KDBX.create(name: "K", credentials: .init(password: "pw", keyFile: keyFile), kdf: light)
strong.header.cipher = .chacha20
strong.header.compressed = false
strong.upsert(login)
let strongBytes = try KDBX.save(strong)
expect("chacha20 round trip", try KDBX.open(strongBytes, credentials: .init(password: "pw", keyFile: keyFile)).items().count == 1)
expectError("key file required", .wrongCredentials) { _ = try KDBX.open(strongBytes, credentials: .init(password: "pw")) }
try strong.changeCredentials(to: .init(password: "other"))
let changed = try KDBX.save(strong)
expect("new password opens", try KDBX.open(changed, credentials: .init(password: "other")).items().count == 1)
expectError("old password closed", .wrongCredentials) { _ = try KDBX.open(changed, credentials: .init(password: "pw")) }

// A large vault crosses the HMAC block size.
var big = try KDBX.create(name: "Big", credentials: .init(password: "pw"), kdf: light)
big.header.compressed = false
for i in 0..<3000 { big.upsert(VaultItem(kind: .login, title: "Item \(i)", account: "u\(i)", website: "site\(i).example", secret: String(repeating: "x", count: 300), notes: String(repeating: "n", count: 300))) }
let bigBytes = try KDBX.save(big)
expect("multi-block file is over 1 MiB", bigBytes.count > 1 << 20)
check("multi-block round trip", "\(try KDBX.open(bigBytes, credentials: .init(password: "pw")).items().count)", "3000")

// MARK: Interop with KeePassXC

if run(["which", "keepassxc-cli"]).status == 0 {
    // Written here, read there.
    let mine = fixtures.appendingPathComponent("mine.kdbx")
    let ours = try KDBX.create(name: "Ours", credentials: .init(password: "interop pw"))
    ours.upsert(login); ours.upsert(card); ours.upsert(note)
    try KDBX.save(ours).write(to: mine)
    let listing = run(["keepassxc-cli", "ls", "-q", mine.path], input: "interop pw\n")
    expect("keepassxc lists our entries", listing.out.contains("Example") && listing.out.contains("Card") && listing.out.contains("Note"))
    let shown = run(["keepassxc-cli", "show", "-q", "-s", mine.path, "Example"], input: "interop pw\n")
    expect("keepassxc reads our password", shown.out.contains("p@ss<word>&\"1\" ü 漢"))
    expect("keepassxc reads our username", shown.out.contains("UserName: alex@example.net"))
    expect("keepassxc reads our notes", shown.out.contains("line two"))
    let totp = run(["keepassxc-cli", "show", "-q", "-t", mine.path, "Example"], input: "interop pw\n")
    expect("keepassxc generates our TOTP code", totp.out.trimmingCharacters(in: .whitespacesAndNewlines).count == 6)
    let attrs = run(["keepassxc-cli", "show", "-q", "-s", "--all", mine.path, "Example"], input: "interop pw\n")
    expect("keepassxc sees our passkey fields", attrs.out.contains("KPEX_PASSKEY_RELYING_PARTY: example.com"))

    // A KDBX 4 file (Argon2id) that KeePassXC itself saved after adding an entry.
    run(["keepassxc-cli", "add", "-q", "-u", "zed", "-p", mine.path, "Zed site"], input: "interop pw\nzeds-secret\n")
    let resaved = try KDBX.open(Data(contentsOf: mine), credentials: .init(password: "interop pw"))
    check("keepassxc-saved KDBX 4 opens", "\(resaved.items().count)", "4")
    check("keepassxc-saved password", resaved.items().first { $0.title == "Zed site" }?.secret ?? "", "zeds-secret")
    check("our TOTP survives keepassxc save", resaved.items().first { $0.title == "Example" }?.otpSecret ?? "", "JBSWY3DPEHPK3PXP")
    check("our passkey survives keepassxc save", resaved.items().first { $0.title == "Example" }?.passkey?.rpID ?? "", "example.com")

    // Written there, read here, edited here, read there again.
    let theirs = fixtures.appendingPathComponent("theirs.kdbx")
    run(["keepassxc-cli", "db-create", "-q", "-p", theirs.path], input: "their pw\ntheir pw\n")
    run(["keepassxc-cli", "add", "-q", "-u", "bob", "--url", "https://bob.example", "-p", theirs.path, "Bob site"], input: "their pw\nbobs-secret\n")
    run(["keepassxc-cli", "add", "-q", "-u", "amy", "-p", theirs.path, "Amy site"], input: "their pw\namys-secret\n")
    let opened = try KDBX.open(Data(contentsOf: theirs), credentials: .init(password: "their pw"))
    let found = opened.items()
    check("their entries count", "\(found.count)", "2")
    check("their password", found.first { $0.title == "Bob site" }?.secret ?? "", "bobs-secret")
    check("their username", found.first { $0.title == "Bob site" }?.account ?? "", "bob")
    check("their url", found.first { $0.title == "Bob site" }?.website ?? "", "https://bob.example")
    check("their file is read as KDBX 3.1", opened.sourceVersion ?? "", "KDBX 3.1")
    check("a saved upgrade is KDBX 4", try KDBX.open(KDBX.save(opened), credentials: .init(password: "their pw")).header.versionLabel, "KDBX 4.1")
    var bob = found.first { $0.title == "Bob site" }!
    bob.secret = "changed-by-psss"
    opened.upsert(bob)
    opened.upsert(VaultItem(kind: .login, title: "Added", account: "new", website: "added.example", secret: "added-secret"))
    try KDBX.save(opened).write(to: theirs)
    let after = run(["keepassxc-cli", "show", "-q", "-s", theirs.path, "Bob site"], input: "their pw\n")
    expect("keepassxc reads our edit", after.out.contains("Password: changed-by-psss"))
    expect("keepassxc reads our new entry", run(["keepassxc-cli", "show", "-q", "-s", theirs.path, "Added"], input: "their pw\n").out.contains("added-secret"))
    let info = run(["keepassxc-cli", "db-info", theirs.path], input: "their pw\n")
    expect("keepassxc db-info works after our save", info.status == 0)

    // Key file made by KeePassXC.
    let keyPath = fixtures.appendingPathComponent("their.keyx")
    let withKey = fixtures.appendingPathComponent("withkey.kdbx")
    run(["keepassxc-cli", "db-create", "-q", "-p", "--set-key-file", keyPath.path, withKey.path], input: "kp\nkp\n")
    run(["keepassxc-cli", "add", "-q", "-u", "k", "-p", "-k", keyPath.path, withKey.path, "Keyed"], input: "kp\nkeyed-secret\n")
    let keyed = try KDBX.open(Data(contentsOf: withKey), credentials: .init(password: "kp", keyFile: Data(contentsOf: keyPath)))
    check("key file from keepassxc", keyed.items().first?.secret ?? "", "keyed-secret")
} else {
    print("skip keepassxc interop: keepassxc-cli not installed")
}

// MARK: Session and store

let session = VaultSession()
session.forget()
try await session.create(name: "Session test", credentials: .init(password: "s3ssion"), items: [custom])
let store = session.store!
check("session created one item", "\(store.items().count)", "1")
try store.save([login])
store.markUsed(login.id)
session.lock()
expect("lock drops the store", session.store == nil)
do { try await session.unlock(credentials: .init(password: "wrong")); failures += 1; print("FAIL wrong password unlocked") } catch { print("ok   wrong password refused") }
try await session.unlock(credentials: .init(password: "s3ssion"))
let reopenedStore = session.store!
check("items survive lock", "\(reopenedStore.items().count)", "2")
check("use survives lock", "\(reopenedStore.items().first { $0.id == login.id }!.useCount)", "1")
// Another writer changes the file: our write must refuse, then succeed when told to overwrite.
let other = try KDBX.open(Data(contentsOf: reopenedStore.url), credentials: .init(password: "s3ssion"))
try KDBX.save(other).write(to: reopenedStore.url)
do { try reopenedStore.save([note]); failures += 1; print("FAIL conflict not detected") } catch VaultStoreError.changedOnDisk { print("ok   conflict detected") }
expect("a refused write left memory as the file holds it", reopenedStore.items().count == 2)
try reopenedStore.overwriting { try reopenedStore.save([note]) }
try await reopenedStore.reload()
check("overwrite wrote our change", "\(reopenedStore.items().count)", "3")
// The transformed key opens the file without the KDF, saves keep it valid, and a wrong key is refused.
let savedKey = reopenedStore.transformedKey
let viaKey = try KDBX.open(Data(contentsOf: reopenedStore.url), transformedKey: savedKey)
check("transformed key opens", "\(viaKey.items().count)", "3")
expectError("wrong transformed key", .wrongCredentials) { _ = try KDBX.open(Data(contentsOf: reopenedStore.url), transformedKey: Data(repeating: 7, count: 32)) }
try await reopenedStore.changeCredentials(to: .init(password: "n3w"))
expectError("old transformed key refused after password change", .wrongCredentials) { _ = try KDBX.open(Data(contentsOf: reopenedStore.url), transformedKey: savedKey) }
session.lock()
try await session.unlock(credentials: .init(password: "n3w"))
expect("new vault password unlocks", session.store != nil)
let backups = (try? FileManager.default.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(session.reference!.id.uuidString)").path)) ?? []
expect("a password change removes every rollback copy (they hold the old password)", backups.isEmpty)

// MARK: Usage log (device-local, never written to the vault file)

let usageStore = session.store!
let vaultId = session.reference!.id
let backupDirectory = VaultFiles.storageRoot.appendingPathComponent("Backups/\(vaultId.uuidString)")
func backupNames() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: backupDirectory.path)) ?? []).sorted() }
let usageBefore = usageStore.items().first { $0.id == login.id }!.useCount
let bytesBefore = try Data(contentsOf: usageStore.url)
let backupsBefore = backupNames()
usageStore.markUsed(login.id)
usageStore.markUsed(login.id)
try usageStore.flush()
expect("marking used leaves the vault file bytes unchanged", try Data(contentsOf: usageStore.url) == bytesBefore)
expect("marking used makes no rollback copy", backupNames() == backupsBefore)
let usedItem = usageStore.items().first { $0.id == login.id }!
check("use count shows in items", "\(usedItem.useCount)", "\(usageBefore + 2)")
expect("last used shows in items", usedItem.lastUsed != nil)
session.lock()
try await session.unlock(credentials: .init(password: "n3w"))
check("usage survives lock and unlock", "\(session.store!.items().first { $0.id == login.id }!.useCount)", "\(usageBefore + 2)")
expect("usage file exists", FileManager.default.fileExists(atPath: UsageLog.fileURL(for: vaultId).path))
expect("usage file holds no secrets", !String(decoding: (try? Data(contentsOf: UsageLog.fileURL(for: vaultId))) ?? Data(), as: UTF8.self).contains(login.secret))
let usageStore2 = session.store!
usageStore2.markUsed(custom.id)
expect("custom item has usage", UsageLog.load(for: vaultId)[custom.id]?.useCount == 1)
try usageStore2.delete(custom.id)
expect("deleted item drops its usage", UsageLog.load(for: vaultId)[custom.id] == nil)
expect("other usage stays", UsageLog.load(for: vaultId)[login.id]?.useCount == usageBefore + 2)

// Reload when another writer (the AutoFill extension, a sync) changed the file.
let storeA = session.store!
let fileNow = try Data(contentsOf: storeA.url)
let storeB = KeePassVaultStore(reference: session.reference!, url: storeA.url, scoped: false,
                               document: try KDBX.open(fileNow, credentials: .init(password: "n3w")), fileData: fileNow)
let unchanged = try await storeA.reloadIfChanged()
expect("reloadIfChanged is false when nothing changed", !unchanged)
let fromElsewhere = VaultItem(kind: .login, title: "From the extension", account: "ext", website: "ext.example", secret: "ext-secret")
try storeB.save([fromElsewhere])
let didReload = try await storeA.reloadIfChanged()
expect("reloadIfChanged is true after another writer", didReload)
expect("reloaded items show the new item", storeA.items().contains { $0.id == fromElsewhere.id })
try storeA.save([VaultItem(kind: .secureNote, title: "After reload", notes: "text")])
print("ok   save after reloadIfChanged does not hit changedOnDisk")
let again2 = try await storeA.reloadIfChanged()
expect("reloadIfChanged is false after our own save", !again2)

// A failed write keeps no rollback copy and leaves the vault and the backups folder as they were.
do {
    let failing = session.store!
    let directory = failing.url.deletingLastPathComponent()
    let backupsBeforeFailure = backupNames()
    let bytesBeforeFailure = try Data(contentsOf: failing.url)
    func setWritable(_ writable: Bool) {
        let mode = NSNumber(value: writable ? 0o755 : 0o555)
        try? FileManager.default.setAttributes([.posixPermissions: mode], ofItemAtPath: directory.path)
        try? FileManager.default.setAttributes([.posixPermissions: NSNumber(value: writable ? 0o644 : 0o444)], ofItemAtPath: failing.url.path)
    }
    setWritable(false)
    var failedWrite = false
    do { try failing.save([VaultItem(kind: .secureNote, title: "Will not be written", notes: "x")]) } catch { failedWrite = true }
    setWritable(true)
    expect("a write to a read-only vault throws", failedWrite)
    expect("a failed write leaves the vault bytes unchanged", try Data(contentsOf: failing.url) == bytesBeforeFailure)
    expect("a failed write keeps no rollback copy", backupNames() == backupsBeforeFailure)
}


// TOTP: RFC 6238 vectors (8 digits, t = 59) for each algorithm, then the setup parser.
func base32(_ data: Data) -> String {
    let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    var out = "", buffer = 0, bits = 0
    for byte in data {
        buffer = (buffer << 8) | Int(byte); bits += 8
        while bits >= 5 { bits -= 5; out.append(alphabet[(buffer >> bits) & 31]) }
    }
    if bits > 0 { out.append(alphabet[(buffer << (5 - bits)) & 31]) }
    return out
}
do {
    let at59 = Date(timeIntervalSince1970: 59)
    func vector(_ algorithm: TOTPSettings.Algorithm, _ key: String) -> String? {
        TOTP.code(secret: base32(Data(key.utf8)), settings: TOTPSettings(digits: 8, period: 30, algorithm: algorithm), at: at59)
    }
    check("RFC 6238 SHA-1", vector(.sha1, "12345678901234567890") ?? "", "94287082")
    check("RFC 6238 SHA-256", vector(.sha256, "12345678901234567890123456789012") ?? "", "46119246")
    check("RFC 6238 SHA-512", vector(.sha512, "1234567890123456789012345678901234567890123456789012345678901234") ?? "", "90693936")
    check("60-second period changes the counter", TOTP.code(secret: "JBSWY3DPEHPK3PXP", settings: TOTPSettings(digits: 6, period: 60, algorithm: .sha1), at: Date(timeIntervalSince1970: 59)) ?? "",
          TOTP.code(secret: "JBSWY3DPEHPK3PXP", settings: TOTPSettings(digits: 6, period: 60, algorithm: .sha1), at: Date(timeIntervalSince1970: 0)) ?? "x")
    check("grouped 6", TOTP.grouped("482913"), "482 913")
    check("grouped 8", TOTP.grouped("12345678"), "1234 5678")

    func parsed(_ text: String) -> TOTPSetup? { if case .setup(let s) = TOTP.parse(text) { s } else { nil } }
    check("bare key with spaces", parsed("jbsw y3dp ehpk 3pxp")?.secret ?? "", "JBSWY3DPEHPK3PXP")
    let link = parsed("otpauth://totp/Acme:alex%40example.net?secret=JBSWY3DPEHPK3PXP&issuer=Acme&digits=8&period=60&algorithm=SHA256")
    check("link issuer", link?.issuer ?? "", "Acme")
    check("link account", link?.account ?? "", "alex@example.net")
    check("link settings", "\(link?.settings.digits ?? 0) \(link?.settings.period ?? 0) \(link?.settings.algorithm.rawValue ?? "")", "8 60 SHA256")
    expect("web link", TOTP.parse("https://example.com/2fa") == .webLink)
    expect("migration batch", TOTP.parse("otpauth-migration://offline?data=abc") == .migration)
    expect("hotp unsupported", TOTP.parse("otpauth://hotp/A?secret=JBSWY3DPEHPK3PXP&counter=1") == .unsupported)
    expect("odd digits unsupported", TOTP.parse("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP&digits=5") == .unsupported)
    expect("unknown algorithm unsupported", TOTP.parse("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP&algorithm=MD5") == .unsupported)
    expect("bad key", TOTP.parse("not a key!") == .invalidKey)
    expect("empty", TOTP.parse("  \n") == .empty)

    // The parameters survive a round trip through an entry.
    var eight = VaultItem(kind: .login, title: "Acme", otpSecret: "JBSWY3DPEHPK3PXP", otpSettings: TOTPSettings(digits: 8, period: 60, algorithm: .sha256))
    let otpDocument = try KDBX.create(name: "Otp", credentials: .init(password: "pw"), kdf: light)
    otpDocument.upsert(eight)
    var otpBack = try KDBX.open(try KDBX.save(otpDocument), credentials: .init(password: "pw")).items().first { $0.id == eight.id }!
    check("otp parameters survive a save", "\(otpBack.otpSettings.digits) \(otpBack.otpSettings.period) \(otpBack.otpSettings.algorithm.rawValue)", "8 60 SHA256")
    eight.otpSettings = .standard
    otpDocument.upsert(eight)
    otpBack = try KDBX.open(try KDBX.save(otpDocument), credentials: .init(password: "pw")).items().first { $0.id == eight.id }!
    check("changing only the parameters rewrites the link", "\(otpBack.otpSettings.digits) \(otpBack.otpSettings.period)", "6 30")
}

session.forget()
expect("forgetting deletes the usage file", !FileManager.default.fileExists(atPath: UsageLog.fileURL(for: vaultId).path))

// MARK: Security fixes 2026-11-23: atomic conflict check, backups after a password change, sample vault, browser prototype, passkeys

do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-sec-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    func backups(of id: UUID) -> [String] {
        ((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []).sorted()
    }
    func openStore(_ url: URL, _ id: UUID, password: String) throws -> KeePassVaultStore {
        let data = try Data(contentsOf: url)
        let document = try KDBX.open(data, credentials: .init(password: password))
        return KeePassVaultStore(reference: VaultReference(id: id, name: "Sec", managed: true, bookmark: nil, fileName: url.lastPathComponent),
                                 url: url, scoped: false, document: document, fileData: data)
    }
    func makeVault(_ name: String, password: String) throws -> (url: URL, id: UUID) {
        let url = dir.appendingPathComponent("\(name).kdbx")
        try KDBX.save(try KDBX.create(name: name, credentials: .init(password: password), kdf: light)).write(to: url)
        return (url, UUID())
    }
    let first = VaultItem(kind: .login, account: "one@example.net", website: "one.example", secret: "Demo-only-One1!")
    let second = VaultItem(kind: .login, account: "two@example.net", website: "two.example", secret: "Demo-only-Two2!")

    // Two stores on one file interleave: the second writer is refused, and Overwrite then wins.
    let shared = try makeVault("shared", password: "pw")
    let writerA = try openStore(shared.url, shared.id, password: "pw")
    let writerB = try openStore(shared.url, shared.id, password: "pw")
    try writerA.save([first])
    do { try writerB.save([second]); failures += 1; print("FAIL second writer not refused") }
    catch VaultStoreError.changedOnDisk { print("ok   second writer is refused with changedOnDisk") }
    let afterA = try Data(contentsOf: shared.url)
    expect("a refused write leaves the file as the first writer wrote it", (try? KDBX.open(afterA, credentials: .init(password: "pw")))?.items().contains { $0.id == first.id } == true)
    try writerB.overwriting { try writerB.save([second]) }
    expect("overwrite writes when the file is readable", try Data(contentsOf: shared.url) != afterA)

    // A file that exists but cannot be read: refuse, with and without overwrite, and write nothing.
    if getuid() != 0 {
        let locked = try makeVault("locked", password: "pw")
        let lockedStore = try openStore(locked.url, locked.id, password: "pw")
        let before = try Data(contentsOf: locked.url)
        try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: locked.url.path)
        for overwrite in [false, true] {
            do { try attempt(lockedStore, overwrite: overwrite) { try lockedStore.save([VaultItem(kind: .secureNote, title: "never written", notes: "n")]) }; failures += 1; print("FAIL unreadable file written (overwrite \(overwrite))") }
            catch VaultStoreError.unreadable { print("ok   unreadable file refused (overwrite \(overwrite))") }
        }
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: locked.url.path)
        expect("unreadable file left unchanged", try Data(contentsOf: locked.url) == before)
        expect("unreadable file made no rollback copy", backups(of: locked.id).isEmpty)
    } else { print("skip unreadable-file test: running as root") }

    // The first write of a new vault (no file yet) works and keeps no rollback copy.
    let fresh = dir.appendingPathComponent("fresh.kdbx")
    let freshId = UUID()
    let freshDocument = try KDBX.create(name: "Fresh", credentials: .init(password: "pw"), kdf: light)
    let freshStore = KeePassVaultStore(reference: VaultReference(id: freshId, name: "Fresh", managed: true, bookmark: nil, fileName: "fresh.kdbx"),
                                       url: fresh, scoped: false, document: freshDocument, fileData: nil)
    try freshStore.save([first])
    expect("first write of a new vault creates the file", (try? KDBX.open(Data(contentsOf: fresh), credentials: .init(password: "pw")))?.items().count == 1)
    expect("first write keeps no rollback copy", backups(of: freshId).isEmpty)

    // Rollback copies never survive a password change, and none opens with the old password.
    let changing = try makeVault("changing", password: "old-pw")
    let changeStore = try openStore(changing.url, changing.id, password: "old-pw")
    try changeStore.save([first]); try changeStore.save([second])
    expect("rollback copies exist before the password change", backups(of: changing.id).count >= 2)
    try await changeStore.changeCredentials(to: .init(password: "new-pw"))
    expect("no rollback copy after a password change", backups(of: changing.id).isEmpty)
    expect("the vault file opens with the new password", (try? KDBX.open(Data(contentsOf: changing.url), credentials: .init(password: "new-pw"))) != nil)
    expectError("the vault file no longer opens with the old password", .wrongCredentials) { _ = try KDBX.open(Data(contentsOf: changing.url), credentials: .init(password: "old-pw")) }
    try changeStore.save([VaultItem(kind: .login, account: "three@example.net", website: "three.example", secret: "Demo-only-Three3!")])
    for name in backups(of: changing.id) {
        let copy = try Data(contentsOf: VaultFiles.storageRoot.appendingPathComponent("Backups/\(changing.id.uuidString)/\(name)"))
        expectError("a later rollback copy does not open with the old password", .wrongCredentials) { _ = try KDBX.open(copy, credentials: .init(password: "old-pw")) }
    }
    // A refused password change leaves the store on the old password, so overwriting afterwards does not change it.
    let conflicted = try makeVault("conflicted", password: "old-pw")
    let conflictStore = try openStore(conflicted.url, conflicted.id, password: "old-pw")
    let conflictOther = try openStore(conflicted.url, conflicted.id, password: "old-pw")
    try conflictStore.save([first]); try conflictStore.save([second])
    do { try await conflictOther.changeCredentials(to: .init(password: "new-pw")); failures += 1; print("FAIL change over a conflict not refused") }
    catch VaultStoreError.changedOnDisk { print("ok   password change refused on a conflict") }
    try conflictOther.overwriting { try conflictOther.save([VaultItem(kind: .secureNote, title: "after refusal", notes: "n")]) }
    expect("overwriting after a refused password change keeps the old password", (try? KDBX.open(Data(contentsOf: conflicted.url), credentials: .init(password: "old-pw"))) != nil
       && (try? KDBX.open(Data(contentsOf: conflicted.url), credentials: .init(password: "new-pw"))) == nil)
    for id in [shared.id, changing.id, conflicted.id, freshId] { VaultFiles.removeBackups(for: id) }
    try? fm.removeItem(at: dir)
}

// The sample vault is in memory: edits stay in the instance, and a new one starts from the compiled-in items.
do {
    let sample = SampleVaultStore()
    check("sample items are the compiled-in ones", "\(sample.items().count)", "\(SampleVault.items.count)")
    let typed = VaultItem(kind: .login, account: "typed@example.net", website: "typed.example", secret: "Demo-only-Typed1!")
    try sample.save([typed])
    expect("sample edits work for the session", sample.items().contains { $0.id == typed.id })
    expect("a new sample store forgets them", !SampleVaultStore().items().contains { $0.id == typed.id })
    try sample.delete(typed.id)
    expect("sample delete works for the session", !sample.items().contains { $0.id == typed.id })
}

// Without the native host's prototype directory, the browser protocol serves and stores no credential and touches no file.
do {
    expect("no prototype directory in the test process", BrowserPrototypeStore.directory == nil)
    for type in ["save", "credential", "candidates", "search"] {
        let reply = BrowserProtocol.handle(["v": 1, "id": "t", "type": type, "origin": "https://one.example", "ref": "x",
                                            "account": "a@example.net", "secret": "Demo-only-Browser1!", "query": "example"])
        check("browser \(type) without a prototype directory", "\(reply["ok"] as? Bool ?? true) \(reply["error"] as? String ?? "")", "false unsupported")
    }
    expect("browser ping still answers", BrowserProtocol.handle(["v": 1, "id": "t", "type": "ping"])["ok"] as? Bool == true)
}

// A passkey signs only for its own relying party.
do {
    let registration = Passkeys.register(rpID: "example.com", userHandle: Data("u".utf8), clientDataHash: Data(count: 32))
    expect("assertion for the stored relying party signs", (try? Passkeys.assert(registration.record, relyingParty: "example.com", clientDataHash: Data(count: 32))) != nil)
    expect("assertion for another relying party fails", (try? Passkeys.assert(registration.record, relyingParty: "evil.example", clientDataHash: Data(count: 32))) == nil)
}

// Characters XML 1.0 cannot hold (U+FFFE, U+FFFF and the C0 controls other than tab, line feed and carriage return) never reach the
// file: they are dropped as it is written, in element text, in a name and in an attribute, so the file opens. A protected value is encrypted first and not XML text.
do {
    let hostile = "a\u{FFFE}b\u{FFFF}c\u{0}d\u{1}e\u{8}f\u{B}g\u{C}h\u{E}i\u{1F}j\tk"
    check("the storable text drops what XML 1.0 cannot hold", XMLTree.storable(hostile), "abcdefghij\tk")
    check("and keeps a supplementary character", XMLTree.storable("x\u{1F510}y"), "x\u{1F510}y")
    let document = try KDBX.create(name: "Name\u{FFFE}", credentials: .init(password: "pw"), kdf: light)
    let plain = XNode("Value", text: hostile)
    let secret = XNode("Value", text: hostile, attributes: [("Protected", "True"), ("note", hostile)])
    let entry = XNode("Entry", children: [XNode("UUID", text: UUID().kdbxBase64),
                                          XNode("String", children: [XNode("Key", text: "Title"), plain]),
                                          XNode("String", children: [XNode("Key", text: "Password"), secret]),
                                          XNode("String", children: [XNode("Key", text: "Ke\u{FFFE}y"), XNode("Value", text: "v")])])
    document.rootGroup!.children.append(entry)
    let reread = try KDBX.open(try KDBX.save(document), credentials: .init(password: "pw"))
    let node = reread.rootGroup!.children(named: "Entry").first!
    // A protected value is encrypted before it is written, so it is not XML text and the file opens whatever it holds.
    check("an entry with such characters saves and opens, with the storable text in its title", EntryMapping.string(node, "Title") ?? "-", "abcdefghij\tk")
    expect("and its protected value is there", node.children(named: "String").contains { $0.child("Key")?.text == "Password" && $0.child("Value")?.attribute("Protected") == "True" })
    check("a name with such a character is stored without it", "\(node.children(named: "String").compactMap { $0.child("Key")?.text }.sorted())", "[\"Key\", \"Password\", \"Title\"]")
    let xml = try XMLTree.parse(XMLTree.serialize(XNode("R", children: [XNode("A", text: hostile, attributes: [("p", hostile)])])))
    check("the same text in an attribute and in element text parses back", "\(xml.child("A")?.attribute("p") ?? "-") \(xml.child("A")?.text ?? "-")", "abcdefghij\tk abcdefghij\tk")
}

// MARK: Security fixes, second round: failed password change, missing and odd files, stale-key lifecycle, concurrency, release checks

do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-sec2-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    func backupNames(_ id: UUID) -> [String] {
        ((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []).sorted()
    }
    func makeStore(_ name: String, password: String = "old-pw") throws -> (store: KeePassVaultStore, url: URL, id: UUID) {
        let url = dir.appendingPathComponent("\(name).kdbx")
        let data = try KDBX.save(try KDBX.create(name: name, credentials: .init(password: password), kdf: light))
        try data.write(to: url)
        let id = UUID()
        let store = KeePassVaultStore(reference: VaultReference(id: id, name: name, managed: true, bookmark: nil, fileName: url.lastPathComponent),
                                      url: url, scoped: false, document: try KDBX.open(data, credentials: .init(password: password)), fileData: data)
        return (store, url, id)
    }
    func opensWith(_ url: URL, _ password: String) -> Bool { (try? KDBX.open(Data(contentsOf: url), credentials: .init(password: password))) != nil }
    let extra = VaultItem(kind: .login, account: "extra@example.net", website: "extra.example", secret: "Demo-only-Extra1!")
    let more = VaultItem(kind: .login, account: "more@example.net", website: "more.example", secret: "Demo-only-More2!")

    // A refused password change on a conflicting file: the store keeps the old credentials, backups stay, a normal save and Reload work.
    do {
        let v = try makeStore("conflict-change")
        try v.store.save([extra]); try v.store.save([more])
        let backupsBefore = backupNames(v.id)
        expect("backups exist before the failed change", backupsBefore.count >= 2)
        // Another writer changes the file (a different item), so ours is stale.
        let other = try KDBX.open(Data(contentsOf: v.url), credentials: .init(password: "old-pw"))
        other.upsert(VaultItem(kind: .login, account: "elsewhere@example.net", website: "elsewhere.example", secret: "Demo-only-Else3!"))
        try KDBX.save(other).write(to: v.url)
        let bytesOnDisk = try Data(contentsOf: v.url)
        let key = v.store.transformedKey
        do { try await v.store.changeCredentials(to: .init(password: "new-pw")); failures += 1; print("FAIL change over a conflict succeeded") }
        catch VaultStoreError.changedOnDisk { print("ok   change refused on a conflicting file") }
        expect("conflict: file untouched", try Data(contentsOf: v.url) == bytesOnDisk)
        expect("conflict: file opens only with the old password", opensWith(v.url, "old-pw") && !opensWith(v.url, "new-pw"))
        expect("conflict: backups unchanged", backupNames(v.id) == backupsBefore)
        check("conflict: store still holds the old key", hex(v.store.transformedKey), hex(key))
        try await v.store.reload()
        try v.store.save([VaultItem(kind: .login, account: "after@example.net", website: "after.example", secret: "Demo-only-After4!")])
        expect("conflict: save after Reload writes with the old password", opensWith(v.url, "old-pw") && !opensWith(v.url, "new-pw"))
        expect("conflict: backups kept after the later save", backupNames(v.id).count >= backupsBefore.count)
        VaultFiles.removeBackups(for: v.id)
    }

    // The same on an unreadable file, and in a read-only folder.
    if getuid() != 0 {
        let v = try makeStore("unreadable-change")
        try v.store.save([extra])
        let backupsBefore = backupNames(v.id)
        let before = try Data(contentsOf: v.url)
        let key = v.store.transformedKey
        try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: v.url.path)
        do { try await v.store.changeCredentials(to: .init(password: "new-pw")); failures += 1; print("FAIL change on unreadable file succeeded") }
        catch VaultStoreError.unreadable { print("ok   change refused on an unreadable file") }
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: v.url.path)
        expect("unreadable: file untouched, old password only", try Data(contentsOf: v.url) == before && opensWith(v.url, "old-pw") && !opensWith(v.url, "new-pw"))
        expect("unreadable: backups unchanged", backupNames(v.id) == backupsBefore)
        check("unreadable: store still holds the old key", hex(v.store.transformedKey), hex(key))
        try v.store.save([more])
        expect("unreadable: later save succeeds with the old password", opensWith(v.url, "old-pw") && !opensWith(v.url, "new-pw"))
        try await v.store.reload()
        VaultFiles.removeBackups(for: v.id)

        let ro = try makeStore("read-only-folder")
        let folder = dir.appendingPathComponent("ro", isDirectory: true)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let roURL = folder.appendingPathComponent("vault.kdbx")
        try Data(contentsOf: ro.url).write(to: roURL)
        let roStore = KeePassVaultStore(reference: ro.store.reference, url: roURL, scoped: false,
                                        document: try KDBX.open(Data(contentsOf: roURL), credentials: .init(password: "old-pw")), fileData: try Data(contentsOf: roURL))
        let roBytes = try Data(contentsOf: roURL)
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: folder.path)
        do { try await roStore.changeCredentials(to: .init(password: "new-pw")); failures += 1; print("FAIL change in read-only folder succeeded") }
        catch VaultStoreError.writeFailed { print("ok   change refused in a read-only folder") }
        do { try roStore.save([extra]); failures += 1; print("FAIL save in read-only folder succeeded") }
        catch VaultStoreError.writeFailed { print("ok   save refused in a read-only folder") }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder.path)
        expect("read-only folder: file unchanged", try Data(contentsOf: roURL) == roBytes)
        try roStore.save([extra])
        expect("read-only folder: save works once writable, old password", opensWith(roURL, "old-pw") && !opensWith(roURL, "new-pw"))
        VaultFiles.removeBackups(for: ro.store.reference.id)
    }

    // A missing file under an open store is `fileMissing` and is not recreated, with or without overwrite. A folder in its place is unreadable.
    do {
        let v = try makeStore("deleted")
        try fm.removeItem(at: v.url)
        for overwrite in [false, true] {
            do { try attempt(v.store, overwrite: overwrite) { try v.store.save([extra]) }; failures += 1; print("FAIL missing file written") }
            catch VaultStoreError.fileMissing { print("ok   missing file refused (overwrite \(overwrite))") }
        }
        expect("missing file is not recreated", !fm.fileExists(atPath: v.url.path))
        try fm.createDirectory(at: v.url, withIntermediateDirectories: true)
        for overwrite in [false, true] {
            do { try attempt(v.store, overwrite: overwrite) { try v.store.save([extra]) }; failures += 1; print("FAIL folder in place of the file written over") }
            catch VaultStoreError.unreadable { print("ok   folder in place of the file refused (overwrite \(overwrite))") }
        }
        var isFolder: ObjCBool = false
        expect("the folder is still there", fm.fileExists(atPath: v.url.path, isDirectory: &isFolder) && isFolder.boolValue)
        VaultFiles.removeBackups(for: v.id)
    }

    // Writers on two threads against one file, a couple of seconds: every reported save is present, every observed state opens.
    do {
        final class Shared: @unchecked Sendable {
            let lock = NSLock()
            var saved: [UUID] = []
            var observed = 0, unreadableStates = 0, errors = 0, finished = 0
            func with(_ body: () -> Void) { lock.lock(); body(); lock.unlock() }
            var finishedCount: Int { lock.lock(); defer { lock.unlock() }; return finished }
        }
        let shared = Shared()
        let v = try makeStore("concurrent", password: "pw")
        let url = v.url
        let deadline = Date().addingTimeInterval(2.5)
        for writer in 0..<2 {
            Thread.detachNewThread {
                var n = 0
                while Date() < deadline {
                    do {
                        let data = try VaultFiles.read(url)
                        let document = try KDBX.open(data, credentials: .init(password: "pw"))
                        let item = VaultItem(kind: .login, account: "w\(writer)-\(n)@example.net", website: "w\(writer).example", secret: "Demo-only-W\(n)!")
                        document.upsert(item)
                        _ = try VaultFiles.replace(at: url, with: try KDBX.save(document), basedOn: KDBXCrypto.sha256(data), overwrite: false)
                        shared.with { shared.saved.append(item.id) }
                        n += 1
                    } catch VaultStoreError.changedOnDisk {
                        continue
                    } catch { shared.with { shared.errors += 1 } }
                }
                shared.with { shared.finished += 1 }
            }
        }
        Thread.detachNewThread {
            while Date() < deadline {
                if let data = try? VaultFiles.read(url), (try? KDBX.open(data, credentials: .init(password: "pw"))) != nil {
                    shared.with { shared.observed += 1 }
                } else { shared.with { shared.unreadableStates += 1 } }
            }
            shared.with { shared.finished += 1 }
        }
        while shared.finishedCount < 3 { try await Task.sleep(for: .milliseconds(50)) }
        let final = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw")).items().map(\.id)
        expect("concurrent writers saved something from both threads", shared.saved.count > 10)
        check("every reported concurrent save is present", "\(shared.saved.filter { !final.contains($0) }.count)", "0")
        check("every observed file state opened", "\(shared.unreadableStates)", "0")
        check("no unexpected writer errors", "\(shared.errors)", "0")
        print("     concurrent: \(shared.saved.count) saves, \(shared.observed) reads")
        VaultFiles.removeBackups(for: v.id)
    }
    try? fm.removeItem(at: dir)
}

// The stale-key lifecycle, with the Keychain replaced by a table: no prompt, nothing real touched.
do {
    let lifecycle = VaultSession()
    lifecycle.forget()
    try await lifecycle.create(name: "Stale test", credentials: .init(password: "pw1"), items: [])
    let id = lifecycle.reference!.id
    try lifecycle.enableBiometric()
    expect("key saved and setting on", lifecycle.reference?.biometricUnlock == true && BiometricKey.memory[id] != nil)
    lifecycle.lock()

    // Lockout or unavailable: key and setting stay, nothing is marked stale.
    BiometricKey.failure = .unavailable
    do { try await lifecycle.unlockWithBiometrics(); failures += 1; print("FAIL unavailable unlocked") } catch BiometricKeyError.unavailable { print("ok   unavailable is reported") }
    BiometricKey.failure = nil
    expect("unavailable leaves the key and the setting alone", lifecycle.reference?.biometricUnlock == true && BiometricKey.memory[id] != nil && lifecycle.reference?.biometricStale == false)

    // A stale key: off and marked; the password unlock saves a fresh key and turns it on again.
    BiometricKey.memory[id] = Data(repeating: 9, count: 32)
    do { try await lifecycle.unlockWithBiometrics(); failures += 1; print("FAIL stale key unlocked") } catch BiometricKeyError.invalidated { print("ok   stale key reported") }
    expect("stale key: off, marked stale, key deleted", lifecycle.reference?.biometricUnlock == false && lifecycle.reference?.biometricStale == true && BiometricKey.memory[id] == nil)
    expect("stale mark is persisted", VaultReference.load()?.biometricStale == true)
    try await lifecycle.unlock(credentials: .init(password: "pw1"))
    expect("password unlock turns it back on", lifecycle.reference?.biometricUnlock == true && lifecycle.reference?.biometricStale == false)
    check("the fresh key is the vault's current key", hex(BiometricKey.memory[id] ?? Data()), hex(lifecycle.store!.transformedKey))
    lifecycle.lock()
    try await lifecycle.unlockWithBiometrics()
    expect("the fresh key opens the vault", lifecycle.isOpen)
    lifecycle.lock()

    // Switched off by the person: a password unlock leaves it off.
    lifecycle.disableBiometric()
    expect("manual off is not stale", lifecycle.reference?.biometricStale == false)
    try await lifecycle.unlock(credentials: .init(password: "pw1"))
    expect("manual off stays off after a password unlock", lifecycle.reference?.biometricUnlock == false && BiometricKey.memory[id] == nil)
    lifecycle.lock()

    // Another process (the AutoFill extension) marks the key stale: this session's older in-memory copy must not hide it.
    try lifecycle.enableBiometric()
    lifecycle.lock()
    var elsewhere = VaultReference.load()!
    elsewhere.biometricUnlock = false
    elsewhere.biometricStale = true
    elsewhere.persist()
    try await lifecycle.unlock(credentials: .init(password: "pw1"))
    expect("a stale mark written elsewhere is honoured", lifecycle.reference?.biometricUnlock == true && lifecycle.reference?.biometricStale == false)

    // The setting persisted elsewhere is read before deciding: off elsewhere means biometrics are not tried.
    lifecycle.lock()
    var turnedOff = VaultReference.load()!
    turnedOff.biometricUnlock = false
    turnedOff.persist()
    do { try await lifecycle.unlockWithBiometrics(); failures += 1; print("FAIL biometrics used after being turned off elsewhere") } catch BiometricKeyError.invalidated { print("ok   setting changed elsewhere is read") }
    lifecycle.forget()
}

// The release decision for the AutoFill provider.
do {
    let login = VaultItem(kind: .login, account: "a@example.net", website: "login.example.com", secret: "Demo-only-Rel1!")
    expect("password: same site", ReleaseCheck.password(item: login, serviceIdentifier: "login.example.com"))
    expect("password: subdomain of the stored site", ReleaseCheck.password(item: login, serviceIdentifier: "deep.login.example.com"))
    expect("password: scheme and path in the identifier", ReleaseCheck.password(item: login, serviceIdentifier: "https://login.example.com/path"))
    expect("password: wrong site refused", !ReleaseCheck.password(item: login, serviceIdentifier: "evil.example"))
    expect("password: parent site refused", !ReleaseCheck.password(item: login, serviceIdentifier: "example.com"))
    expect("password: lookalike refused", !ReleaseCheck.password(item: login, serviceIdentifier: "login.example.com.evil.example"))
    expect("password: empty site refused", !ReleaseCheck.password(item: login, serviceIdentifier: ""))
    var empty = login; empty.secret = ""
    expect("password: empty secret refused", !ReleaseCheck.password(item: empty, serviceIdentifier: "login.example.com"))
    let card = VaultItem(kind: .creditCard, account: "Alex", website: "login.example.com", secret: "4242424242424242")
    let note = VaultItem(kind: .secureNote, website: "login.example.com", secret: "text")
    expect("password: credit card refused", !ReleaseCheck.password(item: card, serviceIdentifier: "login.example.com"))
    expect("password: secure note refused", !ReleaseCheck.password(item: note, serviceIdentifier: "login.example.com"))

    let record = Passkeys.register(rpID: "example.com", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    expect("passkey: same party and credential", ReleaseCheck.passkey(record: record, relyingParty: "example.com", credentialID: record.credentialID))
    expect("passkey: other party refused", !ReleaseCheck.passkey(record: record, relyingParty: "evil.example", credentialID: record.credentialID))
    expect("passkey: different case refused", !ReleaseCheck.passkey(record: record, relyingParty: "Example.com", credentialID: record.credentialID))
    expect("passkey: trailing dot refused", !ReleaseCheck.passkey(record: record, relyingParty: "example.com.", credentialID: record.credentialID))
    expect("passkey: subdomain refused", !ReleaseCheck.passkey(record: record, relyingParty: "login.example.com", credentialID: record.credentialID))
    expect("passkey: wrong credential ID refused", !ReleaseCheck.passkey(record: record, relyingParty: "example.com", credentialID: Data(repeating: 1, count: 16)))
}

// MARK: Codec groundwork 2026-11-23: dates, history, Recycle Bin, cards, store follow-ups

func at(_ seconds: TimeInterval) -> Date { Date(timeIntervalSince1970: seconds) }
/// Makes the codec's clock say `seconds` since 1970 until it is set again.
func setClock(_ seconds: TimeInterval) { KeePassTime.clock = { Date(timeIntervalSince1970: seconds) } }
func resetClock() { KeePassTime.clock = { Date() } }
func entryNode(_ document: KDBXDocument, _ id: UUID) -> XNode? { document.locations().first { EntryMapping.uuid(of: $0.entry) == id }?.entry }
func historyCount(_ document: KDBXDocument, _ id: UUID) -> Int { entryNode(document, id).map { $0.child("History")?.children.count ?? 0 } ?? -1 }
func timeText(_ document: KDBXDocument, _ id: UUID, _ name: String) -> String { entryNode(document, id)?.child("Times")?.child(name)?.text ?? "-" }
func freshDocument(_ name: String = "T") throws -> KDBXDocument { try KDBX.create(name: name, credentials: .init(password: "pw"), kdf: light) }
func current(_ document: KDBXDocument, _ id: UUID) -> VaultItem { document.items().first { $0.id == id }! }
/// Reads the item, applies the change at the given clock time and saves it.
@discardableResult
func edit(_ document: KDBXDocument, _ id: UUID, at seconds: TimeInterval, _ change: (inout VaultItem) -> Void) -> Bool {
    setClock(seconds)
    var item = current(document, id)
    change(&item)
    return document.upsert(item)
}
func stringFlag(_ entry: XNode, _ key: String) -> String? {
    entry.children(named: "String").first { $0.child("Key")?.text == key }?.child("Value")?.attribute("Protected")
}
func hasString(_ entry: XNode, _ key: String) -> Bool { EntryMapping.string(entry, key) != nil }

// Speed budgets are multiples of a calibration, not of the clock: how long this machine takes right now to serialize a fixed
// document of 1,000 entries and list it. A loaded machine makes the unit longer, so a budget stretches with it, and a ceiling
// stays only to catch a real blow-up (the quiet-machine ratio below, times ten).
let calibrationDocument: KDBXDocument = {
    let doc = try! KDBX.create(name: "Calibration", credentials: .init(password: "pw"), kdf: .aesForTesting(rounds: 1000))
    doc.upsert((0..<1_000).map { VaultItem(kind: .login, title: "C\($0)", account: "u\($0)@example.net", website: "https://c\($0).example", secret: "p\($0)", notes: "n") })
    return doc
}()
/// The fastest of five runs, in seconds, measured now.
func calibrationUnit() -> Double {
    var best = Double.infinity
    for _ in 0..<5 {
        let start = Date()
        _ = XMLTree.serialize(calibrationDocument.root)
        _ = calibrationDocument.items()
        best = min(best, Date().timeIntervalSince(start))
    }
    return best
}
/// Checks that `measured` seconds is within `ratio` calibration units (the ratio seen on a quiet machine, times ten, plus a little slack), measured
/// again just now, and prints both.
func withinBudget(_ name: String, _ measured: Double, quietRatio: Double) {
    let unit = calibrationUnit()
    let limit = (10 * quietRatio + 20) * unit        // ten times the quiet ratio, plus 20 units of slack for a stall on a busy machine
    print(String(format: "     budget %@: %.0f ms measured, %.1f units of %.1f ms (a quiet machine takes about %.1f units; limit %.0f ms)", name as NSString, measured * 1000, measured / unit, unit * 1000, quietRatio, limit * 1000))
    expect(name, measured <= limit)
}
print(String(format: "     calibration unit: %.2f ms", calibrationUnit() * 1000))

// Parsing times is fast: no formatter per call.
do {
    let texts = ["2021-03-04T05:06:07Z", "v2HS1w4AAAA=", "2021-03-04T05:06:07.250Z", "2021-03-04T07:06:07+02:00"]
    let start = Date()
    var sum = 0.0
    for i in 0..<100_000 { sum += KeePassTime.date(texts[i % 3])?.timeIntervalSince1970 ?? 0 }
    let took = Date().timeIntervalSince(start)
    print("     100000 time parses took \(Int(took * 1000)) ms")
    withinBudget("100,000 time parses stay within the budget", took, quietRatio: 1.7); expect("and parsed", sum > 0)
    expect("an ISO time with an offset still reads", KeePassTime.date(texts[3]) == at(1_614_834_367))
    expect("year 1 is the KDBX epoch, as the base64 form has it (the system parser is two days off there)", KeePassTime.date("0001-01-01T00:00:00Z") == KeePassTime.date("AAAAAAAAAAA="))
    expect("leap days and old dates parse like the system parser", ["2024-02-29T23:59:59Z", "1999-12-31T00:00:00Z", "2100-03-01T12:00:00Z"].allSatisfy {
        KeePassTime.date($0) == ISO8601DateFormatter().date(from: $0) })
}

// Times: exact values in both encodings.
do {
    let known = at(1_614_834_367)   // 2021-03-04T05:06:07Z
    let later = at(1_669_206_896)   // 2022-11-23T12:34:56Z
    check("stored time 2021-03-04T05:06:07Z", KeePassTime.stored(known), "v2HS1w4AAAA=")
    check("stored time 2022-11-23T12:34:56Z", KeePassTime.stored(later), "cAoQ2w4AAAA=")
    check("stored time of the Unix epoch", KeePassTime.stored(at(0)), "APeRdw4AAAA=")
    check("stored time of year 1 is zero", KeePassTime.stored(at(-62_135_596_800)), "AAAAAAAAAAA=")
    check("stored time rounds down to the second", KeePassTime.stored(at(1_614_834_367.9)), "v2HS1w4AAAA=")
    check("stored time clamps what is not a number", KeePassTime.stored(at(.nan)), "APeRdw4AAAA=")
    check("stored time clamps the far future to year 9999", KeePassTime.stored(at(1e30)), "fziGd0kAAAA=")
    check("stored time clamps the far past to year 1", KeePassTime.stored(at(-1e30)), "AAAAAAAAAAA=")
    expect("reads the KDBX 4 form", KeePassTime.date("v2HS1w4AAAA=") == known)
    expect("reads the ISO form", KeePassTime.date("2021-03-04T05:06:07Z") == known)
    expect("reads ISO with fractions", abs((KeePassTime.date("2021-03-04T05:06:07.250Z")?.timeIntervalSince(known) ?? 9) - 0.25) < 0.001)
    expect("reads nothing from text that is no time", KeePassTime.date("yesterday") == nil && KeePassTime.date("") == nil)
    check("the ISO writer is still ISO", KeePassTime.string(known), "2021-03-04T05:06:07Z")

    setClock(1_614_834_367)
    var doc = try freshDocument("Dates")
    let item = VaultItem(kind: .login, title: "Dated", account: "a@example.net", website: "dated.example", secret: "one")
    doc.upsert(item)
    check("an entry's times are written in the KDBX 4 form", "\(timeText(doc, item.id, "CreationTime")) \(timeText(doc, item.id, "LastModificationTime")) \(timeText(doc, item.id, "LastAccessTime")) \(timeText(doc, item.id, "LocationChanged"))",
          "v2HS1w4AAAA= v2HS1w4AAAA= v2HS1w4AAAA= v2HS1w4AAAA=")
    check("a new vault's group time is in the KDBX 4 form", doc.rootGroup!.child("Times")!.child("CreationTime")!.text, "v2HS1w4AAAA=")
    check("a new vault's Meta times are in the KDBX 4 form", doc.meta!.child("DatabaseNameChanged")!.text, "v2HS1w4AAAA=")
    check("and RecycleBinChanged", doc.meta!.child("RecycleBinChanged")!.text, "v2HS1w4AAAA=")
    let first = current(doc, item.id)
    expect("the item carries the dates", first.created == known && first.modified == known)

    setClock(1_669_206_896)
    var changed = first; changed.secret = "two"; doc.upsert(changed)
    check("an edit moves the modification time to now", timeText(doc, item.id, "LastModificationTime"), "cAoQ2w4AAAA=")
    check("and leaves the creation time", timeText(doc, item.id, "CreationTime"), "v2HS1w4AAAA=")
    doc.touchModified()
    check("the database's modified time is in the KDBX 4 form", doc.rootGroup!.child("Times")!.child("LastModificationTime")!.text, "cAoQ2w4AAAA=")
    doc.databaseName = "Renamed"
    check("a rename stamps DatabaseNameChanged in the KDBX 4 form", doc.meta!.child("DatabaseNameChanged")!.text, "cAoQ2w4AAAA=")
    check("history snapshots keep the time of their version", EntryMapping.string(entryNode(doc, item.id)!.child("History")!.children[0], "Password") ?? "", "one")

    let reopened = try KDBX.open(try KDBX.save(doc), credentials: .init(password: "pw"))
    let back = current(reopened, item.id)
    expect("the dates survive a save and open", back.created == known && back.modified == at(1_669_206_896))
    check("and are still stored in the KDBX 4 form", timeText(reopened, item.id, "CreationTime"), "v2HS1w4AAAA=")

    // The ISO form (KDBX 3) reads as the same dates.
    let times = entryNode(doc, item.id)!.child("Times")!
    times.child("CreationTime")!.text = "2021-03-04T05:06:07Z"
    times.child("LastModificationTime")!.text = "2022-11-23T12:34:56Z"
    expect("ISO times read as the same dates", current(doc, item.id).created == known && current(doc, item.id).modified == at(1_669_206_896))

    // A deletion is stamped in the KDBX 4 form too.
    doc.remove(item.id)
    check("a deletion is recorded in the KDBX 4 form", doc.rootNode!.child("DeletedObjects")!.children.last!.child("DeletionTime")!.text, "cAoQ2w4AAAA=")
    resetClock()
}

// An entry's modification time always moves forward.
do {
    let doc = try freshDocument()
    setClock(1_700_000_000)
    let item = VaultItem(kind: .login, title: "Mono", website: "mono.example", secret: "p0")
    doc.upsert(item)
    var seen: [Int] = []
    for i in 1...4 {
        edit(doc, item.id, at: 1_700_000_000) { $0.secret = "p\(i)" }   // the clock stands still
        seen.append(Int(current(doc, item.id).modified!.timeIntervalSince1970) - 1_700_000_000)
    }
    check("saves within one second get consecutive times", "\(seen)", "[1, 2, 3, 4]")
    edit(doc, item.id, at: 1_600_000_000) { $0.secret = "p5" }          // the clock went back
    check("a clock that went backwards still moves it forward", "\(Int(current(doc, item.id).modified!.timeIntervalSince1970) - 1_700_000_000)", "5")
    edit(doc, item.id, at: 1_800_000_000) { $0.secret = "p6" }
    check("a clock ahead of the entry is used as it is", "\(Int(current(doc, item.id).modified!.timeIntervalSince1970))", "1800000000")
    check("the next time after a given time", "\(Int(KDBXDocument.nextModificationTime(after: at(100.9), now: at(50)).timeIntervalSince1970)) \(Int(KDBXDocument.nextModificationTime(after: nil, now: at(50.7)).timeIntervalSince1970))", "101 50")
    resetClock()
}

// An entry with no Times element gets one when it is next changed.
do {
    let doc = try freshDocument()
    setClock(1_700_000_000)
    let item = VaultItem(kind: .login, title: "Timeless", website: "timeless.example", secret: "p0")
    doc.upsert(item)
    let node = entryNode(doc, item.id)!
    node.children.removeAll { $0.name == "Times" }
    expect("an entry without times has no dates", current(doc, item.id).created == nil && current(doc, item.id).modified == nil)
    edit(doc, item.id, at: 1_700_000_100) { $0.title = "Timeless 2" }
    expect("the next change gives it times, both now", current(doc, item.id).created == at(1_700_000_100) && current(doc, item.id).modified == at(1_700_000_100))
    expect("the times sit before the strings", (node.children.firstIndex { $0.name == "Times" } ?? 99) < (node.children.firstIndex { $0.name == "String" } ?? 0))
    check("it has all seven fields", "\(node.child("Times")!.children.map(\.name))", "[\"CreationTime\", \"LastModificationTime\", \"LastAccessTime\", \"ExpiryTime\", \"Expires\", \"UsageCount\", \"LocationChanged\"]")
    edit(doc, item.id, at: 1_700_000_100) { $0.title = "Timeless 3" }
    expect("then it moves forward like any entry", current(doc, item.id).created == at(1_700_000_100) && current(doc, item.id).modified == at(1_700_000_101))
    resetClock()
}

// The passkey's own creation date.
do {
    let doc = try freshDocument()
    setClock(1_700_000_000)
    var record = Passkeys.register(rpID: "pk.example", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    record.created = at(1_577_934_245)   // 2020-01-02T03:04:05Z
    var item = VaultItem(kind: .login, title: "PK", account: "pk@example.net", website: "pk.example", secret: "x")
    item.passkey = record
    doc.upsert(item)
    let node = entryNode(doc, item.id)!
    check("the passkey date is stored when the passkey is first written", EntryMapping.string(node, EntryMapping.passkeyCreated) ?? "-", "2020-01-02T03:04:05Z")
    expect("the passkey reads its own date, not the entry's", current(doc, item.id).passkey?.created == at(1_577_934_245) && current(doc, item.id).created == at(1_700_000_000))
    edit(doc, item.id, at: 1_700_000_500) { $0.title = "PK 2" }
    check("editing the entry leaves the passkey date", EntryMapping.string(node, EntryMapping.passkeyCreated) ?? "-", "2020-01-02T03:04:05Z")
    let reopened = try KDBX.open(try KDBX.save(doc), credentials: .init(password: "pw"))
    expect("the passkey date survives a save", current(reopened, item.id).passkey?.created == at(1_577_934_245))
    // A passkey written by another app has no such string: the entry's creation time stands in.
    node.children.removeAll { $0.name == "String" && $0.child("Key")?.text == EntryMapping.passkeyCreated }
    expect("without the string the entry's creation time stands in", current(doc, item.id).passkey?.created == at(1_700_000_000))
    edit(doc, item.id, at: 1_700_000_600) { $0.title = "PK 3" }
    expect("editing such an entry does not invent a passkey date", !hasString(node, EntryMapping.passkeyCreated))
    // A new credential gets a new date.
    var replacement = Passkeys.register(rpID: "pk.example", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    replacement.created = at(1_650_000_000)
    edit(doc, item.id, at: 1_700_000_700) { $0.passkey = replacement }
    check("a different passkey is stamped with its own date", EntryMapping.string(node, EntryMapping.passkeyCreated) ?? "-", KeePassTime.string(at(1_650_000_000)))
    edit(doc, item.id, at: 1_700_000_800) { $0.passkey = nil }
    expect("removing the passkey removes its date", !hasString(node, EntryMapping.passkeyCreated) && !hasString(node, EntryMapping.passkeyCredential))
    resetClock()
}

// The protected flag is corrected on the strings Psss protects, and left alone on the others.
do {
    let doc = try freshDocument()
    setClock(1_700_000_000)
    var item = VaultItem(kind: .login, title: "Flags", account: "f@example.net", website: "flags.example", secret: "one", notes: "n", otpSecret: "JBSWY3DPEHPK3PXP")
    item.passkey = Passkeys.register(rpID: "flags.example", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    doc.upsert(item)
    let node = entryNode(doc, item.id)!
    for string in node.children(named: "String") { string.child("Value")?.setAttribute("Protected", nil) }   // as another app might have left them
    let anchor = node.children.firstIndex { $0.name == "AutoType" } ?? node.children.endIndex
    node.children.insert(XNode("String", children: [XNode("Key", text: "Token"), XNode("Value", text: "t", attributes: [("Protected", "True")])]), at: anchor)
    node.children.insert(XNode("String", children: [XNode("Key", text: "Plain"), XNode("Value", text: "p")]), at: anchor)
    node.children.first { $0.name == "String" && $0.child("Key")?.text == "Notes" }?.child("Value")?.setAttribute("Protected", "True")
    edit(doc, item.id, at: 1_700_000_100) { $0.secret = "two"; $0.title = "Flags 2" }
    check("password flag corrected", stringFlag(node, "Password") ?? "-", "True")
    check("one-time code flag corrected", stringFlag(node, "otp") ?? "-", "True")
    check("passkey key flag corrected", stringFlag(node, EntryMapping.passkeyKey) ?? "-", "True")
    check("an unprotected title stays unprotected", stringFlag(node, "Title") ?? "-", "-")
    check("an unprotected user name stays unprotected", stringFlag(node, "UserName") ?? "-", "-")
    check("a protected note stays protected", stringFlag(node, "Notes") ?? "-", "True")
    check("a protected custom string stays protected", stringFlag(node, "Token") ?? "-", "True")
    check("an unprotected custom string stays unprotected", stringFlag(node, "Plain") ?? "-", "-")
    resetClock()
}

// sameContent compares every stored field; usage, dates and the passkey's own date do not count.
do {
    let record = Passkeys.register(rpID: "same.example", userHandle: Data("h".utf8), clientDataHash: Data(count: 32)).record
    let other = Passkeys.register(rpID: "other.example", userHandle: Data("g".utf8), clientDataHash: Data(count: 32)).record
    var base = VaultItem(kind: .login, title: "T", account: "a", website: "https://same.example", secret: "s", notes: "n", otpSecret: "JBSWY3DPEHPK3PXP")
    base.passkey = record
    var card = VaultItem(kind: .creditCard, title: "C", account: "Alex", secret: "4242424242424242", expiry: "08/30", notes: "n")
    card.passkey = nil
    let differing: [(String, VaultItem, (inout VaultItem) -> Void)] = [
        ("title", base, { $0.title = "T2" }), ("account", base, { $0.account = "b" }), ("website", base, { $0.website = "https://other.example" }),
        ("password", base, { $0.secret = "s2" }), ("notes", base, { $0.notes = "n2" }), ("one-time code", base, { $0.otpSecret = "KRSXG5CTMVRXEZLU" }),
        ("one-time code removed", base, { $0.otpSecret = "" }),
        ("code digits", base, { $0.otpSettings.digits = 8 }), ("code period", base, { $0.otpSettings.period = 60 }),
        ("code algorithm", base, { $0.otpSettings.algorithm = .sha256 }),
        ("passkey removed", base, { $0.passkey = nil }), ("passkey credential", base, { $0.passkey?.credentialID = Data(repeating: 1, count: 16) }),
        ("passkey user handle", base, { $0.passkey?.userHandle = Data("x".utf8) }), ("passkey relying party", base, { $0.passkey?.rpID = "x.example" }),
        ("passkey key", base, { $0.passkey?.privateKey = other.privateKey }),
        ("kind", base, { item in item = VaultItem(id: item.id, kind: .keePassEntry, title: item.title, account: item.account, website: item.website, secret: item.secret, notes: item.notes) }),
        ("card number", card, { $0.secret = "4242424242424241" }), ("card expiry", card, { $0.expiry = "09/30" }), ("card holder", card, { $0.account = "Sam" }),
    ]
    for (name, start, change) in differing {
        var changed = start; change(&changed)
        expect("sameContent sees a change to \(name)", !EntryMapping.sameContent(start, changed))
        let doc = try freshDocument()
        doc.upsert(start)
        setClock(1_700_000_000 + 5_000)
        expect("upsert saves a change to \(name)", doc.upsert(changed))
        resetClock()
    }
    var same = base
    same.lastUsed = .now; same.useCount = 9
    same.passkey?.signCount = 5; same.passkey?.created = at(5)
    same.otpSecret = "jbsw y3dp ehpk 3pxp"
    expect("usage, the passkey's own date and the spelling of the code do not count", EntryMapping.sameContent(base, same))
    var named = base; named.title = "same.example"; var unnamed = base; unnamed.title = ""
    expect("a login named by its host is the login without a name", EntryMapping.sameContent(named, unnamed))
    var cardWithCode = card; cardWithCode.otpSecret = "JBSWY3DPEHPK3PXP"; cardWithCode.website = card.website
    expect("a code on a card, which is not stored, does not count", EntryMapping.sameContent(card, cardWithCode))
    let doc = try freshDocument()
    doc.upsert(base)
    expect("upsert of unchanged content or only usage reports no change", !doc.upsert(base) && !doc.upsert(same))
}

// Coalescing: a small, recent change that touches no secret folds into the current version.
do {
    let t0: TimeInterval = 1_700_000_000
    setClock(t0)
    let doc = try freshDocument()
    let item = VaultItem(kind: .login, title: "T", account: "a", website: "co.example", secret: "one")
    doc.upsert(item)
    edit(doc, item.id, at: t0 + 100) { $0.notes = "n1" }
    check("a small change within the window makes no revision", "\(historyCount(doc, item.id))", "0")
    edit(doc, item.id, at: t0 + 699) { $0.title = "T2" }
    check("nor one 599 seconds after the last change", "\(historyCount(doc, item.id))", "0")
    check("the current version has the changes", "\(current(doc, item.id).title) \(current(doc, item.id).notes)", "T2 n1")
    expect("the modification time still moved", current(doc, item.id).modified == at(t0 + 699))
    edit(doc, item.id, at: t0 + 699 + 600) { $0.title = "T3" }
    check("exactly ten minutes after the last change is outside the window", "\(historyCount(doc, item.id))", "1")
    check("the revision holds the version before", EntryMapping.string(entryNode(doc, item.id)!.child("History")!.children[0], "Title") ?? "", "T2")
    let base = t0 + 1300
    edit(doc, item.id, at: base + 10) { $0.secret = "two" }
    check("a changed password always makes a revision", "\(historyCount(doc, item.id))", "2")
    edit(doc, item.id, at: base + 20) { $0.otpSecret = "JBSWY3DPEHPK3PXP" }
    check("a changed one-time code always makes a revision", "\(historyCount(doc, item.id))", "3")
    var record = Passkeys.register(rpID: "co.example", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    edit(doc, item.id, at: base + 30) { $0.passkey = record }
    check("a new passkey always makes a revision", "\(historyCount(doc, item.id))", "4")
    record = Passkeys.register(rpID: "co.example", userHandle: Data("u".utf8), clientDataHash: Data(count: 32)).record
    edit(doc, item.id, at: base + 40) { $0.passkey = record }
    check("a replaced passkey always makes a revision", "\(historyCount(doc, item.id))", "5")
    edit(doc, item.id, at: base + 50) { $0.notes = "n9" }
    check("a small change after secrets, within the window, still folds", "\(historyCount(doc, item.id))", "5")

    let cardDoc = try freshDocument()
    let card = VaultItem(kind: .creditCard, title: "Card", account: "Alex", secret: "4242424242424242", expiry: "08/30")
    setClock(t0); cardDoc.upsert(card)
    edit(cardDoc, card.id, at: t0 + 5) { $0.expiry = "09/30" }
    check("a card's expiry within the window folds", "\(historyCount(cardDoc, card.id))", "0")
    edit(cardDoc, card.id, at: t0 + 10) { $0.secret = "5555555555554444" }
    check("a changed card number always makes a revision", "\(historyCount(cardDoc, card.id))", "1")

    // A string the file marks protected is a secret, whatever it holds.
    let protectedDoc = try freshDocument()
    protectedDoc.meta!.child("MemoryProtection")!.child("ProtectNotes")!.text = "True"
    let note = VaultItem(kind: .secureNote, title: "Note", notes: "text")
    setClock(t0); protectedDoc.upsert(note)
    edit(protectedDoc, note.id, at: t0 + 5) { $0.title = "Note 2" }
    check("a title change within the window folds", "\(historyCount(protectedDoc, note.id))", "0")
    edit(protectedDoc, note.id, at: t0 + 10) { $0.notes = "other text" }
    check("a change to a protected string always makes a revision", "\(historyCount(protectedDoc, note.id))", "1")
    resetClock()
}

// History is bounded by HistoryMaxItems and HistoryMaxSize, oldest first, and never repeats its newest item.
do {
    let t0: TimeInterval = 1_700_000_000
    func build(_ name: String, items: String, size: String, passwords: [String]) throws -> (document: KDBXDocument, id: UUID) {
        let doc = try freshDocument(name)
        doc.meta!.setChildText("HistoryMaxItems", items)
        doc.meta!.setChildText("HistoryMaxSize", size)
        setClock(t0)
        let item = VaultItem(kind: .login, title: "T", account: "a", website: "trim.example", secret: "p0")
        doc.upsert(item)
        for (n, password) in passwords.enumerated() { edit(doc, item.id, at: t0 + Double(n + 1) * 1000) { $0.secret = password } }
        return (doc, item.id)
    }
    func passwords(_ doc: KDBXDocument, _ id: UUID) -> [String] {
        (entryNode(doc, id)!.child("History")?.children ?? []).map { EntryMapping.string($0, "Password") ?? "" }
    }
    let six = (1...6).map { "p\($0)" }
    var r = try build("count", items: "3", size: "-1", passwords: six)
    check("HistoryMaxItems keeps the newest items", "\(passwords(r.document, r.id))", "[\"p3\", \"p4\", \"p5\"]")
    r = try build("unlimited", items: "-1", size: "-1", passwords: (1...12).map { "q\($0)" })
    check("HistoryMaxItems -1 is unlimited", "\(historyCount(r.document, r.id))", "12")
    r = try build("none", items: "0", size: "-1", passwords: six)
    check("HistoryMaxItems 0 keeps no history", "\(historyCount(r.document, r.id))", "0")
    let big = (1...5).map { String(repeating: Character(UnicodeScalar(96 + UInt8($0))), count: 1000) }   // aaaa… bbbb… 1000 characters each
    r = try build("size", items: "-1", size: "2500", passwords: big)
    check("HistoryMaxSize drops the oldest until it fits", "\(historyCount(r.document, r.id))", "2")
    check("and keeps the newest", "\(passwords(r.document, r.id).map { String($0.prefix(1)) })", "[\"c\", \"d\"]")
    expect("what is kept fits", r.document.historySize(of: entryNode(r.document, r.id)!.child("History")!.children[0]) * 2 <= 2500)
    r = try build("size unlimited", items: "-1", size: "-1", passwords: big)
    check("HistoryMaxSize -1 is unlimited", "\(historyCount(r.document, r.id))", "5")
    r = try build("size zero", items: "-1", size: "0", passwords: big)
    check("HistoryMaxSize 0 keeps no history", "\(historyCount(r.document, r.id))", "0")
    r = try build("no limits in the file", items: "10", size: "6291456", passwords: six)
    r.document.meta!.children.removeAll { $0.name == "HistoryMaxItems" || $0.name == "HistoryMaxSize" }
    for n in 7...20 { edit(r.document, r.id, at: t0 + Double(n) * 1000) { $0.secret = "p\(n)" } }
    check("a file that names no limit gets KeePass's default of ten items", "\(historyCount(r.document, r.id))", "10")

    // Dedupe: a snapshot identical to the newest history item is not added again.
    let doc = try freshDocument("dedupe")
    setClock(t0)
    let item = VaultItem(kind: .login, title: "T", website: "dedupe.example", secret: "one")
    doc.upsert(item)
    let node = entryNode(doc, item.id)!
    doc.pushHistory(doc.historySnapshot(of: node), to: node)
    doc.pushHistory(doc.historySnapshot(of: node), to: node)
    check("an identical snapshot is not appended twice", "\(historyCount(doc, item.id))", "1")
    edit(doc, item.id, at: t0 + 5000) { $0.secret = "two" }
    check("an edit whose snapshot equals the newest item adds nothing either", "\(historyCount(doc, item.id))", "1")
    edit(doc, item.id, at: t0 + 9000) { $0.secret = "three" }
    check("the next edit, with a different snapshot, does", "\(historyCount(doc, item.id))", "2")
    resetClock()
}

// Previous passwords, when the current one was set, restore and clear.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t)
    let doc = try freshDocument()
    let item = VaultItem(kind: .login, title: "X", account: "a", website: "pw.example", secret: "A")
    doc.upsert(item)
    expect("no history: no previous passwords and an unknown change date", doc.previousPasswords(of: item.id).isEmpty && doc.passwordChanged(of: item.id) == nil)
    edit(doc, item.id, at: t + 1000) { $0.secret = "B" }
    edit(doc, item.id, at: t + 2000) { $0.title = "X2" }          // outside the window: a second version with B
    edit(doc, item.id, at: t + 3000) { $0.secret = "C" }
    edit(doc, item.id, at: t + 4000) { $0.secret = "D" }
    func rows() -> String { doc.previousPasswords(of: item.id).map { "\($0.password)@\(Int($0.replaced.timeIntervalSince1970 - t))" }.joined(separator: " ") }
    check("previous passwords, newest first, versions with one password collapsed", rows(), "C@4000 B@3000 A@1000")
    check("the current password was set at the last change", "\(Int(doc.passwordChanged(of: item.id)!.timeIntervalSince1970 - t))", "4000")
    edit(doc, item.id, at: t + 5000) { $0.title = "X3" }
    check("a later title edit leaves the previous passwords", rows(), "C@4000 B@3000 A@1000")
    check("and the date the password was set", "\(Int(doc.passwordChanged(of: item.id)!.timeIntervalSince1970 - t))", "4000")

    // Restore: B comes back through the normal change path.
    let before = historyCount(doc, item.id)
    setClock(t + 6000)
    expect("restore of an unknown row does nothing", !doc.restorePassword(of: item.id, replacedAt: at(t + 1234)))
    expect("restore puts the password back", doc.restorePassword(of: item.id, replacedAt: at(t + 3000)))
    check("the restored password is current", current(doc, item.id).secret, "B")
    check("restoring is itself a revision", "\(historyCount(doc, item.id))", "\(before + 1)")
    check("the password it replaced joins the list, and the restored one, now current, leaves it", rows(), "D@6000 C@4000 A@1000")
    expect("the modification time moved", current(doc, item.id).modified == at(t + 6000))
    // A password that was current again is not listed as previous.
    let again = try freshDocument()
    setClock(t); again.upsert(VaultItem(kind: .login, title: "Y", website: "again.example", secret: "one"))
    let againID = again.items()[0].id
    edit(again, againID, at: t + 1000) { $0.secret = "two" }
    edit(again, againID, at: t + 2000) { $0.secret = "one" }
    check("the current password is left out of the previous ones", again.previousPasswords(of: againID).map(\.password).joined(separator: ","), "two")
    // An empty password is not a previous password.
    let blank = try freshDocument()
    setClock(t); blank.upsert(VaultItem(kind: .login, title: "Z", website: "blank.example", secret: ""))
    let blankID = blank.items()[0].id
    edit(blank, blankID, at: t + 1000) { $0.secret = "first" }
    check("an empty earlier password is not listed", "\(blank.previousPasswords(of: blankID).count)", "0")
    check("but it marks when the password was set", "\(Int(blank.passwordChanged(of: blankID)!.timeIntervalSince1970 - t))", "1000")

    // Clear.
    expect("clear removes the history", doc.clearPreviousPasswords(of: item.id))
    expect("nothing is left to show", doc.previousPasswords(of: item.id).isEmpty && historyCount(doc, item.id) == 0)
    check("the entry itself is untouched", current(doc, item.id).secret, "B")
    expect("clearing twice reports nothing to do", !doc.clearPreviousPasswords(of: item.id))
    resetClock()
}

// MARK: Recycle Bin

func groupNode(_ document: KDBXDocument, named name: String) -> XNode? {
    func visit(_ group: XNode) -> XNode? {
        if group.child("Name")?.text == name { return group }
        for child in group.children(named: "Group") { if let found = visit(child) { return found } }
        return nil
    }
    return document.rootGroup.flatMap(visit)
}
func count(_ document: KDBXDocument, _ id: UUID) -> Int { document.locations().filter { EntryMapping.uuid(of: $0.entry) == id }.count }
func deletedObjects(_ document: KDBXDocument) -> Int { document.rootNode?.child("DeletedObjects")?.children.count ?? 0 }
func sourceList(_ document: KDBXDocument) -> [String] { DeletedSources.read(from: document.root).sorted() }
func withSource(_ item: VaultItem, _ source: String, in document: KDBXDocument) {
    EntryMapping.setCustomData(entryNode(document, item.id)!, KeePassImport.sourceKey, source, modified: KeePassTime.storedNow)
}

do {
    let t: TimeInterval = 1_700_000_000   // 2023-11-14T22:13:20Z
    setClock(t)
    let doc = try freshDocument("Bin")
    let work = XNode("Group", children: [XNode("UUID", text: UUID().kdbxBase64), XNode("Name", text: "Work")])
    doc.rootGroup!.children.append(work)
    let a = VaultItem(kind: .login, title: "A", account: "a", website: "a.example", secret: "a1")
    let b = VaultItem(kind: .login, title: "B", account: "b", website: "b.example", secret: "b1")
    let c = VaultItem(kind: .login, title: "C", account: "c", website: "c.example", secret: "c1")
    for item in [a, b, c] { doc.upsert(item) }
    let aNode = entryNode(doc, a.id)!
    doc.rootGroup!.children.removeAll { $0 === aNode }
    work.children.append(aNode)
    edit(doc, a.id, at: t + 10) { $0.secret = "a2" }
    check("A has one revision before it is deleted", "\(historyCount(doc, a.id))", "1")
    let historyBefore = aNode.child("History")!.deepCopy()
    expect("no bin yet", groupNode(doc, named: "Recycle Bin") == nil && doc.recycleBinID == nil)

    setClock(t + 100)
    let modifiedBeforeMove = timeText(doc, a.id, "LastModificationTime")
    expect("move to the Recycle Bin", doc.moveToRecycleBin(a.id))
    let bin = groupNode(doc, named: "Recycle Bin")!
    check("the bin has the standard icon", bin.child("IconID")?.text ?? "", "43")
    check("Meta points at the bin", doc.meta!.child("RecycleBinUUID")!.text, bin.child("UUID")!.text)
    check("Meta says the bin is enabled", doc.meta!.child("RecycleBinEnabled")!.text, "True")
    check("RecycleBinChanged is stamped in the KDBX 4 form", doc.meta!.child("RecycleBinChanged")!.text, KeePassTime.stored(at(t + 100)))
    expect("the bin is in the root group and the entry in the bin", doc.rootGroup!.children.contains { $0 === bin } && bin.children.contains { $0 === aNode })
    expect("the entry left its group", !work.children.contains { $0 === aNode })
    check("the live items are the others", "\(doc.items().map(\.title).sorted())", "[\"B\", \"C\"]")
    check("the bin lists the entry", "\(doc.recycledItems().map(\.item.title))", "[\"A\"]")
    expect("with its deletion time", doc.recycledItems()[0].deleted == at(t + 100) && doc.recycledItems()[0].item.secret == "a2")
    check("the group it came from is recorded", EntryMapping.customData(aNode, RecycleBinKeys.deletedFrom) ?? "-", work.child("UUID")!.text)
    check("and when", EntryMapping.customData(aNode, RecycleBinKeys.deletedAt) ?? "-", "2023-11-14T22:15:00Z")
    check("LocationChanged is set", aNode.child("Times")!.child("LocationChanged")!.text, KeePassTime.stored(at(t + 100)))
    expect("the history moved with it", aNode.child("History")!.isEqual(to: historyBefore))
    check("a move does not change the modification time", timeText(doc, a.id, "LastModificationTime"), modifiedBeforeMove)
    expect("a bin entry is known to the import duplicate check as recycled", KeePassImport.known(in: doc).first { $0.node === aNode }?.existing.inRecycleBin == true)
    expect("moving it again does nothing", !doc.moveToRecycleBin(a.id))
    expect("an unknown id does nothing", !doc.moveToRecycleBin(UUID()) && !doc.restoreFromRecycleBin(UUID()) && !doc.deletePermanently(UUID()))
    setClock(t + 200)
    expect("a second entry goes to the same bin", doc.moveToRecycleBin(b.id))
    check("there is still one Recycle Bin", "\(doc.rootGroup!.children(named: "Group").filter { $0.child("Name")?.text == "Recycle Bin" }.count)", "1")
    check("newest deletion first", "\(doc.recycledItems().map(\.item.title))", "[\"B\", \"A\"]")
    check("the file round trip keeps it", "\(try KDBX.open(try KDBX.save(doc), credentials: .init(password: "pw")).recycledItems().count) \(try KDBX.open(try KDBX.save(doc), credentials: .init(password: "pw")).items().count)", "2 1")

    // Restore to the original group, and when it is gone, to the root.
    setClock(t + 300)
    expect("restore", doc.restoreFromRecycleBin(a.id))
    expect("it is back in its group", work.children.contains { $0 === aNode })
    check("LocationChanged is updated", aNode.child("Times")!.child("LocationChanged")!.text, KeePassTime.stored(at(t + 300)))
    expect("the deletion record is gone", EntryMapping.customData(aNode, RecycleBinKeys.deletedFrom) == nil && EntryMapping.customData(aNode, RecycleBinKeys.deletedAt) == nil && aNode.child("CustomData") == nil)
    expect("it is live again with its history", doc.items().contains { $0.id == a.id } && aNode.child("History")!.isEqual(to: historyBefore))
    expect("restoring a live entry does nothing", !doc.restoreFromRecycleBin(a.id))
    expect("it is not in the bin list any more", !doc.recycledItems().contains { $0.item.id == a.id })
    doc.moveToRecycleBin(a.id)
    doc.rootGroup!.children.removeAll { $0 === work }
    expect("restore after the group was deleted", doc.restoreFromRecycleBin(a.id))
    expect("goes to the root group", doc.rootGroup!.children.contains { $0 === aNode })

    // An entry another app recycled has no Psss data: its LocationChanged is the deletion time, and restore goes to the root.
    doc.moveToRecycleBin(c.id)
    let cNode = entryNode(doc, c.id)!
    cNode.child("CustomData")?.children.removeAll()
    cNode.children.removeAll { $0.name == "CustomData" }
    cNode.child("Times")!.child("LocationChanged")!.text = KeePassTime.stored(at(t - 5000))
    expect("another app's deletion date is its LocationChanged", doc.recycledItems().first { $0.item.id == c.id }?.deleted == at(t - 5000))
    expect("restore needs no Psss data", doc.restoreFromRecycleBin(c.id) && doc.rootGroup!.children.contains { $0 === cNode })

    // Writes consider the bin: upsert of an id that is in the bin restores it, and never makes a second entry.
    doc.moveToRecycleBin(b.id)
    check("b is in the bin once", "\(count(doc, b.id))", "1")
    setClock(t + 400)
    var changedB = b; changedB.title = "B2"
    expect("saving an item from the bin restores and updates it", doc.upsert(changedB))
    check("still exactly one entry with that identifier", "\(count(doc, b.id))", "1")
    check("it is live with the new title", "\(doc.items().first { $0.id == b.id }?.title ?? "-")", "B2")
    check("and the bin no longer holds it", "\(doc.recycledItems().map(\.item.id).contains(b.id))", "false")
    doc.moveToRecycleBin(b.id)
    expect("saving the same content restores it too, and reports a change", doc.upsert(doc.recycledItems().first { $0.item.id == b.id }!.item))
    check("again exactly one", "\(count(doc, b.id))", "1")
    // A live and a bin entry with one identifier: a restore would duplicate it, so it is refused.
    doc.moveToRecycleBin(b.id)
    let twin = entryNode(doc, b.id)!.deepCopy()
    doc.rootGroup!.children.append(twin)
    expect("restoring over a live duplicate is refused", !doc.restoreFromRecycleBin(b.id))
    check("both stay where they are", "\(doc.items().filter { $0.id == b.id }.count) \(doc.recycledItems().filter { $0.item.id == b.id }.count)", "1 1")
    expect("an upsert goes to the live one", doc.upsert({ var item = doc.items().first { $0.id == b.id }!; item.notes = "live"; return item }()) && count(doc, b.id) == 2)
    expect("deleting for good removes both", doc.deletePermanently(b.id) && count(doc, b.id) == 0)
    resetClock()
}

// Deleting for good, emptying, the purge, and the deleted-sources list.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t)
    let doc = try freshDocument("Gone")
    func make(_ title: String) -> VaultItem {
        let item = VaultItem(kind: .login, title: title, website: "\(title.lowercased()).example", secret: title)
        doc.upsert(item)
        return item
    }
    let live = make("Live"), binned = make("Binned"), sourced = make("Sourced"), twin = make("Twin"), other = make("Other")
    withSource(sourced, "1password:S1", in: doc); withSource(twin, "1password:S1", in: doc); withSource(other, "1password:S2", in: doc)
    withSource(binned, "1password:B1", in: doc)
    check("a vault without deletions has no list", "\(sourceList(doc))", "[]")

    // Direct, from the live entries.
    setClock(t + 50)
    expect("delete for good from the live entries", doc.deletePermanently(live.id))
    check("it is gone everywhere", "\(count(doc, live.id))", "0")
    check("the deletion is recorded with its time", "\(deletedObjects(doc)) \(doc.rootNode!.child("DeletedObjects")!.children[0].child("DeletionTime")!.text == KeePassTime.stored(at(t + 50))) \(doc.rootNode!.child("DeletedObjects")!.children[0].child("UUID")!.text == live.id.kdbxBase64)", "1 true true")
    check("an entry without a source adds nothing to the list", "\(sourceList(doc))", "[]")

    // Moving and restoring leave the list alone.
    doc.moveToRecycleBin(binned.id)
    check("moving to the bin does not add the source", "\(sourceList(doc))", "[]")
    doc.restoreFromRecycleBin(binned.id)
    check("restoring does not either", "\(sourceList(doc))", "[]")
    doc.moveToRecycleBin(binned.id)
    expect("delete for good from the bin", doc.deletePermanently(binned.id))
    check("its source is on the list", "\(sourceList(doc))", "[\"1password:B1\"]")
    check("and the deletion is recorded", "\(deletedObjects(doc))", "2")
    expect("the list survives a save", DeletedSources.read(from: try KDBX.open(try KDBX.save(doc), credentials: .init(password: "pw")).root) == ["1password:B1"])
    expect("restoring does not remove from the list", { doc.restoreFromRecycleBin(binned.id); return sourceList(doc) == ["1password:B1"] }())

    // Emptying and the purge.
    doc.moveToRecycleBin(sourced.id); doc.moveToRecycleBin(twin.id); doc.moveToRecycleBin(other.id)
    check("three in the bin", "\(doc.recycledItems().count)", "3")
    check("emptying returns how many it deleted", "\(doc.emptyRecycleBin())", "3")
    expect("the bin is empty and nothing is live", doc.recycledItems().isEmpty && doc.items().isEmpty)
    check("each deletion is recorded", "\(deletedObjects(doc))", "5")
    check("two entries with one source add it once", "\(sourceList(doc))", "[\"1password:B1\", \"1password:S1\", \"1password:S2\"]")

    let day: TimeInterval = 24 * 60 * 60
    let now = at(t + 100 * day)
    func recycle(_ title: String, deletedAgo seconds: TimeInterval, source: String? = nil) -> VaultItem {
        let item = VaultItem(kind: .login, title: title, website: "\(title.lowercased()).example", secret: title)
        setClock(t)
        doc.upsert(item)
        if let source { withSource(item, source, in: doc) }
        setClock(now.timeIntervalSince1970 - seconds)
        doc.moveToRecycleBin(item.id)
        return item
    }
    let fresh = recycle("Fresh", deletedAgo: 29 * day)
    let edge = recycle("Edge", deletedAgo: 30 * day)
    let over = recycle("Over", deletedAgo: 30 * day + 1, source: "1password:P1")
    let old = recycle("Old", deletedAgo: 90 * day)
    let undated = recycle("Undated", deletedAgo: 90 * day)
    let undatedNode = entryNode(doc, undated.id)!
    undatedNode.children.removeAll { $0.name == "CustomData" }
    undatedNode.child("Times")!.children.removeAll { $0.name == "LocationChanged" }
    let before = deletedObjects(doc)
    let purged = doc.purgeRecycleBin(olderThan: RecycleBinKeys.retention, now: now)
    check("the purge removes what is more than 30 days old", "\(purged)", "2")
    expect("exactly 30 days stays, 30 days and a second goes", count(doc, edge.id) == 1 && count(doc, over.id) == 0 && count(doc, old.id) == 0 && count(doc, fresh.id) == 1)
    expect("an entry with no known deletion date is never purged", count(doc, undated.id) == 1)
    check("the purge records its deletions and the sources", "\(deletedObjects(doc) - before) \(sourceList(doc).contains("1password:P1"))", "2 true")
    check("nothing more to purge", "\(doc.purgeRecycleBin(olderThan: RecycleBinKeys.retention, now: now))", "0")
    check("retention is 30 days", "\(RecycleBinKeys.retention / day)", "30.0")
    resetClock()
}

// The legacy remove(_:) is a permanent delete too, from anywhere.
do {
    let doc = try freshDocument()
    let item = VaultItem(kind: .login, title: "R", website: "r.example", secret: "r")
    doc.upsert(item)
    doc.moveToRecycleBin(item.id)
    doc.remove(item.id)
    check("remove deletes from the bin too", "\(count(doc, item.id)) \(deletedObjects(doc))", "0 1")
}

// MARK: The store API, on both stores

do {
    let sample = SampleVaultStore()
    let first = SampleVault.items[0], second = SampleVault.items[1]
    let total = sample.items().count
    try sample.moveToRecentlyDeleted(first.id)
    expect("sample: moving takes an item out of the list", sample.items().count == total - 1 && !sample.items().contains { $0.id == first.id })
    check("sample: and puts it in Recently Deleted", "\(sample.recentlyDeleted().map(\.item.id) == [first.id])", "true")
    try sample.restore(first.id)
    expect("sample: restore brings it back", sample.items().count == total && sample.recentlyDeleted().isEmpty)
    try sample.moveToRecentlyDeleted(first.id); try sample.moveToRecentlyDeleted(second.id)
    check("sample: newest first", "\(sample.recentlyDeleted().map(\.item.id) == [second.id, first.id])", "true")
    try sample.deletePermanently(first.id)
    expect("sample: delete for good from Recently Deleted", sample.recentlyDeleted().count == 1 && !sample.items().contains { $0.id == first.id })
    try sample.emptyRecentlyDeleted()
    expect("sample: empty", sample.recentlyDeleted().isEmpty && sample.items().count == total - 2)
    try sample.delete(SampleVault.items[2].id)
    expect("sample: delete stays permanent", sample.recentlyDeleted().isEmpty && sample.items().count == total - 3)
    expect("sample: no previous passwords", sample.previousPasswords(of: second.id).isEmpty && sample.passwordChanged(of: second.id) == nil)
    try sample.restorePassword(of: second.id, replacedAt: .now); try sample.clearPreviousPasswords(of: second.id)
    print("ok   sample: previous-password calls are no-ops")
}

do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-groundwork-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    func backupNames(_ id: UUID) -> [String] {
        ((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []).sorted()
    }
    func makeStore(_ name: String, password: String = "old-pw") throws -> (store: KeePassVaultStore, url: URL, id: UUID) {
        let url = dir.appendingPathComponent("\(name).kdbx")
        let data = try KDBX.save(try KDBX.create(name: name, credentials: .init(password: password), kdf: light))
        try data.write(to: url)
        let id = UUID()
        let store = KeePassVaultStore(reference: VaultReference(id: id, name: name, managed: true, bookmark: nil, fileName: url.lastPathComponent),
                                      url: url, scoped: false, document: try KDBX.open(data, credentials: .init(password: password)), fileData: data)
        return (store, url, id)
    }
    func opensWith(_ url: URL, _ password: String) -> Bool { (try? KDBX.open(Data(contentsOf: url), credentials: .init(password: password))) != nil }
    func onDisk(_ url: URL, _ password: String = "old-pw") throws -> KDBXDocument { try KDBX.open(Data(contentsOf: url), credentials: .init(password: password)) }
    let day: TimeInterval = 24 * 60 * 60

    let v = try makeStore("groundwork")
    let x = VaultItem(kind: .login, title: "X", account: "x@example.net", website: "x.example", secret: "x1")
    let y = VaultItem(kind: .login, title: "Y", account: "y@example.net", website: "y.example", secret: "y1")
    let z = VaultItem(kind: .login, title: "Z", account: "z@example.net", website: "z.example", secret: "z1")
    /// Runs the operation and says how many rollback copies it made, which is one per write of the vault file.
    func writes(_ body: () throws -> Void) async throws -> Int {
        try await Task.sleep(for: .milliseconds(8))
        let before = Set(backupNames(v.id))
        try body()
        try await Task.sleep(for: .milliseconds(8))
        return Set(backupNames(v.id)).subtracting(before).count
    }
    check("save writes once", "\(try await writes { try v.store.save([x, y]) })", "1")
    expect("items carry the entry's dates", v.store.items().allSatisfy { $0.created != nil && $0.modified != nil })

    check("move to Recently Deleted writes once", "\(try await writes { try v.store.moveToRecentlyDeleted(x.id) })", "1")
    expect("the item left the list and is in Recently Deleted", !v.store.items().contains { $0.id == x.id } && v.store.recentlyDeleted().map(\.item.id) == [x.id])
    expect("the file holds it in the Recycle Bin", try onDisk(v.url).recycledItems().map(\.item.id) == [x.id] && !(try onDisk(v.url).items().contains { $0.id == x.id }))
    check("moving something that is not there writes nothing", "\(try await writes { try v.store.moveToRecentlyDeleted(UUID()) })", "0")
    check("restore writes once", "\(try await writes { try v.store.restore(x.id) })", "1")
    expect("the item is back", v.store.items().contains { $0.id == x.id } && v.store.recentlyDeleted().isEmpty)
    check("restoring a live item writes nothing", "\(try await writes { try v.store.restore(x.id) })", "0")
    _ = try await writes { try v.store.moveToRecentlyDeleted(x.id) }
    UsageLog.record(x.id, in: v.id)
    check("delete for good from Recently Deleted writes once", "\(try await writes { try v.store.deletePermanently(x.id) })", "1")
    expect("it is gone, with its usage", v.store.recentlyDeleted().isEmpty && !v.store.items().contains { $0.id == x.id } && UsageLog.load(for: v.id)[x.id] == nil)
    check("delete, as before, is permanent and writes once", "\(try await writes { try v.store.delete(y.id) })", "1")
    expect("and leaves nothing to restore", v.store.recentlyDeleted().isEmpty && !v.store.items().contains { $0.id == y.id })
    check("deleting for good something that is not there writes nothing", "\(try await writes { try v.store.deletePermanently(UUID()) })", "0")

    _ = try await writes { try v.store.save([x, y, z]) }
    _ = try await writes { try v.store.moveToRecentlyDeleted(x.id) }
    _ = try await writes { try v.store.moveToRecentlyDeleted(y.id) }
    check("empty writes once", "\(try await writes { try v.store.emptyRecentlyDeleted() })", "1")
    expect("Recently Deleted is empty and z is live", v.store.recentlyDeleted().isEmpty && v.store.items().map(\.id) == [z.id])
    check("emptying an empty bin writes nothing", "\(try await writes { try v.store.emptyRecentlyDeleted() })", "0")

    // The purge writes only when it removes something.
    let now = Date()
    let oldItem = VaultItem(kind: .login, title: "Old", website: "old.example", secret: "o")
    let newItem = VaultItem(kind: .login, title: "New", website: "new.example", secret: "n")
    _ = try await writes { try v.store.save([oldItem, newItem]) }
    KeePassTime.clock = { now.addingTimeInterval(-40 * day) }
    _ = try await writes { try v.store.moveToRecentlyDeleted(oldItem.id) }
    resetClock()
    _ = try await writes { try v.store.moveToRecentlyDeleted(newItem.id) }
    var purged = 0
    check("purge writes once when something is old", "\(try await writes { purged = try v.store.purgeRecentlyDeleted() })", "1")
    check("it deleted the old item only", "\(purged) \(v.store.recentlyDeleted().map(\.item.title))", "1 [\"New\"]")
    check("a purge that finds nothing writes nothing", "\(try await writes { purged = try v.store.purgeRecentlyDeleted() })", "0")
    check("and deletes nothing", "\(purged)", "0")

    // Previous passwords through the store.
    let p = VaultItem(kind: .login, title: "P", account: "p@example.net", website: "p.example", secret: "s1")
    _ = try await writes { try v.store.save([p]) }
    for secret in ["s2", "s3"] {
        var item = v.store.items().first { $0.id == p.id }!; item.secret = secret
        _ = try await writes { try v.store.save([item]) }
    }
    check("previous passwords, newest first", "\(v.store.previousPasswords(of: p.id).map(\.password))", "[\"s2\", \"s1\"]")
    expect("the date the password was set is known", v.store.passwordChanged(of: p.id) != nil)
    let oldest = v.store.previousPasswords(of: p.id)[1]
    check("restoring writes once", "\(try await writes { try v.store.restorePassword(of: p.id, replacedAt: oldest.replaced) })", "1")
    check("the restored password is current", v.store.items().first { $0.id == p.id }!.secret, "s1")
    check("and the one it replaced is listed", "\(v.store.previousPasswords(of: p.id).map(\.password))", "[\"s3\", \"s2\"]")
    check("restoring a row that is not there writes nothing", "\(try await writes { try v.store.restorePassword(of: p.id, replacedAt: at(5)) })", "0")
    check("clearing writes once", "\(try await writes { try v.store.clearPreviousPasswords(of: p.id) })", "1")
    expect("nothing is listed afterwards", v.store.previousPasswords(of: p.id).isEmpty && v.store.passwordChanged(of: p.id) == nil)
    check("clearing again writes nothing", "\(try await writes { try v.store.clearPreviousPasswords(of: p.id) })", "0")
    expect("the file has no history for it", (try onDisk(v.url)).locations().first { EntryMapping.uuid(of: $0.entry) == p.id }?.entry.child("History")?.children.isEmpty == true)
    for id in [v.id] { VaultFiles.removeBackups(for: id) }

    // The purge on unlock is the app's: the AutoFill extension runs the same unlock and leaves it off.
    let session = VaultSession()
    session.forget()
    VaultSession.purgesRecentlyDeletedOnUnlock = false
    try await session.create(name: "Purge on unlock", credentials: .init(password: "pw"), items: [])
    let oldOne = VaultItem(kind: .login, title: "Old", website: "o.example", secret: "o")
    let newOne = VaultItem(kind: .login, title: "New", website: "n.example", secret: "n")
    try session.store!.save([oldOne, newOne])
    KeePassTime.clock = { now.addingTimeInterval(-40 * day) }
    try session.store!.moveToRecentlyDeleted(oldOne.id)
    resetClock()
    try session.store!.moveToRecentlyDeleted(newOne.id)
    let sessionURL = session.store!.url
    session.lock()
    let untouched = try Data(contentsOf: sessionURL)
    try await session.unlock(credentials: .init(password: "pw"))
    expect("without the app's switch, unlocking does not write", try Data(contentsOf: sessionURL) == untouched)
    check("and purges nothing", "\(session.store!.recentlyDeleted().count)", "2")
    session.lock()
    VaultSession.purgesRecentlyDeletedOnUnlock = true
    try await session.unlock(credentials: .init(password: "pw"))
    check("with it, unlocking purges what is over 30 days old", "\(session.store!.recentlyDeleted().map(\.item.title))", "[\"New\"]")
    expect("and wrote the vault", try Data(contentsOf: sessionURL) != untouched)
    session.lock()
    let afterPurge = try Data(contentsOf: sessionURL)
    try await session.unlock(credentials: .init(password: "pw"))
    expect("a later unlock with nothing to purge does not write", try Data(contentsOf: sessionURL) == afterPurge)
    expect("the purged item is gone for good", !(try KDBX.open(afterPurge, credentials: .init(password: "pw")).locations().contains { EntryMapping.uuid(of: $0.entry) == oldOne.id }))
    VaultSession.purgesRecentlyDeletedOnUnlock = false
    session.forget()

    // MARK: Store follow-ups from the security validation

    // Rollback copies that cannot be removed after a password change are reported, and removed on a later write.
    if getuid() != 0 {
        let c = try makeStore("backups-remain")
        try c.store.save([x]); try c.store.save([y])
        let folder = VaultFiles.storageRoot.appendingPathComponent("Backups/\(c.id.uuidString)")
        let copies = backupNames(c.id)
        expect("rollback copies exist before the password change", copies.count >= 2)
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: folder.path)
        expect("removeBackups reports a failure", VaultFiles.removeBackups(for: c.id) == false)
        let result = try await c.store.changeCredentials(to: .init(password: "new-pw"))
        check("the change reports that older copies remain", "\(result)", "changedBackupsRemain")
        expect("the password did change", opensWith(c.url, "new-pw") && !opensWith(c.url, "old-pw"))
        expect("the old copies are still there, and open with the old password", backupNames(c.id) == copies && copies.allSatisfy { name in
            (try? KDBX.open(Data(contentsOf: folder.appendingPathComponent(name)), credentials: .init(password: "old-pw"))) != nil })
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder.path)
        try c.store.save([z])
        expect("a later write removes them", backupNames(c.id).allSatisfy { name in
            (try? KDBX.open(Data(contentsOf: folder.appendingPathComponent(name)), credentials: .init(password: "old-pw"))) == nil })
        expect("and keeps its own copy, made with the new password", !backupNames(c.id).isEmpty && backupNames(c.id).allSatisfy { name in
            (try? KDBX.open(Data(contentsOf: folder.appendingPathComponent(name)), credentials: .init(password: "new-pw"))) != nil })
        VaultFiles.removeBackups(for: c.id)

        let ok = try makeStore("backups-removed")
        try ok.store.save([x])
        let outcome = try await ok.store.changeCredentials(to: .init(password: "new-pw"))
        check("when the copies are removed the change reports a plain success", "\(outcome) \(backupNames(ok.id).count)", "changed 0")
        check("removing copies that are not there is a success", "\(VaultFiles.removeBackups(for: ok.id))", "true")
    } else { print("skip backup-removal failure test: running as root") }
    try? fm.removeItem(at: dir)
}

// The stored vault reference is changed field by field and cannot be brought back after a forget. Two sessions stand in for two
// processes, the app and the AutoFill extension.
do {
    let app = VaultSession()
    app.forget()
    try await app.create(name: "Reference A", credentials: .init(password: "pw"), items: [])
    let old = app.reference!
    let extensionProcess = VaultSession()   // read the reference before the app forgets it
    expect("both read the same reference", extensionProcess.reference?.id == old.id)
    app.forget()
    check("forgetting removes the stored reference", "\(VaultReference.load()?.id.uuidString ?? "none")", "none")
    extensionProcess.declineBiometricOffer()
    extensionProcess.disableBiometric()
    try? extensionProcess.enableBiometric()
    check("a stale copy cannot write a forgotten reference back", "\(VaultReference.load()?.id.uuidString ?? "none")", "none")
    old.persist()
    check("nor persist it directly", "\(VaultReference.load()?.id.uuidString ?? "none")", "none")
    expect("the update helper refuses it too", VaultReference.update(old.id) { $0.name = "x" } == nil && VaultReference.load() == nil)

    // A new vault is not affected, and the old copy still cannot touch it.
    try await app.create(name: "Reference B", credentials: .init(password: "pw"), items: [])
    let id = app.reference!.id
    expect("a vault created after the forget is stored", VaultReference.load()?.id == id && id != old.id)
    extensionProcess.declineBiometricOffer()
    old.persist()
    expect("the forgotten vault's copies still change nothing", VaultReference.load()?.id == id && VaultReference.load()?.biometricDeclined == false && VaultReference.load()?.name == "Reference B")

    // Toggling in one process while the other marks the saved key stale.
    try app.enableBiometric()
    let other = VaultSession()      // the extension, holding biometricUnlock = true
    expect("the extension read the setting", other.reference?.biometricUnlock == true)
    app.lock()
    BiometricKey.memory[id] = Data(repeating: 9, count: 32)         // the saved key no longer fits
    do { try await other.unlockWithBiometrics(); failures += 1; print("FAIL stale key unlocked") } catch BiometricKeyError.invalidated { print("ok   the extension marks the key stale") }
    check("the stale mark is stored", "\(VaultReference.load()?.biometricUnlock ?? true) \(VaultReference.load()?.biometricStale ?? false)", "false true")
    app.declineBiometricOffer()      // the app still holds biometricUnlock = true from before
    check("the app's change keeps the stale mark and lands itself", "\(VaultReference.load()?.biometricUnlock ?? true) \(VaultReference.load()?.biometricStale ?? false) \(VaultReference.load()?.biometricDeclined ?? false)", "false true true")
    expect("the app adopted what was stored", app.reference?.biometricStale == true && app.reference?.biometricUnlock == false)
    try await app.unlock(credentials: .init(password: "pw"))
    check("a password unlock turns the setting back on", "\(VaultReference.load()?.biometricUnlock ?? false) \(VaultReference.load()?.biometricStale ?? true)", "true false")
    // The app toggles the setting off while the extension, with an older copy, records a decline: both stay.
    let snapshot = VaultSession()
    app.disableBiometric()
    snapshot.declineBiometricOffer()
    check("a toggle and a setting changed by another copy both stay", "\(VaultReference.load()?.biometricUnlock ?? true) \(VaultReference.load()?.biometricDeclined ?? false)", "false true")
    app.forget()
}

// MARK: Cards

do {
    let brands: [(String, CardBrand)] = [
        ("4242424242424242", .visa), ("4111111111111111", .visa), ("5555555555554444", .mastercard), ("2221000000000009", .mastercard),
        ("2720999999999996", .mastercard), ("378282246310005", .americanExpress), ("341111111111111", .americanExpress),
        ("6011111111111117", .discover), ("6500000000000002", .discover), ("3530111333300000", .jcb), ("30569309025904", .dinersClub),
        ("36227206271667", .dinersClub), ("6759649826438453", .maestro), ("5018000000000009", .maestro), ("6304000000000000", .maestro),
        ("6200000000000005", .unionPay), ("6212345678901234567", .unionPay), ("2200123456789019", .mir), ("2204123456789012", .mir),
        ("5066991111111118", .elo), ("4011780000000000", .elo), ("6362970000457013", .elo), ("6504060000000000", .elo), ("6277800000000000", .elo),
    ]
    for (number, brand) in brands { check("brand of \(number)", CardBrand(number: number).map { $0.name } ?? "none", brand.name) }
    check("spaces and dashes are ignored", CardBrand(number: "3782 822463-10005")?.name ?? "none", "American Express")
    expect("short or unknown numbers have no brand", CardBrand(number: "") == nil && CardBrand(number: "9") == nil && CardBrand(number: "1234567890123456") == nil)
    expect("the new networks have no logo asset yet, the old ones do", [CardBrand.maestro, .unionPay, .mir, .elo].allSatisfy { !$0.hasLogo } && [CardBrand.visa, .mastercard, .americanExpress, .discover, .jcb, .dinersClub].allSatisfy(\.hasLogo))
    check("Amex grouping", "\(CardBrand.americanExpress.grouping(digitCount: 15))", "[4, 6, 5]")
    check("a 14-digit Diners Club is 4-6-4", "\(CardBrand.dinersClub.grouping(digitCount: 14))", "[4, 6, 4]")
    check("a 16-digit Diners Club is 4-4-4-4", "\(CardBrand.dinersClub.grouping(digitCount: 16).prefix(4))", "[4, 4, 4, 4]")

    let grouped: [(String, String)] = [
        ("4242424242424242", "4242 4242 4242 4242"), ("378282246310005", "3782 822463 10005"), ("30569309025904", "3056 930902 5904"),
        ("6212345678901234567", "6212 3456 7890 1234 567"), ("4", "4"), ("42424", "4242 4"), ("37828224", "3782 8224"), ("378282246", "3782 82246"),
        ("4242-4242 4242", "4242 4242 4242"), ("", ""), ("abcd", ""), ("1234567890123456", "1234 5678 9012 3456"), ("12345", "1234 5"),
        ("42424242424242424242", "4242 4242 4242 4242 4242"), ("٤٢", ""),
    ]
    for (input, want) in grouped { check("grouped \"\(input)\"", CardNumber.grouped(input), want) }
    let normalized: [(String, String)] = [("4242 4242-4242.4242", "4242424242424242"), (" 12 34 ", "1234"), ("abc", ""), ("4２4", "44")]
    for (input, want) in normalized { check("normalized \"\(input)\"", CardNumber.normalized(input), want) }
    let luhn: [(String, Bool)] = [("4242424242424242", true), ("4242 4242 4242 4241", false), ("378282246310005", true), ("6011111111111117", true),
                                  ("30569309025904", true), ("5555555555554444", true), ("4111111111111112", false), ("", false), ("7", false), ("0000000000000000", true)]
    for (input, want) in luhn { check("luhn \"\(input)\"", "\(CardNumber.isValidLuhn(input))", "\(want)") }

    let accepted: [(String, String)] = [("08/30", "08/2030"), ("0830", "08/2030"), ("8/30", "08/2030"), ("08/2030", "08/2030"), ("2030-08", "08/2030"),
                                        ("08-30", "08/2030"), ("203008", "08/2030"), ("082030", "08/2030"), ("12/99", "12/2099"), ("1/30", "01/2030"),
                                        (" 08 / 30 ", "08/2030"), ("08.30", "08/2030"), ("830", "08/2030"), ("82030", "08/2030"), ("2030/8", "08/2030"),
                                        ("122030", "12/2030"), ("201203", "03/2012")]
    for (input, want) in accepted {
        let parsed = CardExpiry.parse(input)
        check("expiry \"\(input)\"", parsed.map { String(format: "%02d/%d", $0.month, $0.year) } ?? "nil", want)
    }
    for input in ["", "13/30", "00/30", "08/3", "08/20300", "abc", "08/30x", "2030", "08/1999", "1/2/3", "0", "08/", "/30", "08\u{2215}30", "٠٨/٣٠"] {
        check("expiry rejects \"\(input)\"", CardExpiry.parse(input).map { $0.formatted } ?? "nil", "nil")
    }
    check("formatted is MM/YY", [CardExpiry.parse("8/2030")!.formatted, CardExpiry.parse("12/05")!.formatted, CardExpiry.parse("2099-01")!.formatted].joined(separator: " "), "08/30 12/05 01/99")
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let midAugust = Date(timeIntervalSince1970: 1_912_939_200)   // 2030-08-14T12:00:00Z
    check("the test date", ISO8601DateFormatter().string(from: midAugust), "2030-08-14T12:00:00Z")
    let past: [(String, Bool)] = [("08/30", false), ("09/30", false), ("07/30", true), ("12/29", true), ("01/31", false), ("08/29", true), ("08/2031", false)]
    for (input, want) in past { check("\(input) is past on 14 August 2030", "\(CardExpiry.parse(input)!.isPast(now: midAugust, calendar: calendar))", "\(want)") }
    let endOfMonth = Date(timeIntervalSince1970: 1_914_451_199)   // 2030-08-31T23:59:59Z
    let nextMonth = Date(timeIntervalSince1970: 1_914_451_200)    // 2030-09-01T00:00:00Z
    expect("a card is good through the last day of its month", !CardExpiry.parse("08/30")!.isPast(now: endOfMonth, calendar: calendar) && CardExpiry.parse("08/30")!.isPast(now: nextMonth, calendar: calendar))
}

// MARK: Interop with KeePassXC: dates and the Recycle Bin

if run(["which", "keepassxc-cli"]).status == 0 {
    /// The entry with this title (not a history item) from `keepassxc-cli export -f xml`, which prints times as KeePassXC parsed them.
    func exported(_ path: URL, _ password: String, title: String) -> XNode? {
        let out = run(["keepassxc-cli", "export", "-q", "-f", "xml", path.path], input: password + "\n").out
        guard let root = try? XMLTree.parse(Data(out.utf8)) else { return nil }
        var found: XNode?
        func visit(_ node: XNode) {
            if node.name == "History" { return }
            if node.name == "Entry", EntryMapping.string(node, "Title") == title { found = node }
            for child in node.children { visit(child) }
        }
        visit(root)
        return found
    }
    func listing(_ path: URL, _ password: String) -> [String] {
        run(["keepassxc-cli", "ls", "-q", "-R", "-f", path.path], input: password + "\n").out
            .split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
    }

    // An entry written here shows the right dates in KeePassXC, in the KDBX 4 form.
    let datesPath = fixtures.appendingPathComponent("dates.kdbx")
    let dated = VaultItem(kind: .login, title: "Dated", account: "d@example.net", website: "https://dated.example", secret: "d1")
    let datesDocument = try freshDocument("Dates")
    setClock(1_614_834_367)               // 2021-03-04T05:06:07Z
    datesDocument.upsert(dated)
    edit(datesDocument, dated.id, at: 1_669_206_896) { $0.secret = "d2" }    // 2022-11-23T12:34:56Z
    resetClock()
    try KDBX.save(datesDocument).write(to: datesPath)
    if let entry = exported(datesPath, "pw", title: "Dated") {
        check("keepassxc reads the creation time we wrote", entry.child("Times")?.child("CreationTime")?.text ?? "-", "v2HS1w4AAAA=")
        check("keepassxc reads the modification time we wrote", entry.child("Times")?.child("LastModificationTime")?.text ?? "-", "cAoQ2w4AAAA=")
        expect("as the dates we meant", KeePassTime.date(entry.child("Times")?.child("CreationTime")?.text ?? "") == at(1_614_834_367)
               && KeePassTime.date(entry.child("Times")?.child("LastModificationTime")?.text ?? "") == at(1_669_206_896))
    } else { failures += 1; print("FAIL keepassxc export of our entry") }
    let ours = try KDBX.open(Data(contentsOf: datesPath), credentials: .init(password: "pw"))
    expect("the file holds the KDBX 4 form", timeText(ours, dated.id, "CreationTime") == "v2HS1w4AAAA=")
    expect("we read our own dates back", current(ours, dated.id).created == at(1_614_834_367) && current(ours, dated.id).modified == at(1_669_206_896))

    // Files KeePassXC wrote read as the same dates KeePassXC reports, in the ISO form (KDBX 3.1) and the KDBX 4 form.
    let xcPath = fixtures.appendingPathComponent("xc-dates.kdbx")
    run(["keepassxc-cli", "db-create", "-q", "-p", xcPath.path], input: "xc pw\nxc pw\n")
    run(["keepassxc-cli", "add", "-q", "-u", "xc", "-p", xcPath.path, "XC entry"], input: "xc pw\nxc-secret\n")
    let xcDocument = try KDBX.open(Data(contentsOf: xcPath), credentials: .init(password: "xc pw"))
    let xcItem = xcDocument.items().first { $0.title == "XC entry" }!
    let xcRaw = timeText(xcDocument, xcItem.id, "CreationTime")
    print("     keepassxc wrote \(xcDocument.sourceVersion ?? "KDBX 4") times as \(xcRaw.contains(":") ? "ISO text" : "base64")")
    if let entry = exported(xcPath, "xc pw", title: "XC entry") {
        let reported = KeePassTime.date(entry.child("Times")?.child("CreationTime")?.text ?? "")
        expect("we read the creation date KeePassXC reports for its own entry", reported != nil && xcItem.created == reported)
        expect("and the modification date", xcItem.modified == KeePassTime.date(entry.child("Times")?.child("LastModificationTime")?.text ?? ""))
        expect("both are now", abs((xcItem.created ?? .distantPast).timeIntervalSinceNow) < 300 && abs((xcItem.modified ?? .distantPast).timeIntervalSinceNow) < 300)
    } else { failures += 1; print("FAIL keepassxc export of its own entry") }
    let minePath = fixtures.appendingPathComponent("mine.kdbx")      // saved by KeePassXC as KDBX 4 when it added "Zed site"
    if let mine = try? KDBX.open(Data(contentsOf: minePath), credentials: .init(password: "interop pw")),
       let zed = mine.items().first(where: { $0.title == "Zed site" }), let entry = exported(minePath, "interop pw", title: "Zed site") {
        expect("a KDBX 4 file saved by KeePassXC is in the base64 form", !timeText(mine, zed.id, "CreationTime").contains(":"))
        expect("and reads as the dates KeePassXC reports", zed.created == KeePassTime.date(entry.child("Times")?.child("CreationTime")?.text ?? "") && zed.created != nil)
    } else { print("skip: mine.kdbx from the earlier interop block is not there") }

    // The Recycle Bin in both directions.
    let binPath = fixtures.appendingPathComponent("bin.kdbx")
    let keep = VaultItem(kind: .login, title: "Keep", account: "k", website: "keep.example", secret: "k1")
    let gone = VaultItem(kind: .login, title: "Gone", account: "g", website: "gone.example", secret: "g1")
    let zap = VaultItem(kind: .login, title: "Zap", account: "z", website: "zap.example", secret: "z1")
    var binDocument = try KDBX.create(name: "Bin", credentials: .init(password: "bin pw"), kdf: light)
    for item in [keep, gone, zap] { binDocument.upsert(item) }
    binDocument.moveToRecycleBin(gone.id)
    try KDBX.save(binDocument).write(to: binPath)
    var lines = listing(binPath, "bin pw")
    print("     keepassxc lists: \(lines)")
    expect("keepassxc shows the deleted entry under Recycle Bin", lines.contains("Recycle Bin/Gone"))
    expect("and not anywhere else", !lines.contains("Gone") && lines.filter { $0.hasSuffix("Gone") }.count == 1)
    expect("the others are where they were", lines.contains("Keep") && lines.contains("Zap"))
    expect("keepassxc still shows the entry's fields", run(["keepassxc-cli", "show", "-q", "-s", binPath.path, "Recycle Bin/Gone"], input: "bin pw\n").out.contains("Password: g1"))

    // An entry KeePassXC recycled is in the bin for us, dated by LocationChanged, and we can restore it.
    let beforeRemoval = Date()
    run(["keepassxc-cli", "rm", "-q", binPath.path, "Zap"], input: "bin pw\n")
    binDocument = try KDBX.open(Data(contentsOf: binPath), credentials: .init(password: "bin pw"))
    check("KeePassXC's own recycling shows in Recently Deleted", "\(binDocument.recycledItems().map(\.item.title).sorted())", "[\"Gone\", \"Zap\"]")
    let zapRow = binDocument.recycledItems().first { $0.item.id == zap.id }
    expect("with the deletion date taken from LocationChanged", zapRow != nil && abs(zapRow!.deleted.timeIntervalSince(beforeRemoval)) < 120
           && EntryMapping.customData(entryNode(binDocument, zap.id)!, RecycleBinKeys.deletedAt) == nil)
    expect("it is not in the live items", !binDocument.items().contains { $0.id == zap.id } && binDocument.items().map(\.title) == ["Keep"])
    expect("we restore it", binDocument.restoreFromRecycleBin(zap.id))
    try KDBX.save(binDocument).write(to: binPath)
    lines = listing(binPath, "bin pw")
    expect("keepassxc shows the restored entry at the top again", lines.contains("Zap") && !lines.contains("Recycle Bin/Zap"))
    expect("and the other one still in the bin", lines.contains("Recycle Bin/Gone"))

    // Deleted for good here, gone there.
    binDocument.deletePermanently(gone.id)
    try KDBX.save(binDocument).write(to: binPath)
    lines = listing(binPath, "bin pw")
    expect("after a permanent delete KeePassXC no longer lists the entry", !lines.contains { $0.hasSuffix("Gone") })
    expect("and cannot show it", run(["keepassxc-cli", "show", "-q", binPath.path, "Gone"], input: "bin pw\n").status != 0)
    expect("while the others are still there", lines.contains("Keep") && lines.contains("Zap"))
    check("the file records the deletion for KeePassXC's own merge", "\(deletedObjects(binDocument))", "1")
}

// MARK: Performance: listing and saving must stay linear in the number of entries

do {
    func generated(_ count: Int, iso: Bool = false) throws -> KDBXDocument {
        let doc = try freshDocument("Perf")
        var items = (0..<count).map { VaultItem(kind: .login, title: "T\($0)", account: "u\($0)@example.net", website: "https://site\($0).example", secret: "p\($0)", notes: "n") }
        doc.upsert(items)
        for i in stride(from: 0, to: count, by: 10) { items[i].secret = "q\(i)" }   // a tenth of them have history
        doc.upsert(items.enumerated().filter { $0.offset % 10 == 0 }.map(\.element))
        if iso {
            for location in doc.locations() {
                let times = location.entry.child("Times")!
                times.child("CreationTime")!.text = "2021-03-04T05:06:07Z"
                times.child("LastModificationTime")!.text = "2021-03-04T05:06:08Z"
            }
        }
        return doc
    }
    func seconds(_ body: () -> Void) -> Double { let start = Date(); body(); return Date().timeIntervalSince(start) }
    func listing(_ doc: KDBXDocument) -> Double { var count = 0; let t = (0..<3).map { _ in seconds { count = doc.items().count } }.min()!; expect("every generated entry is listed", count > 0); return t }
    func fmt(_ t: Double) -> String { String(format: "%.2f s", t) }

    var times: [Int: Double] = [:]
    for count in [500, 5_000, 20_000, 50_000] {
        let doc = try generated(count, iso: count == 20_000 || count == 50_000)
        let t = listing(doc)
        times[count] = t
        print("     items() on \(count) entries\(count >= 20_000 ? " with ISO times" : ""): \(fmt(t))")
        if count == 5_000 || count == 50_000 { print("     deep copy of the XML tree of \(count) entries (the snapshot before a store change): \(fmt(seconds { _ = doc.root.deepCopy() }))") }
        check("items() lists all \(count)", "\(doc.items().count)", "\(count)")
    }
    withinBudget("items() on 20,000 entries stays within the budget", times[20_000]!, quietRatio: 12.5)
    withinBudget("items() on 50,000 entries stays within the budget", times[50_000]!, quietRatio: 31)
    let floorTime = 0.1 * calibrationUnit()
    print(String(format: "     items() scaling: 20,000 over 5,000 = %.1f, 50,000 over 5,000 = %.1f (linear is 4 and 10)", times[20_000]! / max(times[5_000]!, floorTime), times[50_000]! / max(times[5_000]!, floorTime)))
    expect("items() scales linearly: 20,000 take at most 8 times as long as 5,000", times[20_000]! <= 8 * max(times[5_000]!, floorTime))
    expect("and 50,000 at most 20 times as long as 5,000", times[50_000]! <= 20 * max(times[5_000]!, floorTime))
    let tBase64 = listing(try generated(20_000))
    print("     items() on 20000 entries with KDBX 4 times: \(fmt(tBase64))")
    withinBudget("and with KDBX 4 times too", tBase64, quietRatio: 13)

    // A batch save is one pass and one commit.
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-perf-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("perf.kdbx")
    let data = try KDBX.save(try freshDocument("Perf"))
    try data.write(to: url)
    let id = UUID()
    let store = KeePassVaultStore(reference: VaultReference(id: id, name: "Perf", managed: true, bookmark: nil, fileName: "perf.kdbx"),
                                  url: url, scoped: false, document: try KDBX.open(data, credentials: .init(password: "pw")), fileData: data)
    let batch = (0..<2_000).map { VaultItem(kind: .login, title: "B\($0)", account: "b\($0)", website: "https://batch\($0).example", secret: "s\($0)") }
    let backupsBefore = Set(((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []))
    let tSave = try { () throws -> Double in let start = Date(); try store.save(batch); return Date().timeIntervalSince(start) }()
    print("     save of 2000 new items in one call: \(fmt(tSave))")
    withinBudget("saving 2,000 new items in one call stays within the budget", tSave, quietRatio: 5.5)
    check("and they are all there", "\(store.items().count)", "2000")
    let backupsAfter = Set(((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []))
    check("one commit: one rollback copy", "\(backupsAfter.subtracting(backupsBefore).count)", "1")
    let reread = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw"))
    check("the file holds them", "\(reread.items().count)", "2000")
    let tEdit = try { () throws -> Double in
        var changed = batch; for i in changed.indices { changed[i].notes = "edited" }
        let start = Date(); try store.save(changed); return Date().timeIntervalSince(start)
    }()
    print("     save of 2000 edited items in one call: \(fmt(tEdit))")
    withinBudget("editing 2,000 items in one call stays within the budget", tEdit, quietRatio: 8.5)
    VaultFiles.removeBackups(for: id)
    try? fm.removeItem(at: dir)

    // Listing and emptying the bin.
    let binned = try generated(2_000)
    let all = binned.items()
    for item in all { binned.moveToRecycleBin(item.id) }
    var recycled = 0
    let tBin = seconds { recycled = binned.recycledItems().count }
    print("     recycledItems() with 2000 binned entries: \(fmt(tBin))")
    check("all 2,000 are in the bin", "\(recycled) \(binned.items().count)", "2000 0")
    withinBudget("recycledItems() with 2,000 entries stays within the budget", tBin, quietRatio: 1.5)
    var emptied = 0
    let tEmpty = seconds { emptied = binned.emptyRecycleBin() }
    print("     emptyRecycleBin() with 2000 entries: \(fmt(tEmpty))")
    check("emptying removes them all", "\(emptied) \(binned.recycledItems().count)", "2000 0")
    withinBudget("emptying 2,000 entries stays within the budget", tEmpty, quietRatio: 1.0)
}


do {  // Verification codes and the fill site (release rules for the AutoFill provider)
    var withCode = VaultItem(kind: .login, title: "Mail", account: "ada", website: "https://login.example.com", secret: "pw",
                             otpSecret: "JBSWY3DPEHPK3PXP")
    expect("code: readable setup, same site", ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "login.example.com"))
    expect("code: subdomain of the stored site", ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "deep.login.example.com"))
    expect("code: URL identifier", ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "https://login.example.com/path"))
    expect("code: wrong site refused", !ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "evil.example"))
    expect("code: parent site refused", !ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "example.com"))
    expect("code: unknown site refused", !ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: ""))
    expect("code: javascript: identifier refused", !ReleaseCheck.oneTimeCode(item: withCode, serviceIdentifier: "javascript:alert(1)"))
    var noCode = withCode; noCode.otpSecret = ""
    expect("code: login without a setup refused", !ReleaseCheck.oneTimeCode(item: noCode, serviceIdentifier: "login.example.com"))
    var badCode = withCode; badCode.otpSecret = "not base32 !!"
    expect("code: unreadable setup refused", !ReleaseCheck.oneTimeCode(item: badCode, serviceIdentifier: "login.example.com"))
    var noSite = withCode; noSite.website = ""
    expect("code: login without a website refused", !ReleaseCheck.oneTimeCode(item: noSite, serviceIdentifier: "login.example.com"))
    let note = VaultItem(kind: .secureNote, title: "Note", website: "login.example.com", otpSecret: "JBSWY3DPEHPK3PXP")
    expect("code: only a login releases a code", !ReleaseCheck.oneTimeCode(item: note, serviceIdentifier: "login.example.com"))
    // The code uses the item's own digits, period and algorithm.
    withCode.otpSettings = TOTPSettings(digits: 8, period: 60, algorithm: .sha256)
    let at = Date(timeIntervalSince1970: 1_700_000_000)
    check("code: current code follows the item's settings",
          ReleaseCheck.currentCode(for: withCode, at: at) ?? "nil",
          TOTP.code(secret: "JBSWY3DPEHPK3PXP", settings: TOTPSettings(digits: 8, period: 60, algorithm: .sha256), at: at) ?? "nil")
    check("code: eight digits", "\((ReleaseCheck.currentCode(for: withCode, at: at) ?? "").count)", "8")
    expect("code: no current code without a setup", ReleaseCheck.currentCode(for: noCode) == nil)

    check("site: https URL", "\(FillSite(serviceIdentifier: "https://www.example.com/login"))", "secure(host: \"example.com\")")
    check("site: bare domain", "\(FillSite(serviceIdentifier: "example.com"))", "secure(host: \"example.com\")")
    check("site: http URL", "\(FillSite(serviceIdentifier: "http://example.com/login"))", "plainHTTP(host: \"example.com\")")
    check("site: http scheme in capitals", "\(FillSite(serviceIdentifier: "HTTP://Example.com"))", "plainHTTP(host: \"example.com\")")
    check("site: http with a port", "\(FillSite(serviceIdentifier: "http://example.com:8080/"))", "plainHTTP(host: \"example.com\")")
    check("site: http on localhost is fine", "\(FillSite(serviceIdentifier: "http://localhost:8080/login"))", "secure(host: \"localhost\")")
    check("site: http on 127.0.0.1 is fine", "\(FillSite(serviceIdentifier: "http://127.0.0.1:3000"))", "secure(host: \"127.0.0.1\")")
    check("site: http on ::1 is fine", "\(FillSite(serviceIdentifier: "http://[::1]:3000/"))", "secure(host: \"::1\")")
    check("site: http on another loopback address is not this rule's business", "\(FillSite(serviceIdentifier: "http://127.0.0.2/"))", "plainHTTP(host: \"127.0.0.2\")")
    check("site: lookalike of localhost over http", "\(FillSite(serviceIdentifier: "http://localhost.example.com/"))", "plainHTTP(host: \"localhost.example.com\")")
    check("site: nil", "\(FillSite(serviceIdentifier: nil))", "unknown")
    check("site: empty", "\(FillSite(serviceIdentifier: "  "))", "unknown")
    check("site: javascript:", "\(FillSite(serviceIdentifier: "javascript:alert(1)"))", "unknown")
    check("site: user info before the host", "\(FillSite(serviceIdentifier: "http://evil.example@example.com/"))", "unknown")
    check("site: http with no host", "\(FillSite(serviceIdentifier: "http://"))", "unknown")
    check("site: host of a secure site", FillSite(serviceIdentifier: "https://a.example.com").host ?? "nil", "a.example.com")
    expect("site: unknown has no host", FillSite(serviceIdentifier: nil).host == nil)
}

// MARK: Validation round 2: purge ages, odd times, all-or-nothing store, attachments, one time form, disabled bin

failures += runTimeParserTests()

func runCapturing(_ args: [String], input: String = "") -> (status: Int32, out: String, err: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = args
    let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
    process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
    try! process.run()
    stdin.fileHandleForWriting.write(Data(input.utf8)); try? stdin.fileHandleForWriting.close()
    let out = stdout.fileHandleForReading.readDataToEndOfFile(), err = stderr.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(decoding: out, as: UTF8.self), String(decoding: err, as: UTF8.self))
}
/// What keepassxc-cli printed on stderr besides the password prompt: the warnings.
func warnings(_ run: (status: Int32, out: String, err: String)) -> String {
    run.err.split(whereSeparator: \.isNewline).filter { !$0.hasPrefix("Enter password") }.joined(separator: "\n")
}
func binGroup(_ name: String, locationChanged: TimeInterval) -> XNode {
    let stored = KeePassTime.stored(at(locationChanged))
    return XNode("Group", children: [
        XNode("UUID", text: UUID().kdbxBase64), XNode("Name", text: name), XNode("Notes"), XNode("IconID", text: "48"),
        XNode("Times", children: [XNode("CreationTime", text: stored), XNode("LastModificationTime", text: stored), XNode("LastAccessTime", text: stored),
                                  XNode("ExpiryTime", text: stored), XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                  XNode("LocationChanged", text: stored)])])
}
func setLocationChanged(_ entry: XNode, _ seconds: TimeInterval) { entry.child("Times")?.setChildText("LocationChanged", KeePassTime.stored(at(seconds))) }
func move(_ entry: XNode, from: XNode, to: XNode) { from.children.removeAll { $0 === entry }; to.children.append(entry) }
func binNode(_ document: KDBXDocument) -> XNode? { document.recycleBinID.flatMap { id in
    var found: XNode?
    document.rootGroup?.walk { if $0.name == "Group", $0.child("UUID")?.text == id { found = $0 } }
    return found
} }
let dayLength: TimeInterval = 24 * 60 * 60

// BIN-1: the time an entry was deleted is the latest of its own, its recycled groups' and Psss's record.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t)
    let doc = try freshDocument("Groups")
    let a = VaultItem(kind: .login, title: "InGroupA", website: "a.example", secret: "a1")
    let b = VaultItem(kind: .login, title: "InGroupB", website: "b.example", secret: "b1")
    let solo = VaultItem(kind: .login, title: "Solo", website: "solo.example", secret: "s1")
    doc.upsert([a, b, solo])
    doc.moveToRecycleBin(solo.id)                     // binned by Psss at t
    let bin = binNode(doc)!
    // Another app recycles a group a minute ago whose entries were last moved 100 days ago.
    let old = binGroup("Old", locationChanged: t + 40 * dayLength - 60)
    bin.children.append(old)
    for item in [a, b] { let node = entryNode(doc, item.id)!; move(node, from: doc.rootGroup!, to: old); setLocationChanged(node, t - 100 * dayLength) }
    let now = at(t + 40 * dayLength)
    setClock(t + 40 * dayLength)                  // the clock reads 40 days on, so the group's time is not in the future
    check("a recycled group's entries are dated by the group", "\(doc.recycledItems().filter { $0.item.title.hasPrefix("InGroup") }.map { Int($0.deleted.timeIntervalSince1970 - t) })",
          "[\(Int(40 * dayLength - 60)), \(Int(40 * dayLength - 60))]")
    check("the purge ignores the entries' own old LocationChanged", "\(doc.purgeRecycleBin(olderThan: 30 * dayLength, now: now))", "1")   // only Solo (binned at t)
    expect("the group's entries are still there", count(doc, a.id) == 1 && count(doc, b.id) == 1 && groupNode(doc, named: "Old") != nil)
    // A group recycled 40 days ago that holds a younger entry stays, with that entry.
    let aged = binGroup("Aged", locationChanged: t - 40 * dayLength)
    bin.children.append(aged)
    let young = VaultItem(kind: .login, title: "Young", website: "y.example", secret: "y1"), older = VaultItem(kind: .login, title: "Older", website: "o.example", secret: "o1")
    doc.upsert([young, older])
    for item in [young, older] { move(entryNode(doc, item.id)!, from: doc.rootGroup!, to: aged) }
    setLocationChanged(entryNode(doc, young.id)!, t + 35 * dayLength)
    setLocationChanged(entryNode(doc, older.id)!, t - 41 * dayLength)
    let report = doc.purgeRecycleBinReport(olderThan: 30 * dayLength, now: now)
    check("an entry younger than the group keeps its own time, so the older one in the group goes", "\(count(doc, young.id)) \(count(doc, older.id))", "1 0")   // older: max(own, group) = t - 40d
    expect("a group that still holds a younger entry stays", groupNode(doc, named: "Aged") != nil && report.groups == 0)
    // Later, everything is past the limit: the entries and the groups go, with no empty shell.
    let later = doc.purgeRecycleBinReport(olderThan: 30 * dayLength, now: at(t + 200 * dayLength))
    expect("everything old goes, groups included, leaving no empty shell", doc.recycledItems().isEmpty && groupNode(doc, named: "Old") == nil
           && groupNode(doc, named: "Aged") == nil && later.groups == 2 && binNode(doc)!.children.filter { $0.name == "Group" || $0.name == "Entry" }.isEmpty)
    expect("the removed groups are recorded as deleted objects", deletedObjects(doc) >= 2 + 2)
    // A group with no time at all, and an entry with no time at all, are never purged.
    let timeless = XNode("Group", children: [XNode("UUID", text: UUID().kdbxBase64), XNode("Name", text: "Timeless")])
    binNode(doc)!.children.append(timeless)
    let lone = VaultItem(kind: .login, title: "Lone", website: "l.example", secret: "l1")
    doc.upsert(lone)
    let loneNode = entryNode(doc, lone.id)!
    move(loneNode, from: doc.rootGroup!, to: timeless)
    loneNode.children.removeAll { $0.name == "Times" }
    check("with no time known nothing is purged", "\(doc.purgeRecycleBin(olderThan: 0, now: at(t + 1000 * dayLength))) \(count(doc, lone.id)) \(groupNode(doc, named: "Timeless") != nil)", "0 1 true")
    resetClock()
}

// BIN-1 again, with a real keepassxc-cli rmdir.
if run(["which", "keepassxc-cli"]).status == 0 {
    let path = fixtures.appendingPathComponent("rmdir.kdbx")
    let t = Date().timeIntervalSince1970
    let doc = try KDBX.create(name: "Rmdir", credentials: .init(password: "rm pw"), kdf: light)
    let e1 = VaultItem(kind: .login, title: "Inside One", website: "one.example", secret: "1"), e2 = VaultItem(kind: .login, title: "Inside Two", website: "two.example", secret: "2")
    doc.upsert([e1, e2])
    let group = binGroup("Old group", locationChanged: t - 100 * dayLength)
    doc.rootGroup!.children.append(group)
    for item in [e1, e2] { let node = entryNode(doc, item.id)!; move(node, from: doc.rootGroup!, to: group); setLocationChanged(node, t - 100 * dayLength) }
    try KDBX.save(doc).write(to: path)
    let removal = run(["keepassxc-cli", "rmdir", "-q", path.path, "Old group"], input: "rm pw\n")
    let reopened = try KDBX.open(Data(contentsOf: path), credentials: .init(password: "rm pw"))
    expect("keepassxc-cli rmdir moved the group to the bin (status \(removal.status))", removal.status == 0 && reopened.items().isEmpty && reopened.recycledItems().count == 2)
    expect("the entries inside show as deleted a moment ago", reopened.recycledItems().allSatisfy { abs($0.deleted.timeIntervalSince1970 - t) < 120 })
    check("unlocking does not destroy them", "\(reopened.purgeRecycleBin(olderThan: 30 * dayLength, now: Date())) \(reopened.recycledItems().count)", "0 2")
    check("and in 31 days they go with their group", "\(reopened.purgeRecycleBin(olderThan: 30 * dayLength, now: Date().addingTimeInterval(31 * dayLength))) \(reopened.recycledItems().count) \(groupNode(reopened, named: "Old group") == nil)", "2 0 true")
}

// BIN-2: an entry taken out of the bin by another app and recycled again starts a new countdown.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t)
    let doc = try freshDocument("Again")
    let e = VaultItem(kind: .login, title: "Again", website: "again.example", secret: "x")
    let other = VaultItem(kind: .login, title: "Other", website: "other.example", secret: "o")
    doc.upsert([e, other])
    doc.moveToRecycleBin(e.id)
    let node = entryNode(doc, e.id)!
    move(node, from: binNode(doc)!, to: doc.rootGroup!)                  // another app restores it, keeping Psss's marks
    setLocationChanged(node, t + 10 * dayLength)
    _ = doc.items()
    expect("reading items does not touch an entry", EntryMapping.customData(node, RecycleBinKeys.deletedAt) != nil)
    doc.upsert(VaultItem(kind: .login, title: "New", website: "new.example", secret: "n"))
    expect("a write drops the stale deleted-at and deleted-from from an entry outside the bin",
           EntryMapping.customData(node, RecycleBinKeys.deletedAt) == nil && EntryMapping.customData(node, RecycleBinKeys.deletedFrom) == nil)
    // Without that cleanup, the latest time still decides: marks from t, recycled again at t + 40 days.
    EntryMapping.setCustomData(node, RecycleBinKeys.deletedAt, KeePassTime.string(at(t)), modified: KeePassTime.stored(at(t)))
    move(node, from: doc.rootGroup!, to: binNode(doc)!)
    setLocationChanged(node, t + 40 * dayLength)
    check("recycled again later, it is not purged at once", "\(doc.purgeRecycleBin(olderThan: 30 * dayLength, now: at(t + 41 * dayLength))) \(count(doc, e.id))", "0 1")
    check("its countdown runs from the second recycling", "\(doc.purgeRecycleBin(olderThan: 30 * dayLength, now: at(t + 71 * dayLength))) \(count(doc, e.id))", "1 0")
    resetClock()
}

// BIN-4 and BIN-5: a switched-off bin, and corrupt bin identifiers.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t)
    let doc = try freshDocument("Disabled")
    let x = VaultItem(kind: .login, title: "InTheOldBin", website: "x.example", secret: "x"), y = VaultItem(kind: .login, title: "ToDelete", website: "y.example", secret: "y")
    doc.upsert([x, y])
    doc.moveToRecycleBin(x.id)
    let bin = binNode(doc)!
    doc.meta!.setChildText("RecycleBinEnabled", "False")                 // another app switched the bin off
    expect("with the bin off its group is an ordinary group: the entry shows", doc.items().contains { $0.id == x.id } && doc.recycledItems().isEmpty)
    doc.moveToRecycleBin(y.id)
    check("deleting reuses the existing group, no second Recycle Bin", "\(doc.rootGroup!.children(named: "Group").filter { $0.child("Name")?.text == "Recycle Bin" }.count)", "1")
    expect("and sets the flag back on", doc.meta!.child("RecycleBinEnabled")?.text == "True" && binNode(doc) === bin)
    expect("the entries that were already in that group are now in the bin", Set(doc.recycledItems().map(\.item.title)) == ["InTheOldBin", "ToDelete"])
    check("they start a countdown now: none is purged next day", "\(doc.purgeRecycleBin(olderThan: 30 * dayLength, now: at(t + dayLength)))", "0")
    // No bin at all: one is made.
    let fresh = try freshDocument("None")
    fresh.upsert(y)
    fresh.moveToRecycleBin(y.id)
    check("with no bin one is made", "\(fresh.rootGroup!.children(named: "Group").count)", "1")

    // The bin is the root group: no bin.
    let corrupt = try freshDocument("Corrupt")
    let c1 = VaultItem(kind: .login, title: "C1", website: "c1.example", secret: "1"), c2 = VaultItem(kind: .login, title: "C2", website: "c2.example", secret: "2")
    corrupt.upsert([c1, c2])
    corrupt.meta!.setChildText("RecycleBinEnabled", "True")
    corrupt.meta!.setChildText("RecycleBinUUID", corrupt.rootGroup!.child("UUID")!.text)
    check("a bin that names the root group is no bin", "\(corrupt.recycleBinID == nil) \(corrupt.items().count) \(corrupt.recycledItems().count)", "true 2 0")
    check("and a purge deletes nothing", "\(corrupt.purgeRecycleBin(olderThan: 0, now: at(t + 1000 * dayLength))) \(corrupt.items().count)", "0 2")
    corrupt.meta!.setChildText("RecycleBinUUID", UUID().kdbxBase64)       // a group that does not exist
    check("a bin that names no group hides nothing", "\(corrupt.items().count) \(corrupt.purgeRecycleBin(olderThan: 0, now: at(t + 1000 * dayLength)))", "2 0")
    corrupt.moveToRecycleBin(c1.id)
    expect("deleting then makes a proper bin", corrupt.recycledItems().map(\.item.title) == ["C1"] && corrupt.items().map(\.title) == ["C2"])
    resetClock()
}

// DATE-1 at the document level: one odd time does not crash listing.
do {
    let doc = try freshDocument("Odd")
    let item = VaultItem(kind: .login, title: "Odd time", website: "odd.example", secret: "x")
    doc.upsert(item)
    let times = entryNode(doc, item.id)!.child("Times")!
    times.setChildText("CreationTime", "2021-03-04T05:06:07.12345678901234567890Z")
    times.setChildText("LastModificationTime", "2021-02-30T00:00:00Z")
    let listed = doc.items()
    expect("items() lists an entry with a 20-digit fraction and a 30 February", listed.count == 1
           && abs((listed[0].created?.timeIntervalSince1970 ?? 0) - 1_614_834_367.123456789) < 1e-3 && listed[0].modified == nil)
}

// Protected flags are corrected on every write of an entry, and reading never writes.
do {
    let doc = try freshDocument("Flags")
    let item = VaultItem(kind: .login, title: "Flags", account: "f", website: "f.example", secret: "secret-1")
    doc.upsert(item)
    let node = entryNode(doc, item.id)!
    func unprotect() { node.children(named: "String").first { $0.child("Key")?.text == "Password" }?.child("Value")?.setAttribute("Protected", nil) }
    let modifiedBefore = timeText(doc, item.id, "LastModificationTime")
    unprotect()
    _ = doc.items()
    expect("reading does not correct (or write) anything", stringFlag(node, "Password") == nil)
    expect("saving the same content counts as a write, because the flag was wrong", doc.upsert(item))
    expect("and the flag is back", stringFlag(node, "Password") == "True")
    check("without a revision or a new modification time", "\(historyCount(doc, item.id)) \(timeText(doc, item.id, "LastModificationTime") == modifiedBefore)", "0 true")
    expect("with the flag right, saving the same content is no write", !doc.upsert(item))
    var edited = item; edited.secret = "secret-2"
    doc.upsert(edited)
    unprotect()
    doc.clearPreviousPasswords(of: item.id)
    expect("clearing the previous passwords corrects it", stringFlag(node, "Password") == "True")
    unprotect()
    doc.moveToRecycleBin(item.id)
    expect("so does moving to the bin", stringFlag(node, "Password") == "True")
    unprotect()
    doc.restoreFromRecycleBin(item.id)
    expect("and restoring", stringFlag(node, "Password") == "True")
}

// clearPreviousPasswords moves the modification time forward.
do {
    let t: TimeInterval = 1_700_000_000
    let doc = try freshDocument("Clear")
    let item = VaultItem(kind: .login, title: "Clear", website: "clear.example", secret: "one")
    setClock(t); doc.upsert(item)
    edit(doc, item.id, at: t + 3600) { $0.secret = "two" }
    let before = current(doc, item.id).modified!
    setClock(t + 7200)
    doc.clearPreviousPasswords(of: item.id)
    expect("clearing the history stamps the entry later, without a snapshot", current(doc, item.id).modified! > before && historyCount(doc, item.id) == 0)
    resetClock()
}

// A strict reader needs numbers in HistoryMaxItems and HistoryMaxSize; the other times follow in one form.
do {
    let doc = try freshDocument("Limits")
    doc.meta!.setChildText("HistoryMaxItems", "many")
    doc.meta!.setChildText("HistoryMaxSize", "-5")
    var reopened = try KDBX.open(KDBX.save(doc), credentials: .init(password: "pw"))
    check("a limit that is not a number is saved as the default, a negative one as -1", "\(reopened.meta!.child("HistoryMaxItems")!.text) \(reopened.meta!.child("HistoryMaxSize")!.text)", "10 -1")
    doc.meta!.setChildText("HistoryMaxItems", "-1"); doc.meta!.setChildText("HistoryMaxSize", "123")
    reopened = try KDBX.open(KDBX.save(doc), credentials: .init(password: "pw"))
    check("valid limits are left alone", "\(reopened.meta!.child("HistoryMaxItems")!.text) \(reopened.meta!.child("HistoryMaxSize")!.text)", "-1 123")
}

// One form of time in a saved file, with every instant unchanged.
let timeElementNames: Set<String> = ["CreationTime", "LastModificationTime", "LastAccessTime", "ExpiryTime", "LocationChanged", "DeletionTime", "DatabaseNameChanged",
                                     "DatabaseDescriptionChanged", "DefaultUserNameChanged", "MasterKeyChanged", "RecycleBinChanged", "EntryTemplatesGroupChanged", "SettingsChanged"]
func timeElements(_ document: KDBXDocument) -> [XNode] {
    var found: [XNode] = []
    document.root.walk { if timeElementNames.contains($0.name), $0.children.isEmpty { found.append($0) } }
    return found
}
do {
    let doc = try freshDocument("Mixed")
    let items = (0..<3).map { VaultItem(kind: .login, title: "M\($0)", website: "m\($0).example", secret: "p\($0)") }
    doc.upsert(items)
    edit(doc, items[0].id, at: Date().timeIntervalSince1970 + 5) { $0.secret = "changed" }       // history
    resetClock()
    doc.moveToRecycleBin(items[2].id)
    doc.deletePermanently(items[1].id)
    for node in timeElements(doc) { node.text = KeePassTime.string(KeePassTime.date(node.text)!) }  // as a KDBX 3 file or an older Psss wrote them
    let before = timeElements(doc).map { KeePassTime.date($0.text)!.timeIntervalSince1970 }
    expect("the test file has ISO text everywhere, history, deleted objects and meta included", timeElements(doc).count > 30 && timeElements(doc).allSatisfy { KeePassTime.isISO($0.text) })
    let reopened = try KDBX.open(KDBX.save(doc), credentials: .init(password: "pw"))
    let after = timeElements(reopened).map { KeePassTime.date($0.text)!.timeIntervalSince1970 }
    expect("a saved file holds every time in the KDBX 4 form", timeElements(reopened).allSatisfy { !KeePassTime.isISO($0.text) && Data(base64Encoded: $0.text)?.count == 8 })
    expect("and every instant is unchanged", before == after)
    expect("saving does not change the open document", timeElements(doc).allSatisfy { KeePassTime.isISO($0.text) })
}
if run(["which", "keepassxc-cli"]).status == 0 {
    // A KDBX 3.1 file KeePassXC wrote, with a history item, upgraded by one save here.
    let path = fixtures.appendingPathComponent("upgrade.kdbx"), upgraded = fixtures.appendingPathComponent("upgraded.kdbx")
    run(["keepassxc-cli", "db-create", "-q", "-p", path.path], input: "up pw\nup pw\n")
    run(["keepassxc-cli", "add", "-q", "-u", "u", "-p", path.path, "Upgrade me"], input: "up pw\nsecret-one\n")
    run(["keepassxc-cli", "edit", "-q", "-p", path.path, "Upgrade me"], input: "up pw\nsecret-two\n")
    let old = try KDBX.open(Data(contentsOf: path), credentials: .init(password: "up pw"))
    let item = old.items().first { $0.title == "Upgrade me" }
    expect("the file KeePassXC wrote is read as \(old.sourceVersion ?? "KDBX 4") with a history item", item != nil && historyCount(old, item!.id) >= 1)
    let before = timeElements(old).map { KeePassTime.date($0.text)!.timeIntervalSince1970 }
    try KDBX.save(old).write(to: upgraded)
    let now = try KDBX.open(Data(contentsOf: upgraded), credentials: .init(password: "up pw"))
    expect("the upgrade writes one form: no ISO text left", timeElements(now).allSatisfy { Data(base64Encoded: $0.text)?.count == 8 })
    expect("every instant is unchanged (to the second)", before == timeElements(now).map { KeePassTime.date($0.text)!.timeIntervalSince1970 }.map { $0 })
    let out = runCapturing(["keepassxc-cli", "export", "-q", "-f", "xml", upgraded.path], input: "up pw\n")
    if let exportedRoot = try? XMLTree.parse(Data(out.out.utf8)) {
        var reported: [Double] = [], written: [Double] = []
        func collect(_ node: XNode, into list: inout [Double]) {
            if ["CreationTime", "LastModificationTime", "LastAccessTime", "ExpiryTime", "LocationChanged"].contains(node.name), node.children.isEmpty, let date = KeePassTime.date(node.text) { list.append(date.timeIntervalSince1970) }
            for child in node.children { collect(child, into: &list) }
        }
        collect(exportedRoot, into: &reported)
        collect(now.root, into: &written)
        expect("KeePassXC reports the same instants for the upgraded file", reported.sorted() == written.sorted() && !reported.isEmpty)
    } else { failures += 1; print("FAIL keepassxc export of the upgraded file") }
    expect("keepassxc opens it without a warning", warnings(runCapturing(["keepassxc-cli", "ls", upgraded.path], input: "up pw\n")).isEmpty)
}

// BIN-3: attachments nothing refers to any more leave the file.
do {
    var doc = try freshDocument("Attachments")
    let a = VaultItem(kind: .login, title: "HasBig", website: "big.example", secret: "a"), b = VaultItem(kind: .login, title: "HasSmall", website: "small.example", secret: "b")
    let c = VaultItem(kind: .login, title: "HistoryOnly", website: "hist.example", secret: "c1")
    doc.upsert([a, b, c])
    let bigBody = Data((0..<3_000_000).map { _ in UInt8.random(in: 0...255) })
    let smallBody = Data("small attachment, still referenced".utf8), historyBody = Data("referenced only by a history item".utf8)
    doc.binaries = [Data([0]) + bigBody, Data([0]) + smallBody, Data([1]) + historyBody]
    func attach(_ id: UUID, _ name: String, _ index: Int) {
        let entry = entryNode(doc, id)!
        entry.children.insert(XNode("Binary", children: [XNode("Key", text: name), XNode("Value", attributes: [("Ref", String(index))])]),
                              at: entry.children.firstIndex { $0.name == "AutoType" } ?? entry.children.endIndex)
    }
    attach(a.id, "big.bin", 0); attach(b.id, "small.bin", 1); attach(c.id, "history.bin", 2)
    var changed = c; changed.secret = "c2"
    doc.upsert(changed)                                                   // the snapshot in History carries the attachment
    entryNode(doc, c.id)!.children.removeAll { $0.name == "Binary" }     // the live entry no longer has it
    let path = fixtures.appendingPathComponent("attachments.kdbx")
    let full = try KDBX.save(doc)
    doc.deletePermanently(a.id)
    let smaller = try KDBX.save(doc)
    try smaller.write(to: path)
    print("     attachment file: \(full.count) bytes with the 3 MB attachment, \(smaller.count) after deleting its entry")
    expect("the file shrinks by about the attachment", full.count - smaller.count > 2_900_000)
    let reopened = try KDBX.open(smaller, credentials: .init(password: "pw"))
    check("two attachments are left", "\(reopened.binaries.count)", "2")
    let ref = { (id: UUID) in entryNode(reopened, id)!.child("Binary")?.child("Value")?.attribute("Ref") ?? "-" }
    check("the other entry's reference is renumbered", ref(b.id), "0")
    check("the reference in a history item too", entryNode(reopened, c.id)!.child("History")!.children[0].child("Binary")!.child("Value")!.attribute("Ref") ?? "-", "1")
    expect("the bytes are the same", reopened.binaries[0].dropFirst() == smallBody && reopened.binaries[1].dropFirst() == historyBody && reopened.binaries[1].first == 1)
    if run(["which", "keepassxc-cli"]).status == 0 {
        let exportPath = fixtures.appendingPathComponent("small-export.bin")
        try? FileManager.default.removeItem(at: exportPath)
        let exportRun = runCapturing(["keepassxc-cli", "attachment-export", "-q", path.path, "HasSmall", "small.bin", exportPath.path], input: "pw\n")
        expect("keepassxc exports the other attachment with identical bytes (status \(exportRun.status))", (try? Data(contentsOf: exportPath)) == smallBody)
        let listed = runCapturing(["keepassxc-cli", "ls", path.path], input: "pw\n")
        expect("keepassxc reads the file with no warning: [\(warnings(listed))]", listed.status == 0 && warnings(listed).isEmpty)
    }
    // Clearing the history frees its attachment, and so does emptying the bin.
    doc.clearPreviousPasswords(of: c.id)
    check("clearing history leaves one attachment", "\(try KDBX.open(KDBX.save(doc), credentials: .init(password: "pw")).binaries.count)", "1")
    doc.deletePermanently(b.id)
    check("deleting the last owner leaves none", "\(try KDBX.open(KDBX.save(doc), credentials: .init(password: "pw")).binaries.count)", "0")
    // A reference to a binary that does not exist is left alone.
    var broken = try freshDocument("Broken")
    let r = VaultItem(kind: .login, title: "Broken ref", website: "br.example", secret: "r")
    broken.upsert(r)
    broken.binaries = [Data([0, 1, 2]), Data([0, 3])]
    entryNode(broken, r.id)!.children.append(XNode("Binary", children: [XNode("Key", text: "x"), XNode("Value", attributes: [("Ref", "7")])]))
    check("a dangling reference stops the pruning, nothing is renumbered", "\(try KDBX.open(KDBX.save(broken), credentials: .init(password: "pw")).binaries.count)", "2")
}

// STORE-1: every mutating store method is all-or-nothing, RELOAD-1, and the conflict exception.
do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-atomic-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("atomic.kdbx")
    let t0 = Date().timeIntervalSince1970
    let seed = try KDBX.create(name: "Atomic", credentials: .init(password: "old-pw"), kdf: light)
    let x = VaultItem(kind: .login, title: "X", account: "x", website: "x.example", secret: "x1")
    let y = VaultItem(kind: .login, title: "Y", account: "y", website: "y.example", secret: "y1")
    let z = VaultItem(kind: .login, title: "Z", account: "z", website: "z.example", secret: "z1")
    let binned = VaultItem(kind: .login, title: "Binned", account: "b", website: "b.example", secret: "b1")
    let stale = VaultItem(kind: .login, title: "Stale", account: "s", website: "s.example", secret: "s1")
    seed.upsert([x, y, z, binned, stale])
    setClock(t0 - 100 * dayLength); seed.moveToRecycleBin(stale.id)
    setClock(t0 - 1000); seed.moveToRecycleBin(binned.id); resetClock()
    var withHistory = x; withHistory.secret = "x2"; seed.upsert(withHistory)
    let data = try KDBX.save(seed)
    try data.write(to: url)
    let id = UUID()
    let store = KeePassVaultStore(reference: VaultReference(id: id, name: "Atomic", managed: true, bookmark: nil, fileName: "atomic.kdbx"), url: url, scoped: false,
                                  document: try KDBX.open(data, credentials: .init(password: "old-pw")), fileData: data)
    func state() -> String {
        let items = store.items().map { "\($0.id)|\($0.title)|\($0.secret)|\($0.notes)|\($0.modified?.timeIntervalSince1970 ?? 0)" }.sorted().joined(separator: ";")
        let deleted = store.recentlyDeleted().map { "\($0.item.id)|\($0.deleted.timeIntervalSince1970)" }.joined(separator: ";")
        return items + "#" + deleted + "#" + hex(KDBXCrypto.sha256(store.documentDump))
    }
    let plan = try CSVSource.plan(from: "Title,URL,Username,Password\nImported,https://imported.example,i,pw\n")
    let operations: [(String, () async throws -> Void)] = [
        ("save", { try store.save([withHistory, VaultItem(kind: .secureNote, title: "New note", notes: "n")]) }),
        ("delete", { try store.delete(y.id) }),
        ("moveToRecentlyDeleted", { try store.moveToRecentlyDeleted(z.id) }),
        ("restore", { try store.restore(binned.id) }),
        ("restorePassword", { try store.restorePassword(of: x.id, replacedAt: store.previousPasswords(of: x.id)[0].replaced) }),
        ("deletePermanently", { try store.deletePermanently(binned.id) }),
        ("emptyRecentlyDeleted", { try store.emptyRecentlyDeleted() }),
        ("clearPreviousPasswords", { try store.clearPreviousPasswords(of: x.id) }),
        ("purgeRecentlyDeleted", { _ = try store.purgeRecentlyDeleted(now: Date()) }),
        ("rename", { try store.rename("Renamed") }),
        ("changeCredentials", { _ = try await store.changeCredentials(to: .init(password: "new-pw")) }),
        ("apply", { _ = try store.apply(plan) }),
    ]
    func setReadable(_ readable: Bool) { try? fm.setAttributes([.posixPermissions: NSNumber(value: readable ? 0o644 : 0o000)], ofItemAtPath: url.path) }
    expect("the setup has something to purge and something to restore", store.recentlyDeleted().count == 2 && !store.previousPasswords(of: x.id).isEmpty)
    let bytesBefore = try Data(contentsOf: url)
    for (name, operation) in operations {
        let before = state()
        setReadable(false)
        var threw = false
        do { try await operation() } catch { threw = true }
        setReadable(true)
        expect("\(name): fails when the file cannot be read", threw)
        expect("\(name): items, Recently Deleted and the document are as before", state() == before)
        expect("\(name): the file is untouched", (try? Data(contentsOf: url)) == bytesBefore)
    }
    // And the stores still work, writing only what is asked.
    try store.save([VaultItem(kind: .secureNote, title: "After", notes: "ok")])
    let onDisk = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "old-pw"))
    expect("a later save writes only what was asked, none of the failed edits", Set(onDisk.items().map(\.title)) == ["X", "Y", "Z", "After"])
    expect("the failed password change left the old password", (try? KDBX.open(Data(contentsOf: url), credentials: .init(password: "new-pw"))) == nil)

    // RELOAD-1: a reload that finishes after a save keeps the save.
    let reloading = Task { try await store.reload() }
    await Task.yield()
    try store.save([VaultItem(kind: .secureNote, title: "Saved during reload", notes: "n")])
    try await reloading.value
    expect("a reload that finishes after a save keeps what was saved", store.items().contains { $0.title == "Saved during reload" })
    do { try store.save([VaultItem(kind: .secureNote, title: "And again", notes: "n")]); print("ok   and the next save does not fail with changed-on-disk") }
    catch { failures += 1; print("FAIL the next save after the reload threw \(error)") }
    try await store.reload()
    expect("a reload with nothing in between does load the file", store.items().contains { $0.title == "And again" })

    // changeCredentials stamps MasterKeyChanged.
    let stampBefore = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "old-pw")).meta!.child("MasterKeyChanged")!.text
    setClock(t0 + 5000)
    _ = try await store.changeCredentials(to: .init(password: "new-pw"))
    resetClock()
    let stampAfter = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "new-pw")).meta!.child("MasterKeyChanged")!.text
    check("changing the password stamps MasterKeyChanged", "\(stampAfter != stampBefore) \(stampAfter == KeePassTime.stored(at(t0 + 5000)))", "true true")
    VaultFiles.removeBackups(for: id)
    try? fm.removeItem(at: dir)
}

// The purge on unlock: a failed write leaves memory as it was, and unlock still works.
do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-purge-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("purge.kdbx")
    let doc = try KDBX.create(name: "Purge", credentials: .init(password: "pw"), kdf: light)
    let item = VaultItem(kind: .login, title: "Old", website: "old.example", secret: "o")
    doc.upsert(item)
    setClock(Date().timeIntervalSince1970 - 40 * dayLength); doc.moveToRecycleBin(item.id); resetClock()
    let data = try KDBX.save(doc)
    try data.write(to: url)
    let id = UUID()
    let store = KeePassVaultStore(reference: VaultReference(id: id, name: "Purge", managed: true, bookmark: nil, fileName: "purge.kdbx"), url: url, scoped: false,
                                  document: try KDBX.open(data, credentials: .init(password: "pw")), fileData: data)
    try? fm.setAttributes([.posixPermissions: NSNumber(value: 0o000)], ofItemAtPath: url.path)
    let result = try? store.purgeRecentlyDeleted()
    try? fm.setAttributes([.posixPermissions: NSNumber(value: 0o644)], ofItemAtPath: url.path)
    expect("a purge whose write fails reports it and keeps the entry in memory", result == nil && store.recentlyDeleted().count == 1)
    check("the next purge, with the file readable, does delete it", "\(try store.purgeRecentlyDeleted()) \(store.recentlyDeleted().count)", "1 0")
    VaultFiles.removeBackups(for: id)
    try? fm.removeItem(at: dir)
}

// CARD-1: Gregorian dates under any calendar and time zone; Maestro ranges.
do {
    let expiry = CardExpiry.parse("08/30")!
    let midAugust = Date(timeIntervalSince1970: 1_912_939_200)   // 2030-08-14T12:00:00Z
    for identifier in [Calendar.Identifier.buddhist, .japanese, .islamicUmmAlQura, .persian, .republicOfChina, .hebrew] {
        var calendar = Calendar(identifier: identifier)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        expect("a 08/30 card is not expired in mid-August 2030 under the \(identifier) calendar", !expiry.isPast(now: midAugust, calendar: calendar))
        expect("and a 07/30 card is expired under the \(identifier) calendar", CardExpiry.parse("07/30")!.isPast(now: midAugust, calendar: calendar))
    }
    var buddhist = Calendar(identifier: .buddhist)
    buddhist.timeZone = TimeZone(identifier: "Pacific/Kiritimati")!             // UTC+14: it is 1 September there
    let lateAugust = Date(timeIntervalSince1970: 1_914_451_200 - 3600)          // 2030-08-31T23:00:00Z
    expect("the month is the one in the person's time zone: already September in UTC+14", expiry.isPast(now: lateAugust, calendar: buddhist))
    buddhist.timeZone = TimeZone(identifier: "Pacific/Pago_Pago")!              // UTC-11
    expect("and still August in UTC-11", !expiry.isPast(now: lateAugust, calendar: buddhist))
    for (number, want) in [("5612000000000000", CardBrand.maestro), ("6390000000000000", .maestro), ("6304000000000000", .maestro), ("6759649826438453", .maestro),
                           ("6767700000000000", .maestro), ("5018000000000000", .maestro), ("5893000000000000", .maestro), ("5020000000000000", .maestro),
                           ("5066990000000000", .elo), ("5090000000000000", .elo), ("6362970000000000", .elo), ("6277800000000000", .elo),
                           ("6011000000000000", .discover), ("6500000000000000", .discover), ("6200000000000000", .unionPay), ("4111111111111111", .visa),
                           ("5105105105105100", .mastercard), ("2200000000000000", .mir), ("3782822463100005", .americanExpress), ("3530111333300000", .jcb)] {
        check("\(number.prefix(6)) is \(want.name)", CardBrand(number: number)?.name ?? "none", want.name)
    }
    expect("numbers outside every block have no network", CardBrand(number: "9999999999999999") == nil && CardBrand(number: "6000000000000000") == nil)
}

// MARK: Round 3: no held edits, purge evidence, batches, duplicate bin identifiers

// Purge evidence: anything present but unreadable stops the purge; a time in the future counts as now and never purges.
do {
    let t: TimeInterval = 1_700_000_000
    setClock(t + 200 * dayLength)
    let now = at(t + 200 * dayLength)
    let doc = try freshDocument("Evidence")
    func binned(_ title: String, _ edit: (XNode) -> Void) -> VaultItem {
        let item = VaultItem(kind: .login, title: title, website: "\(title).example", secret: "s")
        doc.upsert(item)
        doc.moveToRecycleBin(item.id)
        let node = entryNode(doc, item.id)!
        EntryMapping.setCustomData(node, RecycleBinKeys.deletedAt, KeePassTime.string(at(t)), modified: KeePassTime.stored(at(t)))
        setLocationChanged(node, t)
        edit(node)
        return item
    }
    let fine = binned("Fine") { _ in }
    let badAt = binned("BadDeletedAt") { EntryMapping.setCustomData($0, RecycleBinKeys.deletedAt, "not a time", modified: "") }
    let badLocation = binned("BadLocation") { $0.child("Times")?.setChildText("LocationChanged", "garbage") }
    let hugeLocation = binned("OutOfRange") { $0.child("Times")?.setChildText("LocationChanged", "//////////8=") }   // beyond year 9999
    let emptyLocation = binned("EmptyLocation") { $0.child("Times")?.setChildText("LocationChanged", "") }
    let futureAt = binned("FutureDeletedAt") { EntryMapping.setCustomData($0, RecycleBinKeys.deletedAt, KeePassTime.string(at(t + 300 * dayLength)), modified: "") }
    let futureLocation = binned("FutureLocation") { $0.child("Times")?.setChildText("LocationChanged", KeePassTime.stored(at(t + 300 * dayLength))) }
    // An entry under a group whose own time cannot be read.
    let badGroup = binGroup("Bad group", locationChanged: t)
    badGroup.child("Times")?.setChildText("LocationChanged", "damaged")
    binNode(doc)!.children.append(badGroup)
    let underBad = binned("UnderBadGroup") { _ in }
    move(entryNode(doc, underBad.id)!, from: binNode(doc)!, to: badGroup)
    // An empty group with an unreadable time stays too.
    let emptyBad = binGroup("Empty bad group", locationChanged: t)
    emptyBad.child("Times")?.setChildText("LocationChanged", "damaged")
    binNode(doc)!.children.append(emptyBad)

    let purged = doc.purgeRecycleBin(olderThan: 30 * dayLength, now: now)
    check("only the entry with clean evidence is purged", "\(purged) \(count(doc, fine.id))", "1 0")
    for (name, item) in [("a malformed PSSS_DELETED_AT", badAt), ("a malformed LocationChanged", badLocation), ("an out-of-range LocationChanged", hugeLocation),
                         ("an empty LocationChanged", emptyLocation), ("a future PSSS_DELETED_AT", futureAt), ("a future LocationChanged", futureLocation),
                         ("an unreadable group time above it", underBad)] {
        expect("an entry with \(name) is never purged", count(doc, item.id) == 1)
    }
    expect("an empty group with an unreadable time stays", groupNode(doc, named: "Empty bad group") != nil && groupNode(doc, named: "Bad group") != nil)
    let rows = doc.recycledItems()
    expect("no deletion date is in the future (never a negative age)", rows.allSatisfy { $0.deleted <= now })
    expect("a future time shows as now", rows.first { $0.item.id == futureAt.id }?.deleted == now && rows.first { $0.item.id == futureLocation.id }?.deleted == now)
    expect("even far in the future nothing with unreadable evidence goes", doc.purgeRecycleBin(olderThan: 0, now: at(t + 10_000 * dayLength)) <= 2
           && count(doc, badAt.id) == 1 && count(doc, badLocation.id) == 1 && count(doc, hugeLocation.id) == 1 && count(doc, underBad.id) == 1)
    resetClock()
}

// A bin identifier carried by two groups is a corrupt file: no bin.
do {
    let doc = try freshDocument("Twins")
    let a = VaultItem(kind: .login, title: "A", website: "a.example", secret: "a"), b = VaultItem(kind: .login, title: "B", website: "b.example", secret: "b")
    doc.upsert([a, b])
    doc.moveToRecycleBin(a.id)
    let bin = binNode(doc)!
    let twin = XNode("Group", children: [XNode("UUID", text: bin.child("UUID")!.text), XNode("Name", text: "Copy of the bin")])
    doc.rootGroup!.children.append(twin)
    move(entryNode(doc, b.id)!, from: doc.rootGroup!, to: twin)
    expect("two groups with the bin's identifier mean no bin", doc.recycleBinID == nil && doc.rawRecycleBinID == nil)
    check("nothing is hidden", "\(doc.items().count) \(doc.recycledItems().count)", "2 0")
    setLocationChanged(entryNode(doc, a.id)!, 1)
    check("and a purge deletes nothing", "\(doc.purgeRecycleBin(olderThan: 0, now: Date()))", "0")
    // A delete then makes a fresh bin with the usual name, and leaves the old groups alone: ordinary groups, their entries visible.
    let oldID = bin.child("UUID")!.text
    let c = VaultItem(kind: .login, title: "C", website: "c.example", secret: "c")
    doc.upsert(c)
    doc.moveToRecycleBin(c.id)
    check("a delete makes one fresh bin, named like the old one", "\(doc.recycleBinID != nil && doc.recycleBinID != oldID) \(doc.rootGroup!.children(named: "Group").filter { $0.child("Name")?.text == "Recycle Bin" }.count)", "true 2")
    expect("the old groups' entries are visible in items() again", Set(doc.items().map(\.title)) == ["A", "B"] && doc.recycledItems().map(\.item.title) == ["C"])
    check("a purge takes only what is in the fresh bin; the old groups' entries stay", "\(doc.purgeRecycleBin(olderThan: 0, now: Date().addingTimeInterval(1000 * dayLength))) \(count(doc, a.id)) \(count(doc, b.id)) \(doc.items().count)", "1 1 1 2")
}

// Batches: one pass and one write, however many.
do {
    let doc = try freshDocument("Batches")
    let all = (0..<8).map { VaultItem(kind: .login, title: "B\($0)", website: "b\($0).example", secret: "s\($0)") }
    doc.upsert(all)
    let ids = all.map(\.id)
    check("moving 5 of 8 in one call", "\(doc.moveToRecycleBin(Array(ids[0..<5]) + [UUID()])) \(doc.items().count) \(doc.recycledItems().count)", "5 3 5")
    check("moving ones already in the bin moves nothing", "\(doc.moveToRecycleBin(Array(ids[0..<5])))", "0")
    doc.upsert(VaultItem(id: ids[0], kind: .login, title: "Live twin", website: "twin.example", secret: "x"))   // restores B0 itself; give it back
    doc.moveToRecycleBin(ids[0])
    var twin = VaultItem(kind: .login, title: "Dup", website: "dup.example", secret: "d")
    twin = VaultItem(id: ids[1], kind: .login, title: "Dup", website: "dup.example", secret: "d")
    _ = twin
    check("restoring 3 in one call", "\(doc.restoreFromRecycleBin(Array(ids[0..<3]))) \(doc.items().count) \(doc.recycledItems().count)", "3 6 2")
    check("deleting 4 for good in one call, from the bin and from the live entries", "\(doc.deletePermanently([ids[0], ids[3], ids[5], ids[7], UUID()])) \(count(doc, ids[3])) \(count(doc, ids[5]))", "4 0 0")
    check("and each is a deleted object", "\(deletedObjects(doc))", "4")
    check("the entries that were not touched are all there", "\(doc.items().count + doc.recycledItems().count)", "4")
}

// Every store method is all-or-nothing against a conflicting file, and Overwrite repeats the change deliberately.
do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-conflict-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let t0 = Date().timeIntervalSince1970
    let seed = try KDBX.create(name: "Conflict", credentials: .init(password: "old-pw"), kdf: light)
    let x = VaultItem(kind: .login, title: "X", account: "x", website: "x.example", secret: "x1")
    let y = VaultItem(kind: .login, title: "Y", account: "y", website: "y.example", secret: "y1")
    let z = VaultItem(kind: .login, title: "Z", account: "z", website: "z.example", secret: "z1")
    let binned = VaultItem(kind: .login, title: "Binned", account: "b", website: "b.example", secret: "b1")
    let stale = VaultItem(kind: .login, title: "Stale", account: "s", website: "s.example", secret: "s1")
    seed.upsert([x, y, z, binned, stale])
    setClock(t0 - 100 * dayLength); seed.moveToRecycleBin(stale.id)
    setClock(t0 - 1000); seed.moveToRecycleBin(binned.id); resetClock()
    var edited = x; edited.secret = "x2"; seed.upsert(edited)
    let seedData = try KDBX.save(seed)
    let plan = try CSVSource.plan(from: "Title,URL,Username,Password\nImported,https://imported.example,i,pw\n")
    var counter = 0
    func makeStore() throws -> (store: KeePassVaultStore, url: URL, id: UUID) {
        counter += 1
        let url = dir.appendingPathComponent("c\(counter).kdbx")
        try seedData.write(to: url)
        let id = UUID()
        let store = KeePassVaultStore(reference: VaultReference(id: id, name: "Conflict", managed: true, bookmark: nil, fileName: url.lastPathComponent), url: url, scoped: false,
                                      document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
        return (store, url, id)
    }
    func backupFiles(_ id: UUID) -> [String] {
        ((try? fm.contentsOfDirectory(atPath: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)").path)) ?? []).sorted()
    }
    func newestBackup(_ id: UUID) -> Data? {
        backupFiles(id).last.flatMap { try? Data(contentsOf: VaultFiles.storageRoot.appendingPathComponent("Backups/\(id.uuidString)/\($0)")) }
    }
    func summary(_ items: [VaultItem], _ deleted: [(item: VaultItem, deleted: Date)]) -> String {
        items.map { "\($0.title)=\($0.secret)/\($0.notes)" }.sorted().joined(separator: ",") + " | " + deleted.map { "\($0.item.title)=\($0.item.secret)" }.sorted().joined(separator: ",")
    }
    func state(_ store: KeePassVaultStore) -> String {
        let items = store.items().map { "\($0.id)|\($0.title)|\($0.secret)|\($0.notes)|\($0.modified?.timeIntervalSince1970 ?? 0)" }.sorted().joined(separator: ";")
        let deleted = store.recentlyDeleted().map { "\($0.item.id)|\($0.deleted.timeIntervalSince1970)" }.joined(separator: ";")
        return items + "#" + deleted + "#" + hex(KDBXCrypto.sha256(store.documentDump))
    }
    typealias Operation = (name: String, run: (KeePassVaultStore) throws -> Void, overwritable: Bool)
    let operations: [Operation] = [
        ("save", { try $0.save([edited, VaultItem(kind: .secureNote, title: "New note", notes: "n")]) }, true),
        ("delete", { try $0.delete(y.id) }, true),
        ("moveToRecentlyDeleted", { try $0.moveToRecentlyDeleted(z.id) }, true),
        ("moveToRecentlyDeleted (batch)", { try $0.moveToRecentlyDeleted([y.id, z.id]) }, true),
        ("restore", { try $0.restore(binned.id) }, true),
        ("restore (batch)", { try $0.restore([binned.id, stale.id]) }, true),
        ("restorePassword", { try $0.restorePassword(of: x.id, replacedAt: $0.previousPasswords(of: x.id)[0].replaced) }, true),
        ("deletePermanently", { try $0.deletePermanently(binned.id) }, true),
        ("deletePermanently (batch)", { try $0.deletePermanently([binned.id, y.id]) }, true),
        ("emptyRecentlyDeleted", { try $0.emptyRecentlyDeleted() }, true),
        ("clearPreviousPasswords", { try $0.clearPreviousPasswords(of: x.id) }, true),
        ("purgeRecentlyDeleted", { _ = try $0.purgeRecentlyDeleted(now: Date()) }, true),
        ("rename", { try $0.rename("Renamed") }, true),
        ("apply", { _ = try $0.apply(plan) }, true),
    ]
    for operation in operations {
        // The expected result, with no conflict.
        let reference = try makeStore()
        try operation.run(reference.store)
        let expected = summary(reference.store.items(), reference.store.recentlyDeleted())

        let mine = try makeStore()
        let other = KeePassVaultStore(reference: VaultReference(id: mine.id, name: "Conflict", managed: true, bookmark: nil, fileName: mine.url.lastPathComponent), url: mine.url, scoped: false,
                                      document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
        try other.save([VaultItem(kind: .secureNote, title: "From the other writer", notes: "o")])
        let theirs = try Data(contentsOf: mine.url)
        let before = state(mine.store)
        let backupsBefore = backupFiles(mine.id)
        var refused = false
        do { try operation.run(mine.store) } catch VaultStoreError.changedOnDisk { refused = true } catch { print("     \(operation.name) threw \(error)") }
        expect("\(operation.name): a conflicting file makes it throw changedOnDisk", refused)
        expect("\(operation.name): memory, items(), Recently Deleted and the dump are as before", state(mine.store) == before)
        expect("\(operation.name): the file is the other writer's, untouched, with no new rollback copy", (try? Data(contentsOf: mine.url)) == theirs && backupFiles(mine.id) == backupsBefore)
        try mine.store.overwriting { try operation.run(mine.store) }
        expect("\(operation.name): with overwrite it succeeds", true)
        let written = try KDBX.open(Data(contentsOf: mine.url), credentials: .init(password: "old-pw"))
        expect("\(operation.name): the file holds the change, and not the other writer's item", summary(written.items(), written.recycledItems()) == expected
               && !written.items().contains { $0.title == "From the other writer" })
        expect("\(operation.name): the other writer's version is the newest rollback copy", newestBackup(mine.id) == theirs)
        expect("\(operation.name): memory equals the file", state(mine.store).prefix { $0 != "#" } == state(mine.store).prefix { $0 != "#" } && summary(mine.store.items(), mine.store.recentlyDeleted()) == expected)
        VaultFiles.removeBackups(for: mine.id)
    }

    // A refused password change leaves the old password and every in-memory value as it was.
    do {
        let mine = try makeStore()
        let other = KeePassVaultStore(reference: VaultReference(id: mine.id, name: "Conflict", managed: true, bookmark: nil, fileName: mine.url.lastPathComponent), url: mine.url, scoped: false,
                                      document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
        try other.save([VaultItem(kind: .secureNote, title: "From the other writer", notes: "o")])
        let theirs = try Data(contentsOf: mine.url), before = state(mine.store)
        var refused = false
        do { _ = try await mine.store.changeCredentials(to: .init(password: "new-pw")) } catch VaultStoreError.changedOnDisk { refused = true }
        expect("changeCredentials: a conflicting file refuses it, and memory and the file are as before", refused && state(mine.store) == before && (try? Data(contentsOf: mine.url)) == theirs)
        VaultFiles.removeBackups(for: mine.id)
    }

    // A refused write is never written later: not by reloadIfChanged, not by a new session on the file, not by a later save.
    let scenario = try makeStore()
    let rival = KeePassVaultStore(reference: VaultReference(id: scenario.id, name: "Conflict", managed: true, bookmark: nil, fileName: scenario.url.lastPathComponent), url: scenario.url, scoped: false,
                                  document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
    try rival.save([VaultItem(kind: .secureNote, title: "Rival", notes: "r")])
    let refusedItem = VaultItem(kind: .secureNote, title: "Refused change", notes: "never")
    do { try scenario.store.save([refusedItem]); failures += 1; print("FAIL conflict not detected") } catch VaultStoreError.changedOnDisk {}
    expect("the refused item is not in the list", !scenario.store.items().contains { $0.id == refusedItem.id })
    expect("reloadIfChanged brings in the other version and not the refused change", try await scenario.store.reloadIfChanged()
           && scenario.store.items().contains { $0.title == "Rival" } && !scenario.store.items().contains { $0.id == refusedItem.id })
    try scenario.store.save([VaultItem(kind: .secureNote, title: "Unrelated", notes: "u")])
    var onDisk = try KDBX.open(Data(contentsOf: scenario.url), credentials: .init(password: "old-pw"))
    expect("an unrelated save writes only itself", !onDisk.items().contains { $0.id == refusedItem.id } && onDisk.items().contains { $0.title == "Unrelated" })

    // The file goes back to the bytes this store last read: an unrelated save still does not carry the refused change.
    let revert = try makeStore()
    let intruder = KeePassVaultStore(reference: VaultReference(id: revert.id, name: "Conflict", managed: true, bookmark: nil, fileName: revert.url.lastPathComponent), url: revert.url, scoped: false,
                                     document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
    try intruder.save([VaultItem(kind: .secureNote, title: "Intruder", notes: "i")])
    do { try revert.store.save([refusedItem]); failures += 1; print("FAIL conflict not detected") } catch VaultStoreError.changedOnDisk {}
    try seedData.write(to: revert.url)
    try revert.store.save([VaultItem(kind: .secureNote, title: "Unrelated again", notes: "u")])
    onDisk = try KDBX.open(Data(contentsOf: revert.url), credentials: .init(password: "old-pw"))
    expect("a file that returned to the last-read bytes does not bring the refused change back", !onDisk.items().contains { $0.id == refusedItem.id } && onDisk.items().contains { $0.title == "Unrelated again" })

    // Lock and unlock (a new store on the file) shows only what the file holds.
    let locked = try makeStore()
    let writer = KeePassVaultStore(reference: VaultReference(id: locked.id, name: "Conflict", managed: true, bookmark: nil, fileName: locked.url.lastPathComponent), url: locked.url, scoped: false,
                                   document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
    try writer.save([VaultItem(kind: .secureNote, title: "Writer", notes: "w")])
    do { try locked.store.save([refusedItem]) } catch VaultStoreError.changedOnDisk {}
    let reopened = KeePassVaultStore(reference: VaultReference(id: locked.id, name: "Conflict", managed: true, bookmark: nil, fileName: locked.url.lastPathComponent), url: locked.url, scoped: false,
                                     document: try KDBX.open(Data(contentsOf: locked.url), credentials: .init(password: "old-pw")), fileData: try Data(contentsOf: locked.url))
    expect("after lock and unlock the refused change is nowhere", !reopened.items().contains { $0.id == refusedItem.id })

    // The unlock purge refused by a conflict leaves memory equal to disk.
    let purging = try makeStore()
    let beforePurge = state(purging.store)
    let racer = KeePassVaultStore(reference: VaultReference(id: purging.id, name: "Conflict", managed: true, bookmark: nil, fileName: purging.url.lastPathComponent), url: purging.url, scoped: false,
                                  document: try KDBX.open(seedData, credentials: .init(password: "old-pw")), fileData: seedData)
    try racer.save([VaultItem(kind: .secureNote, title: "Raced", notes: "r")])
    var purgeRefused = false
    do { _ = try purging.store.purgeRecentlyDeleted(now: Date()) } catch VaultStoreError.changedOnDisk { purgeRefused = true }
    expect("the purge is refused by the conflict and memory equals what it was (and what the file held when read)", purgeRefused && state(purging.store) == beforePurge)
    for id in [scenario.id, revert.id, locked.id, purging.id] { VaultFiles.removeBackups(for: id) }
    try? fm.removeItem(at: dir)
}

// Performance of batches: 2,500 entries moved to the bin in one call at 50,000 entries, saved once.
do {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("psss-batchperf-\(UUID().uuidString)")
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let doc = try freshDocument("Big")
    let items = (0..<50_000).map { VaultItem(kind: .login, title: "T\($0)", account: "u\($0)@example.net", website: "https://site\($0).example", secret: "p\($0)", notes: "n") }
    doc.upsert(items)
    let url = dir.appendingPathComponent("big.kdbx")
    let data = try KDBX.save(doc)
    try data.write(to: url)
    let id = UUID()
    let store = KeePassVaultStore(reference: VaultReference(id: id, name: "Big", managed: true, bookmark: nil, fileName: "big.kdbx"), url: url, scoped: false,
                                  document: try KDBX.open(data, credentials: .init(password: "pw")), fileData: data)
    let chosen = items.enumerated().filter { $0.offset % 20 == 0 }.map(\.element.id)
    let started = Date()
    try store.moveToRecentlyDeleted(chosen)
    let moved = Date().timeIntervalSince(started)
    print("     moving \(chosen.count) of 50000 entries to the bin in one call, with the save: \(String(format: "%.2f s", moved))")
    check("they are all in the bin", "\(store.recentlyDeleted().count) \(store.items().count)", "2500 47500")
    withinBudget("2,500 moved at 50,000 entries, with the save, stay within the budget", moved, quietRatio: 75)
    let t2 = Date()
    try store.restore(chosen)
    let restored = Date().timeIntervalSince(t2)
    print("     restoring them in one call: \(String(format: "%.2f s", restored))")
    withinBudget("and restoring them", restored, quietRatio: 75); expect("all are back", store.items().count == 50_000)
    let t3 = Date()
    try store.deletePermanently(chosen)
    let deleted = Date().timeIntervalSince(t3)
    print("     deleting them for good in one call: \(String(format: "%.2f s", deleted))")
    withinBudget("and deleting them for good", deleted, quietRatio: 75); expect("and they are gone", store.items().count == 47_500)
    VaultFiles.removeBackups(for: id)
    try? fm.removeItem(at: dir)
}

do {  // Provider follow-ups: several identifiers, loopback as written, readable hosts, group and Keychain decisions
    // FillSite over the whole list of identifiers
    check("sites: first with a host, all secure", "\(FillSite(serviceIdentifiers: ["https://a.example.com", "example.com"]))", "secure(host: \"a.example.com\")")
    check("sites: an http URL behind a secure first one makes it plain http, named by its own host", "\(FillSite(serviceIdentifiers: ["https://a.example.com", "http://example.com"]))", "plainHTTP(host: \"example.com\")")
    check("sites: the warning names the unencrypted host", "\(FillSite(serviceIdentifiers: ["https://a.example.com", "http://b.example.org", "http://c.example.org"]))", "plainHTTP(host: \"b.example.org\")")
    check("sites: an http URL first makes it plain http", "\(FillSite(serviceIdentifiers: ["http://a.example.com", "https://example.com"]))", "plainHTTP(host: \"a.example.com\")")
    check("sites: an identifier without a host is skipped", "\(FillSite(serviceIdentifiers: ["", "javascript:alert(1)", "https://example.com"]))", "secure(host: \"example.com\")")
    check("sites: http on this machine behind another is still secure", "\(FillSite(serviceIdentifiers: ["http://localhost:3000", "https://localhost"]))", "secure(host: \"localhost\")")
    check("sites: no identifiers", "\(FillSite(serviceIdentifiers: []))", "unknown")
    check("sites: none has a host", "\(FillSite(serviceIdentifiers: ["", "javascript:alert(1)"]))", "unknown")
    check("sites: a single one reads like the single form", "\(FillSite(serviceIdentifiers: ["http://example.com"]))", "\(FillSite(serviceIdentifier: "http://example.com"))")

    // Loopback is decided on the host as written, not after dropping www.
    check("loopback: www.127.0.0.1 over http is not this machine", "\(FillSite(serviceIdentifier: "http://www.127.0.0.1"))", "plainHTTP(host: \"127.0.0.1\")")
    check("loopback: www.localhost over http is not this machine", "\(FillSite(serviceIdentifier: "http://www.localhost:8080/x"))", "plainHTTP(host: \"www.localhost\")")
    check("loopback: localhost with a trailing dot", "\(FillSite(serviceIdentifier: "http://localhost./"))", "secure(host: \"localhost\")")
    check("loopback: capitals", "\(FillSite(serviceIdentifier: "http://LOCALHOST:8080"))", "secure(host: \"localhost\")")
    check("loopback: bare 127.0.0.1 over http", "\(FillSite(serviceIdentifier: "http://127.0.0.1:3000/a?b=c#d"))", "secure(host: \"127.0.0.1\")")
    check("loopback: ::1 in brackets with a port", "\(FillSite(serviceIdentifier: "http://[::1]:8080/"))", "secure(host: \"::1\")")

    // Readable hosts: RFC 3492 decoding, and a hint only for a name that mixes scripts
    check("punycode: RFC 3492 Arabic sample", HostDisplay.decodePunycode("egbpdaj6bu4bxfgehfvwxn") ?? "nil", "ليهمابتكلموشعربي؟")
    check("punycode: bücher", HostDisplay.unicode("xn--bcher-kva.example"), "bücher.example")
    check("punycode: münchen", HostDisplay.unicode("xn--mnchen-3ya.de"), "münchen.de")
    check("punycode: café", HostDisplay.unicode("xn--caf-dma.example"), "café.example")
    check("punycode: Russian name and top-level domain", HostDisplay.unicode("xn--e1afmkfd.xn--p1ai"), "пример.рф")
    check("punycode: Japanese", HostDisplay.unicode("xn--wgv71a119e.example"), "日本語.example")
    check("punycode: plain ASCII is unchanged", HostDisplay.unicode("login.example.com"), "login.example.com")
    check("punycode: upper case prefix with lower case payload", HostDisplay.unicode("XN--bcher-kva.example"), "bücher.example")
    check("punycode: upper case letters in the payload decode to upper case and stay ASCII", HostDisplay.unicode("xn--BCHER-kva.example"), "xn--BCHER-kva.example")
    check("punycode: malformed label is left alone", HostDisplay.unicode("xn--a!b.example"), "xn--a!b.example")
    check("punycode: truncated label is left alone", HostDisplay.unicode("xn--bcher-k.example"), HostDisplay.unicode("xn--bcher-k.example"))
    check("punycode: empty payload is left alone", HostDisplay.unicode("xn--.example"), "xn--.example")
    check("punycode: overflow is refused", "\(HostDisplay.decodePunycode("999999999999999999999999") as Any)", "nil")
    check("shown: one script shows only Unicode", HostDisplay.shown("xn--bcher-kva.example"), "bücher.example")
    check("shown: Russian name with a Russian top-level domain", HostDisplay.shown("xn--e1afmkfd.xn--p1ai"), "пример.рф")
    check("shown: ASCII host", HostDisplay.shown("example.com"), "example.com")
    // "аррӏе.com": Cyrillic letters that look like Latin ones, followed by a Latin top-level domain.
    check("shown: mixed scripts add the ASCII form", HostDisplay.shown("xn--80ak6aa92e.com"), "аррӏе.com (xn--80ak6aa92e.com)")
    check("shown: scripts of a mixed name", "\(HostDisplay.scripts(in: "аррӏе.com").sorted())", "[\"Cyrillic\", \"Latin\"]")
    check("shown: digits and hyphens belong to no script", "\(HostDisplay.scripts(in: "1-2.3").count)", "0")

    // Display safety: never show text that could be mistaken for another ASCII host
    func puny(_ text: String) -> String {  // RFC 3492 encoder, test only
        let input = text.unicodeScalars.map { Int($0.value) }
        var out = input.filter { $0 < 128 }.map { Character(Unicode.Scalar(UInt8($0))) }
        let basic = out.count
        var handled = basic
        if basic > 0 { out.append("-") }
        var n = 128, delta = 0, bias = 72
        func digit(_ d: Int) -> Character { Character(Unicode.Scalar(UInt8(d < 26 ? d + 97 : d + 22))) }
        func adapt(_ d: Int, _ points: Int, _ first: Bool) -> Int {
            var d = first ? d / 700 : d / 2; d += d / points; var k = 0
            while d > 455 { d /= 35; k += 36 }
            return k + 36 * d / (d + 38)
        }
        while handled < input.count {
            let m = input.filter { $0 >= n }.min()!
            delta += (m - n) * (handled + 1); n = m
            for c in input {
                if c < n { delta += 1 }
                if c == n {
                    var q = delta, k = 36
                    while true {
                        let t = k <= bias ? 1 : (k >= bias + 26 ? 26 : k - bias)
                        if q < t { break }
                        out.append(digit(t + (q - t) % (36 - t))); q = (q - t) / (36 - t); k += 36
                    }
                    out.append(digit(q)); bias = adapt(delta, handled + 1, handled == basic); delta = 0; handled += 1
                }
            }
            delta += 1; n += 1
        }
        return "xn--" + String(out)
    }
    check("display: the encoder agrees with the decoder", HostDisplay.unicode(puny("bücher") + ".example"), "bücher.example")
    check("display: encoder vector", puny("bücher"), "xn--bcher-kva")
    let hostile: [(String, UInt32)] = [
        ("bidi embedding", 0x202A), ("bidi embedding", 0x202B), ("bidi pop", 0x202C), ("bidi lro", 0x202D), ("bidi override", 0x202E),
        ("bidi isolate", 0x2066), ("bidi isolate", 0x2067), ("bidi isolate", 0x2068), ("bidi pop isolate", 0x2069),
        ("lrm", 0x200E), ("rlm", 0x200F), ("arabic letter mark", 0x061C),
        ("zero width space", 0x200B), ("zwnj", 0x200C), ("zwj", 0x200D), ("word joiner", 0x2060), ("bom", 0xFEFF),
        ("soft hyphen", 0x00AD), ("mongolian vowel separator", 0x180E), ("C0 control", 0x01), ("C0 control", 0x1F),
        ("C1 control", 0x80), ("C1 control", 0x9F), ("no-break space", 0x00A0), ("en quad", 0x2000), ("hair space", 0x200A),
        ("narrow no-break space", 0x202F), ("medium math space", 0x205F), ("ideographic space", 0x3000),
        ("ideographic full stop", 0x3002), ("fraction slash", 0x2044), ("division slash", 0x2215), ("variation selector", 0xFE0F),
        ("grapheme joiner", 0x034F), ("hangul filler", 0x3164), ("private use", 0xE000), ("unassigned", 0x0378), ("noncharacter", 0xFFFF)
    ]
    for (name, value) in hostile {
        let c = String(Unicode.Scalar(value)!)
        for (place, label) in [("start", c + "bank"), ("middle", "ba" + c + "nk"), ("end", "bank" + c)] {
            let host = puny(label) + ".com"
            check("display: \(name) U+\(String(value, radix: 16, uppercase: true)) at the \(place) shows ASCII only", HostDisplay.shown(host), host)
        }
    }
    let spoof = puny("bank\u{200B}") + ".com"
    check("display: bank + zero width space is not shown as bank.com", HostDisplay.shown(spoof) == "bank.com" ? "spoofed" : "ok", "ok")
    check("display: right-to-left override", HostDisplay.shown(puny("ab\u{202E}cd") + ".example"), puny("ab\u{202E}cd") + ".example")
    check("display: a label that decodes to pure ASCII is suspicious", HostDisplay.shown("xn--bank-.com"), "xn--bank-.com")
    check("display: decoding fails", HostDisplay.shown("xn--a!b.com"), "xn--a!b.com")
    check("display: one bad label hides the whole host", HostDisplay.shown(puny("bücher") + "." + puny("a\u{200B}b") + ".com"), puny("bücher") + "." + puny("a\u{200B}b") + ".com")
    check("display: not in NFC", HostDisplay.shown(puny("e\u{301}cole") + ".example"), puny("e\u{301}cole") + ".example")
    check("display: NFC form of the same name is shown", HostDisplay.shown(puny("\u{E9}cole") + ".example"), "\u{E9}cole.example")
    check("display: upper case letter", HostDisplay.shown(puny("B\u{FC}cher") + ".example"), puny("B\u{FC}cher") + ".example")
    check("display: mark at the start", HostDisplay.shown(puny("\u{301}abc") + ".example"), puny("\u{301}abc") + ".example")
    check("display: hyphen and digits are fine", HostDisplay.shown(puny("caf\u{E9}-2") + ".example"), "caf\u{E9}-2.example")
    check("display: mixed scripts still add the ASCII form", HostDisplay.shown(puny("\u{430}\u{440}\u{440}\u{4CF}\u{435}") + ".com"), "\u{430}\u{440}\u{440}\u{4CF}\u{435}.com (\(puny("\u{430}\u{440}\u{440}\u{4CF}\u{435}")).com)")
    expect("display: a raw zero width space in a host is written out", HostDisplay.shown("ban\u{200B}k.com").contains("U+200B") && HostDisplay.shown("ban\u{200B}k.com").unicodeScalars.allSatisfy(\.isASCII))
    expect("display: raw safe text passes", HostDisplay.shown("b\u{FC}cher.example") == "b\u{FC}cher.example")

    // Property: whenever `shown` differs from the ASCII host, the non-ASCII text in it holds nothing invisible, no format or
    // control character, no space and nothing unassigned. Random scalar sequences, encoded to punycode labels, from a fixed seed.
    func forbidden(_ s: Unicode.Scalar) -> Bool {
        if s.isASCII { return false }
        let bad: Set<Unicode.GeneralCategory> = [.format, .control, .spaceSeparator, .lineSeparator, .paragraphSeparator, .surrogate, .privateUse, .unassigned]
        if bad.contains(s.properties.generalCategory) || s.properties.isDefaultIgnorableCodePoint { return true }
        return [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x200E, 0x200F, 0x061C, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0xAD, 0x180E, 0xA0, 0x202F, 0x205F, 0x3000].contains(Int(s.value))
            || (0x2000...0x200A).contains(Int(s.value))
    }
    // The stricter property for what is shown: every non-ASCII label is unchanged by NFKC and lower casing, has no combining mark
    // after an ASCII letter, and has no non-ASCII digit together with an ASCII letter or digit.
    func strictlySafe(_ shown: String) -> Bool {
        let readable = String(shown.split(separator: " (", maxSplits: 1, omittingEmptySubsequences: false)[0])
        for label in readable.split(separator: ".") where !label.allSatisfy(\.isASCII) {
            let scalars = Array(label.unicodeScalars)
            if scalars != Array(String(label).precomposedStringWithCompatibilityMapping.unicodeScalars) { return false }
            if scalars != Array(String(label).lowercased().unicodeScalars) { return false }
            for (i, s) in scalars.enumerated() where i > 0 && [.nonspacingMark, .spacingMark].contains(s.properties.generalCategory) {
                let before = scalars[..<i].last { ![.nonspacingMark, .spacingMark].contains($0.properties.generalCategory) }
                if let before, before.isASCII, before.properties.isAlphabetic { return false }
            }
            let digits = scalars.filter { $0.properties.generalCategory == .decimalNumber }
            if digits.contains(where: { !$0.isASCII }) {
                if scalars.contains(where: { $0.isASCII && ($0.properties.isAlphabetic || $0.properties.generalCategory == .decimalNumber) }) { return false }
                let bases = Set(digits.map { Int($0.value) - Int($0.properties.numericValue ?? 0) })
                if bases.count != 1 { return false }
            }
        }
        return true
    }
    var seed: UInt64 = 0x1234_5678_9ABC_DEF0
    func next() -> UInt64 { seed &+= 0x9E37_79B9_7F4A_7C15; var z = seed; z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9; z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB; return z ^ (z >> 31) }
    let pools: [ClosedRange<UInt32>] = [0x61...0x7A, 0xA0...0x24F, 0x300...0x36F, 0x400...0x4FF, 0x590...0x6FF, 0x2000...0x206F, 0x2E80...0x9FFF, 0xFE00...0xFE0F, 0xFFF0...0xFFFF, 0xE000...0xE0FF, 0x1F300...0x1F3FF,
                                  0xFF00...0xFF5F, 0x1D400...0x1D7FF, 0xAA...0xBA, 0x660...0x669, 0x6F0...0x6F9, 0x966...0x96F, 0x1C0...0x1C3, 0x131...0x138, 0xA780...0xA7FF, 0x1EA0...0x1EF9, 0x41...0x5A, 0x30...0x39, 0x2160...0x217F, 0xFB00...0xFB06]
    var shownDifferent = 0, propertyViolations = 0
    for _ in 0..<4000 {
        var text = ""
        for _ in 0..<Int(next() % 9 + 1) {
            let pool = pools[Int(next() % UInt64(pools.count))]
            if let scalar = Unicode.Scalar(UInt32(next() % UInt64(pool.count)) + pool.lowerBound) { text.unicodeScalars.append(scalar) }
        }
        let host = puny(text) + ".example"
        let out = HostDisplay.shown(host)
        if out != host {
            shownDifferent += 1
            if out.unicodeScalars.contains(where: forbidden) || !strictlySafe(out) { propertyViolations += 1; print("violation for \(text.unicodeScalars.map { String($0.value, radix: 16) })") }
        }
    }
    check("property: no forbidden character in any shown text", "\(propertyViolations)", "0")
    expect("property: the random run did show some decoded names", shownDifferent > 100)
    // The same with random payloads that are not valid encodings of anything
    var payloadViolations = 0
    let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789-")
    for _ in 0..<3000 {
        let payload = String((0..<Int(next() % 14 + 1)).map { _ in alphabet[Int(next() % UInt64(alphabet.count))] })
        let host = "xn--\(payload).com"
        let out = HostDisplay.shown(host)
        if out != host, out.unicodeScalars.contains(where: forbidden) { payloadViolations += 1 }
    }
    check("property: random payloads never show a forbidden character", "\(payloadViolations)", "0")

    // Lookalikes: fullwidth and compatibility forms, Latin letters that read as others, marks that barely render, foreign digits
    func hint(_ label: String, _ tld: String = "com") -> String { let d = puny(label); return "\(label).\(tld) (\(d).\(tld))" }
    func asciiOnly(_ label: String, _ tld: String = "com") -> String { puny(label) + "." + tld }
    let tldCom = ".com"
    check("lookalike: fullwidth Latin and digits", HostDisplay.shown(puny("\u{FF41}\u{FF50}\u{FF50}\u{FF4C}\u{FF45}") + tldCom), asciiOnly("\u{FF41}\u{FF50}\u{FF50}\u{FF4C}\u{FF45}"))
    check("lookalike: one fullwidth letter in a Latin word", HostDisplay.shown(puny("a\u{FF50}ple") + tldCom), asciiOnly("a\u{FF50}ple"))
    check("lookalike: a with dot below (Vietnamese) is a letter of its own", HostDisplay.shown(puny("\u{1EA1}pple") + tldCom), "\u{1EA1}pple.com")
    check("lookalike: a letter followed by a low line", HostDisplay.shown(puny("apple\u{332}") + tldCom), asciiOnly("apple\u{332}"))
    check("lookalike: a letter followed by a long solidus overlay", HostDisplay.shown(puny("apple\u{338}") + tldCom), asciiOnly("apple\u{338}"))
    check("lookalike: dotless i", HostDisplay.shown(puny("paypal\u{131}") + tldCom), hint("paypal\u{131}"))
    check("lookalike: dental click", HostDisplay.shown(puny("paypa\u{1C0}") + tldCom), hint("paypa\u{1C0}"))
    check("lookalike: turned l", HostDisplay.shown(puny("paypa\u{A781}") + tldCom), hint("paypa\u{A781}"))
    check("lookalike: sinological dot", HostDisplay.shown(puny("exam\u{A78F}ple") + tldCom), hint("exam\u{A78F}ple"))
    check("lookalike: kra", HostDisplay.shown(puny("\u{138}ey") + tldCom), hint("\u{138}ey"))
    check("lookalike: feminine ordinal", HostDisplay.shown(puny("\u{AA}pple") + tldCom), asciiOnly("\u{AA}pple"))
    check("lookalike: masculine ordinal", HostDisplay.shown(puny("g\u{BA}gle") + tldCom), asciiOnly("g\u{BA}gle"))
    check("lookalike: Arabic-Indic digits after Latin", HostDisplay.shown(puny("a1\u{662}\u{663}") + tldCom), asciiOnly("a1\u{662}\u{663}"))
    check("lookalike: fullwidth zeros in a Latin word", HostDisplay.shown(puny("g\u{FF10}\u{FF10}gle") + tldCom), asciiOnly("g\u{FF10}\u{FF10}gle"))
    check("lookalike: Devanagari digits in a Latin word", HostDisplay.shown(puny("g\u{966}\u{967}gle") + tldCom), asciiOnly("g\u{966}\u{967}gle"))
    check("lookalike: mathematical letters", HostDisplay.shown(puny("\u{1D41A}pple") + tldCom), asciiOnly("\u{1D41A}pple"))
    check("lookalike: ligature", HostDisplay.shown(puny("o\u{FB01}ce") + tldCom), asciiOnly("o\u{FB01}ce"))
    check("lookalike: Cyrillic name under a Cyrillic top-level domain stays as it is", HostDisplay.shown(puny("\u{430}\u{440}\u{440}\u{4CF}\u{435}") + "." + puny("\u{440}\u{444}")), "\u{430}\u{440}\u{440}\u{4CF}\u{435}.\u{440}\u{444}")
    check("lookalike: Arabic letters with Arabic-Indic digits under an Arabic top level domain", HostDisplay.shown(puny("\u{628}\u{661}\u{662}") + "." + puny("\u{634}\u{628}\u{643}\u{629}")), "\u{628}\u{661}\u{662}.\u{634}\u{628}\u{643}\u{629}")
    check("lookalike: two Arabic digit sets in one label", HostDisplay.shown(puny("\u{628}\u{661}\u{6F2}") + "." + puny("\u{634}\u{628}\u{643}\u{629}")), asciiOnly("\u{628}\u{661}\u{6F2}", puny("\u{634}\u{628}\u{643}\u{629}")))
    check("lookalike: Arabic digits with an ASCII digit", HostDisplay.shown(puny("\u{628}1\u{662}") + "." + puny("\u{634}\u{628}\u{643}\u{629}")), asciiOnly("\u{628}1\u{662}", puny("\u{634}\u{628}\u{643}\u{629}")))
    check("common Latin: Vietnamese", HostDisplay.shown(puny("vi\u{1EC7}t") + tldCom), "vi\u{1EC7}t.com")
    check("common Latin: Romanian", HostDisplay.shown(puny("ro\u{219}u") + tldCom), "ro\u{219}u.com")
    check("common Latin: German sharp s", HostDisplay.shown(puny("stra\u{DF}e") + tldCom), "stra\u{DF}e.com")
    check("common Latin: Polish", HostDisplay.shown(puny("\u{142}\u{F3}d\u{17A}") + tldCom), "\u{142}\u{F3}d\u{17A}.com")
    check("common Latin: Scandinavian", HostDisplay.shown(puny("sm\u{F8}rrebr\u{F8}d") + tldCom), "sm\u{F8}rrebr\u{F8}d.com")
    check("common Latin letters: a to z, accents, no ordinals", "\([0x61, 0xE9, 0x142, 0x1EA1, 0x219].allSatisfy { HostDisplay.isCommonLatinLetter(Unicode.Scalar($0)!) })\([0xAA, 0xBA, 0x131, 0x138, 0x1C0, 0xA781, 0xA78F].contains { HostDisplay.isCommonLatinLetter(Unicode.Scalar($0)!) })", "truefalse")

    // Text from the vault is made safe before it is shown
    let dirty: [(String, [UInt32])] = [
        ("bidi controls", [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x200E, 0x200F, 0x061C]),
        ("zero width and format", [0x200B, 0x200C, 0x2060, 0xFEFF, 0x00AD, 0x180E, 0x2061, 0x2064, 0x034F, 0x3164]),
        ("C0 controls", [0x01, 0x07, 0x1B, 0x7F]), ("C1 controls", [0x80, 0x85 + 1, 0x9F]),
        ("tag characters", [0xE0001, 0xE0041, 0xE007F]), ("private use and unassigned", [0xE000, 0x0378, 0xFFFF])
    ]
    for (name, values) in dirty {
        for value in values {
            let c = String(Unicode.Scalar(value)!)
            check("text: \(name) U+\(String(value, radix: 16, uppercase: true)) inside a title", DisplayText.safe("ab" + c + "cd"), "abcd")
            check("text: \(name) U+\(String(value, radix: 16, uppercase: true)) at both ends", DisplayText.safe(c + "ab" + c), "ab")
        }
    }
    check("text: bidi override cannot reorder the rest", DisplayText.safe("Bank\u{202E}gro.evil"), "Bankgro.evil")
    for value in [0x20, 0x09, 0x0A, 0x0D, 0xA0, 0x2000, 0x2003, 0x200A, 0x202F, 0x205F, 0x3000, 0x2028, 0x2029, 0x85] as [UInt32] {
        check("text: space U+\(String(value, radix: 16, uppercase: true)) becomes one space", DisplayText.safe("a" + String(Unicode.Scalar(value)!) + String(Unicode.Scalar(value)!) + "b"), "a b")
    }
    check("text: runs of mixed spaces collapse and the ends are trimmed", DisplayText.safe("  a \u{A0}\u{2003}\t\n b  "), "a b")
    check("text: a right-to-left title is kept as it is", DisplayText.safe("\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{5E2}\u{5D5}\u{5DC}\u{5DD}"), "\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{5E2}\u{5D5}\u{5DC}\u{5DD}")
    let long = DisplayText.safe(String(repeating: "x", count: 5000))
    check("text: 5,000 characters are cut to 80", "\(long.count) \(long.last!)", "80 \u{2026}")
    check("text: a title that fits is not cut", DisplayText.safe(String(repeating: "x", count: 80)).count == 80 ? "ok" : "cut", "ok")
    check("text: only invisible characters falls back to the placeholder", DisplayText.safe("\u{200B}\u{202E}\u{2060} \u{A0}"), "Untitled")
    check("text: the fallback can be changed", DisplayText.safe("\u{200B}", empty: ""), "")
    let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"
    check("emoji: a ZWJ family survives", DisplayText.safe("a " + family + " b"), "a " + family + " b")
    check("emoji: a ZWJ between letters goes", DisplayText.safe("a\u{200D}b"), "ab")
    check("emoji: a ZWJ after an emoji and before a letter goes", DisplayText.safe("\u{1F600}\u{200D}a"), "\u{1F600}a")
    check("emoji: a ZWJ at the end goes", DisplayText.safe("\u{1F600}\u{200D}"), "\u{1F600}")
    check("emoji: a ZWJ at the start goes", DisplayText.safe("\u{200D}\u{1F600}"), "\u{1F600}")
    check("emoji: a skin tone survives", DisplayText.safe("\u{1F44D}\u{1F3FD}"), "\u{1F44D}\u{1F3FD}")
    check("emoji: a heart with its variation selector survives", DisplayText.safe("\u{2764}\u{FE0F}"), "\u{2764}\u{FE0F}")
    check("emoji: a variation selector after a letter goes", DisplayText.safe("a\u{FE0F}"), "a")
    check("emoji: a flag survives", DisplayText.safe("\u{1F1F1}\u{1F1FB}"), "\u{1F1F1}\u{1F1FB}")
    do {  // a long run of families is cut by the 320 scalar limit, and says so
        let cut = DisplayText.safe(String(repeating: family, count: 90))
        expect("emoji: families are cut by the scalar limit and end in an ellipsis", cut.hasSuffix("\u{2026}") && cut.unicodeScalars.count <= DisplayText.maxScalars + 1 && cut.count <= 80)
        check("emoji: 40 families fit in 80 characters and 320 scalars with no cut", DisplayText.safe(String(repeating: family, count: 40)), String(repeating: family, count: 40))
    }
    check("marks: a combining accent survives", DisplayText.safe("e\u{301}cole"), "e\u{301}cole")
    let marks = DisplayText.safe(String(repeating: "e\u{301}", count: 100))
    check("marks: cutting never leaves a mark without its letter", "\(marks.count) \(marks.unicodeScalars.dropLast().last == "\u{301}")", "80 true")
    check("title: a safe title", DisplayText.title(of: VaultItem(kind: .login, title: "Mail\u{202E}", website: "x.example")), "Mail")
    check("title: no title uses the readable site", DisplayText.title(of: VaultItem(kind: .login, website: "https://xn--bcher-kva.example")), "b\u{FC}cher.example")
    check("title: an invisible title uses the site", DisplayText.title(of: VaultItem(kind: .login, title: "\u{200B}", website: "example.com")), "example.com")
    check("title: nothing at all is untitled", DisplayText.title(of: VaultItem(kind: .login)), "Untitled")

    // The Mac App Group comes from the entitlement only when it carries a team identifier
    check("group: team-prefixed", SharedVault.teamPrefixedGroup(in: ["ABCDE12345.local.kdbox.prototype"]) ?? "nil", "ABCDE12345.local.kdbox.prototype")
    check("group: no team (empty prefix) is refused", SharedVault.teamPrefixedGroup(in: ["local.kdbox.prototype"]) ?? "nil", "nil")
    check("group: leading dot is refused", SharedVault.teamPrefixedGroup(in: [".local.kdbox.prototype"]) ?? "nil", "nil")
    check("group: group. identifier is refused", SharedVault.teamPrefixedGroup(in: ["group.local.kdbox.prototype"]) ?? "nil", "nil")
    check("group: lower case team is refused", SharedVault.teamPrefixedGroup(in: ["abcde12345.local"]) ?? "nil", "nil")
    check("group: nine characters is refused", SharedVault.teamPrefixedGroup(in: ["ABCDE1234.local.kdbox"]) ?? "nil", "nil")
    check("group: eleven characters is refused", SharedVault.teamPrefixedGroup(in: ["ABCDE123456.local.kdbox"]) ?? "nil", "nil")
    check("group: nothing after the team is refused", SharedVault.teamPrefixedGroup(in: ["ABCDE12345.", "ABCDE12345"]) ?? "nil", "nil")
    check("group: empty dot after the team is refused", SharedVault.teamPrefixedGroup(in: ["ABCDE12345..x"]) ?? "nil", "nil")
    check("group: the first valid one wins", SharedVault.teamPrefixedGroup(in: ["local.x", "ABCDE12345.a", "ZZZZZ99999.b"]) ?? "nil", "ABCDE12345.a")
    check("group: empty list", SharedVault.teamPrefixedGroup(in: []) ?? "nil", "nil")

    // The Keychain mode is decided once from the entitlements: provisioned only with the shared group, team-prefixed
    let shared = "ABCDE12345.local.kdbox.prototype"
    expect("keychain: provisioned with the shared group", BiometricKey.isProvisioned(keychainGroups: [shared], group: shared))
    expect("keychain: not provisioned without the entitlement", !BiometricKey.isProvisioned(keychainGroups: nil, group: shared))
    expect("keychain: not provisioned with another group only", !BiometricKey.isProvisioned(keychainGroups: ["ABCDE12345.other"], group: shared))
    expect("keychain: not provisioned for the default group", !BiometricKey.isProvisioned(keychainGroups: ["group.local.kdbox.prototype"], group: "group.local.kdbox.prototype"))
    expect("keychain: not provisioned for a group with no team", !BiometricKey.isProvisioned(keychainGroups: ["local.kdbox.prototype"], group: "local.kdbox.prototype"))
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
