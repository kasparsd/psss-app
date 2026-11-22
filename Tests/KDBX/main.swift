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
reopened.markUsed(login.id)
check("usage count", "\(reopened.items().first { $0.id == login.id }!.useCount)", "1")
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
expect("rollback copies are kept", backups.count >= 2)
session.forget()

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
