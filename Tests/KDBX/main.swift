import Foundation

// Hostless checks for the KDBX codec and entry mapping. Run with scripts/test-kdbx.sh.
// Interop checks use keepassxc-cli when it is installed, and are skipped with a note otherwise.

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
nonisolated(unsafe) var failures = 0
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
try reopenedStore.commit(overwrite: true)
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
    var otpDocument = try KDBX.create(name: "Otp", credentials: .init(password: "pw"), kdf: light)
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
    try writerB.commit(overwrite: true)
    expect("overwrite writes when the file is readable", try Data(contentsOf: shared.url) != afterA)

    // A file that exists but cannot be read: refuse, with and without overwrite, and write nothing.
    if getuid() != 0 {
        let locked = try makeVault("locked", password: "pw")
        let lockedStore = try openStore(locked.url, locked.id, password: "pw")
        let before = try Data(contentsOf: locked.url)
        try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: locked.url.path)
        for overwrite in [false, true] {
            do { try lockedStore.commit(overwrite: overwrite); failures += 1; print("FAIL unreadable file written (overwrite \(overwrite))") }
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
    try conflictOther.commit(overwrite: true)
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
            do { try v.store.save([extra]); try v.store.commit(overwrite: overwrite); failures += 1; print("FAIL missing file written") }
            catch VaultStoreError.fileMissing { print("ok   missing file refused (overwrite \(overwrite))") }
        }
        expect("missing file is not recreated", !fm.fileExists(atPath: v.url.path))
        try fm.createDirectory(at: v.url, withIntermediateDirectories: true)
        for overwrite in [false, true] {
            do { try v.store.commit(overwrite: overwrite); failures += 1; print("FAIL folder in place of the file written over") }
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

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
