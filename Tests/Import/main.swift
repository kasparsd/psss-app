import Darwin
import Foundation

// Hostless checks for the 1Password 7 importer: the 1PIF reader, the mapping, the duplicate, update and merge rules, the KDBX
// writer, the store, the CSV fallback, limits, files that are not files, a large generated export and a KeePassXC round trip. Run with scripts/test-import.sh.
// Everything it writes goes under build/import-test. The KeePassXC checks are skipped with a note when keepassxc-cli is missing.

setvbuf(stdout, nil, _IOLBF, 0)
nonisolated(unsafe) var failures = 0
func check(_ name: String, _ got: String, _ want: String) {
    if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)\n  got  \(got)\n  want \(want)") }
}
func expect(_ name: String, _ condition: Bool) { check(name, "\(condition)", "true") }
func expectThrows(_ name: String, _ want: ImportError, _ body: () throws -> Void) {
    do { try body(); failures += 1; print("FAIL \(name): no error") } catch let error as ImportError { check(name, "\(error)", "\(want)") } catch { failures += 1; print("FAIL \(name): \(error)") }
}

let work = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/import-test/work")
let fixtures = URL(fileURLWithPath: "Tests/Fixtures/1pif")
nonisolated(unsafe) let fm = FileManager.default
try? fm.removeItem(at: work)
try fm.createDirectory(at: work, withIntermediateDirectories: true)
let now = Date(timeIntervalSince1970: 1_800_000_000)
let light = KDBXKDF.aesForTesting(rounds: 1000)

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

func peakResidentMB() -> Int {
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    return Int(usage.ru_maxrss) / (1024 * 1024)   // bytes on macOS
}

// MARK: Helpers

func plan(_ name: String, limits: OnePasswordPIF.Limits = .standard) throws -> ImportPlan {
    try OnePasswordPIF.plan(from: fixtures.appendingPathComponent(name), limits: limits, now: now)
}

func emptyVault(_ name: String = "Import test") throws -> KDBXDocument {
    try KDBX.create(name: name, credentials: .init(password: "pw"), kdf: light)
}

/// Writes the document and opens it again, so every check reads what a file holds and not what is in memory.
func reopen(_ document: KDBXDocument) throws -> KDBXDocument {
    try KDBX.open(try KDBX.save(document), credentials: .init(password: "pw"))
}

func allEntries(_ document: KDBXDocument) -> [XNode] {
    var found: [XNode] = []
    func visit(_ group: XNode) {
        for child in group.children {
            if child.name == "Entry" { found.append(child) } else if child.name == "Group" { visit(child) }
        }
    }
    if let root = document.rootGroup { visit(root) }
    return found
}

typealias Strings = [String: (value: String, protected: Bool)]
func strings(_ entry: XNode) -> Strings {
    var result: Strings = [:]
    for node in entry.children(named: "String") {
        guard let key = node.child("Key")?.text, let value = node.child("Value") else { continue }
        result[key] = (value.text, value.attribute("Protected") == "True")
    }
    return result
}

func entry(_ document: KDBXDocument, _ title: String) -> XNode? {
    allEntries(document).first { EntryMapping.string($0, "Title") == title }
}

let standardKeys: Set<String> = ["Title", "UserName", "Password", "URL", "Notes", "otp", "Expiry", "PSSS_TYPE"]
/// The custom strings of an entry: everything but the standard fields, the type hint and the extra websites.
func customKeys(_ entry: XNode) -> Set<String> {
    Set(strings(entry).keys.filter { !standardKeys.contains($0) && !$0.hasPrefix("KP2A_URL") })
}

func vaultItem(_ document: KDBXDocument, titled title: String) -> VaultItem? {
    guard let node = entry(document, title), let id = EntryMapping.uuid(of: node) else { return nil }
    return document.items().first { $0.id == id }
}

func issueCount(_ issues: [ImportIssue], _ kind: ImportIssue.Kind) -> Int { issues.filter { $0.kind == kind }.count }

func item(_ plan: ImportPlan, _ title: String) -> ImportItem? { plan.items.first { $0.title == title } }

func seconds(_ text: String?) -> String { text.flatMap { KeePassTime.date($0) }.map { "\($0.timeIntervalSince1970)" } ?? "none" }
/// What the writer's time reads back as, in ISO text.
func shown(_ d: Date) -> String { KeePassTime.date(ImportTime.iso(d)).map { KeePassTime.string($0) } ?? "unreadable" }
func iso(_ seconds: TimeInterval) -> String { KeePassTime.stored(Date(timeIntervalSince1970: seconds)) }


/// A plan whose texts all hold characters the vault file cannot store, and names that meet once those are gone.
func hostilePlan(_ file: URL) -> ImportPlan {
    var plan = ImportPlan(source: .onePasswordPIF)
    plan.importedAt = now
    plan.items = [ImportItem(sourceID: "test:bad\u{FFFE}1", kind: .login, title: "Bad\u{FFFE}title",
                             fields: [ImportField(.username, value: "us\u{1}er"), ImportField(.password, value: "pa\u{FFFF}ss", concealed: true),
                                      ImportField(.website, value: "bad\u{FFFE}.example.com"), ImportField(.notes, value: "no\u{B}tes"),
                                      ImportField(.custom, label: "Lab\u{FFFE}el", value: "one"), ImportField(.custom, label: "Label", value: "two"),
                                      ImportField(.custom, label: "Ti\u{FFFE}tle", value: "three"), ImportField(.custom, label: "Not\u{1}es", value: "four"),
                                      ImportField(.custom, label: "KP\u{FFFE}H:x", value: "five"), ImportField(.custom, label: "\u{FFFE}", value: "six")],
                             tags: ["t\u{FFFE}ag"], folder: ["Fol\u{FFFE}der"], created: now, modified: now,
                             attachments: [ImportAttachment(name: "a\u{FFFE}.txt", size: 13, url: file), ImportAttachment(name: "a.txt", size: 13, url: file)])]
    return plan
}

final class Box: @unchecked Sendable { var value = "" }
/// Runs a check on another thread and gives up after a while, so a read that never ends is a failure and not a hang.
func timed(_ name: String, seconds: Double = 20, _ body: @escaping @Sendable () -> String) -> String {
    let box = Box(), done = DispatchSemaphore(value: 0)
    Thread.detachNewThread { box.value = body(); done.signal() }
    if done.wait(timeout: .now() + seconds) == .timedOut { print("FAIL \(name): still running after \(Int(seconds)) s"); print("1 failed"); exit(1) }
    return box.value
}
func outcome(of url: URL, limits: OnePasswordPIF.Limits = .standard) -> @Sendable () -> String {
    { do { return "plan with \(try OnePasswordPIF.plan(from: url, limits: limits, now: Date(timeIntervalSince1970: 1_800_000_000)).items.count) items" }
      catch let error as ImportError { return "\(error)" } catch { return "\(error)" } }
}

let separatorLine = "***5642bee8-a5ff-11dc-8314-0800200c9a66***\n"
/// Writes `<work>/<name>.1pif/data.1pif` from JSON records, and any files given by their path inside the folder.
@discardableResult
func writeExport(_ name: String, _ records: [String], files: [String: Data] = [:]) throws -> URL {
    let folder = work.appendingPathComponent("\(name).1pif")
    try? fm.removeItem(at: folder)
    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
    try Data(records.map { $0 + "\n" + separatorLine }.joined().utf8).write(to: folder.appendingPathComponent("data.1pif"))
    for (path, data) in files {
        let file = folder.appendingPathComponent(path)
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file)
    }
    return folder
}
/// A secure note record with extra top-level JSON.
func noteJSON(_ n: Int, _ title: String, notes: String = "n", extra: String = "", created: Int? = 1_700_000_000, updated: Int? = 1_700_500_000) -> String {
    var parts = ["\"uuid\":\"\(uid(n))\"", "\"typeName\":\"securenotes.SecureNote\"", "\"title\":\"\(title)\""]
    if let created { parts.append("\"createdAt\":\(created)") }
    if let updated { parts.append("\"updatedAt\":\(updated)") }
    parts.append("\"secureContents\":{\"notesPlain\":\"\(notes)\"\(extra)}")
    return "{" + parts.joined(separator: ",") + "}"
}
func loginJSON(_ n: Int, _ title: String, user: String, password: String, site: String, extra: String = "", open: String = "") -> String {
    "{\"uuid\":\"\(uid(n))\",\"typeName\":\"webforms.WebForm\",\"title\":\"\(title)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"location\":\"\(site)\"\(open),"
        + "\"secureContents\":{\"fields\":[{\"value\":\"\(user)\",\"name\":\"u\",\"type\":\"T\",\"designation\":\"username\"},{\"value\":\"\(password)\",\"name\":\"p\",\"type\":\"P\",\"designation\":\"password\"}],"
        + "\"URLs\":[{\"label\":\"\",\"url\":\"\(site)\"}]\(extra)}}"
}
func randomData(_ count: Int) -> Data {
    var data = Data(count: count)
    data.withUnsafeMutableBytes { if let base = $0.baseAddress { arc4random_buf(base, count) } }
    return data
}
/// The non-empty strings of an entry as sorted `*key=value` lines (the star marks a protected one), without the title and the
/// bookkeeping keys, so a whole item can be compared in one line.
func readBack(_ entry: XNode) -> [String] {
    entry.children(named: "String").compactMap { node -> String? in
        guard let key = node.child("Key")?.text, let value = node.child("Value"), key != "Title", !key.hasPrefix("PSSS_"), !value.text.isEmpty else { return nil }
        return (value.attribute("Protected") == "True" ? "*" : "") + key + "=" + value.text
    }.sorted()
}
func historyPasswords(_ entry: XNode) -> [String] { (entry.child("History")?.children ?? []).map { EntryMapping.string($0, "Password") ?? "" } }
func summaryLine(_ s: ImportSummary) -> String {
    "added \(s.addedCount) updated \(s.updated) merged \(s.merged) skipped \(s.duplicatesSkipped) similar \(s.similarAdded)"
}

// MARK: Large export first, so the peak memory it reports is its own

func uid(_ n: Int) -> String { String(format: "%032X", n) }

func generateLarge(count: Int, attachmentFiles: Int, attachmentBytes: Int, at directory: URL) throws {
    try? fm.removeItem(at: directory)
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    let dataURL = directory.appendingPathComponent("data.1pif")
    fm.createFile(atPath: dataURL.path, contents: nil)
    let handle = try FileHandle(forWritingTo: dataURL)
    defer { try? handle.close() }
    let separator = "***5642bee8-a5ff-11dc-8314-0800200c9a66***\n"
    var buffer = ""
    func flush() { handle.write(Data(buffer.utf8)); buffer = "" }
    let folderCount = 20
    for f in 0..<folderCount {
        buffer += "{\"uuid\":\"\(uid(0xF000000 + f))\",\"typeName\":\"system.folder.Regular\",\"title\":\"Folder \(f)\",\"createdAt\":0,\"updatedAt\":1700000000}\n" + separator
    }
    for i in 0..<count {
        let id = uid(i + 1)
        var line: String
        switch i % 20 {
        case 7:
            line = "{\"uuid\":\"\(id)\",\"typeName\":\"securenotes.SecureNote\",\"title\":\"Note \(i)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\"notesPlain\":\"\(String(repeating: "note text ", count: 20))\"}}"
        case 13:
            line = "{\"uuid\":\"\(id)\",\"typeName\":\"wallet.financial.CreditCard\",\"title\":\"Card \(i)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\"ccnum\":\"4000000000000002\",\"cardholder\":\"Holder \(i)\",\"cvv\":\"123\",\"expiry_mm\":\"12\",\"expiry_yy\":\"2030\"}}"
        default:
            let code = i % 10 == 0 ? ",{\"k\":\"concealed\",\"n\":\"TOTP_\(uid(i))\",\"v\":\"JBSWY3DPEHPK3PXP\",\"t\":\"\"}" : ""
            let history = i % 5 == 0 ? ",\"passwordHistory\":[{\"value\":\"old-\(i)-a\",\"time\":1699000000},{\"value\":\"old-\(i)-b\",\"time\":1699500000}]" : ""
            line = "{\"uuid\":\"\(id)\",\"typeName\":\"webforms.WebForm\",\"title\":\"Site \(i)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,"
                + "\"folderUuid\":\"\(uid(0xF000000 + i % folderCount))\",\"location\":\"site\(i).example.com\",\"openContents\":{\"tags\":[\"bulk\",\"group \(i % 7)\"]},"
                + "\"secureContents\":{\"fields\":[{\"value\":\"user\(i)\",\"name\":\"email\",\"type\":\"E\",\"designation\":\"username\"},"
                + "{\"value\":\"pass-\(i)-\(String(repeating: "x", count: 24))\",\"name\":\"pw\",\"type\":\"P\",\"designation\":\"password\"},"
                + "{\"value\":\"x\",\"name\":\"csrf\",\"type\":\"H\"}],\"URLs\":[{\"label\":\"\",\"url\":\"site\(i).example.com\"},{\"label\":\"website 2\",\"url\":\"https://login.site\(i).example.net\"}],"
                + "\"notesPlain\":\"\(String(repeating: "some notes ", count: 12))\","
                + "\"sections\":[{\"title\":\"Extra\",\"name\":\"s\",\"fields\":[{\"k\":\"string\",\"n\":\"f\(i)\",\"v\":\"extra value \(i)\",\"t\":\"label\"}\(code)]}]\(history)}}"
        }
        buffer += line + "\n" + separator
        if buffer.utf8.count > 1 << 20 { flush() }
    }
    flush()
    for i in 0..<attachmentFiles {
        let folder = directory.appendingPathComponent("attachments/\(uid(i + 1))")
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        // Random bytes, so nothing is stored once because it repeats and nothing shrinks when compressed.
        try randomData(attachmentBytes).write(to: folder.appendingPathComponent("file\(i).bin"))
    }
}

let largeCount = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_ITEMS"] ?? "") ?? 50_000
let largeFiles = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_FILES"] ?? "") ?? 10
let largeFileBytes = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_FILE_MB"] ?? "") ?? 5
do {
    let directory = work.appendingPathComponent("large.1pif")
    let started = Date()
    try generateLarge(count: largeCount, attachmentFiles: largeFiles, attachmentBytes: largeFileBytes * 1024 * 1024, at: directory)
    let dataSize = (try? fm.attributesOfItem(atPath: directory.appendingPathComponent("data.1pif").path)[.size] as? Int) ?? 0
    print("note generated \(largeCount) items (\(dataSize / (1024 * 1024)) MB of records) and \(largeFiles) attachments of \(largeFileBytes) MB in \(Int(Date().timeIntervalSince(started))) s")

    // The defaults hold 10 MB a file and 50 MB in all. A bigger run raises them, and says so by being asked for.
    var largeLimits = OnePasswordPIF.Limits.standard
    largeLimits.attachmentBytes = max(largeLimits.attachmentBytes, largeFileBytes * 1024 * 1024)
    largeLimits.allAttachmentBytes = max(largeLimits.allAttachmentBytes, largeFiles * largeFileBytes * 1024 * 1024)
    let baseline = peakResidentMB()
    let readStart = Date()
    let big = try OnePasswordPIF.plan(from: directory, limits: largeLimits, now: now)
    let readSeconds = Date().timeIntervalSince(readStart)
    let readPeak = peakResidentMB() - baseline
    print("note read and mapped in \(String(format: "%.1f", readSeconds)) s, peak memory grew by \(readPeak) MB")
    check("large: every item is read", "\(big.items.count)", "\(largeCount)")
    check("large: attachments are listed", "\(big.items.reduce(0) { $0 + $1.attachments.count })", "\(largeFiles)")
    check("large: no line was unreadable", "\(big.skipped.unreadable)", "0")
    expect("large: reading stays under 20 s", readSeconds < 20)
    expect("large: reading stays under 500 MB of extra peak memory", readPeak < 500)
    check("large: folders become groups (notes and cards sit in none)", "\(Set(big.items.compactMap { $0.folder.first }).count)", "18")

    let applyStart = Date()
    var vault = try emptyVault("Large")
    let applyBaseline = peakResidentMB()
    let summary = try vault.apply(big)
    let applySeconds = Date().timeIntervalSince(applyStart)
    print("note applied in \(String(format: "%.1f", applySeconds)) s, peak memory grew by \(peakResidentMB() - applyBaseline) MB more")
    check("large: every item is added", "\(summary.addedCount)", "\(largeCount)")
    expect("large: applying stays under 60 s", applySeconds < 60)
    let saveStart = Date()
    let bytes = try KDBX.save(vault)
    let reopened = try KDBX.open(bytes, credentials: .init(password: "pw"))
    let peakAfterSave = peakResidentMB()
    print("note saved and reopened \(bytes.count / (1024 * 1024)) MB in \(String(format: "%.1f", Date().timeIntervalSince(saveStart))) s, peak memory \(peakAfterSave) MB in all so far")
    check("large: reopened vault holds every item", "\(reopened.items().count)", "\(largeCount)")
    check("large: reopened vault holds every attachment", "\(reopened.binaries.count)", "\(largeFiles)")
    expect("large: the run so far stays under 2500 MB of peak memory", peakAfterSave < 2500)
    // What the rest costs, measured after the numbers above so it cannot inflate them.
    let secondStart = Date()
    let second = try vault.apply(big)
    print("note applying the same export again (every item an identical duplicate) takes \(String(format: "%.1f", Date().timeIntervalSince(secondStart))) s, peak memory \(peakResidentMB()) MB in all")
    check("large: a second apply changes nothing", "\(second.duplicatesSkipped) \(second.itemCount) \(vault.binaries.count)", "\(largeCount) 0 \(largeFiles)")
    let verifyStart = Date()
    _ = try XMLTree.parse(XMLTree.serialize(vault.root))
    print("note serializing and parsing the whole tree at once, which apply does in batches on what it wrote, takes \(String(format: "%.1f", Date().timeIntervalSince(verifyStart))) s here (\(largeCount) entries), peak memory \(peakResidentMB()) MB in all")
    try? fm.removeItem(at: directory)
}

// MARK: Every fixture reads back as the kind the plan says

do {
    let names = ["logins", "codes", "cards", "notes", "kinds", "sections", "history", "meta", "attachments", "noattachments", "windows", "malformed",
                 "legacy-kinds", "extremes", "dotted-names", "encoding", "owner-shape"]
    for name in names {
        let p = try plan(name)
        var vault = try emptyVault()
        let summary = try vault.apply(p)
        let back = try reopen(vault)
        let items = back.items()
        check("\(name): every plan item is in the file", "\(items.count)", "\(summary.addedCount)")
        func count(_ kind: ItemKind) -> Int { items.filter { $0.kind == kind }.count }
        check("\(name): kinds read back", "\(count(.login)) \(count(.creditCard)) \(count(.secureNote)) \(count(.keePassEntry))",
              "\(summary.logins) \(summary.cards) \(summary.notes) \(summary.others)")
    }
}

// MARK: logins

do {
    let p = try plan("logins")
    check("logins: two items", "\(p.items.count)", "2")
    check("logins: web-form noise is counted and not imported", "\(p.skipped.webFormFields)", "5")
    let mail = item(p, "Example Mail")!
    check("logins: type E username is the username", mail.username, "alex@example.net")
    check("logins: websites keep their order", mail.websites.joined(separator: " | "), "mail.example.com | https://accounts.example.net/login")
    check("logins: every other field is gone", "\(mail.fields.filter { $0.role == .custom }.count)", "0")
    check("logins: an item without a title and with only a location", p.items[1].websites.joined(), "shop.example.org")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    let read = vaultItem(back, titled: "Example Mail")!
    check("logins: reads back as a login", "\(read.kind)", "login")
    check("logins: username", read.account, "alex@example.net")
    check("logins: password", read.secret, "Alpha-pass-1")
    check("logins: website", read.website, "mail.example.com")
    check("logins: notes", read.notes, "Primary mailbox")
    let strs = strings(entry(back, "Example Mail")!)
    check("logins: extra website is KP2A_URL", strs["KP2A_URL"]?.value ?? "", "https://accounts.example.net/login")
    expect("logins: the password is protected", strs["Password"]?.protected == true)
    let unnamed = entry(back, "shop.example.org")!
    check("logins: no title is stored as the host", EntryMapping.string(unnamed, "Title") ?? "", "shop.example.org")
    check("logins: and read back as no name", back.items().first { $0.account == "shop-user" }?.title ?? "x", "")
    check("logins: the source is kept", KeePassImport.sourceID(of: entry(back, "Example Mail")!) ?? "", "1password:00000000000000000000000000001001")
}

// MARK: codes

do {
    let p = try plan("codes")
    check("codes: five items", "\(p.items.count)", "5")
    check("codes: one unreadable", "\(issueCount(p.items.flatMap(\.issues), .unreadableCode))", "1")
    check("codes: one extra", "\(issueCount(p.items.flatMap(\.issues), .extraCode))", "1")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    check("codes: bare secret", vaultItem(back, titled: "Code bare")?.otpSecret ?? "", "JBSWY3DPEHPK3PXP")
    check("codes: a template field with no value leaves nothing", "\(customKeys(entry(back, "Code bare")!).count)", "0")
    let link = vaultItem(back, titled: "Code link")!
    check("codes: link keeps digits, period and algorithm", "\(link.otpSettings.digits) \(link.otpSettings.period) \(link.otpSettings.algorithm.rawValue)", "8 60 SHA256")
    check("codes: link issuer is kept", EntryMapping.string(entry(back, "Code link")!, "otp")?.contains("issuer=Example") == true ? "yes" : "no", "yes")
    let plain = vaultItem(back, titled: "Code no digits")!
    check("codes: a link without digits uses the standard ones", "\(plain.otpSecret) \(plain.otpSettings.digits) \(plain.otpSettings.period)", "GEZDGNBVGY3TQOJQ 6 30")
    let bad = entry(back, "Code unreadable")!
    check("codes: unreadable value is not the code", vaultItem(back, titled: "Code unreadable")?.otpSecret ?? "x", "")
    check("codes: unreadable value is kept as a hidden field", strings(bad)["One-time code"]?.value ?? "", "not-a-code-fixture")
    expect("codes: and it is protected", strings(bad)["One-time code"]?.protected == true)
    let two = entry(back, "Code two")!
    check("codes: the first of two is the code", vaultItem(back, titled: "Code two")?.otpSecret ?? "", "MFRGGZDFMZTWQ2LK")
    check("codes: the second stays as a hidden field named after its section", strings(two)["One-time code (Backup)"]?.value.contains("GEZDGNBVGY3TQOJQ") == true ? "found" : "missing", "found")
}

// MARK: cards

do {
    let p = try plan("cards")
    check("cards: two cards", "\(p.items.filter { $0.kind == .card }.count)", "2")
    let card = item(p, "Fixture Card")!
    let values = card.fields.map(\.value)
    check("cards: no value appears twice", "\(Set(values).count)", "\(values.count)")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    let read = vaultItem(back, titled: "Fixture Card")!
    check("cards: kind", "\(read.kind)", "creditCard")
    check("cards: holder, number and expiry", "\(read.account) | \(read.secret) | \(read.expiry)", "Alex Example | 4000000000000002 | 12/27")
    let s = strings(entry(back, "Fixture Card")!)
    check("cards: security code", s["Security code"]?.value ?? "", "123")
    expect("cards: security code is protected", s["Security code"]?.protected == true)
    check("cards: PIN from its section", s["PIN"]?.value ?? "", "4321")
    expect("cards: PIN is protected", s["PIN"]?.protected == true)
    check("cards: valid from", s["Valid from"]?.value ?? "", "01/2020")
    check("cards: the custom fields are the contact and detail ones only",
          customKeys(entry(back, "Fixture Card")!).sorted().joined(separator: ", "),
          ["Additional Details: credit limit", "Contact Information: issuing bank", "Contact Information: phone (local)", "Contact Information: website", "PIN", "Security code", "Valid from"].joined(separator: ", "))
    let old = vaultItem(back, titled: "Old Card")!
    check("cards: flat keys only, unpadded month and four-digit year", "\(old.account) | \(old.secret) | \(old.expiry)", "Old Holder | 5500000000000004 | 01/29")
    let o = strings(entry(back, "Old Card")!)
    check("cards: flat security code and valid from", "\(o["Security code"]?.value ?? "") \(o["Valid from"]?.value ?? "")", "987 03/2018")
    check("cards: the card type is dropped", "\(customKeys(entry(back, "Old Card")!).sorted().joined(separator: ", "))", "Security code, Valid from, bank, phoneLocal")
}

// MARK: notes

do {
    let p = try plan("notes")
    check("notes: four notes", "\(p.items.count)", "4")
    check("notes: the control character line is read", "\(p.skipped.unreadable)", "0")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    check("notes: multi-line", vaultItem(back, titled: "Multi-line")?.notes ?? "", "Line one\nLine two\n\nLine four after a blank line")
    check("notes: tag", entry(back, "Multi-line")!.child("Tags")?.text ?? "none", "some")
    check("notes: non-ASCII", vaultItem(back, titled: "Unicode")?.notes ?? "", "Z\u{fc}rich \u{2014} \u{65e5}\u{672c}\u{8a9e} \u{2014} caf\u{e9} \u{1F510}")
    check("notes: markup", vaultItem(back, titled: "Markup")?.notes ?? "", "<b>bold</b> &amp; \"quotes\" 'single' ]]> <![CDATA[x]]> * # _ `code`")
    check("notes: a tab survives and a bell is dropped from the XML", vaultItem(back, titled: "Control characters")?.notes ?? "", "tab\there and bell and more")
    check("notes: kind", "\(vaultItem(back, titled: "Unicode")!.kind)", "secureNote")
}

// MARK: kinds

do {
    let p = try plan("kinds")
    check("kinds: seventeen custom items", "\(p.items.filter { $0.kind == .custom }.count) of \(p.items.count)", "17 of 17")
    let unknown = p.items.flatMap(\.issues).filter { $0.kind == .unknownKind }
    check("kinds: an unknown and a numeric type are never named, the text says what happened", unknown.map { $0.detail.contains("wallet.example.Gadget") || $0.detail.contains("114") ? "named" : $0.detail }.joined(separator: ","),
          "this is an item type Psss does not know, so its fields were kept as a custom item,this is an item type Psss does not know, so its fields were kept as a custom item")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    func s(_ title: String) -> Strings { strings(entry(back, title)!) }
    check("kinds: identity text", s("Fixture Identity")["Identification: first name"]?.value ?? "", "Alex")
    check("kinds: a date is a UTC calendar date", s("Fixture Identity")["Identification: birth date"]?.value ?? "", "1980-02-29")
    check("kinds: an address is multi-line", s("Fixture Identity")["Address: address"]?.value ?? "", "1 Example Street\nExampleville\nEX\n00000\nlv")
    check("kinds: a menu value is kept as written", s("Fixture Bank")["type"]?.value ?? "", "checking")
    expect("kinds: telephone PIN is protected", s("Fixture Bank")["telephone PIN"]?.protected == true)
    expect("kinds: database password is protected", s("Fixture Database")["password"]?.protected == true)
    expect("kinds: SSN number is protected", s("Fixture SSN")["number"]?.protected == true)
    expect("kinds: other names are plain text", s("Fixture SSN")["name"]?.protected == false)
    check("kinds: month and year", s("Fixture Membership")["member since"]?.value ?? "", "05/2019")
    check("kinds: server host is the website", vaultItem(back, titled: "Fixture Server")?.website ?? "", "https://srv.example.net")
    check("kinds: router host is the website", vaultItem(back, titled: "Fixture Router")?.website ?? "", "192.0.2.1")
    check("kinds: database host is the website", vaultItem(back, titled: "Fixture Database")?.website ?? "", "db.example.net")
    check("kinds: mail server is the website", vaultItem(back, titled: "Fixture Email Account")?.website ?? "", "imap.example.net")
    check("kinds: the host stays a field too", s("Fixture Router")["server / IP address"]?.value ?? "", "192.0.2.1")
    check("kinds: a numeric type reads its own sections", s("Fixture SSH key")["public key"]?.value ?? "", "ssh-ed25519 AAAAFIXTURE alex@example.net")
    expect("kinds: and its private key is protected", s("Fixture SSH key")["private key"]?.protected == true)
    check("kinds: flat keys only", customKeys(entry(back, "Old FTP")!).sorted().joined(separator: ", "), "hostname, password, port, username")
    expect("kinds: a flat password is protected", s("Old FTP")["password"]?.protected == true)
    check("kinds: an unknown type is a custom item", "\(vaultItem(back, titled: "Unknown gadget")!.kind)", "keePassEntry")
    check("kinds: email provider fields are prefixed by section", s("Fixture Email Account")["Provider: provider"]?.value ?? "", "Example Mail")
}

// MARK: sections

do {
    let p = try plan("sections")
    var vault = try emptyVault()
    try vault.apply(p)
    let back = try reopen(vault)
    let e = entry(back, "All kinds")!
    let s = strings(e)
    check("sections: string", s["Kinds: String"]?.value ?? "", "text")
    check("sections: menu", s["Kinds: Menu"]?.value ?? "", "checking")
    check("sections: card type is text outside a card", s["Kinds: Card type"]?.value ?? "", "visa")
    expect("sections: concealed is protected", s["Kinds: Secret"]?.protected == true)
    expect("sections: string is not", s["Kinds: String"]?.protected == false)
    check("sections: date", s["Kinds: Date"]?.value ?? "", "2024-02-29")
    check("sections: a date before 1970", s["Kinds: Before 1970"]?.value ?? "", "1960-05-17")
    check("sections: month and year", s["Kinds: Month year"]?.value ?? "", "09/2023")
    check("sections: address", s["Kinds: Address"]?.value ?? "", "1 Example Street\nExampleville\nEX\n00000\nlv")
    check("sections: unknown object is compact JSON", s["Kinds: Unknown object"]?.value ?? "", "{\"a\":1,\"b\":[1,2]}")
    check("sections: unknown number is text", s["Kinds: Unknown number"]?.value ?? "", "42")
    check("sections: a field with no title uses its name", s["Kinds: k_nolabel"]?.value ?? "", "no title")
    expect("sections: an empty value is skipped", s["Kinds: Empty"] == nil)
    expect("sections: a missing value is skipped", s["Kinds: Missing"] == nil)
    check("sections: reserved names get a suffix", ["Notes (2)", "URL (2)", "otp (2)", "Title (2)", "UserName (2)", "Password (2)"].map { s[$0]?.value ?? "-" }.joined(), "abcfgh")
    check("sections: reserved prefixes are moved clear", "\(s["Field: PSSS_TYPE"]?.value ?? "-")\(s["Field: KP2A_URL"]?.value ?? "-")", "de")
    check("sections: duplicate labels", "\(s["Account number"]?.value ?? "-")\(s["Account number (2)"]?.value ?? "-")", "ij")
    check("sections: standard fields are untouched", "\(s["Notes"]?.value ?? "") \(s["PSSS_TYPE"]?.value ?? "") \(s["Title"]?.value ?? "")", "n note All kinds")
    check("sections: it still reads as a note", "\(vaultItem(back, titled: "All kinds")!.kind)", "secureNote")
    check("sections: the section with no fields leaves nothing", "\(s.keys.filter { $0.contains("Related") }.count)", "0")
}

// MARK: history

do {
    let p = try plan("history")
    check("history: three items", "\(p.items.count)", "3")
    check("history: the entry equal to the current password is dropped", item(p, "History login")!.history.map(\.password).joined(separator: ","), "old-a1,old-a2")
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    let back = try reopen(vault)
    func history(_ title: String) -> [XNode] { entry(back, title)?.child("History")?.children ?? [] }
    check("history: oldest first", history("History login").map { EntryMapping.string($0, "Password") ?? "" }.joined(separator: ","), "old-a1,old-a2")
    check("history: each snapshot has the time it was replaced", history("History login").map { $0.child("Times")?.child("LastModificationTime")?.text ?? "" }.joined(separator: ","), "\(iso(1699000000)),\(iso(1699500000))")
    check("history: the entry itself is current", EntryMapping.string(entry(back, "History login")!, "Password") ?? "", "current-a")
    check("history: kept within HistoryMaxItems", "\(history("Long history").count)", "10")
    check("history: and the oldest were the ones dropped", history("Long history").first.flatMap { EntryMapping.string($0, "Password") } ?? "", "old-b03")
    check("history: the trim is reported", "\(issueCount(summary.issues, .historyTrimmed))", "1")
    check("history: a router keeps its history", history("History router").map { EntryMapping.string($0, "Password") ?? "" }.joined(separator: ","), "router-old-1,router-old-2")
    check("history: counted in the summary", "\(summary.historyEntries)", "14")
    let tight = try plan("history")
    var small = try emptyVault()
    small.root.child("Meta")?.setChildText("HistoryMaxItems", "1")
    let trimmed = try small.apply(tight)
    check("history: a smaller limit keeps the newest only", "\(entry(small, "History login")?.child("History")?.children.count ?? 0)", "1")
    check("history: and reports each trim", "\(issueCount(trimmed.issues, .historyTrimmed))", "3")
}

// MARK: meta

do {
    let p = try plan("meta")
    check("meta: nine items", "\(p.items.count)", "9")
    check("meta: trashed items are counted and not imported", "\(p.skipped.trashed) \(p.items.contains { $0.title == "Trashed login" })", "1 false")
    check("meta: records read include the trashed one", "\(p.recordCount)", "10")
    check("meta: tombstones, saved searches and folders are not items", "\(p.items.filter { $0.title.contains("Saved") }.count)", "0")
    check("meta: tags", item(p, "Tagged")!.tags.joined(separator: ";"), "alpha;beta gamma")
    check("meta: favourite at the top level, position 0", item(p, "Favourite top")!.tags.joined(separator: ";"), "Favorite")
    check("meta: favourite in open contents", item(p, "Favourite open")!.tags.joined(separator: ";"), "alpha;Favorite")
    check("meta: favourite on a Windows record", item(p, "Windows favourite")!.tags.joined(separator: ";"), "Favorite")
    check("meta: nested folder path", item(p, "In nested folder")!.folder.joined(separator: " > "), "Work > Projects")
    check("meta: top folder path", item(p, "In top folder")!.folder.joined(separator: " > "), "Work")
    check("meta: both identifier formats", "\(item(p, "Synced identifier")!.sourceID ?? "") \(item(p, "Tagged")!.sourceID ?? "")", "1password:abcdefghijklmnopqrstuvwxyz 1password:00000000000000000000000000008001")
    expect("meta: a Windows record marks the plan lower confidence", p.lowConfidence)
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    check("meta: the second item with the same identifier and other content is its own entry", "\(summary.duplicatesSkipped) \(summary.itemCount)", "0 9")
    expect("meta: and the two share one identifier is reported", summary.issues.contains { $0.kind == .sharedIdentifier })
    let back = try reopen(vault)
    func group(_ parent: XNode, _ name: String) -> XNode? { parent.children(named: "Group").first { $0.child("Name")?.text == name } }
    let work = group(back.rootGroup!, "Work")
    expect("meta: the folder is a group", work != nil)
    expect("meta: nested folders nest", work.flatMap { group($0, "Projects") } != nil)
    expect("meta: an empty folder is not created", group(back.rootGroup!, "Empty") == nil)
    check("meta: the nested entry sits in the nested group", work.flatMap { group($0, "Projects") }?.children(named: "Entry").compactMap { EntryMapping.string($0, "Title") }.joined() ?? "", "In nested folder")
    check("meta: the top folder entry sits in its group", work?.children(named: "Entry").compactMap { EntryMapping.string($0, "Title") }.joined() ?? "", "In top folder")
    let tagged = entry(back, "Tagged")!
    check("meta: Tags in the file", tagged.child("Tags")?.text ?? "", "alpha;beta gamma")
    check("meta: creation time", tagged.child("Times")?.child("CreationTime")?.text ?? "", iso(1700000000))
    check("meta: modification time", tagged.child("Times")?.child("LastModificationTime")?.text ?? "", iso(1700500000))
    check("meta: the item is still found by the existing mapping", vaultItem(back, titled: "In nested folder")?.secret ?? "", "nest-pass")
}

// MARK: dates

do {
    check("dates: the writer's time is the codec's stored form, and reads back", "\(ImportTime.iso(Date(timeIntervalSince1970: 1_795_386_026)) == KeePassTime.stored(Date(timeIntervalSince1970: 1_795_386_026))) \(shown(Date(timeIntervalSince1970: 1_795_386_026)))", "true 2026-11-22T22:20:26Z")
    check("dates: and for a leap day", shown(Date(timeIntervalSince1970: 951_782_400 + 45_678)), "2000-02-29T12:41:18Z")
}

// MARK: attachments

var attachmentLimits = OnePasswordPIF.Limits()
attachmentLimits.attachmentBytes = 2048
do {
    let p = try plan("attachments", limits: attachmentLimits)
    check("attachments: six items", "\(p.items.count)", "6")
    check("attachments: an export folder with an attachments folder", "\(p.attachmentsFolderFound) \(p.pickedDataFileOnly)", "true false")
    check("attachments: two files on one item", item(p, "Two files")!.attachments.map(\.name).joined(separator: ", "), "copy of report.txt, report.txt")
    check("attachments: the same name on another item", item(p, "Same name elsewhere")!.attachments.map(\.name).joined(), "report.txt")
    let all = p.items.flatMap(\.issues)
    check("attachments: a path in the identifier is rejected and reported", "\(item(p, "Escape attempt")!.attachments.count) \(item(p, "Escape attempt")!.issues.map(\.kind.rawValue).joined())", "0 attachmentRejected")
    check("attachments: the fixture holds no link at all", "\(item(p, "Links")!.attachments.count) \(item(p, "Links")!.issues.count)", "0 0")
    check("attachments: over the limit is reported once, names the limit, and the small file stays", "\(item(p, "Too large")!.attachments.map(\.name).joined()) \(issueCount(all, .attachmentTooLarge)) \(all.first { $0.kind == .attachmentTooLarge }?.detail ?? "")",
          "small.txt 1 1 attachment is larger than the limit of 2048 bytes, so it was not imported")
    check("attachments: no files for an item that has none", "\(item(p, "No files")!.attachments.count)", "0")
    expect("attachments: no issue holds file contents", !all.contains { $0.detail.contains("must never be read") })

    var vault = try emptyVault()
    let summary = try vault.apply(p)
    check("attachments: counted", "\(summary.attachments)", "4")
    check("attachments: identical bytes are stored once", "\(vault.binaries.count)", "3")
    let back = try reopen(vault)
    check("attachments: the file is a pool entry plus a flag byte", "\(back.binaries.map(\.count).sorted().map(String.init).joined(separator: ","))",
          [Data("Fixture attachment: the same bytes under two names.\n".utf8).count + 1, Data("A different file that happens to share the name report.txt.\n".utf8).count + 1, Data("small enough\n".utf8).count + 1].sorted().map(String.init).joined(separator: ","))
    let two = entry(back, "Two files")!
    let refs = two.children(named: "Binary").map { ($0.child("Key")?.text ?? "", Int($0.child("Value")?.attribute("Ref") ?? "") ?? -1) }
    check("attachments: two references to one entry in the pool", "\(Set(refs.map(\.1)).count)", "1")
    for (name, index) in refs {
        check("attachments: bytes of \(name) equal the file", back.binaries[index].dropFirst() == (try Data(contentsOf: fixtures.appendingPathComponent("attachments/attachments/\(uid(0x9001))/\(name)"))) ? "same" : "different", "same")
    }
    let other = entry(back, "Same name elsewhere")!
    check("attachments: the same name holds other bytes", back.binaries[Int(other.child("Binary")!.child("Value")!.attribute("Ref")!)!].dropFirst() == (try Data(contentsOf: fixtures.appendingPathComponent("attachments/attachments/\(uid(0x9002))/report.txt"))) ? "same" : "different", "same")

    // Names stay unique within an item, whatever the source called its files.
    var clash = p
    let file = fixtures.appendingPathComponent("attachments/attachments/\(uid(0x9005))/small.txt")
    clash.items = [ImportItem(sourceID: "test:1", kind: .note, title: "Clash", fields: [], created: now, modified: now,
                              attachments: [ImportAttachment(name: "a.txt", size: 13, url: file), ImportAttachment(name: "A.TXT", size: 13, url: file), ImportAttachment(name: "a.txt", size: 13, url: file)])]
    var clashVault = try emptyVault()
    try clashVault.apply(clash)
    check("attachments: names are unique within an item", entry(try reopen(clashVault), "Clash")!.children(named: "Binary").map { $0.child("Key")?.text ?? "" }.joined(separator: " | "), "a.txt | A (2).TXT | a (3).txt")
    check("attachments: and the bytes are stored once", "\(clashVault.binaries.count)", "1")

    // A second import of the same plan adds nothing, not even bytes.
    let again = try vault.apply(p)
    check("attachments: importing twice adds nothing", "\(again.itemCount) \(again.duplicatesSkipped) \(vault.binaries.count)", "0 6 3")

    // Only data.1pif chosen: the files beside it are out of reach, and the plan says so.
    let lone = try OnePasswordPIF.plan(from: fixtures.appendingPathComponent("attachments/data.1pif"), limits: attachmentLimits, now: now)
    check("attachments: a lone data.1pif has no attachments and says so", "\(lone.pickedDataFileOnly) \(lone.attachmentsFolderFound) \(lone.items.flatMap(\.attachments).count)", "true false 0")
    let none = try plan("noattachments")
    check("attachments: an export with no attachments folder", "\(none.attachmentsFolderFound) \(none.items.count)", "false 1")

    // The totals are limits too.
    var tight = OnePasswordPIF.Limits()
    tight.allAttachmentBytes = 100
    tight.attachmentsPerItem = 1
    let limited = try plan("attachments", limits: tight)
    check("attachments: each refusal is one issue per item, with a count", limited.items.flatMap(\.issues).filter { $0.kind == .attachmentsTotalLimit || $0.kind == .attachmentLimitPerItem }.map { "\($0.item ?? "-"): \($0.kind.rawValue)" }.sorted().joined(separator: " | "),
          "Same name elsewhere: attachmentsTotalLimit | Too large: attachmentsTotalLimit | Two files: attachmentLimitPerItem")
}

// MARK: windows

do {
    let p = try plan("windows")
    expect("windows: marked lower confidence", p.lowConfidence)
    check("windows: eight items", "\(p.items.count)", "8")
    check("windows: reported once", "\(issueCount(p.issues, .windowsExport))", "1")
    let login = item(p, "Windows login")!
    check("windows: login credentials", "\(login.username) \(login.password)", "winuser win-login-pass")
    check("windows: websites from overview URLs", login.websites.joined(separator: " | "), "winlogin.example.com | https://alt.example.net")
    check("windows: tags, and a fave of 0 is not a favourite", login.tags.joined(separator: ";"), "win tag")
    check("windows: folder with a parent field", login.folder.joined(), "Windows folder")
    check("windows: history", login.history.map(\.password).joined(), "win-old")
    check("windows: section field", login.fields.first { $0.label == "Extra: extra label" }?.value ?? "", "extra value")
    check("windows: noise counted", "\(p.skipped.webFormFields)", "1")
    let card = item(p, "Windows card")!
    check("windows: card", "\(card.kind) \(card.first(.cardholder) ?? "") \(card.first(.expiry) ?? "")", "card Win Holder 05/28")
    check("windows: card has no repeated value", "\(Set(card.fields.map(\.value)).count)", "\(card.fields.count)")
    check("windows: note", item(p, "Windows note")!.first(.notes) ?? "", "windows note body")
    check("windows: identity is a custom item", "\(item(p, "Windows identity")!.kind) \(item(p, "Windows identity")!.fields.first?.label ?? "")", "custom Identification: first name")
    let password = item(p, "Windows password")!
    check("windows: a password item with a website is a login", "\(password.kind) \(password.username.isEmpty) \(password.password)", "login true win-only-password")
    check("windows: router website", item(p, "Windows router")!.websites.joined(), "192.0.2.9")
    check("windows: an unknown category is not named", p.items.flatMap(\.issues).first { $0.kind == .unknownKind }?.detail.contains("category:199") == true ? "named" : "unnamed", "unnamed")
    check("windows: a Mac-shaped record is read as one", item(p, "Mac-shaped record from Windows")?.first(.notes) ?? "", "Windows can write this shape too")
}

// MARK: malformed

do {
    var limits = OnePasswordPIF.Limits()
    limits.lineBytes = 4096
    let p = try plan("malformed", limits: limits)
    check("malformed: the good records are read", p.items.map(\.title).joined(separator: " | "), "Good before | Café Windows text | Milliseconds | No dates | Good after")
    check("malformed: broken, too long and several-line records are skipped and reported", "\(p.skipped.unreadable)", "3")
    check("malformed: by kind", "\(issueCount(p.issues, .unreadableRecord)) \(issueCount(p.issues, .lineTooLong))", "2 1")
    check("malformed: Windows-1252 text is read and reported", "\(issueCount(p.issues, .textEncoding))", "1")
    check("malformed: milliseconds are read as seconds", "\(item(p, "Milliseconds")!.created.timeIntervalSince1970) \(item(p, "Milliseconds")!.modified.timeIntervalSince1970)", "1700000000.0 1700500000.0")
    check("malformed: missing and zero dates become the import time, counted", "\(item(p, "No dates")!.created == now) \(item(p, "No dates")!.modified == now) \(p.missingDates)", "true true 1")
    check("malformed: no issue holds the line's contents", "\(p.issues.contains { $0.detail.contains("unterminated") || $0.detail.contains("Pretty") })", "false")
    let wide = try plan("malformed")
    check("malformed: with the default limit the long line is read", "\(wide.items.count) \(wide.skipped.unreadable)", "6 2")
    let summary = p.summary
    check("malformed: the summary counts them", "\(summary.unreadable) \(summary.notes)", "3 5")
    expectThrows("malformed: not a 1Password file", .notAnExport) { _ = try plan("malformed-notexport") }
    expectThrows("malformed: an empty file", .empty) { _ = try plan("malformed-empty") }
    expectThrows("malformed: a folder without data.1pif", .notAnExport) { _ = try OnePasswordPIF.plan(from: fixtures, now: now) }
    expectThrows("malformed: a path that does not exist", .notAnExport) { _ = try OnePasswordPIF.plan(from: fixtures.appendingPathComponent("nothing-here"), now: now) }
    var tiny = OnePasswordPIF.Limits()
    tiny.dataFileBytes = 100
    expectThrows("limits: a data file over the limit", .tooLarge) { _ = try plan("logins", limits: tiny) }
    var few = OnePasswordPIF.Limits()
    few.items = 1
    expectThrows("limits: more items than the limit", .tooLarge) { _ = try plan("logins", limits: few) }
}

// MARK: duplicates

do {
    let p = try plan("logins")
    var vault = try emptyVault()
    vault.upsert(VaultItem(kind: .login, title: "Mine", account: "alex@example.net", website: "https://mail.example.com/inbox", secret: "Alpha-pass-1"))
    vault.upsert(VaultItem(kind: .login, title: "Shop", account: "shop-user", website: "https://www.shop.example.org", secret: "another password"))
    let preview = vault.preview(p)
    check("duplicates: preview counts without writing", "\(preview.merged) \(preview.similarAdded) \(preview.logins) \(preview.duplicatesSkipped) \(vault.items().count)", "1 1 1 0 2")
    let summary = try vault.apply(p)
    check("duplicates: preview and apply agree", summaryLine(preview), summaryLine(summary))
    check("duplicates: same site, username and password as a hand-made login merges into it", "\(summary.merged) \(summary.duplicatesSkipped)", "1 0")
    check("duplicates: same site and username with another password is added and listed", "\(summary.similarAdded) \(issueCount(summary.issues, .similarLogin)) \(summary.logins)", "1 1 1")
    check("duplicates: the vault holds the original two and the one added", "\(vault.items().count)", "3")
    let second = try vault.apply(p)
    check("duplicates: a second import changes nothing", "\(second.itemCount) \(second.duplicatesSkipped) \(vault.items().count)", "0 2 3")
    var other = ImportPlan(source: .csv)
    other.items = [ImportItem(sourceID: nil, kind: .login, title: "Other site", fields: [ImportField(.username, value: "alex@example.net"), ImportField(.password, value: "Alpha-pass-1"), ImportField(.website, value: "other.example.net")], created: now, modified: now)]
    check("duplicates: the same credentials on another site are new", ImportDuplicates.classify(other, against: KeePassImport.existing(in: vault)).map { "\($0)" }.joined(separator: ","), "add")
    var twice = other
    twice.items.append(twice.items[0])
    check("duplicates: the same login twice in one plan is added once", ImportDuplicates.classify(twice, against: []).map { "\($0)" }.joined(separator: ","), "add,duplicate")
    var card = ImportPlan(source: .csv)
    card.items = [ImportItem(sourceID: nil, kind: .card, title: "Card", fields: [ImportField(.cardNumber, value: "1")], created: now, modified: now)]
    check("duplicates: only logins are compared by site", ImportDuplicates.classify(card, against: [ImportDuplicates.Existing(sourceID: nil, hosts: [], username: "", password: "1")]).map { "\($0)" }.joined(separator: ","), "add")
    // A hand-made login with the same site and username but another password is not merged into.
    var login1 = ImportPlan(source: .onePasswordPIF)
    login1.items = [ImportItem(sourceID: "1password:A", kind: .login, title: "L", fields: [ImportField(.username, value: "u"), ImportField(.password, value: "p"), ImportField(.website, value: "site.example.net")], created: now, modified: now)]
    let plain = ImportDuplicates.Existing(sourceID: nil, hosts: ["site.example.net"], username: "u", password: "p")
    check("duplicates: a 1Password item merges into a login with no source", ImportDuplicates.classify(login1, against: [plain]).map { "\($0)" }.joined(), "merge(0)")
    check("duplicates: and into one a CSV import made", ImportDuplicates.classify(login1, against: [ImportDuplicates.Existing(sourceID: "csv:x", hosts: ["site.example.net"], username: "u", password: "p")]).map { "\($0)" }.joined(), "merge(0)")
    check("duplicates: but not into one that already has another 1Password identifier", ImportDuplicates.classify(login1, against: [ImportDuplicates.Existing(sourceID: "1password:B", hosts: ["site.example.net"], username: "u", password: "p")]).map { "\($0)" }.joined(), "duplicate")
    var inBin = plain
    inBin.inRecycleBin = true
    check("duplicates: an entry in the recycle bin never absorbs an imported item", ImportDuplicates.classify(login1, against: [inBin]).map { "\($0)" }.joined(), "add")
    var csvItem = login1
    csvItem.items[0].sourceID = nil
    check("duplicates: a CSV item is never richer, so it is a duplicate", ImportDuplicates.classify(csvItem, against: [plain]).map { "\($0)" }.joined(), "duplicate")
    var sameID = ImportDuplicates.Existing(sourceID: "1password:A", hosts: ["site.example.net"], username: "u", password: "p")
    sameID.contentHash = ImportItem.salted("", login1.items[0].fingerprint)
    check("duplicates: the same identifier and content is skipped", ImportDuplicates.classify(login1, against: [sameID]).map { "\($0)" }.joined(), "duplicate")
    sameID.contentHash = "0000"
    check("duplicates: the same identifier and other content is an update", ImportDuplicates.classify(login1, against: [sameID]).map { "\($0)" }.joined(), "update(0)")
    sameID.inRecycleBin = true
    check("duplicates: an item in the recycle bin does not come back", ImportDuplicates.classify(login1, against: [sameID]).map { "\($0)" }.joined(), "inRecycleBin(0)")
}

// MARK: all or nothing

do {
    let p = try plan("logins")
    var broken = p
    broken.items[1].attachments = [ImportAttachment(name: "gone.txt", size: 5, url: work.appendingPathComponent("no-such-file"))]
    var vault = try emptyVault()
    vault.upsert(VaultItem(kind: .login, title: "Existing", website: "existing.example.com", secret: "x"))
    let before = XMLTree.serialize(vault.root)
    let binariesBefore = vault.binaries.count
    expectThrows("atomic: an unreadable attachment fails the whole import", .attachmentUnreadable("gone.txt")) { _ = try vault.apply(broken) }
    check("atomic: the document tree is as it was", XMLTree.serialize(vault.root) == before ? "same" : "changed", "same")
    check("atomic: and so is the binary pool", "\(vault.binaries.count)", "\(binariesBefore)")
    let sizeFile = work.appendingPathComponent("sized.txt")
    try Data("12345".utf8).write(to: sizeFile)
    var changed = p
    changed.items[0].attachments = [ImportAttachment(name: "sized.txt", size: 3, url: sizeFile)]
    expectThrows("atomic: a file that changed since it was listed fails the import", .attachmentChanged("sized.txt")) { _ = try vault.apply(changed) }
    check("atomic: nothing was added", "\(vault.items().count)", "1")
}

// MARK: the store: one commit, one rollback copy, a failed write leaves everything

@MainActor
func storeChecks(writesWork: Bool) async throws {
    let url = work.appendingPathComponent("store.kdbx")
    let document = try emptyVault("Store")
    let data = try KDBX.save(document)
    try data.write(to: url)
    var reference = VaultReference(name: "Store", managed: false, bookmark: nil, fileName: "store.kdbx")
    reference.id = UUID()
    let store = KeePassVaultStore(reference: reference, url: url, scoped: false, document: document, fileData: data)
    let backupDirectory = VaultFiles.storageRoot.appendingPathComponent("Backups/\(reference.id.uuidString)")
    func backups() -> Int { ((try? fm.contentsOfDirectory(atPath: backupDirectory.path)) ?? []).count }
    defer { VaultFiles.removeBackups(for: reference.id) }

    let p = try plan("meta")
    // A write that cannot happen: the vault, its in-memory items and the rollback copies stay as they were.
    let directory = url.deletingLastPathComponent()
    let bytesBefore = try Data(contentsOf: url)
    func setWritable(_ writable: Bool) {
        try? fm.setAttributes([.posixPermissions: NSNumber(value: writable ? 0o755 : 0o555)], ofItemAtPath: directory.path)
        try? fm.setAttributes([.posixPermissions: NSNumber(value: writable ? 0o644 : 0o444)], ofItemAtPath: url.path)
    }
    setWritable(false)
    var failed = false
    do { _ = try store.apply(p) } catch { failed = true }
    setWritable(true)
    expect("store: a forced write failure throws", failed)
    expect("store: and the vault's bytes are unchanged", try Data(contentsOf: url) == bytesBefore)
    check("store: and the open vault holds nothing new", "\(store.items().count)", "0")
    check("store: and no rollback copy was made", "\(backups())", "0")

    guard writesWork else {
        print("SKIP store checks that write: this process cannot write files with complete protection right now (Mac locked or asleep?). Run scripts/test-import.sh again while it is unlocked")
        return
    }
    let summary = try store.apply(p)
    check("store: the import is added", "\(summary.itemCount) \(store.items().count)", "9 9")
    check("store: one commit made one rollback copy", "\(backups())", "1")
    let onDisk = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw"))
    check("store: the file holds the items", "\(onDisk.items().count)", "9")
    let again = try store.apply(p)
    check("store: importing again adds nothing and writes nothing", "\(again.itemCount) \(backups())", "0 1")
    do { _ = try SampleVaultStore().apply(p); failures += 1; print("FAIL the sample vault took an import") } catch ImportError.sampleVault { print("ok   the sample vault refuses an import") }
    let other = try plan("logins")
    let third = try store.apply(other)
    check("store: a later import is one more commit", "\(third.itemCount) \(backups()) \(store.items().count)", "2 2 11")
    // A changed file on disk fails the write and leaves the open vault as it was.
    let intruder = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw"))
    try KDBX.save(intruder).write(to: url)
    let codes = try plan("codes")
    do { _ = try store.apply(codes); failures += 1; print("FAIL a changed file was overwritten") } catch VaultStoreError.changedOnDisk { print("ok   a file changed elsewhere refuses the import") }
    check("store: and the open vault holds nothing of it", "\(store.items().count)", "11")
}
// The store writes with complete file protection, which the system refuses while the Mac is locked or asleep. The existing
// KDBX test has the same limit. The failed-write checks hold either way; the ones that need a write are skipped with a note.
let probe = work.appendingPathComponent("protection-probe")
let writesWork = (try? Data("x".utf8).write(to: probe, options: VaultFiles.writeOptions)) != nil
try? fm.removeItem(at: probe)
try await storeChecks(writesWork: writesWork)

// MARK: Editing an imported item keeps what the interface does not show

do {
    let file = fixtures.appendingPathComponent("attachments/attachments/\(uid(0x9001))/report.txt")
    let fileSize = try Data(contentsOf: file).count
    var rich = ImportPlan(source: .onePasswordPIF)
    rich.items = [
        ImportItem(sourceID: "1password:EDIT1", kind: .login, title: "Rich login",
                   fields: [ImportField(.username, value: "rich"), ImportField(.password, value: "rich-current", concealed: true),
                            ImportField(.website, value: "rich.example.com"), ImportField(.website, value: "https://second.example.net"),
                            ImportField(.code, value: "JBSWY3DPEHPK3PXP", concealed: true), ImportField(.notes, value: "kept"),
                            ImportField(.custom, label: "Security question", value: "blue", concealed: true), ImportField(.custom, label: "Account no", value: "42")],
                   tags: ["one", "Favorite"], folder: ["Deep", "Down"], created: Date(timeIntervalSince1970: 1_600_000_000), modified: Date(timeIntervalSince1970: 1_650_000_000),
                   history: (1...3).map { ImportRevision(password: "rich-old-\($0)", date: Date(timeIntervalSince1970: 1_600_000_000 + Double($0) * 1000)) },
                   attachments: [ImportAttachment(name: "report.txt", size: fileSize, url: file)]),
        ImportItem(sourceID: "1password:EDIT2", kind: .custom, title: "Rich custom", fields: [ImportField(.password, value: "c-secret", concealed: true), ImportField(.custom, label: "Model", value: "G-1"), ImportField(.code, value: "GEZDGNBVGY3TQOJQ", concealed: true)],
                   created: now, modified: now)
    ]
    var vault = try emptyVault()
    try vault.apply(rich)
    var back = try reopen(vault)
    var node = entry(back, "Rich login")!
    let before = strings(node)
    var edited = vaultItem(back, titled: "Rich login")!
    check("edit: an imported login reads back whole", "\(edited.account) \(edited.secret) \(edited.website) \(edited.otpSecret)", "rich rich-current rich.example.com JBSWY3DPEHPK3PXP")
    edited.secret = "rich-new"
    edited.notes = "changed"
    expect("edit: the existing mapping accepts the change", back.upsert(edited))
    node = entry(back, "Rich login")!
    let after = strings(node)
    check("edit: custom strings survive", "\(after["Security question"]?.value ?? "") \(after["Account no"]?.value ?? "") \(after["KP2A_URL"]?.value ?? "")", "blue 42 https://second.example.net")
    check("edit: their protection survives", "\(after["Security question"]?.protected ?? false) \(after["Account no"]?.protected ?? true)", "true false")
    check("edit: only the edited fields changed", before.keys.filter { before[$0]?.value != after[$0]?.value }.sorted().joined(separator: ","), "Notes,Password")
    check("edit: the attachment survives", "\(node.children(named: "Binary").count) \(node.child("Binary")?.child("Key")?.text ?? "")", "1 report.txt")
    check("edit: the history keeps the imported versions and adds one", "\(node.child("History")?.children.count ?? 0)", "4")
    check("edit: the oldest imported version is still first", EntryMapping.string(node.child("History")!.children[0], "Password") ?? "", "rich-old-1")
    check("edit: the version replaced now holds the old password", EntryMapping.string(node.child("History")!.children[3], "Password") ?? "", "rich-current")
    check("edit: tags survive", node.child("Tags")?.text ?? "", "one;Favorite")
    check("edit: the source survives", KeePassImport.sourceID(of: node) ?? "", "1password:EDIT1")
    check("edit: the creation time survives", node.child("Times")?.child("CreationTime")?.text ?? "", iso(1_600_000_000))
    check("edit: the one-time code survives", "\(vaultItem(back, titled: "Rich login")!.otpSecret)", "JBSWY3DPEHPK3PXP")
    back = try reopen(back)
    check("edit: and all of it survives a save", "\(strings(entry(back, "Rich login")!)["Security question"]?.value ?? "") \(back.binaries.count)", "blue 1")
    check("edit: the group path survives", back.rootGroup!.children(named: "Group").first?.children(named: "Group").first?.children(named: "Entry").count == 1 ? "in Deep/Down" : "elsewhere", "in Deep/Down")
    // A custom item keeps its code and fields too.
    var custom = vaultItem(back, titled: "Rich custom")!
    check("edit: a custom item reads back as one", "\(custom.kind) \(custom.secret)", "keePassEntry c-secret")
    custom.title = "Renamed custom"
    custom.secret = "c-secret-2"
    expect("edit: a custom item is edited", back.upsert(custom))
    let c = strings(entry(back, "Renamed custom")!)
    check("edit: a custom item keeps its fields and its code", "\(c["Model"]?.value ?? "") \(c["One-time code"]?.value ?? "")", "G-1 GEZDGNBVGY3TQOJQ")
}

// MARK: CSV

do {
    let text = "Title,Url,Username,Password,OTPAuth,Notes\n\"csv login\",\"csv.example.com\",\"csvuser\",\"csv-pass\",,\"csv notes\",\n\"csv bare\",\"csv2.example.org\",,\"pw\",,\"more notes\",\n\"A note row\",,,,,\"a note body\",\n\"A card row\",,,,,,\n\"Coded\",\"coded.example.com\",\"c\",\"p\",\"not a code\",,\n,,,,,,\n"
    let p = try CSVSource.plan(from: text, now: now)
    check("csv: logins", "\(p.items.count) \(p.items.map(\.title).joined(separator: ","))", "3 csv login,csv bare,Coded")
    check("csv: skipped rows are counted, empty lines are not", "\(p.skipped.rows) \(p.recordCount)", "2 5")
    check("csv: and named by title with a reason", p.issues.filter { $0.kind == .skippedRow }.map { $0.item ?? "" }.joined(separator: ","), "A note row,A card row")
    check("csv: a note row says so", p.issues.first { $0.item == "A note row" }?.detail.contains("note") == true ? "note" : "other", "note")
    check("csv: a row with no username has none", item(p, "csv bare")!.username, "")
    check("csv: the trailing comma is harmless", item(p, "csv login")!.first(.notes) ?? "", "csv notes")
    check("csv: an unreadable code is kept as a hidden field", "\(item(p, "Coded")!.fields.first { $0.label == "One-time code" }?.value ?? "") \(issueCount(p.items.flatMap(\.issues), .unreadableCode))", "not a code 1")
    check("csv: dates are the import time and counted", "\(p.items[0].created == now) \(p.missingDates)", "true 3")
    check("csv: every row has a marker made of site, user and title", "\(p.items.allSatisfy { $0.sourceID?.hasPrefix("csv:") == true })", "true")
    expectThrows("csv: not a passwords file", .notAnExport) { _ = try CSVSource.plan(from: "a,b\n1,2\n", now: now) }
    expectThrows("csv: nothing but a header", .empty) { _ = try CSVSource.plan(from: "Title,Url,Username,Password\n", now: now) }
    // The existing reader still works for its current caller.
    check("csv: CSVImport is unchanged", "\(try CSVImport.items(from: text).items.count) \(try CSVImport.items(from: text).skipped)", "3 2")
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    check("csv: applied", "\(summary.logins) \(vault.items().count)", "3 3")
    let strs = strings(entry(vault, "Coded")!)
    check("csv: the entry keeps the marker", "\(KeePassImport.sourceID(of: entry(vault, "Coded")!)?.hasPrefix("csv:") ?? false)", "true")
    check("csv: the unreadable code is protected", "\(strs["One-time code"]?.protected ?? false)", "true")
    let csvFile = work.appendingPathComponent("login.csv")
    try Data(text.utf8).write(to: csvFile)
    check("csv: the source is detected from the file", "\(try ImportSources.plan(from: csvFile, now: now).source)", "csv")
    check("csv: and from the folder", "\(try ImportSources.plan(from: fixtures.appendingPathComponent("logins"), now: now).source)", "onePasswordPIF")
}

// MARK: An export shaped like a real one, with made-up values

do {
    let p = try plan("owner-shape")
    check("owner-shape: four items from four records", "\(p.items.count) \(p.recordCount)", "4 4")
    let note = item(p, "Sample note")!
    check("owner-shape: a secure note with its tag", "\(note.kind) \(note.tags.joined(separator: ",")) \(note.first(.notes) ?? "")", "note sample Text of the sample note.\nSecond line.")
    let pass = item(p, "Sample password")!
    check("owner-shape: a password item with a website is a login with no username", "\(pass.kind) \(pass.websites.joined()) \(pass.username.isEmpty)", "login sample.example.org true")
    check("owner-shape: its password and notes", "\(pass.password) \(pass.first(.notes) ?? "")", "Sample-pass-only-1 notes for the password item")
    let login = item(p, "Sample login")!
    check("owner-shape: login credentials", "\(login.kind) \(login.username) \(login.password) \(login.websites.joined())", "login sampleuser Sample-pass-2 login.example.com")
    check("owner-shape: two tags", login.tags.joined(separator: ","), "first tag,second tag")
    check("owner-shape: one custom field labelled with its section", login.fields.filter { $0.label == "Custom section: custom label" }.map(\.value).joined(), "custom value.")
    let code = login.fields.first { $0.label == "One-time code" }
    check("owner-shape: the invalid code is a concealed field and not the code", "\(code?.value ?? "") \(code?.concealed ?? false) \(login.first(.code) == nil)", "not-valid-base32! true true")
    check("owner-shape: and it is reported once", "\(issueCount(login.issues, .unreadableCode))", "1")
    check("owner-shape: the empty Related Items section adds nothing", "\(login.fields.filter { $0.role == .custom }.count)", "2")
    let card = item(p, "Sample card")!
    check("owner-shape: card holder, number and expiry", "\(card.first(.cardholder) ?? "") \(card.first(.cardNumber) ?? "") \(card.first(.expiry) ?? "")", "Sample Holder 4000000000000002 09/31")
    check("owner-shape: security code and valid from", "\(card.first(.securityCode) ?? "") \(card.fields.first { $0.label == "Valid from" }?.value ?? "")", "456 02/1999")
    check("owner-shape: issuing bank", card.fields.first { $0.label == "Contact Information: issuing bank" }?.value ?? "", "Sample Bank")
    let values = card.fields.map(\.value)
    check("owner-shape: template fields without a value and the empty one add nothing, and no value repeats", "\(values.count) \(Set(values).count)", "6 6")
    check("owner-shape: dates are the export's", "\(note.created.timeIntervalSince1970) \(note.modified.timeIntervalSince1970)", "1700000100.0 1700000100.0")
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    let back = try reopen(vault)
    check("owner-shape: it reads back as a note, two logins and a card", "\(back.items().count) \(summary.logins) \(summary.notes) \(summary.cards) \(summary.others)", "4 2 1 1 0")
    check("owner-shape: only the unreadable code is an issue", "\(summary.issues.count)", "1")

    // The CSV that goes with it, trailing commas and all.
    let csvURL = URL(fileURLWithPath: "Tests/Fixtures/csv/owner-shape.csv")
    let c = try CSVSource.plan(from: csvURL, now: now)
    check("owner-shape csv: two logins, two rows skipped for a reason", "\(c.items.count) \(c.skipped.rows) \(c.issues.filter { $0.kind == .skippedRow }.count)", "2 2 2")
    check("owner-shape csv: the trailing comma shifts nothing", "\(item(c, "Sample login")!.username) \(item(c, "Sample login")!.password) \(item(c, "Sample password")!.first(.notes) ?? "")", "sampleuser Sample-pass-2 notes for the password item")

    // CSV first, then the 1PIF: the richer item fills the plainer entry, and nothing is duplicated.
    var both = try emptyVault()
    let csvFirst = try both.apply(c)
    check("csv then 1pif: the CSV adds two logins", "\(csvFirst.addedCount)", "2")
    let preview = both.preview(p)
    let merged = try both.apply(p)
    check("csv then 1pif: the 1PIF merges into both and adds the note and the card", summaryLine(merged), "added 2 updated 0 merged 2 skipped 0 similar 0")
    check("csv then 1pif: the preview said the same", summaryLine(preview), summaryLine(merged))
    check("csv then 1pif: four entries, none twice", "\(allEntries(both).count)", "4")
    let entryNode = entry(both, "Sample login")!
    check("csv then 1pif: the entry keeps its password", strings(entryNode)["Password"]?.value ?? "", "Sample-pass-2")
    check("csv then 1pif: and gains the custom field and the tags", "\(strings(entryNode)["Custom section: custom label"]?.value ?? "") \(entryNode.child("Tags")?.text ?? "")", "custom value. first tag;second tag")
    check("csv then 1pif: the source is now the 1Password identifier", KeePassImport.sourceID(of: entryNode) ?? "", "1password:\(uid(0xF103))")
    check("csv then 1pif: the creation date is the earlier one", entryNode.child("Times")?.child("CreationTime")?.text ?? "", iso(1_700_000_300))
    check("csv then 1pif: the one-time code was already there and is not doubled", "\(entryNode.children(named: "String").filter { $0.child("Key")?.text.hasPrefix("One-time code") == true }.count)", "1")
    check("csv then 1pif: the previous version is in the history", "\(historyPasswords(entryNode))", "[\"Sample-pass-2\"]")
    let again = try both.apply(p)
    check("csv then 1pif: the same 1PIF again changes nothing", summaryLine(again), "added 0 updated 0 merged 0 skipped 4 similar 0")
    let csvAgain = try both.apply(c)
    check("csv then 1pif: and the CSV again changes nothing", "\(csvAgain.itemCount) \(csvAgain.duplicatesSkipped)", "0 2")
    let reread = try reopen(both)
    check("csv then 1pif: it survives a save", "\(reread.items().count)", "4")

    // The 1PIF first, then the CSV: the CSV is the plainer one and adds nothing.
    var other = try emptyVault()
    try other.apply(p)
    let csvLater = try other.apply(c)
    check("1pif then csv: the CSV items are duplicates", "\(csvLater.itemCount) \(csvLater.duplicatesSkipped)", "0 2")
}

// MARK: The real export, when it is there, by structure only

do {
    let export = URL(fileURLWithPath: "build/1p7-export.1pif")
    if fm.fileExists(atPath: export.path) {
        let p = try OnePasswordPIF.plan(from: export, now: now)
        check("real: every record was read as an item", "\(p.items.count) \(p.skipped.unreadable) \(p.skipped.trashed)", "\(p.recordCount) 0 0")
        var vault = try emptyVault()
        let summary = try vault.apply(p)
        let back = try reopen(vault)
        check("real: every item is in the file", "\(back.items().count)", "\(summary.addedCount)")
        check("real: kinds add up", "\(summary.logins + summary.cards + summary.notes + summary.others)", "\(p.items.count)")
        check("real: a second import changes nothing", "\(try vault.apply(p).itemCount)", "0")
        let csv = URL(fileURLWithPath: "build/1p7-export.csv")
        if fm.fileExists(atPath: csv.path) {
            let c = try CSVSource.plan(from: csv, now: now)
            check("real csv: every row is a login or a skipped row", "\(c.items.count + c.skipped.rows)", "\(c.recordCount)")
            check("real csv: the same logins add nothing to the 1PIF import", "\(try vault.apply(c).itemCount)", "0")
        } else { print("skip real csv: build/1p7-export.csv not found") }
    } else {
        print("skip real export: build/1p7-export.1pif not found")
    }
}

// MARK: Every kind, field by field

do {
    let table: [(title: String, fields: [String])] = [
    ("Fixture Identity", ["Address: address=1 Example Street\nExampleville\nEX\n00000\nlv", "Address: business=555-0104", "Address: cell=555-0103", "Address: default phone=555-0101", "Address: home=555-0102", "Identification: birth date=1980-02-29", "Identification: company=Example Ltd", "Identification: department=QA", "Identification: first name=Alex", "Identification: initial=Q", "Identification: job title=Lead", "Identification: last name=Example", "Identification: occupation=Tester", "Identification: sex=male", "Internet Details: ICQ=12345", "Internet Details: email=alex@example.net", "Internet Details: reminder answer=Fixture", "Internet Details: reminder question=First pet?", "Internet Details: username=alexq", "Internet Details: website=https://alex.example.net"]),
    ("Fixture Bank", ["*telephone PIN=2468", "Branch Information: address=2 Example Street\nExampleville", "Branch Information: phone=555-0111", "IBAN=XX00EXAMPLE00000000", "SWIFT=EXAMPLXX", "account number=11112222", "bank name=Example Bank", "name on account=Alex Example", "routing number=000000000", "type=checking"]),
    ("Fixture Database", ["*password=db-pass-fixture", "SID=FX1", "URL=db.example.net", "alias=fx", "connection options=sslmode=require", "database=fixture", "port=5432", "server=db.example.net", "type=postgresql", "username=dbuser"]),
    ("Fixture Driver Licence", ["address=3 Example Road\nExampleville\nus", "birth date=1975-07-04", "conditions / restrictions=none", "country=Exampleland", "expiry date=06/2031", "full name=Alex Example", "height=170 cm", "license class=B", "number=FX-0000-1", "sex=female", "state=EX"]),
    ("Fixture Outdoor Licence", ["approved wildlife=fishing", "country=Exampleland", "expires=2026-12-31", "full name=Alex Example", "maximum quota=5", "state=EX", "valid from=2024-01-01"]),
    ("Fixture Passport", ["date of birth=1980-02-29", "expiry date=2030-04-30", "full name=Alex Example", "issued on=2020-05-01", "issuing authority=Example Office", "issuing country=Exampleland", "nationality=Exampleish", "number=XP0000001", "place of birth=Exampleville", "sex=male", "type=P"]),
    ("Fixture SSN", ["*number=000-00-0000", "name=Alex Example"]),
    ("Fixture Membership", ["*password=1357", "expiration date=05/2029", "group=Example Club", "member ID=M-0001", "member name=Alex Example", "member since=05/2019", "telephone=555-0121", "website=https://club.example.net"]),
    ("Fixture Rewards", ["*PIN=8642", "More Information: additional number=R-0003", "More Information: customer service phone=555-0131", "More Information: member since=01/2018", "More Information: phone for reservations=555-0132", "More Information: website=https://air.example.net", "company name=Example Air", "member ID=R-0002", "member name=Alex Example"]),
    ("Fixture Email Account", ["*SMTP: password=smtp-pass-fixture", "*password=imap-pass-fixture", "Provider: phone (local)=555-0141", "Provider: phone (toll free)=555-0142", "Provider: provider's website=https://mail.example.net", "Provider: provider=Example Mail", "SMTP: SMTP server=smtp.example.net", "SMTP: authentication=password", "SMTP: port number=465", "SMTP: security=starttls", "SMTP: type=custom", "SMTP: username=alex", "URL=imap.example.net", "auth method=password", "port number=993", "security=ssl", "server=imap.example.net", "type=imap", "username=alex"]),
    ("Fixture Server", ["*Admin Console: console password=console-pass-fixture", "*password=srv-pass-fixture", "Admin Console: admin console URL=https://admin.srv.example.net", "Admin Console: console username=admin", "Hosting Provider: name=Example Hosting", "Hosting Provider: support URL=https://hosting.example.net/support", "Hosting Provider: support phone=555-0151", "Hosting Provider: website=https://hosting.example.net", "URL (2)=https://srv.example.net", "URL=https://srv.example.net", "username=root"]),
    ("Fixture Router", ["*attached storage password=disk-pass-fixture", "*base station password=router-pass-fixture", "*wireless network password=wifi-pass-fixture", "AirPort ID=00:00:5E:00:53:00", "URL=192.0.2.1", "base station name=base station", "network name=FixtureNet", "server / IP address=192.0.2.1", "wireless security=wpa2p"]),
    ("Fixture Licence", ["Customer: company=Example Ltd", "Customer: licensed to=Alex Example", "Customer: registered email=alex@example.net", "Order: order number=O-1", "Order: purchase date=2022-03-03", "Order: total=19.99", "Publisher: download page=https://dl.example.net", "Publisher: publisher=Example Software", "Publisher: retail price=19.99", "Publisher: support email=support@example.net", "Publisher: website=https://software.example.net", "license key=FX-AAAA-BBBB", "version=1.2.3"]),
    ("Old FTP", ["*password=ftp-pass-fixture", "hostname=ftp.example.net", "port=21", "username=ftpuser"]),
    ("Old MySQL", ["*password=sql-pass-fixture", "database=fx", "hostname=sql.example.net", "username=sqluser"]),
    ("Unknown gadget", ["*Gadget: unlock code=gadget-code-fixture", "Gadget: model=G-1"]),
    ("Fixture SSH key", ["*private key=-----FIXTURE PRIVATE KEY-----", "public key=ssh-ed25519 AAAAFIXTURE alex@example.net"]),
    ("Old Email", ["*pop_password=mail-pass-fixture", "*smtp_password=smtp-legacy-fixture", "pop_port=110", "pop_server=pop.example.net", "pop_type=pop3", "pop_username=mailer", "smtp_authentication=password", "smtp_security=starttls", "smtp_server=smtp.example.net", "smtp_type=custom", "smtp_username=mailer"]),
    ("Old Generic Account", ["*password=gen-pass-fixture", "username=genuser", "website=https://generic.example.net"]),
    ("Old DotMac", ["*password=mac-pass-fixture", "username=macuser"]),
    ("Old Messenger", ["*password=im-pass-fixture", "server=im.example.net", "service=jabber", "username=imuser"]),
    ("Old ISP", ["*password=isp-pass-fixture", "accountno=ISP-1", "phone=555-0160", "server=isp.example.net", "username=ispuser"]),
    ("Old S3", ["*secret_access_key=s3-secret-fixture", "access_key_id=AKIAFIXTUREKEY", "bucket=fixture-bucket"]),
    ("Sample note", ["Notes=Text of the sample note.\nSecond line."]),
    ("Sample password", ["*Password=Sample-pass-only-1", "Notes=notes for the password item", "URL=sample.example.org"]),
    ("Sample login", ["*One-time code=not-valid-base32!", "*Password=Sample-pass-2", "Custom section: custom label=custom value.", "URL=login.example.com", "UserName=sampleuser"]),
    ("Sample card", ["*Password=4000000000000002", "*Security code=456", "Contact Information: issuing bank=Sample Bank", "Expiry=09/31", "UserName=Sample Holder", "Valid from=02/1999"])
    ]
    var vault = try emptyVault()
    for name in ["kinds", "legacy-kinds", "owner-shape"] { try vault.apply(plan(name)) }
    let back = try reopen(vault)
    for row in table {
        guard let node = entry(back, row.title) else { failures += 1; print("FAIL kinds table: \(row.title) is missing"); continue }
        check("kinds table: \(row.title)", readBack(node).joined(separator: "\n"), row.fields.sorted().joined(separator: "\n"))
    }
    check("kinds table: nothing else is in the vault", "\(allEntries(back).count)", "\(table.count)")
    func s(_ title: String) -> Strings { strings(entry(back, title)!) }
    expect("kinds table: membership and reward pins are protected", s("Fixture Membership")["password"]?.protected == true && s("Fixture Rewards")["PIN"]?.protected == true)
    expect("kinds table: both router passwords are protected", s("Fixture Router")["wireless network password"]?.protected == true && s("Fixture Router")["attached storage password"]?.protected == true)
    expect("kinds table: an older kind's secret key is protected", s("Old S3")["secret_access_key"]?.protected == true && s("Old S3")["access_key_id"]?.protected == false)
    check("kinds table: SMTP type, security and authentication are kept", "\(s("Fixture Email Account")["SMTP: type"]?.value ?? "") \(s("Fixture Email Account")["SMTP: security"]?.value ?? "") \(s("Fixture Email Account")["SMTP: authentication"]?.value ?? "")", "custom starttls password")
    check("kinds table: the older email keeps its smtp keys", "\(s("Old Email")["smtp_type"]?.value ?? "") \(s("Old Email")["smtp_security"]?.value ?? "") \(s("Old Email")["smtp_authentication"]?.value ?? "")", "custom starttls password")
    let sections = strings(entry(try { var v = try emptyVault(); try v.apply(plan("sections")); return v }(), "All kinds")!)
    check("sections: email, phone, URL and gender are text", "\(sections["Kinds: Email"]?.value ?? "") \(sections["Kinds: Phone"]?.value ?? "") \(sections["Kinds: URL"]?.value ?? "") \(sections["Kinds: Gender"]?.value ?? "")", "alex@example.net 555-0100 https://example.net female")
    check("sections: a month and year written as text", sections["Kinds: Month year as text"]?.value ?? "", "11/2023")
}

// MARK: XML safety: characters the file cannot hold (D1, D2)

do {
    let hostile = "a\u{FFFE}b\u{FFFF}c\u{0}d\u{1}e\u{8}f\u{B}g\u{C}h\u{E}i\u{1F}j\tk"
    check("xml: the storable text drops what XML 1.0 cannot hold and keeps a tab", XMLTree.storable(hostile), "abcdefghij\tk")
    check("xml: a supplementary character and a line feed are kept", XMLTree.storable("x\u{1F510}\u{1FFFE}y\n"), "x\u{1F510}\u{1FFFE}y\n")
    let node = XNode("A", text: hostile, attributes: [("p", hostile)])
    let tree = try XMLTree.parse(XMLTree.serialize(XNode("R", children: [node])))
    check("xml: the writer's output parses and holds the storable text", "\(tree.child("A")?.text ?? "?") \(tree.child("A")?.attribute("p") ?? "?")", "abcdefghij\tk abcdefghij\tk")

    // A plan with such characters everywhere, applied and read back.
    let small = work.appendingPathComponent("small.txt")
    try Data("small enough\n".utf8).write(to: small)
    let bad = hostilePlan(small)
    var vault = try emptyVault()
    try vault.apply(bad)
    let back = try reopen(vault)
    let node2 = entry(back, "Badtitle")!
    let keys = node2.children(named: "String").compactMap { $0.child("Key")?.text }
    check("xml: every key is unique after cleaning", "\(Set(keys).count) \(keys.count)", "\(keys.count) \(keys.count)")
    let s = strings(node2)
    check("xml: the fields read back clean", "\(s["UserName"]?.value ?? "") \(s["Password"]?.value ?? "") \(s["URL"]?.value ?? "") \(s["Notes"]?.value ?? "")", "user pass bad.example.com notes")
    check("xml: labels that meet after cleaning get suffixes, and a reserved one moves", ["Label", "Label (2)", "Title (2)", "Notes (2)", "Field: KPH:x", "Field"].map { s[$0]?.value ?? "-" }.joined(separator: ","), "one,two,three,four,five,six")
    check("xml: tags, source, group and attachment names are clean", "\(node2.child("Tags")?.text ?? "") \(KeePassImport.sourceID(of: node2) ?? "") \(back.rootGroup!.children(named: "Group").first?.child("Name")?.text ?? "") \(node2.children(named: "Binary").compactMap { $0.child("Key")?.text }.joined(separator: ","))", "tag test:bad1 Folder a.txt,a (2).txt")

    // The same through a 1PIF, where the text arrives as JSON escapes.
    let folder = try writeExport("hostile", [noteJSON(1, "Note\\ufffetitle", notes: "body\\u0001text", extra: ",\"sections\":[{\"title\":\"Sec\\ufffe\",\"name\":\"s\",\"fields\":[{\"k\":\"string\",\"n\":\"a\",\"v\":\"v\\ufffe1\",\"t\":\"Lab\\ufffeel\"},{\"k\":\"string\",\"n\":\"b\",\"v\":\"v2\",\"t\":\"Label\"}]},{\"title\":\"Sec\",\"name\":\"t\",\"fields\":[{\"k\":\"string\",\"n\":\"c\",\"v\":\"v3\",\"t\":\"Label\"}]}]")])
    let hp = try OnePasswordPIF.plan(from: folder, now: now)
    check("xml: a 1PIF with such characters reads clean", "\(hp.items[0].title) \(hp.items[0].first(.notes) ?? "")", "Notetitle bodytext")
    check("xml: and its labels are unique", hp.items[0].fields.filter { $0.role == .custom }.map(\.label).sorted().joined(separator: ","), "Sec: Label,Sec: Label (2),Sec: Label (3)")
    var hv = try emptyVault()
    try hv.apply(hp)
    check("xml: and the file opens", "\(try reopen(hv).items().count)", "1")

    // The second line of defence: what was written is read back before the vault changes. A group path deeper than the codec
    // reads is something no cleaning prevents, and it would have made a file that does not open.
    var deep = bad
    deep.items[0].folder = Array(repeating: "g", count: 70)
    var guarded = try emptyVault()
    let treeBefore = XMLTree.serialize(guarded.root)
    expectThrows("xml: a vault the codec could not read back is refused", .unreadableResult) { _ = try guarded.apply(deep) }
    check("xml: and the document is as it was", XMLTree.serialize(guarded.root) == treeBefore ? "same" : "changed", "same")
}

// MARK: Dates and numbers that must never trap (D3)

do {
    typealias V = PlanBuilder.Value
    check("numbers: huge and special values are no date", [1e30, 1e300, Double.infinity, -Double.infinity, Double.nan].map { "\(V.stamp($0))" }.joined(separator: ","), "invalid,invalid,invalid,invalid,invalid")
    check("numbers: text of the same", ["inf", "nan", "1e30", "-inf"].map { "\(V.stamp($0))" }.joined(separator: ","), "invalid,invalid,invalid,invalid")
    check("numbers: the edges of year 1 and 9999", "\(V.stamp(253_402_300_799.0)) \(V.stamp(253_402_300_800.0))", "ok(\(Date(timeIntervalSince1970: 253_402_300_799))) invalid")
    check("numbers: zero, a negative and null are missing, not invalid", "\(V.stamp(0)) \(V.stamp(-5)) \(V.stamp(NSNull())) \(V.stamp(nil))", "missing missing missing missing")
    check("numbers: months are 1 to 12 and years 1 to 9999", "\(String(describing: V.yearMonth(202412))) \(String(describing: V.yearMonth(202413))) \(String(describing: V.yearMonth(1e30))) \(String(describing: V.yearMonth("nan"))) \(String(describing: V.yearMonth(99999999999999999)))", "Optional((2024, 12)) nil nil nil nil")
    check("numbers: a day is a day or nothing", "\(V.day(9223372036854775807) ?? "nil") \(V.day(9.3e18) ?? "nil") \(V.day(0) ?? "nil") \(V.day(-62135596800) ?? "nil") \(V.day("inf") ?? "nil")", "nil nil 1970-01-01 0001-01-01 nil")
    check("numbers: the writer's time text clamps instead of trapping", "\(shown(Date(timeIntervalSince1970: 1e300))) \(shown(Date(timeIntervalSince1970: .nan))) \(KeePassTime.date(ImportTime.iso(Date(timeIntervalSince1970: -1e300)))?.timeIntervalSince1970 ?? 1)", "9999-12-31T23:59:59Z 1970-01-01T00:00:00Z -62135596800.0")

    let p = try plan("extremes")
    check("extremes: every record is read", "\(p.items.count) \(p.skipped.unreadable)", "12 0")
    let both = item(p, "Huge dates")!
    check("extremes: two absurd dates become the import time and say so", "\(both.created == now) \(both.modified == now) \(both.issues.map(\.detail).joined())", "true true the creation and last edit dates were missing or not valid dates, so the time of the import was used instead")
    let one = item(p, "Huge created only")!
    check("extremes: one absurd date takes the other, in the words of the report", "\(one.created.timeIntervalSince1970) \(one.issues.map(\.detail).joined())", "1700500000.0 the creation date was missing or not a valid date, so the last edit date was used instead")
    check("extremes: they count as missing", "\(p.missingDates)", "2")
    let history = item(p, "History times")!
    check("extremes: history keeps every password, with unusable times replaced by the edit time", history.history.map { "\($0.password):\($0.date.timeIntervalSince1970)" }.joined(separator: ","),
          "h-good:1699000000.0,h-huge:1700500000.0,h-inf:1700500000.0,h-nan:1700500000.0,h-none:1700500000.0")
    check("extremes: that is one issue with a count", history.issues.map(\.detail).joined(), "4 earlier passwords have no valid date, so the last edit date was used for them")
    func raw(_ title: String, _ label: String) -> String { item(p, title)!.fields.first { $0.label == label }.map { "\($0.value) \($0.concealed)" } ?? "none" }
    for (title, label, value) in [("Card nan", "Expiry date", "nan/2027"), ("Card inf", "Expiry date", "inf/2027"), ("Card huge month", "Expiry date", "1e+30/2027"), ("Card huge year", "Expiry date", "12/99999999999999999"),
                                  ("Card month 13", "Expiry date", "13/2027"), ("Card section huge", "expiry date", "1e+30"), ("Card section month 13", "expiry date", "202713")] {
        check("extremes: \(title) keeps the text as a plain field", raw(title, label), "\(value) false")
        check("extremes: \(title) has no expiry and says so", "\(item(p, title)!.first(.expiry) == nil) \(issueCount(item(p, title)!.issues, .unreadableValue))", "true 1")
    }
    check("extremes: a two-digit year is this century", item(p, "Card two-digit year")!.first(.expiry) ?? "", "07/29")
    let dates = item(p, "Date extremes")!
    func d(_ label: String) -> String { dates.fields.first { $0.label == "Dates: \(label)" }?.value ?? "none" }
    check("extremes: dates outside years 1 to 9999 or unreadable stay as written", ["int64 max", "huge", "below year 1", "year 10000", "text", "infinity"].map(d).joined(separator: " | "),
          "9223372036854775807 | 9.3e+18 | -62135596801 | 253402300800 | not a date | inf")
    check("extremes: and each is reported", "\(issueCount(dates.issues, .unreadableValue))", "6")
    check("extremes: a date of 0 with a value stays a date, as do the first and last day", "\(d("zero")) \(d("first day")) \(d("last second"))", "1970-01-01 0001-01-01 9999-12-31")
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    check("extremes: all of it is written and opens", "\(try reopen(vault).items().count) \(summary.addedCount)", "12 12")
}

// MARK: Files that are not files (D4)

do {
    // The data file is a FIFO: nothing is writing to it, so reading it would wait for ever.
    let fifoFolder = work.appendingPathComponent("fifo-export.1pif")
    try fm.createDirectory(at: fifoFolder, withIntermediateDirectories: true)
    let fifo = fifoFolder.appendingPathComponent("data.1pif")
    check("files: a FIFO is made", "\(mkfifo(fifo.path, 0o600))", "0")
    check("files: a FIFO as data.1pif is not an export, and does not hang", timed("fifo in folder", outcome(of: fifoFolder)), "notAnExport")
    check("files: a FIFO chosen directly is not an export either", timed("fifo picked", outcome(of: fifo)), "notAnExport")

    // A link to /dev/zero would never end.
    let zeroLinkFolder = work.appendingPathComponent("zero-link.1pif")
    try fm.createDirectory(at: zeroLinkFolder, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: zeroLinkFolder.appendingPathComponent("data.1pif").path, withDestinationPath: "/dev/zero")
    check("files: data.1pif linked to /dev/zero is not an export, and does not hang", timed("dev zero in folder", outcome(of: zeroLinkFolder)), "notAnExport")
    let zeroPicked = work.appendingPathComponent("zero-picked.1pif")
    try fm.createSymbolicLink(atPath: zeroPicked.path, withDestinationPath: "/dev/zero")
    check("files: a chosen link to /dev/zero is not an export, and does not hang", timed("dev zero picked", outcome(of: zeroPicked)), "notAnExport")
    check("files: /dev/null as the chosen file is not an export", timed("dev null", outcome(of: URL(fileURLWithPath: "/dev/null"))), "notAnExport")

    // A socket.
    let socketPath = work.appendingPathComponent("s.sock").path
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(socketPath.utf8CString)
    withUnsafeMutablePointer(to: &address.sun_path) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: 104) { target in for (index, byte) in bytes.enumerated() where index < 104 { target[index] = byte } }
    }
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    close(descriptor)
    if bound == 0 { check("files: a socket is not an export", timed("socket", outcome(of: URL(fileURLWithPath: socketPath))), "notAnExport") } else { print("skip socket: could not make one") }

    // The same for a CSV, which the importer picks by what the file is called.
    let csvFifo = work.appendingPathComponent("pipe.csv")
    check("files: a FIFO called .csv is made", "\(mkfifo(csvFifo.path, 0o600))", "0")
    check("files: a FIFO as a CSV is not read, and does not hang", timed("csv fifo", { do { _ = try ImportSources.plan(from: csvFifo); return "read" } catch { return "\(error)" } }), "notAnExport")
    let csvZero = work.appendingPathComponent("zero.csv")
    try fm.createSymbolicLink(atPath: csvZero.path, withDestinationPath: "/dev/zero")
    check("files: a link to /dev/zero as a CSV is not read, and does not hang", timed("csv zero", { do { _ = try ImportSources.plan(from: csvZero); return "read" } catch { return "\(error)" } }), "notAnExport")

    // A directory called data.1pif.
    let dirFolder = work.appendingPathComponent("dir-export.1pif")
    try fm.createDirectory(at: dirFolder.appendingPathComponent("data.1pif"), withIntermediateDirectories: true)
    check("files: a folder named data.1pif is not an export", timed("dir", outcome(of: dirFolder)), "notAnExport")

    // At most one link, and only to a regular file inside the export folder.
    let linked = try writeExport("linked", [noteJSON(1, "Through a link")])
    try fm.moveItem(at: linked.appendingPathComponent("data.1pif"), to: linked.appendingPathComponent("real.dat"))
    try fm.createSymbolicLink(atPath: linked.appendingPathComponent("data.1pif").path, withDestinationPath: "real.dat")
    check("files: data.1pif as one link to a file in the folder is read", timed("one link", outcome(of: linked)), "plan with 1 items")
    let chained = work.appendingPathComponent("chained.1pif")
    try fm.createDirectory(at: chained, withIntermediateDirectories: true)
    try fm.copyItem(at: linked.appendingPathComponent("real.dat"), to: chained.appendingPathComponent("real.dat"))
    try fm.createSymbolicLink(atPath: chained.appendingPathComponent("middle.dat").path, withDestinationPath: "real.dat")
    try fm.createSymbolicLink(atPath: chained.appendingPathComponent("data.1pif").path, withDestinationPath: "middle.dat")
    check("files: two links in a row are not followed", timed("two links", outcome(of: chained)), "notAnExport")
    let outside = work.appendingPathComponent("outside.dat")
    try fm.copyItem(at: linked.appendingPathComponent("real.dat"), to: outside)
    let leaving = work.appendingPathComponent("leaving.1pif")
    try fm.createDirectory(at: leaving, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: leaving.appendingPathComponent("data.1pif").path, withDestinationPath: "../outside.dat")
    check("files: a link out of the folder is not followed", timed("link out", outcome(of: leaving)), "notAnExport")
    let loop = work.appendingPathComponent("loop.1pif")
    try fm.createDirectory(at: loop, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: loop.appendingPathComponent("data.1pif").path, withDestinationPath: "data.1pif")
    check("files: a link to itself is not an export", timed("loop", outcome(of: loop)), "notAnExport")

    // Size is enforced by what is read, as well as by what the file says.
    var small = OnePasswordPIF.Limits()
    small.dataFileBytes = 64
    check("files: a data file over the limit is too large", timed("too large", outcome(of: linked, limits: small)), "tooLarge")
}

// MARK: Text outside UTF-8 (D5) and lines that are too long (D6)

do {
    let p = try plan("encoding")
    check("encoding: no record is lost to an undefined byte", "\(p.items.count) \(p.skipped.unreadable)", "4 0")
    check("encoding: an undefined byte becomes U+FFFD and the record stays", item(p, "Undefined bytes")!.first(.notes) ?? "", "a\u{FFFD}b\u{FFFD}c\u{FFFD}d\u{FFFD}e\u{FFFD}f")
    check("encoding: the defined bytes are read", item(p, "Defined bytes")!.first(.notes) ?? "", "caf\u{e9} \u{20AC} \u{2122}")
    check("encoding: the title of the same record is read as well", item(p, "More undefined")?.first(.notes) ?? "", "x\u{FFFD}y")
    check("encoding: two reports, each once", p.issues.filter { $0.kind == .textEncoding }.map(\.detail).joined(separator: " | "),
          "the file is not saved as UTF-8, so it was read as Windows text and accented or special characters may look different | some characters could not be read and are shown as a replacement mark (\u{FFFD})")
    check("encoding: the decoder alone", "\(Windows1252.decode(Data([0x41, 0x81, 0x9F, 0xFF, 0x80])).text) \(Windows1252.decode(Data([0x8D, 0x8F, 0x90, 0x9D])).undefined)", "A\u{FFFD}\u{178}\u{FF}\u{20AC} 4")
    let csv = work.appendingPathComponent("windows.csv")
    try Data([UInt8]("Title,Url,Username,Password\n\"Caf".utf8) + [0xE9, 0x81] + [UInt8]("\",\"x.example.com\",\"u\",\"p\"\n".utf8)).write(to: csv)
    let cp = try CSVSource.plan(from: csv, now: now)
    check("encoding: a CSV with an undefined byte is read too", "\(cp.items.count) \(cp.items[0].title)", "1 Caf\u{e9}\u{FFFD}")

    // One line over the limit and nothing else is a line problem, in words that say so.
    var limits = OnePasswordPIF.Limits()
    limits.lineBytes = 1024 * 1024
    let longFolder = try writeExport("long-line", [noteJSON(1, "Long", notes: String(repeating: "x", count: 1_200_000))])
    expectThrows("long line: a single line over the limit says the line is too long", .lineTooLong(1)) { _ = try OnePasswordPIF.plan(from: longFolder, limits: limits, now: now) }
    check("long line: and the message says so", ImportError.lineTooLong(1).message.contains("longer than 1 MB") ? "yes" : "no", "yes")
    let mixed = try writeExport("long-and-short", [noteJSON(1, "Long", notes: String(repeating: "x", count: 1_200_000)), noteJSON(2, "Short")])
    let mp = try OnePasswordPIF.plan(from: mixed, limits: limits, now: now)
    check("long line: with a good record beside it the import goes on and names the limit", "\(mp.items.count) \(mp.issues.first { $0.kind == .lineTooLong }?.detail ?? "")", "1 line 1 of the file is longer than 1 MB, so it was skipped")
}

// MARK: Attachments that are links, folders and pipes (D8, D9)

do {
    // The links are made here, in a copy under build/, since a committed link is a trap for tools that copy or scan the folder.
    let copy = work.appendingPathComponent("attachments-copy.1pif")
    try? fm.removeItem(at: copy)
    try fm.copyItem(at: fixtures.appendingPathComponent("attachments"), to: copy)
    let folder = copy.appendingPathComponent("attachments/\(uid(0x9004))")
    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: folder.appendingPathComponent("link-out.txt").path, withDestinationPath: "../../data.1pif")
    try fm.createSymbolicLink(atPath: folder.appendingPathComponent("link-absolute.txt").path, withDestinationPath: "/etc/hosts")
    try fm.createSymbolicLink(atPath: folder.appendingPathComponent("loop.txt").path, withDestinationPath: "loop.txt")
    try fm.createSymbolicLink(atPath: folder.appendingPathComponent("link-in.txt").path, withDestinationPath: "../\(uid(0x9001))/report.txt")
    try fm.createSymbolicLink(atPath: folder.appendingPathComponent("chain.txt").path, withDestinationPath: "link-in.txt")
    try fm.createDirectory(at: folder.appendingPathComponent("nested"), withIntermediateDirectories: true)
    try Data("inside a nested folder\n".utf8).write(to: folder.appendingPathComponent("nested/inner.txt"))
    check("links: a pipe is made", "\(mkfifo(folder.appendingPathComponent("pipe").path, 0o600))", "0")
    var limits = OnePasswordPIF.Limits()
    limits.attachmentBytes = 2048
    let frozen = limits
    let p = timed("links plan", { do { let p = try OnePasswordPIF.plan(from: copy, limits: frozen, now: Date(timeIntervalSince1970: 1_800_000_000)); return p.items.first { $0.title == "Links" }.map { "\($0.attachments.map(\.name).joined(separator: ",")) | " + $0.issues.map { "\($0.kind.rawValue): \($0.detail)" }.sorted().joined(separator: " | ") } ?? "no item" } catch { return "\(error)" } })
    check("links: one link inside the folder is an attachment, the rest are refused or skipped, one issue each kind", p,
          "link-in.txt | attachmentRejected: 6 attachments were not imported because they are not ordinary files inside the export folder")

    // Mode 000: the plan lists it, applying says which file could not be read and changes nothing.
    let locked = try writeExport("locked", [noteJSON(1, "Locked file")], files: ["attachments/\(uid(1))/secret.txt": Data("locked down\n".utf8)])
    let lockedFile = locked.appendingPathComponent("attachments/\(uid(1))/secret.txt")
    try fm.setAttributes([.posixPermissions: NSNumber(value: 0)], ofItemAtPath: lockedFile.path)
    defer { try? fm.setAttributes([.posixPermissions: NSNumber(value: 0o644)], ofItemAtPath: lockedFile.path) }
    let lp = try OnePasswordPIF.plan(from: locked, now: now)
    check("links: an unreadable attachment is still listed", "\(lp.items[0].attachments.map(\.name))", "[\"secret.txt\"]")
    var lv = try emptyVault()
    let lockedBefore = XMLTree.serialize(lv.root)
    expectThrows("links: applying it names the file and adds nothing", .attachmentUnreadable("secret.txt")) { _ = try lv.apply(lp) }
    check("links: the vault is as it was", XMLTree.serialize(lv.root) == lockedBefore ? "same" : "changed", "same")

    // Only a pipe next to a real file: one attachment skipped, said once with the count, and a folder that is itself a link.
    let pipeOnly = try writeExport("pipe-only", [noteJSON(1, "Pipe only"), noteJSON(2, "Linked folder")], files: ["attachments/\(uid(1))/real.txt": Data("x".utf8), "attachments/\(uid(3))/other.txt": Data("y".utf8)])
    check("links: a pipe is made next to a real file", "\(mkfifo(pipeOnly.appendingPathComponent("attachments/\(uid(1))/pipe").path, 0o600))", "0")
    try fm.createSymbolicLink(atPath: pipeOnly.appendingPathComponent("attachments/\(uid(2))").path, withDestinationPath: "\(uid(3))")
    let pp = try OnePasswordPIF.plan(from: pipeOnly, now: now)
    check("links: a pipe next to a file is one skipped attachment, said with the count", details(pp.summary, .attachmentSkipped),
          "Pipe only: 1 attachment was not imported because it is not an ordinary file inside the export folder | Linked folder: some attachments were not imported because they are not ordinary files inside the export folder")

    // Many refusals are one issue per item with a count.
    let many = try writeExport("many-files", [noteJSON(1, "Many files")], files: Dictionary(uniqueKeysWithValues: (0..<6).map { ("attachments/\(uid(1))/f\($0).bin", Data(repeating: UInt8($0), count: 3000)) }))
    var tiny = OnePasswordPIF.Limits()
    tiny.attachmentBytes = 2048
    let mp = try OnePasswordPIF.plan(from: many, limits: tiny, now: now)
    check("many: six refused files are one issue with the number and the limit", "\(mp.items[0].issues.count) \(mp.items[0].issues.first?.detail ?? "")", "1 6 attachments are larger than the limit of 2048 bytes each, so they were not imported")

    // File names with two dots in a row are names, nothing more.
    let dp = try plan("dotted-names")
    check("dots: names with .. are read as names", dp.items[0].attachments.map(\.name).sorted().joined(separator: " | "), "..keep.txt | a..b.txt | end..")
    var dv = try emptyVault()
    try dv.apply(dp)
    check("dots: and stored under those names", entry(dv, "Dotted names")!.children(named: "Binary").compactMap { $0.child("Key")?.text }.sorted().joined(separator: " | "), "..keep.txt | a..b.txt | end..")
}

// MARK: Reading what 1Password writes loosely (D10, D12)

do {
    let dates = try writeExport("dates", [noteJSON(1, "No creation", created: nil), noteJSON(2, "No edit", updated: nil), noteJSON(3, "Neither", created: nil, updated: nil)])
    let dp = try OnePasswordPIF.plan(from: dates, now: now)
    check("dates: the missing creation date is said in plain words", item(dp, "No creation")!.issues.map(\.detail).joined(), "the creation date was missing or not a valid date, so the last edit date was used instead")
    check("dates: and the missing edit date", item(dp, "No edit")!.issues.map(\.detail).joined(), "the last edit date was missing or not a valid date, so the creation date was used instead")
    check("dates: and both", item(dp, "Neither")!.issues.map(\.detail).joined(), "the creation and last edit dates were missing or not valid dates, so the time of the import was used instead")

    // Tags with the separators of the vault file.
    let tags = try writeExport("tags", [noteJSON(1, "Tags", extra: "", created: 1_700_000_000).replacingOccurrences(of: "\"secureContents\"", with: "\"openContents\":{\"tags\":[\"a;b\",\"c,d\",\"plain\"]},\"secureContents\"")])
    let tp = try OnePasswordPIF.plan(from: tags, now: now)
    check("tags: ; and , become a space", item(tp, "Tags")!.tags.joined(separator: "|"), "a b|c d|plain")
    check("tags: and the plan says so once", tp.issues.filter { $0.kind == .tagsChanged }.map(\.detail).joined(), "2 tags contained a semicolon or comma, which a tag cannot hold, so each was replaced with a space")
    var tv = try emptyVault()
    try tv.apply(tp)
    check("tags: the file keeps three tags", entry(tv, "Tags")!.child("Tags")?.text ?? "", "a b;c d;plain")

    // Codes: the second keeps a name of its own.
    func totp(_ n: Int, _ secret: String, title: String = "one-time password") -> String { "{\"k\":\"concealed\",\"n\":\"TOTP_\(uid(n))\",\"v\":\"\(secret)\",\"t\":\"\(title)\"}" }
    let codes = try writeExport("three-codes", [loginJSON(1, "Three codes", user: "u", password: "p", site: "three.example.com", extra: ",\"sections\":[{\"title\":\"\",\"name\":\"\",\"fields\":[\(totp(1, "JBSWY3DPEHPK3PXP")),\(totp(2, "GEZDGNBVGY3TQOJQ"))]},{\"title\":\"Spare\",\"name\":\"x\",\"fields\":[\(totp(3, "MFRGGZDFMZTWQ2LK"))]}]")])
    let cp = try OnePasswordPIF.plan(from: codes, now: now)
    var cv = try emptyVault()
    try cv.apply(cp)
    let cs = strings(entry(cv, "Three codes")!)
    check("codes: the first is the code, the others keep a name", "\(vaultItem(cv, titled: "Three codes")!.otpSecret) \(cs["One-time code 2"]?.value ?? "-") \(cs["One-time code (Spare)"]?.value ?? "-")", "JBSWY3DPEHPK3PXP GEZDGNBVGY3TQOJQ MFRGGZDFMZTWQ2LK")
    check("codes: the extra ones are hidden fields", "\(cs["One-time code 2"]?.protected ?? false) \(cs["One-time code (Spare)"]?.protected ?? false)", "true true")

    // An address object with more than the usual parts, nested.
    let address = try writeExport("address", [noteJSON(1, "Address", extra: ",\"sections\":[{\"title\":\"Home\",\"name\":\"h\",\"fields\":[{\"k\":\"address\",\"n\":\"a\",\"v\":{\"street\":\"1 A St\",\"city\":\"Town\",\"extra\":\"x\",\"geo\":{\"lat\":\"1\",\"lng\":\"2\"},\"zip\":\"Z\"},\"t\":\"address\"}]}]")])
    let ap = try OnePasswordPIF.plan(from: address, now: now)
    check("address: known parts first, every other part as key: value, nested ones flattened", item(ap, "Address")!.fields.first { $0.label == "Home: address" }?.value ?? "", "1 A St\nTown\nZ\nextra: x\ngeo.lat: 1\ngeo.lng: 2")

    // A numeric category is the same as its three-digit form.
    func windows(_ category: String) -> String {
        "{\"category\":\(category),\"uuid\":\"\(uid(9))\",\"created\":1700000000,\"updated\":1700500000,\"overview\":{\"title\":\"Windows password\",\"URLs\":[{\"u\":\"winpass.example.com\",\"l\":\"\"}],\"tags\":[]},\"details\":{\"password\":\"win-only-password\"}}"
    }
    let numeric = try OnePasswordPIF.plan(from: try writeExport("category-number", [windows("5")]), now: now)
    let padded = try OnePasswordPIF.plan(from: try writeExport("category-text", [windows("\"005\"")]), now: now)
    check("category: 5 and \"005\" are the same item", "\(numeric.items[0].kind) \(numeric.items[0].password) | \(padded.items[0].kind) \(padded.items[0].password)", "login win-only-password | login win-only-password")
}

// MARK: Updates and merges (the two new rules)

do {
    // The same identifier with other content updates in place.
    var vault = try emptyVault()
    let first = try plan("logins")
    try vault.apply(first)
    var node = entry(vault, "Example Mail")!
    // The person adds a field of their own, changes the notes and keeps another website.
    node.children.insert(XNode("String", children: [XNode("Key", text: "My own field"), XNode("Value", text: "kept")]), at: node.children.lastIndex { $0.name == "String" }! + 1)
    var changed = first
    changed.items[0].fields = changed.items[0].fields.map { var f = $0; if f.role == .password { f.value = "Alpha-pass-2" }; return f }
    let preview = vault.preview(changed)
    let update = try vault.apply(changed)
    check("update: preview and apply agree", summaryLine(preview), summaryLine(update))
    check("update: one updated, one unchanged", summaryLine(update), "added 0 updated 1 merged 0 skipped 1 similar 0")
    node = entry(vault, "Example Mail")!
    check("update: the new password is written", strings(node)["Password"]?.value ?? "", "Alpha-pass-2")
    check("update: the previous version is in the history", "\(historyPasswords(node))", "[\"Alpha-pass-1\"]")
    check("update: a field Psss added is kept", strings(node)["My own field"]?.value ?? "", "kept")
    check("update: nothing the person had changed was overwritten, so there is no issue", "\(issueCount(update.issues, .updatedOverwrote))", "0")
    check("update: the same entry, not a new one", "\(allEntries(vault).count)", "2")
    check("update: the source is unchanged", KeePassImport.sourceID(of: node) ?? "", "1password:\(uid(0x1001))")
    let again = try vault.apply(changed)
    check("update: the same content again is skipped (idempotent)", summaryLine(again), "added 0 updated 0 merged 0 skipped 2 similar 0")
    check("update: and nothing was added to the history", "\(historyPasswords(entry(vault, "Example Mail")!).count)", "1")

    // A field the person changed and the source changed too is overwritten, and the item is named.
    entry(vault, "Example Mail")!.children.first { $0.name == "String" && $0.child("Key")?.text == "Notes" }!.child("Value")!.text = "my own notes"
    var third = changed
    third.items[0].fields = third.items[0].fields.map { var f = $0; if f.role == .notes { f.value = "notes from the source" }; return f }
    let overwrite = try vault.apply(third)
    check("update: a field changed in both places is overwritten and the item is named", overwrite.issues.filter { $0.kind == .updatedOverwrote }.map { "\($0.item ?? "-"): \($0.detail)" }.joined(),
          "Example Mail: it changed in 1Password, so your edit to Notes here was replaced with the new value. The earlier value is in the history of this item.")
    check("update: with the source's value", strings(entry(vault, "Example Mail")!)["Notes"]?.value ?? "", "notes from the source")
    check("update: and the version that had the person's notes is in the history", "\(historyPasswords(entry(vault, "Example Mail")!).count)", "2")
    // A field the person changed and the source did not is left alone.
    entry(vault, "Example Mail")!.children.first { $0.name == "String" && $0.child("Key")?.text == "UserName" }!.child("Value")!.text = "changed-by-person"
    var fourth = third
    fourth.items[0].fields = fourth.items[0].fields.map { var f = $0; if f.role == .password { f.value = "Alpha-pass-3" }; return f }
    let kept = try vault.apply(fourth)
    check("update: a field only the person changed is kept", "\(strings(entry(vault, "Example Mail")!)["UserName"]?.value ?? "") \(strings(entry(vault, "Example Mail")!)["Password"]?.value ?? "") \(issueCount(kept.issues, .updatedOverwrote))", "changed-by-person Alpha-pass-3 0")
    // It survives a save, and the second import after a save is still quiet.
    let saved = try reopen(vault)
    check("update: after a save the same plan changes nothing", "\(saved.preview(fourth).itemCount)", "0")

    // Tags follow the source, and the ones the person added stay.
    var tagged = try emptyVault()
    var tagPlan = ImportPlan(source: .onePasswordPIF)
    tagPlan.items = [ImportItem(sourceID: "1password:T", kind: .note, title: "Tagged", fields: [ImportField(.notes, value: "n")], tags: ["one", "two"], created: now, modified: now)]
    try tagged.apply(tagPlan)
    entry(tagged, "Tagged")!.child("Tags")!.text = "one;two;mine"
    tagPlan.items[0].tags = ["two", "three"]
    tagPlan.items[0].fields = [ImportField(.notes, value: "n2")]
    try tagged.apply(tagPlan)
    check("update: tags the source dropped go, the source's new ones come, the person's stay", entry(tagged, "Tagged")!.child("Tags")?.text ?? "", "two;mine;three")

    // A field the source dropped is removed unless the person changed it.
    var dropped = try emptyVault()
    var dropPlan = ImportPlan(source: .onePasswordPIF)
    dropPlan.items = [ImportItem(sourceID: "1password:D", kind: .note, title: "Dropped", fields: [ImportField(.notes, value: "n"), ImportField(.custom, label: "Gone", value: "g"), ImportField(.custom, label: "Edited", value: "e")], created: now, modified: now)]
    try dropped.apply(dropPlan)
    entry(dropped, "Dropped")!.children.first { $0.name == "String" && $0.child("Key")?.text == "Edited" }!.child("Value")!.text = "edited by person"
    dropPlan.items[0].fields = [ImportField(.notes, value: "n")]
    dropPlan.items[0].title = "Dropped"
    dropPlan.items[0].tags = ["new"]
    try dropped.apply(dropPlan)
    check("update: a dropped field is removed, an edited one stays", readBack(entry(dropped, "Dropped")!).joined(separator: " | "), "Edited=edited by person | Notes=n")

    // A merge: a hand-made login with the same credentials gets what it lacked, and never loses what it has.
    var merge = try emptyVault()
    merge.upsert(VaultItem(kind: .login, title: "My own title", account: "hist", website: "https://hist.example.com/login", secret: "current-a", notes: "my notes"))
    let hist = try plan("history")
    let mergePreview = merge.preview(hist)
    let mergeSummary = try merge.apply(hist)
    check("merge: preview and apply agree", summaryLine(mergePreview), summaryLine(mergeSummary))
    check("merge: the login merged and the other two were added", summaryLine(mergeSummary), "added 2 updated 0 merged 1 skipped 0 similar 0")
    let mine = entry(merge, "My own title")!
    check("merge: the title stays, no copy is made of the other one, and one line says which were removed",
          "\(strings(mine)["Title"]?.value ?? "-") | \(strings(mine)["Title (1Password)"]?.value ?? "-") | \(mergeSummary.issues.filter { $0.kind == .mergeConflict }.count)",
          "My own title | - | 0")
    check("merge: the same site with another path is not a conflict, and the notes stay", "\(strings(mine)["URL"]?.value ?? "-") \(strings(mine)["URL (1Password)"] == nil) \(strings(mine)["Notes"]?.value ?? "-")", "https://hist.example.com/login true my notes")
    check("merge: the password is the one both had", strings(mine)["Password"]?.value ?? "", "current-a")
    check("merge: the older passwords come in, and the version before the merge is the newest record", "\(historyPasswords(mine))", "[\"old-a1\", \"old-a2\", \"current-a\"]")
    check("merge: the source is the 1Password identifier", KeePassImport.sourceID(of: mine) ?? "", "1password:\(uid(0x7001))")
    check("merge: the creation date is the earlier one", mine.child("Times")?.child("CreationTime")?.text ?? "", iso(1_700_000_000 - 5_000_000))
    let mergeAgain = try merge.apply(hist)
    check("merge: the same import again changes nothing", summaryLine(mergeAgain), "added 0 updated 0 merged 0 skipped 3 similar 0")
    check("merge: it survives a save", "\(try reopen(merge).items().count)", "3")

    // A merge adds attachments, and keeps the entry's own values when they differ.
    var withFiles = try emptyVault()
    withFiles.upsert(VaultItem(kind: .login, title: "Hand made", account: "att", website: "att.example.com", secret: "att-pass"))
    let attached = try plan("attachments", limits: attachmentLimits)
    let attachedSummary = try withFiles.apply(attached)
    check("merge: the login with the same credentials merged and the others were added", summaryLine(attachedSummary), "added 5 updated 0 merged 1 skipped 0 similar 0")
    check("merge: its attachments came in", "\(entry(withFiles, "Hand made")!.children(named: "Binary").compactMap { $0.child("Key")?.text }.sorted()) \(attachedSummary.attachments)", "[\"copy of report.txt\", \"report.txt\"] 4")
    check("merge: and the bytes are stored once", "\(withFiles.binaries.count)", "3")
    check("merge: the preview of the same plan afterwards finds nothing to do", "\(withFiles.preview(attached).itemCount)", "0")

    // The store applies a merge as a change worth saving.
    var gate = ImportPlan(source: .onePasswordPIF)
    gate.items = [ImportItem(sourceID: "1password:G", kind: .login, title: "Gate", fields: [ImportField(.username, value: "g"), ImportField(.password, value: "gp"), ImportField(.website, value: "gate.example.com")], created: now, modified: now)]
    var gateVault = try emptyVault()
    gateVault.upsert(VaultItem(kind: .login, title: "Gate", account: "g", website: "gate.example.com", secret: "gp"))
    let gateSummary = try gateVault.apply(gate)
    check("merge: a merge alone counts as a change, so the store would write it", "\(gateSummary.itemCount) \(gateSummary.addedCount) \(gateSummary.merged)", "1 0 1")
}

// MARK: Round 3: secrets, links, nesting, identifiers, bytes, surrogates, salting and the nine behaviours

func mk(_ id: String?, _ title: String, user: String = "u", password: String = "p", site: String? = "site.example.net", folder: [String] = [],
        tags: [String] = [], extra: [ImportField] = [], attachments: [ImportAttachment] = []) -> ImportItem {
    var fields = [ImportField(.username, value: user), ImportField(.password, value: password, concealed: true)]
    if let site { fields.append(ImportField(.website, value: site)) }
    return ImportItem(sourceID: id, kind: .login, title: title, fields: fields + extra, tags: tags, folder: folder, created: now, modified: now, attachments: attachments)
}
func planOf(_ items: [ImportItem]) -> ImportPlan {
    var p = ImportPlan(source: .onePasswordPIF)
    p.importedAt = now
    p.items = items
    return p
}
func groupPath(_ document: KDBXDocument, _ title: String) -> String {
    KeePassImport.known(in: document).first { EntryMapping.string($0.node, "Title") == title }.map { $0.path.joined(separator: "/") } ?? "missing"
}
func moveEntry(_ document: KDBXDocument, _ title: String, toGroup name: String) {
    guard let known = KeePassImport.known(in: document).first(where: { EntryMapping.string($0.node, "Title") == title }), let root = document.rootGroup else { return }
    known.parent.children.removeAll { $0 === known.node }
    let group = root.children(named: "Group").first { $0.child("Name")?.text == name } ?? {
        let node = XNode("Group", children: [XNode("UUID", text: UUID().kdbxBase64), XNode("Name", text: name)])
        root.children.append(node)
        return node
    }()
    group.children.append(known.node)
}
func moveToBin(_ document: KDBXDocument, _ title: String) {
    guard let meta = document.root.child("Meta") else { return }
    let id = UUID().kdbxBase64
    let bin = XNode("Group", children: [XNode("UUID", text: id), XNode("Name", text: "Recycle Bin")])
    document.rootGroup?.children.append(bin)
    meta.setChildText("RecycleBinUUID", id)
    meta.setChildText("RecycleBinEnabled", "True")
    moveEntry(document, title, toGroup: "Recycle Bin")
}
func tagsOf(_ document: KDBXDocument, _ title: String) -> String { entry(document, title)?.child("Tags")?.text ?? "" }
func binaryNames(_ node: XNode) -> [String] { node.children(named: "Binary").compactMap { $0.child("Key")?.text }.sorted() }
func details(_ summary: ImportSummary, _ kind: ImportIssue.Kind) -> String {
    summary.issues.filter { $0.kind == kind }.map { ($0.item ?? "-") + ": " + $0.detail }.joined(separator: " | ")
}
func attachmentText(_ document: KDBXDocument, _ title: String, _ name: String) -> String {
    guard let node = entry(document, title)?.children(named: "Binary").first(where: { $0.child("Key")?.text == name }),
          let ref = node.child("Value")?.attribute("Ref").flatMap(Int.init), document.binaries.indices.contains(ref) else { return "missing" }
    return String(decoding: document.binaries[ref].dropFirst(), as: UTF8.self)
}
func login(_ title: String, secret: String = "p", otp: String = "") -> VaultItem {
    var v = VaultItem(kind: .login, title: title, account: "u", website: "https://site.example.net", secret: secret)
    v.otpSecret = otp
    return v
}

do {
    // N1: a secret is never changed silently.
    var secrets = ImportItem(sourceID: "1password:N1", kind: .login, title: "Secret\u{FFFE}Site",
                             fields: [ImportField(.username, value: "us\u{1}er"), ImportField(.password, value: "pa\u{FFFF}ss", concealed: true),
                                      ImportField(.website, value: "site.example.net"), ImportField(.notes, value: "no\u{B}tes"),
                                      ImportField(.code, value: "otp\u{FFFE}auth", concealed: true),
                                      ImportField(.custom, label: "Hidden", value: "h\u{FFFE}h", concealed: true), ImportField(.custom, label: "Plain", value: "x\u{FFFE}y")],
                             created: now, modified: now)
    secrets.sanitize()
    let said = secrets.issues.filter { $0.kind == .secretChanged }.map(\.detail)
    check("n1: the password is kept cleaned and the change names item and field",
          "\(secrets.password) | \(secrets.issues.first { $0.kind == .secretChanged }?.item ?? "-") | \(said.first ?? "-")",
          "pass | SecretSite | the password contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it.")
    check("n1: a one-time code and a hidden field are named too", said.dropFirst().joined(separator: " | "),
          "the one-time code contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it. | the hidden field Hidden contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it.")
    check("n1: the title, notes and a plain field are cleaned without a word", "\(secrets.title) \(secrets.first(.notes) ?? "") \(secrets.issues.filter { $0.kind != .secretChanged }.count)", "SecretSite notes 0")
    check("n1: the plan counts them as a separate number", "\(planOf([secrets]).summary.secretsChanged) \(try emptyVault().preview(planOf([secrets])).secretsChanged)", "3 3")
    var card = ImportItem(sourceID: nil, kind: .card, title: "Card", fields: [ImportField(.cardNumber, value: "4111\u{FFFE}", concealed: true), ImportField(.pin, value: "\u{FFFF}", concealed: true), ImportField(.securityCode, value: "1\u{1}2", concealed: true)], created: now, modified: now)
    card.sanitize()
    check("n1: a card number, a PIN and a security code are named, and an empty one says it could not be stored",
          card.issues.map(\.detail).joined(separator: " | "),
          "the card number contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it. | the PIN could not be stored at all. Check it in 1Password before you rely on it. | the security code contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it.")
    var emptyTitle = ImportItem(sourceID: nil, kind: .note, title: "\u{FFFE}", fields: [ImportField(.notes, value: "\u{1}"), ImportField(.custom, label: "\u{FFFE}", value: "v")], created: now, modified: now)
    emptyTitle.sanitize()
    check("n1: text that becomes empty is reported once per item, as text and not as a secret", "\(emptyTitle.issues.filter { $0.kind == .textEmptied }.count) \(emptyTitle.issues.filter { $0.kind == .secretChanged }.count)", "1 0")
    var untouched = mk(nil, "Fine")
    untouched.sanitize()
    check("n1: a clean item says nothing", "\(untouched.issues.count)", "0")
    let viaFile = try writeExport("n1-file", [loginJSON(1, "Via file", user: "u", password: "p\\ufffeq", site: "site.example.net")])
    let viaPlan = try OnePasswordPIF.plan(from: viaFile, now: now)
    check("n1: the same through a 1PIF", "\(viaPlan.items[0].password) \(viaPlan.summary.secretsChanged)", "pq 1")
    let viaCSV = try CSVSource.plan(from: "title,url,username,password\nCsv row,site.example.net,u,\"pa\u{FFFF}ss\"\n", now: now)
    check("n1: and through a CSV", "\(viaCSV.items[0].password) \(viaCSV.summary.secretsChanged)", "pass 1")

    // N2: a link inside the export folder, reached through /tmp or /private/tmp.
    let alias = "/tmp/psss-import-alias-\(getpid())"
    try? fm.removeItem(atPath: alias)
    try fm.createDirectory(atPath: alias, withIntermediateDirectories: true)
    defer { try? fm.removeItem(atPath: alias) }
    let records = [loginJSON(7, "Through a link", user: "u", password: "p", site: "link.example.net")].map { $0 + "\n" + separatorLine }.joined()
    try Data(records.utf8).write(to: URL(fileURLWithPath: alias + "/real-data.txt"))
    try fm.createSymbolicLink(atPath: alias + "/data.1pif", withDestinationPath: "real-data.txt")
    for spelling in [alias, "/private" + alias] {
        let outcomeText = (try? OnePasswordPIF.plan(from: URL(fileURLWithPath: spelling), now: now).items.first?.title) ?? "refused"
        check("n2: data.1pif linked to a file in the folder is read through \(spelling.hasPrefix("/private") ? "/private/tmp" : "/tmp")", outcomeText, "Through a link")
    }
    let outside = "/tmp/psss-import-outside-\(getpid())"
    try Data(records.utf8).write(to: URL(fileURLWithPath: outside))
    defer { try? fm.removeItem(atPath: outside) }
    try? fm.removeItem(atPath: alias + "/data.1pif")
    try fm.createSymbolicLink(atPath: alias + "/data.1pif", withDestinationPath: outside)
    check("n2: a link to a file outside the folder is still refused", (try? OnePasswordPIF.plan(from: URL(fileURLWithPath: alias), now: now).items.count).map(String.init) ?? "refused", "refused")

    // N3: folders nested deeper than 32 levels are flattened, and the import says so once.
    var deepRecords: [String] = []
    for level in 1...40 {
        deepRecords.append("{\"uuid\":\"F\(level)\",\"typeName\":\"system.folder.Regular\",\"title\":\"L\(level)\"" + (level > 1 ? ",\"folderUuid\":\"F\(level - 1)\"" : "") + "}")
    }
    deepRecords.append(loginJSON(1, "Deep one", user: "u", password: "p", site: "deep.example.net").replacingOccurrences(of: "\"updatedAt\"", with: "\"folderUuid\":\"F40\",\"updatedAt\""))
    deepRecords.append(loginJSON(2, "Deep two", user: "u", password: "p2", site: "deep.example.net").replacingOccurrences(of: "\"updatedAt\"", with: "\"folderUuid\":\"F39\",\"updatedAt\""))
    let deepPlan = try OnePasswordPIF.plan(from: try writeExport("deep-folders", deepRecords), now: now)
    check("n3: the path is cut at 32 and reported once", "\(deepPlan.items[0].folder.count) \(deepPlan.items[1].folder.count) \(issueCount(deepPlan.issues, .foldersFlattened)) \(deepPlan.issues.first { $0.kind == .foldersFlattened }?.detail ?? "-")", "32 32 1 some folders were nested more than 32 levels deep and were flattened, so a few items are in a different folder than in 1Password")
    let shallowPlan = try OnePasswordPIF.plan(from: try writeExport("shallow-folders", Array(deepRecords.prefix(5)) + [loginJSON(1, "Shallow", user: "u", password: "p", site: "s.example.net").replacingOccurrences(of: "\"updatedAt\"", with: "\"folderUuid\":\"F5\",\"updatedAt\"")]), now: now)
    check("n3: a path of five is not reported", "\(shallowPlan.items[0].folder.count) \(issueCount(shallowPlan.issues, .foldersFlattened))", "5 0")

    // N4: the same identifier twice.
    let twice = try OnePasswordPIF.plan(from: try writeExport("same-id", [loginJSON(5, "First", user: "u", password: "one", site: "a.example.net"), loginJSON(5, "First", user: "u", password: "two", site: "b.example.net"),
                                                                       loginJSON(6, "Third", user: "u", password: "three", site: "c.example.net"), loginJSON(6, "Third", user: "u", password: "three", site: "c.example.net")]), now: now)
    let twiceIssues = twice.items.flatMap(\.issues) + twice.issues
    check("n4: other content makes separate entries and an issue each, identical content is dropped and counted", "\(twice.items.count) \(issueCount(twiceIssues, .sharedIdentifier)) \(twice.duplicatesInExport) \(Set(twice.items.compactMap(\.sourceID)).count)", "3 1 1 3")
    check("n4: the issue says so once for the group", twiceIssues.first { $0.kind == .sharedIdentifier }?.detail ?? "-", "2 items shared one internal ID in 1Password and were kept as separate entries")
    var shared = try emptyVault()
    let sharedSummary = try shared.apply(twice)
    check("n4: the vault holds the three and counts the repeat", "\(sharedSummary.addedCount) \(sharedSummary.duplicatesInExport)", "3 1")
    let sharedAgain = try shared.apply(twice)
    check("n4: importing it again changes nothing", summaryLine(sharedAgain), "added 0 updated 0 merged 0 skipped 3 similar 0")

    // N5: two imported items for one hand-made login. The second becomes its own entry and is listed as similar.
    var onceMerged = try emptyVault()
    onceMerged.upsert(login("Hand made"))
    let mergedSummary = try onceMerged.apply(planOf([mk("1password:M1", "First copy"), mk("1password:M2", "Second copy")]))
    check("n5: one merges, the other is added and listed as similar", "\(mergedSummary.merged) \(mergedSummary.addedCount) \(mergedSummary.similarAdded) \(issueCount(mergedSummary.issues, .similarLogin))", "1 1 1 1")
    check("n5: and both are in the vault", "\(allEntries(onceMerged).count)", "2")

    // N6: the bytes decide, not the name and the size.
    let bytesFile = work.appendingPathComponent("bytes.bin")
    try Data("AAAA".utf8).write(to: bytesFile)
    var bytesVault = try emptyVault()
    let attach = ImportAttachment(name: "doc.bin", size: 4, url: bytesFile)
    try bytesVault.apply(planOf([mk("1password:B1", "Bytes", attachments: [attach])]))
    check("n6: the first import holds the first bytes", attachmentText(bytesVault, "Bytes", "doc.bin"), "AAAA")
    try Data("BBBB".utf8).write(to: bytesFile)
    let bytesPlan = planOf([mk("1password:B1", "Bytes", attachments: [attach])])
    let bytesSummary = try bytesVault.apply(bytesPlan)
    check("n6: same name and size with other bytes is an update", "\(bytesSummary.updated) \(bytesSummary.attachments)", "1 1")
    check("n6: and the entry now holds the new bytes", attachmentText(bytesVault, "Bytes", "doc.bin"), "BBBB")
    let bytesAgain = try bytesVault.apply(bytesPlan)
    check("n6: the same bytes again is nothing", summaryLine(bytesAgain), "added 0 updated 0 merged 0 skipped 1 similar 0")

    // N7: a record with a lone surrogate is skipped and reported like any unreadable line.
    let lone = "{\"uuid\":\"\(uid(9))\",\"typeName\":\"securenotes.SecureNote\",\"title\":\"Lone\\ud800surrogate\",\"secureContents\":{\"notesPlain\":\"n\"}}"
    let loneMixed = try OnePasswordPIF.plan(from: try writeExport("lone-mixed", [noteJSON(1, "Good one"), lone, noteJSON(2, "Good two")]), now: now)
    check("n7: the other records are read and the bad one is reported", "\(loneMixed.items.count) \(loneMixed.skipped.unreadable) \(issueCount(loneMixed.issues, .unreadableRecord))", "2 1 1")
    expectThrows("n7: a file whose only record is bad says the records could not be read, not that it is not an export", .unreadable("The one item in the file could not be read.")) {
        _ = try OnePasswordPIF.plan(from: try writeExport("lone-only", [lone]), now: now)
    }

    // Salting: the stored fingerprint differs per entry.
    var saltA = try emptyVault(), saltB = try emptyVault()
    let saltItem = mk("1password:S1", "Salted")
    try saltA.apply(planOf([saltItem]))
    try saltB.apply(planOf([saltItem]))
    let hashA = KeePassImport.baseline(of: entry(saltA, "Salted")!)?.content ?? "a", hashB = KeePassImport.baseline(of: entry(saltB, "Salted")!)?.content ?? "b"
    check("salt: the content fingerprint of the same item differs between two entries", "\(hashA != hashB) \(hashA != saltItem.fingerprint)", "true true")
    check("salt: and is the item's fingerprint salted with the entry's own identifier", hashA, ImportItem.salted(entry(saltA, "Salted")!.child("UUID")!.text, saltItem.fingerprint))
    check("salt: importing it again is a duplicate", summaryLine(try saltA.apply(planOf([saltItem]))), "added 0 updated 0 merged 0 skipped 1 similar 0")
}

do {
    // Behaviour 1: a folder moved in 1Password moves the entry, unless the person moved it.
    var moved = try emptyVault()
    try moved.apply(planOf([mk("1password:F1", "Folder item", folder: ["A"]), mk("1password:F2", "Person moved", user: "v", folder: ["A"])]))
    moveEntry(moved, "Person moved", toGroup: "Mine")
    let movePlan = planOf([mk("1password:F1", "Folder item", folder: ["B"]), mk("1password:F2", "Person moved", user: "v", folder: ["B"])])
    check("move: the preview counts the move as an update", "\(moved.preview(movePlan).updated)", "1")
    let moveSummary = try moved.apply(movePlan)
    check("move: the entry follows the source, the one the person moved stays", "\(groupPath(moved, "Folder item")) | \(groupPath(moved, "Person moved")) | \(moveSummary.updated)", "B | Mine | 1")
    check("move: it survives a save", groupPath(try reopen(moved), "Folder item"), "B")

    // Behaviour 2: trashed in 1Password after the import.
    var trashed = try emptyVault()
    try trashed.apply(planOf([mk("1password:T1", "Will be trashed")]))
    var trashPlan = planOf([])
    trashPlan.trashedSources = [TrashedSource(id: "1password:T1", title: "Will be trashed"), TrashedSource(id: "1password:never", title: "Never imported")]
    let trashSummary = try trashed.apply(trashPlan)
    check("trashed: the entry stays and the person is told once", "\(allEntries(trashed).count) | \(details(trashSummary, .trashedInSource))", "1 | Will be trashed: it was deleted in 1Password, but it is still in your vault")

    // Behaviour 3: deleted in Psss, then imported again.
    var gone = try emptyVault()
    gone.root.child("Meta")!.child("CustomData")!.children.append(XNode("Item", children: [XNode("Key", text: DeletedSources.key), XNode("Value", text: "[\"1password:D1\"]"), XNode("LastModificationTime", text: "2026-01-01T00:00:00Z")]))
    check("deleted: the list is read from the vault's own custom data", "\(DeletedSources.read(from: gone.root).sorted())", "[\"1password:D1\"]")
    DeletedSources.record("1password:D2", in: gone.root)
    DeletedSources.record("1password:D2", in: gone.root)
    check("deleted: the helper adds an identifier once, and it survives a save", "\(DeletedSources.read(from: try reopen(gone).root).sorted())", "[\"1password:D1\", \"1password:D2\"]")
    let freshMeta = try emptyVault()
    DeletedSources.record("1password:X", in: freshMeta.root)
    check("deleted: it works in a vault that has no list yet", "\(DeletedSources.read(from: freshMeta.root).sorted())", "[\"1password:X\"]")
    var deletedPlan = planOf([mk("1password:D1", "Deleted one"), mk("1password:D2", "Deleted two", user: "w"), mk("1password:D3", "Still wanted", user: "x")])
    let deletedPreview = gone.preview(deletedPlan)
    let deletedSummary = try gone.apply(deletedPlan)
    check("deleted: only the one never deleted comes back, and the person is told how many", "\(deletedSummary.addedCount) \(deletedSummary.deletedNotImported) | \(details(deletedSummary, .deletedNotImported)) | \(deletedPreview.deletedNotImported)",
          "1 2 | -: 2 items you deleted in Psss were not imported again | 2")
    check("deleted: the summary lists them by title and kind for a screen", deletedSummary.deletedItems.map { "\($0.title) (\($0.kind.rawValue))" }.joined(separator: ", "), "Deleted one (login), Deleted two (login)")
    deletedPlan.includeDeleted = true
    let broughtBack = try gone.apply(deletedPlan)
    check("deleted: asking for them brings them back", "\(broughtBack.addedCount) \(broughtBack.deletedNotImported)", "2 0")

    // Behaviour 4: in Recently Deleted.
    var binned = try emptyVault()
    try binned.apply(planOf([mk("1password:R1", "Binned", password: "p1")]))
    moveToBin(binned, "Binned")
    let binSummary = try binned.apply(planOf([mk("1password:R1", "Binned", password: "p2")]))
    check("bin: changed in the source, it is skipped and reported", "\(binSummary.itemCount) \(allEntries(binned).count) \(details(binSummary, .inRecycleBin))", "0 1 Binned: it is in Recently Deleted, so it was not imported again. Restore it there if you want it back.")
    let binSame = try binned.apply(planOf([mk("1password:R1", "Binned", password: "p1")]))
    check("bin: unchanged, it is skipped and reported too", "\(binSame.itemCount) \(issueCount(binSame.issues, .inRecycleBin))", "0 1")
    var handMade = try emptyVault()
    handMade.upsert(login("Hand login"))
    moveToBin(handMade, "Hand login")
    let handSummary = try handMade.apply(planOf([mk("1password:H1", "Imported login")]))
    check("bin: a hand-made login in the bin neither blocks nor absorbs an imported item", "\(handSummary.addedCount) \(handSummary.merged) \(handSummary.duplicatesSkipped) \(allEntries(handMade).count)", "1 0 0 2")

    // Behaviour 5: a tag the person removed stays removed.
    var tags = try emptyVault()
    try tags.apply(planOf([mk("1password:G1", "Tagged", tags: ["a", "b"])]))
    entry(tags, "Tagged")!.child("Tags")!.text = "a;mine"
    let tagSummary = try tags.apply(planOf([mk("1password:G1", "Tagged", tags: ["a", "b", "c"])]))
    check("tags: the removed tag stays removed, the person's stays, the source's new one comes", "\(tagsOf(tags, "Tagged")) \(tagSummary.updated)", "a;mine;c 1")
    let tagSummary2 = try tags.apply(planOf([mk("1password:G1", "Tagged", tags: ["a", "b"])]))
    check("tags: a tag the source dropped goes", "\(tagsOf(tags, "Tagged")) \(tagSummary2.updated)", "a;mine 1")

    // Behaviour 6: an attachment removed in 1Password goes, unless the person changed it.
    let f1 = work.appendingPathComponent("r3-one.txt"), f2 = work.appendingPathComponent("r3-two.txt"), f3 = work.appendingPathComponent("r3-three.txt")
    try Data("one".utf8).write(to: f1); try Data("two!".utf8).write(to: f2); try Data("three!!".utf8).write(to: f3)
    let a1 = ImportAttachment(name: "one.txt", size: 3, url: f1), a2 = ImportAttachment(name: "two.txt", size: 4, url: f2), a3 = ImportAttachment(name: "three.txt", size: 7, url: f3)
    var files = try emptyVault()
    try files.apply(planOf([mk("1password:A1", "Files", attachments: [a1, a2, a3])]))
    let fileNode = entry(files, "Files")!
    // The person adds one of their own and replaces three.txt with other bytes.
    let ownRef = fileNode.children(named: "Binary").first { $0.child("Key")?.text == "one.txt" }!.child("Value")!.attribute("Ref")!
    fileNode.children.append(XNode("Binary", children: [XNode("Key", text: "mine.txt"), XNode("Value", attributes: [("Ref", ownRef)])]))
    fileNode.children.first { $0.name == "Binary" && $0.child("Key")?.text == "three.txt" }!.child("Value")!.setAttribute("Ref", ownRef)
    let fileSummary = try files.apply(planOf([mk("1password:A1", "Files", attachments: [a1])]))
    check("files: the removed ones go, the person's own and the changed one stay, and nothing is reported", "\(binaryNames(entry(files, "Files")!).joined(separator: ",")) \(fileSummary.updated) \(fileSummary.issues.count)", "mine.txt,one.txt,three.txt 1 1")
    check("files: the removal is listed by item and file name", fileSummary.removedAttachments.map { "\($0.item): \($0.file)" }.joined(), "Files: two.txt")
    check("files: a removed attachment makes the import unclean even with no issue to read", "\(fileSummary.isClean) \(fileSummary.secretsChanged) \(fileSummary.removedAttachments.count)", "false 0 1")
    check("files: the removal is said in one line with the file names", details(fileSummary, .attachmentRemoved), "Files: an attachment removed in 1Password was removed here too: two.txt")
    // Several removed files: one line, up to three names, then the count of the rest.
    var many: [ImportAttachment] = []
    for n in 1...5 {
        let url = work.appendingPathComponent("r3-many\(n).txt")
        try Data("file \(n)".utf8).write(to: url)
        many.append(ImportAttachment(name: "m\(n).txt", size: 6, url: url))
    }
    var manyVault = try emptyVault()
    try manyVault.apply(planOf([mk("1password:M1", "Many", attachments: many)]))
    let manySummary = try manyVault.apply(planOf([mk("1password:M1", "Many", attachments: [])]))
    check("files: five removed files are one line with three names and a count", details(manySummary, .attachmentRemoved), "Many: 5 attachments removed in 1Password were removed here too: m1.txt, m2.txt, m3.txt and 2 more")
    var threeVault = try emptyVault()
    try threeVault.apply(planOf([mk("1password:M2", "Three", attachments: Array(many.prefix(3)))]))
    let threeSummary = try threeVault.apply(planOf([mk("1password:M2", "Three", attachments: [])]))
    check("files: three removed files are listed in full", details(threeSummary, .attachmentRemoved), "Three: 3 attachments removed in 1Password were removed here too: m1.txt, m2.txt, m3.txt")
    check("files: the old file is still in the history", "\(entry(files, "Files")!.child("History")?.children.contains { binaryNames($0).contains("two.txt") } ?? false)", "true")

    // Behaviour 7: merge noise.
    var noise = try emptyVault()
    noise.upsert({ var v = login("Mine"); v.notes = "my notes"; return v }())
    var other = login("other.example.net"); other.account = "u2"; other.website = "https://other.example.net"; other.secret = "q"
    noise.upsert(other)
    let noiseSummary = try noise.apply(planOf([mk("1password:N1", "Theirs", extra: [ImportField(.notes, value: "their notes")]),
                                               mk("1password:N2", "Better title", user: "u2", password: "q", site: "other.example.net")]))
    check("noise: a title never conflicts, the entry's own stays unless it is only its site", "\(entry(noise, "Mine") != nil) \(entry(noise, "Better title") != nil) \(allEntries(noise).filter { strings($0)["Title (1Password)"] != nil }.count)", "true true 0")
    check("noise: differing notes are joined, entry's first, and listed once", "\(strings(entry(noise, "Mine")!)["Notes"]?.value ?? "") | \(issueCount(noiseSummary.issues, .notesCombined)) \(issueCount(noiseSummary.issues, .mergeConflict))", "my notes\n\ntheir notes | 1 0")
    var conflictVault = try emptyVault()
    conflictVault.upsert(login("Own"))
    entry(conflictVault, "Own")!.children.append(XNode("String", children: [XNode("Key", text: "Pin"), XNode("Value", text: "1111")]))
    let conflictSummary = try conflictVault.apply(planOf([mk("1password:C1", "Own", extra: [ImportField(.custom, label: "Pin", value: "9999", concealed: true)])]))
    check("noise: a custom field with the same label and another value is the one conflict", "\(strings(entry(conflictVault, "Own")!)["Pin"]?.value ?? "") \(strings(entry(conflictVault, "Own")!)["Pin (1Password)"]?.value ?? "") | \(details(conflictSummary, .mergeConflict))",
          "1111 9999 | Own: the vault already had a different value for Pin, so it was kept. The value from 1Password was saved in a field whose name ends in (1Password).")

    // Behaviour 8: a different one-time code is kept apart and reported as not in use.
    var codes = try emptyVault()
    codes.upsert(login("Coded", otp: "JBSWY3DPEHPK3PXP"))
    let codeSummary = try codes.apply(planOf([mk("1password:O1", "Coded", extra: [ImportField(.code, value: "otpauth://totp/Coded?secret=KRSXG5CTMVRXEZLU&issuer=Coded", concealed: true)])]))
    let codeStrings = strings(entry(codes, "Coded")!)
    check("code: the other code is a hidden field, the one in use stays", "\(codeStrings["One-time code (1Password)"]?.protected ?? false) \(codeStrings["otp"]?.value.contains("JBSWY3DPEHPK3PXP") ?? false) \(codeStrings["One-time code (1Password)"]?.value.contains("KRSXG5CTMVRXEZLU") ?? false)", "true true true")
    check("code: and it is reported as not in use, not as a conflict", "\(issueCount(codeSummary.issues, .codeNotInUse)) \(issueCount(codeSummary.issues, .mergeConflict))", "1 0")

    // Behaviour 9: of several entries that match, a CSV one first, then the newest, then the first.
    func ex(_ source: String?, modified: Double) -> ImportDuplicates.Existing {
        var e = ImportDuplicates.Existing(sourceID: source, hosts: ["site.example.net"], username: "u", password: "p")
        e.modified = Date(timeIntervalSince1970: modified)
        return e
    }
    let one = planOf([mk("1password:P1", "Pick")])
    check("pick: a CSV entry wins over a newer hand-made one", ImportDuplicates.classify(one, against: [ex(nil, modified: 300), ex("csv:x", modified: 100)]).map { "\($0)" }.joined(), "merge(1)")
    check("pick: otherwise the most recently modified", ImportDuplicates.classify(one, against: [ex(nil, modified: 100), ex(nil, modified: 300), ex(nil, modified: 200)]).map { "\($0)" }.joined(), "merge(1)")
    check("pick: otherwise the first", ImportDuplicates.classify(one, against: [ex(nil, modified: 100), ex(nil, modified: 100)]).map { "\($0)" }.joined(), "merge(0)")
    check("pick: a second item takes the next one, a third has none left and is similar", ImportDuplicates.classify(planOf([mk("1password:P1", "A"), mk("1password:P2", "B"), mk("1password:P3", "C")]), against: [ex(nil, modified: 100), ex(nil, modified: 200)]).map { "\($0)" }.joined(separator: ","), "merge(1),merge(0),addSimilar")
}

// MARK: Follow-ups: CSV markers, spaces in secrets, order-free shared identifiers, refreshed hashes, emptied values

func csvPlan(_ text: String) throws -> ImportPlan { try CSVSource.plan(from: text, now: now) }
func setBaseline(_ node: XNode, _ edit: (inout [String: Any]) -> Void) {
    guard let item = node.child("CustomData")?.children(named: "Item").first(where: { $0.child("Key")?.text == KeePassImport.hashesKey }),
          var object = (try? JSONSerialization.jsonObject(with: Data((item.child("Value")?.text ?? "").utf8))) as? [String: Any] else { return }
    edit(&object)
    item.setChildText("Value", String(decoding: try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self))
}

do {
    // D-D: a CSV row with no password is a duplicate, and a repeated CSV import is a no-op.
    let noPassword = "title,url,username,password\nNo secret,site.example.net,u,\nWith secret,other.example.net,v,pw1\n"
    var csvVault = try emptyVault()
    let csv1 = try csvVault.apply(try csvPlan(noPassword))
    let csvBefore = XMLTree.serialize(csvVault.root)
    let csvPreview = csvVault.preview(try csvPlan(noPassword))
    let csv2 = try csvVault.apply(try csvPlan(noPassword))
    check("csv again: the first import adds both, the second skips both with no issue", "\(csv1.addedCount) \(csv2.addedCount) \(csv2.duplicatesSkipped) \(csv2.similarAdded) \(issueCount(csv2.issues, .similarLogin)) \(csv2.needsWrite) \(csvPreview.needsWrite)", "2 0 2 0 0 false false")
    check("csv again: the vault is byte-identical", XMLTree.serialize(csvVault.root) == csvBefore ? "same" : "changed", "same")
    var handNoPassword = try emptyVault()
    handNoPassword.upsert(login("No secret", secret: ""))
    let handCSV = try handNoPassword.apply(try csvPlan("title,url,username,password\nNo secret,site.example.net,u,\n"))
    check("csv again: a row with no password matches a hand-made login with none (site, user name, title)", "\(handCSV.addedCount) \(handCSV.duplicatesSkipped) \(issueCount(handCSV.issues, .similarLogin))", "0 1 0")
    let otherTitle = try handNoPassword.apply(try csvPlan("title,url,username,password\nAnother title,site.example.net,u,\n"))
    check("csv again: another title is another login", "\(otherTitle.addedCount)", "1")
    // The marker is made of site, user name and title, so a changed password is an update with history.
    let changedCSV = try csvVault.apply(try csvPlan("title,url,username,password\nWith secret,other.example.net,v,pw2\n"))
    check("csv again: a changed password is an update, and the old one is in the history", "\(changedCSV.updated) \(changedCSV.addedCount) \(historyPasswords(entry(csvVault, "With secret")!)) \(strings(entry(csvVault, "With secret")!)["Password"]?.value ?? "")", "1 0 [\"pw1\"] pw2")
    let marker = KeePassImport.sourceID(of: entry(csvVault, "With secret")!) ?? ""
    expect("csv again: the marker is csv: and a digest, not the password", marker.hasPrefix("csv:") && !marker.contains("pw"))
    let sameMarker = try csvPlan("title,url,username,password\nWith secret,other.example.net,v,anything\n").items[0].sourceID ?? ""
    check("csv again: the marker does not depend on the password", sameMarker, marker)
    // Two rows with one marker.
    let twoRows = try csvPlan("title,url,username,password\nSame,s.example.net,u,a\nSame,s.example.net,u,b\nSame,s.example.net,u,a\n")
    check("csv again: rows that share a marker and differ are kept apart, an identical one is dropped", "\(twoRows.items.count) \(twoRows.duplicatesInExport) \(Set(twoRows.items.compactMap(\.sourceID)).count)", "2 1 2")

    // D-C: with markers, a CSV entry is the one a 1Password item merges into.
    var csvFirst = try emptyVault()
    try csvFirst.apply(try csvPlan("title,url,username,password\nFrom CSV,site.example.net,u,p\n"))
    csvFirst.upsert(login("Hand made later"))
    let csvMerge = try csvFirst.apply(planOf([mk("1password:W1", "Theirs")]))
    check("pick: a 1Password item merges into the CSV entry, not into the hand-made one", "\(csvMerge.merged) \(KeePassImport.sourceID(of: entry(csvFirst, "From CSV")!) ?? "-") \(KeePassImport.sourceID(of: entry(csvFirst, "Hand made later")!) ?? "none")", "1 1password:W1 none")

    // D-A: a secret is never trimmed.
    var spaces = ImportItem(sourceID: "1password:SP", kind: .login, title: "Spacey", fields: [ImportField(.password, value: " ", concealed: true), ImportField(.website, value: "site.example.net")], created: now, modified: now)
    spaces.sanitize()
    check("spaces: a password of one space is kept and reported", "\(spaces.password.count) \(details(planOf([spaces]).summary, .secretSpaces))", "1 Spacey: the password is only spaces. Check it in 1Password.")
    let cardFile = try writeExport("spacey-card", [
        "{\"uuid\":\"\(uid(21))\",\"typeName\":\"wallet.financial.CreditCard\",\"title\":\"Spacey card\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\"sections\":[{\"title\":\"\",\"name\":\"s\",\"fields\":["
        + "{\"k\":\"string\",\"n\":\"cardholder\",\"v\":\"A B\",\"t\":\"cardholder\"},{\"k\":\"string\",\"n\":\"ccnum\",\"v\":\"   \",\"t\":\"number\"},"
        + "{\"k\":\"concealed\",\"n\":\"cvv\",\"v\":\"  \",\"t\":\"verification number\"},{\"k\":\"concealed\",\"n\":\"pin\",\"v\":\" \",\"t\":\"PIN\"},"
        + "{\"k\":\"concealed\",\"n\":\"other\",\"v\":\"\t\",\"t\":\"Other\"},{\"k\":\"string\",\"n\":\"plain\",\"v\":\"   \",\"t\":\"Plain\"},{\"k\":\"concealed\",\"n\":\"empty\",\"v\":\"\",\"t\":\"Empty\"}]}]}}"])
    let cardPlan = try OnePasswordPIF.plan(from: cardFile, now: now)
    let spaced = cardPlan.items[0]
    check("spaces: a card number, security code, PIN and hidden field of only spaces are kept exactly", "\(spaced.first(.cardNumber) ?? "-")|\(spaced.first(.securityCode) ?? "-")|\(spaced.first(.pin) ?? "-")|\(spaced.fields.first { $0.label == "Other" }?.value ?? "-")", "   |  | |\t")
    check("spaces: each is reported by name, an empty one and a plain one are skipped silently", cardPlan.items[0].issues.filter { $0.kind == .secretSpaces }.map(\.detail).joined(separator: " | "),
          "the card number is only spaces. Check it in 1Password. | the security code is only spaces. Check it in 1Password. | the PIN is only spaces. Check it in 1Password. | the hidden field Other is only spaces. Check it in 1Password.")
    check("spaces: and no field is made for the empty or plain ones", "\(spaced.fields.contains { $0.label == "Empty" || $0.label == "Plain" })", "false")
    let spacedCSV = try csvPlan("title,url,username,password\nSp,site.example.net,u, \n")
    check("spaces: a CSV password of one space is kept and reported", "\(spacedCSV.items[0].password.count) \(issueCount(spacedCSV.items[0].issues, .secretSpaces))", "1 1")

    // D-B: shared identifiers do not depend on the order of the export.
    let aRec = loginJSON(5, "Alpha", user: "u", password: "one", site: "a.example.net"), bRec = loginJSON(5, "Beta", user: "u", password: "two", site: "b.example.net")
    var shared2 = try emptyVault()
    let firstOrder = try OnePasswordPIF.plan(from: try writeExport("order-a", [aRec, bRec]), now: now)
    try shared2.apply(firstOrder)
    let sharedBefore = XMLTree.serialize(shared2.root)
    let reordered = try OnePasswordPIF.plan(from: try writeExport("order-b", [bRec, aRec]), now: now)
    let reorderPreview = shared2.preview(reordered)
    let reorderedSummary = try shared2.apply(reordered)
    check("shared: reordering the export and importing again changes nothing", "\(reorderedSummary.itemCount) \(reorderedSummary.duplicatesSkipped) \(reorderedSummary.needsWrite) \(reorderPreview.needsWrite) \(XMLTree.serialize(shared2.root) == sharedBefore)", "0 2 false false true")
    check("shared: each entry keeps its own content", "\(strings(entry(shared2, "Alpha")!)["Password"]?.value ?? "") \(strings(entry(shared2, "Beta")!)["Password"]?.value ?? "")", "one two")
    check("shared: every item of the group has a suffix made of a digest, the first included", "\(firstOrder.items.map { $0.sourceID ?? "" }.allSatisfy { $0.hasPrefix("1password:\(uid(5))#") && $0.count == "1password:\(uid(5))#".count + 8 })", "true")
    // A title edited in 1Password: matched by fields and reported.
    let renamed = try OnePasswordPIF.plan(from: try writeExport("order-c", [bRec, loginJSON(5, "Alpha renamed", user: "u", password: "one-changed", site: "a.example.net")]), now: now)
    let renamedSummary = try shared2.apply(renamed)
    check("shared: a changed title is matched to the entry by its fields, updated and reported", "\(renamedSummary.updated) \(renamedSummary.addedCount) \(allEntries(shared2).count) \(strings(entry(shared2, "Alpha renamed")!)["Password"]?.value ?? "-") \(issueCount(renamedSummary.issues, .sharedIdentifier))", "1 0 2 one-changed 1")
    let renamedAgain = try shared2.apply(renamed)
    check("shared: and then it is quiet again", "\(renamedAgain.needsWrite)", "false")

    // D-F: hashes of an older form are refreshed in place, once.
    var old = try emptyVault()
    let oldPlan = planOf([mk("1password:OLD1", "Old import", folder: ["Fo"], attachments: [ImportAttachment(name: "one.txt", size: 3, url: work.appendingPathComponent("r3-one.txt"))])])
    try old.apply(oldPlan)
    setBaseline(entry(old, "Old import")!) { $0["v"] = 1; $0["content"] = "0123"; $0.removeValue(forKey: "folder"); $0.removeValue(forKey: "files") }
    let oldPreview = old.preview(oldPlan)
    let refreshed = try old.apply(oldPlan)
    check("refresh: an old entry unchanged in every field is refreshed and counted apart", "\(refreshed.refreshed) \(refreshed.itemCount) \(refreshed.needsWrite) \(refreshed.duplicatesSkipped) \(oldPreview.refreshed)", "1 0 true 0 1")
    check("refresh: a refresh-only import stays clean", "\(refreshed.isClean) \(refreshed.issues.isEmpty)", "true true")
    let refreshedState = XMLTree.serialize(old.root)
    let after = try old.apply(oldPlan)
    check("refresh: the next import writes nothing and the vault is byte-identical", "\(after.refreshed) \(after.needsWrite) \(after.duplicatesSkipped) \(XMLTree.serialize(old.root) == refreshedState)", "0 false 1 true")
    var movedPlan = oldPlan
    movedPlan.items[0].folder = ["Elsewhere"]
    movedPlan.items[0].attachments = []
    let afterMove = try old.apply(movedPlan)
    check("refresh: afterwards a folder move and a removed attachment are noticed", "\(afterMove.updated) \(groupPath(old, "Old import")) \(afterMove.removedAttachments.map { "\($0.item): \($0.file)" })", "1 Elsewhere [\"Old import: one.txt\"]")
    let digestHex = AttachmentDigest.shared.hex(of: work.appendingPathComponent("r3-one.txt"), size: 3)
    var fresh = try emptyVault(), fresh2 = try emptyVault()
    try fresh.apply(oldPlan); try fresh2.apply(oldPlan)
    let digestA = KeePassImport.baseline(of: entry(fresh, "Old import")!)?.files["one.txt"] ?? "a", digestB = KeePassImport.baseline(of: entry(fresh2, "Old import")!)?.files["one.txt"] ?? "b"
    check("salt: the attachment digest in the stored hashes is salted per entry, not the plain SHA-256", "\(digestA != digestB) \(digestA != digestHex) \(digestA.count != 64)", "true true true")

    // D-G: an earlier password emptied by cleaning is not a history entry.
    var hist = mk("1password:HG", "History gone")
    hist.history = [ImportRevision(password: "\u{FFFE}", date: now.addingTimeInterval(-200)), ImportRevision(password: "ok\u{FFFE}", date: now.addingTimeInterval(-100))]
    hist.sanitize()
    check("history: the emptied one is dropped, the changed one is kept, and each says what happened", "\(hist.history.map(\.password)) | \(hist.issues.filter { $0.kind == .secretChanged }.map(\.detail).joined(separator: " | "))",
          "[\"ok\"] | an earlier password contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it. | an earlier password could not be stored at all and was left out. Check it in 1Password before you rely on it.")
    var histVault = try emptyVault()
    try histVault.apply(planOf([hist]))
    check("history: the entry holds one snapshot", "\(historyPasswords(entry(histVault, "History gone")!))", "[\"ok\"]")

    // D-H: no empty custom field, and no empty notes on a merge.
    var emptied = mk("1password:EM", "Emptied", extra: [ImportField(.custom, label: "Gone", value: "\u{FFFE}"), ImportField(.custom, label: "Kept", value: "x")])
    emptied.sanitize()
    var emptiedVault = try emptyVault()
    try emptiedVault.apply(planOf([emptied]))
    check("emptied: the value is reported once and no field is written for it", "\(issueCount(emptied.issues, .textEmptied)) \(customKeys(entry(emptiedVault, "Emptied")!).sorted())", "1 [\"Kept\"]")
    var noNotes = try emptyVault()
    noNotes.upsert(login("No notes"))
    let noNotesNode = entry(noNotes, "No notes")!
    noNotesNode.children.removeAll { $0.name == "String" && $0.child("Key")?.text == "Notes" }
    try noNotes.apply(planOf([mk("1password:NN", "Theirs")]))
    check("emptied: a merge writes no empty Notes when neither side has any", "\(strings(entry(noNotes, "No notes")!)["Notes"] == nil)", "true")
}

do {
    // PERF-1: recording many identifiers.
    let bulk = try emptyVault()
    let batchStart = Date()
    DeletedSources.record((0..<20_000).map { "1password:bulk-\($0)" }, in: bulk.root)
    let batchSeconds = Date().timeIntervalSince(batchStart)
    check("deleted: 20,000 identifiers through the batch form are listed and take well under a second", "\(DeletedSources.read(from: bulk.root).count) \(batchSeconds < 1.0)", "20000 true")
    let singles = try emptyVault()
    let singleStart = Date()
    for i in 0..<2_000 { DeletedSources.record("1password:single-\(i)", in: singles.root) }
    let singleSeconds = Date().timeIntervalSince(singleStart)
    check("deleted: the single form called 2,000 times stays under a second", "\(DeletedSources.read(from: singles.root).count) \(singleSeconds < 1.0)", "2000 true")
    DeletedSources.record(["1password:bulk-1", "1password:new"], in: bulk.root)
    check("deleted: a batch skips the ones it holds and adds the others", "\(DeletedSources.read(from: bulk.root).count)", "20001")
    let reopenedBulk = try reopen(bulk)
    check("deleted: the long list survives a save", "\(DeletedSources.read(from: reopenedBulk.root).count)", "20001")
    let control = try emptyVault()
    DeletedSources.record(["1password:ctl\u{1}x", "1password:ctlx", "1password:ctl\u{FFFE}x"], in: control.root)
    DeletedSources.record("1password:ctl\u{1}x", in: control.root)
    let rawList = control.root.child("Meta")?.child("CustomData")?.children(named: "Item").first?.child("Value")?.text ?? ""
    check("deleted: an identifier with a control character is cleaned first and listed once", rawList, "[\"1password:ctlx\"]")
    let metaTime = control.root.child("Meta")?.child("CustomData")?.children(named: "Item").first?.child("LastModificationTime")?.text ?? ""
    check("deleted: the item's time is in the codec's stored form", "\(Data(base64Encoded: metaTime)?.count ?? 0) \(KeePassTime.date(metaTime) != nil)", "8 true")
}

// MARK: Round 5: alike items, spaces in codes, first-importer entries, no identifier, empty strings, messages

func entriesTitled(_ document: KDBXDocument, _ title: String) -> [XNode] { allEntries(document).filter { EntryMapping.string($0, "Title") == title } }
func passwordsByID(_ document: KDBXDocument, _ title: String) -> [String: String] {
    Dictionary(uniqueKeysWithValues: entriesTitled(document, title).map { ($0.child("UUID")?.text ?? "?", strings($0)["Password"]?.value ?? "") })
}

do {
    // R-1, 1PIF: two items alike in kind, title, site and user name, with different passwords.
    let dupOne = loginJSON(31, "Dup", user: "u", password: "one", site: "dup.example.net"), dupTwo = loginJSON(31, "Dup", user: "u", password: "two", site: "dup.example.net")
    let dupThree = loginJSON(31, "Dup", user: "u", password: "three", site: "dup.example.net")
    var alike = try emptyVault()
    try alike.apply(try OnePasswordPIF.plan(from: try writeExport("alike-a", [dupOne, dupTwo]), now: now))
    let alikeIDs = passwordsByID(alike, "Dup")
    let alikeState = XMLTree.serialize(alike.root)
    let reorderedAlike = try OnePasswordPIF.plan(from: try writeExport("alike-b", [dupTwo, dupOne]), now: now)
    let reorderedPreview = alike.preview(reorderedAlike)
    let reorderedSummary = try alike.apply(reorderedAlike)
    check("alike: reordering an unchanged export is a no-op, byte-identical", "\(reorderedSummary.needsWrite) \(reorderedPreview.needsWrite) \(reorderedSummary.duplicatesSkipped) \(XMLTree.serialize(alike.root) == alikeState) \(passwordsByID(alike, "Dup") == alikeIDs)", "false false 2 true true")
    // One password changed in the source, in the other order: the right entry is updated.
    let changedAlike = try OnePasswordPIF.plan(from: try writeExport("alike-c", [dupThree, dupOne]), now: now)
    let changedSummary = try alike.apply(changedAlike)
    let uuidOfTwo = alikeIDs.first { $0.value == "two" }!.key, uuidOfOne = alikeIDs.first { $0.value == "one" }!.key
    let nowIDs = passwordsByID(alike, "Dup")
    check("alike: the entry whose password changed is the one updated, the other is untouched", "\(changedSummary.updated) \(changedSummary.addedCount) \(nowIDs[uuidOfTwo] ?? "-") \(nowIDs[uuidOfOne] ?? "-") \(allEntries(alike).count)", "1 0 three one 2")
    let againAlike = try OnePasswordPIF.plan(from: try writeExport("alike-d", [dupOne, dupThree]), now: now)
    let againState = XMLTree.serialize(alike.root)
    let againSummary = try alike.apply(againAlike)
    check("alike: and any order after that is a no-op too", "\(againSummary.needsWrite) \(XMLTree.serialize(alike.root) == againState)", "false true")

    // R-1, CSV.
    let rowOne = "Dup,csv.example.net,u,one", rowTwo = "Dup,csv.example.net,u,two", head = "title,url,username,password\n"
    var csvAlike = try emptyVault()
    try csvAlike.apply(try csvPlan(head + rowOne + "\n" + rowTwo + "\n"))
    let csvIDs = passwordsByID(csvAlike, "Dup")
    let csvState = XMLTree.serialize(csvAlike.root)
    let csvReordered = try csvAlike.apply(try csvPlan(head + rowTwo + "\n" + rowOne + "\n"))
    check("alike: the same for two CSV rows", "\(csvReordered.needsWrite) \(XMLTree.serialize(csvAlike.root) == csvState) \(passwordsByID(csvAlike, "Dup") == csvIDs)", "false true true")
    let csvChanged = try csvAlike.apply(try csvPlan(head + "Dup,csv.example.net,u,three\n" + rowOne + "\n"))
    let csvNow = passwordsByID(csvAlike, "Dup")
    check("alike: and when one password changed, that entry is updated", "\(csvChanged.updated) \(csvChanged.addedCount) \(csvNow[csvIDs.first { $0.value == "two" }!.key] ?? "-") \(csvNow[csvIDs.first { $0.value == "one" }!.key] ?? "-")", "1 0 three one")
    // Entries that were imported once before and now come in the other order, with a history, still pair by password.
    check("alike: and a repeat in either order is a no-op", "\(try csvAlike.apply(try csvPlan(head + rowOne + "\n" + "Dup,csv.example.net,u,three\n")).needsWrite)", "false")

    // R-2: a one-time code of only spaces is not a code.
    func codeRecord(_ n: Int, _ value: String) -> String {
        loginJSON(n, "Coded \(n)", user: "u", password: "p\(n)", site: "code\(n).example.net", extra: ",\"sections\":[{\"title\":\"\",\"name\":\"s\",\"fields\":[{\"k\":\"concealed\",\"n\":\"TOTP_x\",\"v\":\"\(value)\",\"t\":\"\"}]}]")
    }
    let codes = try OnePasswordPIF.plan(from: try writeExport("blank-codes", [codeRecord(41, "   "), codeRecord(42, "\\u000b"), codeRecord(43, "\\u000c \\u000b")]), now: now)
    check("codes: spaces only is left out and reported once", "\(codes.items[0].first(.code) == nil) \(details(codes.summary, .secretSpaces))", "true Coded 41: the one-time code was only spaces and was left out. Set it up again from the site if you need one.")
    check("codes: a code of only U+000B is reported as not storable and is no code", "\(codes.items[1].first(.code) == nil) \(codes.items[1].issues.filter { $0.kind == .secretChanged }.map(\.detail))", "true [\"the one-time code could not be stored at all. Check it in 1Password before you rely on it.\"]")
    check("codes: spaces next to unstorable characters is reported as changed, and is no code", "\(codes.items[2].first(.code) == nil) \(codes.items[2].issues.filter { $0.kind == .secretChanged }.count)", "true 1")
    var spacedHistory = mk("1password:SH", "Spaced history")
    spacedHistory.history = [ImportRevision(password: "  ", date: now.addingTimeInterval(-10)), ImportRevision(password: "real", date: now.addingTimeInterval(-5))]
    spacedHistory.sanitize()
    check("codes: an earlier password of only spaces is kept and reported like other spaces-only secrets", "\(spacedHistory.history.count) \(details(planOf([spacedHistory]).summary, .secretSpaces))", "2 Spaced history: an earlier password is only spaces. Check it in 1Password.")

    // R-3: an entry from the first importer has a source and no stored hashes.
    var first = try emptyVault()
    let firstPlan = planOf([mk("1password:FI1", "First importer", folder: ["Fo"], attachments: [ImportAttachment(name: "one.txt", size: 3, url: work.appendingPathComponent("r3-one.txt"))])])
    try first.apply(firstPlan)
    entry(first, "First importer")!.child("CustomData")!.children.removeAll { $0.child("Key")?.text == KeePassImport.hashesKey }
    let firstPreview = first.preview(firstPlan)
    let firstRefreshed = try first.apply(firstPlan)
    check("first importer: an entry with a source and no hashes is refreshed and counted apart", "\(firstRefreshed.refreshed) \(firstRefreshed.itemCount) \(firstRefreshed.needsWrite) \(firstPreview.refreshed)", "1 0 true 1")
    let firstState = XMLTree.serialize(first.root)
    let firstAfter = try first.apply(firstPlan)
    check("first importer: and the next import writes nothing", "\(firstAfter.needsWrite) \(XMLTree.serialize(first.root) == firstState)", "false true")
    var firstMoved = firstPlan
    firstMoved.items[0].folder = ["Elsewhere"]
    firstMoved.items[0].attachments = []
    let firstMove = try first.apply(firstMoved)
    check("first importer: afterwards a folder move and a removed attachment are noticed", "\(firstMove.updated) \(groupPath(first, "First importer")) \(firstMove.removedAttachments.count)", "1 Elsewhere 1")
    check("first importer: the removed attachment makes that import unclean", "\(firstMove.isClean)", "false")

    // R-4: a record with no uuid gets a marker made of what it is.
    let noID = "{\"typeName\":\"securenotes.SecureNote\",\"title\":\"No id note\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\"notesPlain\":\"body\"}}"
    let noIDPlan = try OnePasswordPIF.plan(from: try writeExport("no-uuid", [noID]), now: now)
    expect("no uuid: the item has a derived marker", noIDPlan.items[0].sourceID?.hasPrefix("1password:nouuid:") == true)
    var noIDVault = try emptyVault()
    let noID1 = try noIDVault.apply(noIDPlan)
    let noIDState = XMLTree.serialize(noIDVault.root)
    let noID2 = try noIDVault.apply(noIDPlan)
    check("no uuid: imported once, the second import is a no-op", "\(noID1.addedCount) \(noID2.addedCount) \(noID2.duplicatesSkipped) \(noID2.needsWrite) \(XMLTree.serialize(noIDVault.root) == noIDState)", "1 0 1 false true")
    let sameA = "{\"typeName\":\"securenotes.SecureNote\",\"title\":\"Same title\",\"secureContents\":{\"notesPlain\":\"first body\"}}", sameB = "{\"typeName\":\"securenotes.SecureNote\",\"title\":\"Same title\",\"secureContents\":{\"notesPlain\":\"second body\"}}"
    var noIDPair = try emptyVault()
    try noIDPair.apply(try OnePasswordPIF.plan(from: try writeExport("no-uuid-pair", [sameA, sameB]), now: now))
    let pairState = XMLTree.serialize(noIDPair.root)
    let pairAgain = try noIDPair.apply(try OnePasswordPIF.plan(from: try writeExport("no-uuid-pair2", [sameB, sameA]), now: now))
    check("no uuid: two alike records are kept apart and a reordered import is a no-op", "\(allEntries(noIDPair).count) \(pairAgain.needsWrite) \(XMLTree.serialize(noIDPair.root) == pairState)", "2 false true")

    // R-5: the five standard strings stay (KeePassXC writes them all, even when empty), other empty strings are not written.
    var plain = try emptyVault()
    var cardItem = ImportItem(sourceID: "1password:CARD", kind: .card, title: "Card without expiry", fields: [ImportField(.cardholder, value: "A B"), ImportField(.cardNumber, value: "4111111111111111", concealed: true)], created: now, modified: now)
    cardItem.sanitize()
    var cardWithExpiry = cardItem
    cardWithExpiry.sourceID = "1password:CARD2"
    cardWithExpiry.title = "Card with expiry"
    cardWithExpiry.fields.append(ImportField(.expiry, value: "01/2030"))
    try plain.apply(planOf([mk("1password:LOGIN", "Login without notes"), cardItem, cardWithExpiry]))
    let loginKeys = Set(strings(entry(plain, "Login without notes")!).keys)
    check("empty: a login keeps the five standard strings", "\(["Title", "UserName", "Password", "URL", "Notes"].allSatisfy(loginKeys.contains))", "true")
    check("empty: a card without an expiry has no Expiry string, one with an expiry has it", "\(strings(entry(plain, "Card without expiry")!)["Expiry"] == nil) \(strings(entry(plain, "Card with expiry")!)["Expiry"]?.value ?? "-")", "true 01/2030")
    check("empty: and both still read as cards", "\(vaultItem(try reopen(plain), titled: "Card without expiry")?.kind == .creditCard) \(vaultItem(try reopen(plain), titled: "Card with expiry")?.kind == .creditCard)", "true true")

    // R-6: messages that say what happened.
    var grown = try emptyVault()
    try grown.apply(try OnePasswordPIF.plan(from: try writeExport("grow-1", [loginJSON(51, "Grower", user: "u", password: "g1", site: "grow.example.net")]), now: now))
    let grownSummary = try grown.apply(try OnePasswordPIF.plan(from: try writeExport("grow-2", [loginJSON(51, "Grower", user: "u", password: "g1", site: "grow.example.net"), loginJSON(51, "Grower two", user: "v", password: "g2", site: "grow2.example.net")]), now: now))
    check("messages: a group that grew says so, and not that the title or site changed", details(grownSummary, .sharedIdentifier),
          "Grower: 2 items shared one internal ID in 1Password and were kept as separate entries")
    check("messages: the earlier entry was matched, the new item added, and the next import is a no-op", "\(grownSummary.refreshed + grownSummary.updated) \(grownSummary.addedCount) \(try grown.apply(try OnePasswordPIF.plan(from: try writeExport("grow-3", [loginJSON(51, "Grower two", user: "v", password: "g2", site: "grow2.example.net"), loginJSON(51, "Grower", user: "u", password: "g1", site: "grow.example.net")]), now: now)).needsWrite)", "1 1 false")
    var emptyPw = try emptyVault()
    try emptyPw.apply(planOf([mk("1password:E1", "First", password: "", site: "same.example.net")]))
    let bothEmpty = try emptyPw.apply(planOf([mk("1password:E2", "Second", password: "", site: "same.example.net")]))
    check("messages: two empty passwords with another title say so, not 'another password'", details(bothEmpty, .similarLogin),
          "Second: the vault already has a login for this site and user name with another title and no password, so this one was added as a separate entry. Delete the one you do not need.")
    var pwKinds = try emptyVault()
    try pwKinds.apply(planOf([mk("1password:H", "Has", password: "secret", site: "k.example.net"), mk("1password:N", "None", password: "", site: "n.example.net")]))
    let incoming = try pwKinds.apply(planOf([mk("1password:H2", "Has again", password: "", site: "k.example.net"), mk("1password:N2", "None again", password: "x", site: "n.example.net"),
                                             mk("1password:C", "Changed", password: "other", site: "k.example.net")]))
    check("messages: a missing password on either side says which", incoming.issues.filter { $0.kind == .similarLogin }.map { "\($0.item ?? "-"): \($0.detail)" }.joined(separator: " | "),
          "Has again: the vault already has a login for this site and user name with a password, and this one has none, so it was added as a separate entry. Delete the one you do not need. | None again: the vault already has a login for this site and user name without a password, and this one has one, so it was added as a separate entry. Delete the one you do not need. | Changed: the vault already has a login for this site and user name with a different password, so this one was added as a separate entry. Delete the one you do not need.")
    // A look-alike is one line: the look-alike line replaces the line about a similar login.
    var oneLine = try emptyVault()
    try oneLine.apply(try csvPlan(head + "First,same.example.net,u,\n"))
    let oneLineSummary = try oneLine.apply(try csvPlan(head + "Second,same.example.net,u,\n"))
    check("messages: a look-alike of a CSV login is one line", "\(issueCount(oneLineSummary.issues, .similarLogin)) \(issueCount(oneLineSummary.issues, .looksLikeExisting)) \(oneLineSummary.issues.count) \(oneLineSummary.similarAdded)", "0 1 1 1")

    // CSV rows that look like an earlier CSV login.
    var looks = try emptyVault()
    try looks.apply(try csvPlan(head + "Bank,bank.example.net,me,p1\n"))
    let looksSummary = try looks.apply(try csvPlan(head + "Bank account,bank.example.net,me,p2\nBank,other-bank.example.net,me,p3\nUnrelated,elsewhere.example.net,you,p4\n"))
    check("looks like: a different title or a different site is reported once per item", details(looksSummary, .looksLikeExisting),
          "Bank account: it looks like \u{2018}Bank\u{2019}, which has a different title, so it was added as a separate entry. Delete the one you do not need. | Bank: it looks like \u{2018}Bank\u{2019}, which has a different site, so it was added as a separate entry. Delete the one you do not need.")
    check("looks like: the summary lists them by title and kind for a screen, all three were added", "\(looksSummary.possibleMatches.map { "\($0.title)>\($0.existingTitle) (\($0.kind.rawValue))" }) \(looksSummary.addedCount)", "[\"Bank account>Bank (login)\", \"Bank>Bank (login)\"] 3")

    // The summary for a screen.
    var tidy = try emptyVault()
    let tidySummary = try tidy.apply(planOf([mk("1password:CLEAN", "Clean item")]))
    check("summary: a plain import is clean and has no issues by kind", "\(tidySummary.isClean) \(tidySummary.issuesByKind.count)", "true 0")
    var messy = mk("1password:MESSY", "Messy item")
    messy.fields[1].value = "pa\u{FFFF}ss"
    messy.sanitize()
    let messySummary = try tidy.apply(planOf([messy]))
    check("summary: a changed secret makes it unclean and groups the issue by kind", "\(messySummary.isClean) \(messySummary.issuesByKind[.secretChanged]?.count ?? 0) \(messySummary.secretsChanged)", "false 1 1")
}

// MARK: Round 6: alike items, random sequences (D1)

struct SeededRandom {
    var state: UInt64
    mutating func next() -> Int { state = state &* 6364136223846793005 &+ 1442695040888963407; return Int(truncatingIfNeeded: state >> 33) }
    mutating func below(_ n: Int) -> Int { next() % n }
    mutating func shuffle<T>(_ list: inout [T]) { for i in stride(from: list.count - 1, to: 0, by: -1) { list.swapAt(i, below(i + 1)) } }
}

/// The identifiers of the live entries, which must all be different.
func liveMarkers(_ document: KDBXDocument) -> [String] {
    KeePassImport.known(in: document).filter { !$0.existing.inRecycleBin }.compactMap(\.existing.sourceID)
}

func describeAlike(_ document: KDBXDocument) -> [String] {
    KeePassImport.known(in: document).map { k in
        "\(EntryMapping.string(k.node, "Title") ?? ""):\(k.existing.password):\((k.existing.sourceID ?? "-").suffix(12)):h[\((k.node.child("History")?.children(named: "Entry") ?? []).map { EntryMapping.string($0, "Password") ?? "" }.joined(separator: ","))]"
    }
}

do {
    // After every import, importing the same export again changes nothing and every live entry has its own marker.
    let pool = ["", "p1", "p2", "p3"]
    struct Row { var title: String; var password: String; var note: String }
    var failures: [String] = []
    var steps = 0
    var lost = 0
    for csv in [false, true] {
        for seed in (Int(ProcessInfo.processInfo.environment["PSSS_ALIKE_FROM"] ?? "") ?? 1)...(Int(ProcessInfo.processInfo.environment["PSSS_ALIKE_SEEDS"] ?? "") ?? 4) {
            var random = SeededRandom(state: UInt64(seed * 7919 + (csv ? 1 : 0)))
            var document = try emptyVault()
            var rows: [Row] = []
            var edited = false
            func makePlan() throws -> ImportPlan {
                if csv {
                    var text = "Title,URL,Username,Password,Notes\n"
                    for row in rows { text += "\(row.title),site.example.net,u,\(row.password),\(row.note)\n" }
                    return try csvPlan(text)
                }
                var p = planOf(rows.map { row in
                    mk("1password:ALIKE", row.title, password: row.password, extra: row.note.isEmpty ? [] : [ImportField(.notes, value: row.note)])
                })
                p.separateSharedIdentifiers()
                return p
            }
            for step in 0..<1000 {
                let fresh = step % 40 == 0
                var prePasswords: [String] = []
                if fresh {
                    document = try emptyVault()
                    edited = false
                    // Logins that were already there: hand-made or from a CSV, with the site and user name of the items and either
                    // the password of one of them or another one.
                    var choices = ["p1", "p2", "p3", "zz"]
                    for n in 0..<random.below(4) {
                        let password = choices.remove(at: random.below(choices.count))
                        _ = try document.apply(try csvPlan("title,url,username,password\nPre \(n),site.example.net,u,\(password)\n"))
                        prePasswords.append(password)
                        if random.below(2) == 0, let node = entriesTitled(document, "Pre \(n)").first { node.children.removeAll { $0.name == "CustomData" } }
                    }
                    rows = (0..<(2 + random.below(4))).map { _ in Row(title: random.below(3) == 0 ? "T2" : "T1", password: pool[random.below(pool.count)], note: "") }
                }
                switch fresh ? 5 : random.below(6) {
                case 0: random.shuffle(&rows)
                case 1: rows[random.below(rows.count)].password = pool[random.below(pool.count)]
                case 2: rows[random.below(rows.count)].note = ["", "n1", "n2"][random.below(3)]
                case 3:
                    if rows.count < 5, random.below(2) == 0 { rows.append(Row(title: random.below(3) == 0 ? "T2" : "T1", password: pool[random.below(pool.count)], note: "")) }
                    else if rows.count > 2 { rows.remove(at: random.below(rows.count)) }
                case 4:
                    // An edit in Psss.
                    let entries = allEntries(document)
                    if !entries.isEmpty, case let node = entries[random.below(entries.count)], let value = node.children(named: "String").first(where: { $0.child("Key")?.text == "Password" })?.child("Value") {
                        value.text = ["", "mine", "p1"][random.below(3)]
                        edited = true
                    }
                default: break
                }
                let first = try makePlan()
                let pre = describeAlike(document)
                func describeResolution(_ items: [KeePassImport.Resolution]) -> String {
                    items.map { r -> String in
                        switch r {
                        case .update(let c), .merge(let c), .refresh(let c):
                            let kind = "\(r)".prefix(3)
                            return "\(kind)->\(EntryMapping.string(c.entry, "Title") ?? ""):\(EntryMapping.string(c.entry, "Password") ?? ""):\((KeePassImport.sourceID(of: c.entry) ?? "-").suffix(5))"
                        default: return "\(r)"
                        }
                    }.joined(separator: " ")
                }
                let res1 = describeResolution(KeePassImport.resolve(first, in: document).items)
                let firstSummary = try document.apply(first)
                let mid = describeAlike(document)
                steps += 1
                if fresh {
                    // A pre-existing login that an item matches is merged into (a 1Password item) or is what the item repeats (a CSV
                    // row), never duplicated; the others stay, and every distinct item is an entry unless it was that repeat.
                    // Source items are distinct by title, password and notes in a 1PIF export. A CSV row repeats an earlier row with
                    // the same password (same site and user name), or, with no password, with the same title.
                    let distinct = Set(rows.map { csv ? ($0.password.isEmpty ? "t:\($0.title)" : "p:\($0.password)") : "\($0.title)|\($0.password)|\($0.note)" }).count
                    // Live entries after a first import = distinct source items + the pre-existing entries no source item matched.
                    let matchedPre = prePasswords.filter { password in rows.contains { $0.password == password } }.count
                    let expected = distinct + prePasswords.count - matchedPre
                    if allEntries(document).count != expected {
                        failures.append("\(csv ? "csv" : "1pif") seed \(seed) step \(step): \(allEntries(document).count) entries, expected \(expected); pre \(prePasswords) rows \(rows.map { "\($0.title):\($0.password):\($0.note)" })")
                    }
                }
                let markers = liveMarkers(document)
                if Set(markers).count != markers.count { failures.append("\(csv ? "csv" : "1pif") seed \(seed) step \(step): a marker is held twice \(markers)") }
                if !edited {
                    let held = Set(KeePassImport.known(in: document).filter { !$0.existing.inRecycleBin }.flatMap { entry -> [String] in
                        [entry.existing.password] + (entry.node.child("History")?.children(named: "Entry") ?? []).map { EntryMapping.string($0, "Password") ?? "" }
                    })
                    for row in rows where !row.password.isEmpty && !held.contains(row.password) { lost += 1 }
                }
                let before = XMLTree.serialize(document.root)
                let preview = document.preview(first)
                let res2 = describeResolution(KeePassImport.resolve(try makePlan(), in: document).items)
                let again = try document.apply(try makePlan())
                let quiet = !again.needsWrite && again.addedCount == 0 && again.updated == 0 && again.merged == 0 && again.refreshed == 0 && !preview.needsWrite
                if !quiet || XMLTree.serialize(document.root) != before {
                    failures.append("\(csv ? "csv" : "1pif") seed \(seed) step \(step): the second import changed something (added \(again.addedCount), updated \(again.updated), merged \(again.merged), refreshed \(again.refreshed); first: added \(firstSummary.addedCount), updated \(firstSummary.updated), merged \(firstSummary.merged), dup \(firstSummary.duplicatesSkipped))\n  mid \(mid)\n  res1 \(res1)\n  res2 \(res2)\n  rows \(rows.map { "\($0.title):\($0.password):\($0.note)" })\n  plan \(first.items.map { ($0.sourceID ?? "-").suffix(12) })\n  before \(pre)\n  after \(describeAlike(document))")
                    document = try emptyVault(); edited = false; rows = []; rows = [Row(title: "T1", password: "p1", note: ""), Row(title: "T1", password: "p2", note: "")]
                }
                if failures.count > 5 { break }
            }
        }
    }
    check("alike property: no second import changed anything and no marker was held twice", failures.prefix(6).joined(separator: "\n"), "")
    check("alike property: no incoming password was lost when nobody edited in Psss", "\(lost)", "0")
    expect("alike property: at least three thousand steps ran", steps >= 3000)
}

// MARK: Round 6: nothing to read is nothing stored (D2)

do {
    func card(_ n: Int, _ title: String, _ secure: String) -> String {
        "{\"uuid\":\"CARD\(n)\",\"typeName\":\"wallet.financial.CreditCard\",\"title\":\"\(title)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\(secure)}}"
    }
    let blank = try OnePasswordPIF.plan(from: try writeExport("empty-dates", [
        card(1, "Both empty", "\"ccnum\":\"4000000000000002\",\"cardholder\":\"Holder\",\"expiry_mm\":\"\",\"expiry_yy\":\"\",\"validFrom_mm\":\"\",\"validFrom_yy\":\"\""),
        card(2, "Spaces", "\"ccnum\":\"4000000000000002\",\"expiry_mm\":\" \",\"expiry_yy\":\"  \""),
        card(3, "Section parts", "\"ccnum\":\"4000000000000002\",\"sections\":[{\"title\":\"\",\"fields\":[{\"k\":\"monthYear\",\"n\":\"expiry\",\"t\":\"expires\",\"v\":{\"month\":\"\",\"year\":\"\"}}]}]"),
        card(4, "One part", "\"ccnum\":\"4000000000000002\",\"expiry_mm\":\"\",\"expiry_yy\":\"2030\""),
    ]), now: now)
    for title in ["Both empty", "Spaces", "Section parts"] {
        let item = item(blank, title)!
        check("empty dates: \(title) stores nothing and reports nothing", "\(item.fields.filter { $0.value == "/" || $0.role == .expiry || $0.label.lowercased().contains("valid") || $0.label.lowercased().contains("expir") }.count) \(item.issues.count)", "0 0")
    }
    check("empty dates: a year with no month is still kept as written and reported", "\(item(blank, "One part")!.fields.contains { $0.value == "/2030" }) \(issueCount(item(blank, "One part")!.issues, .unreadableValue))", "true 1")
    check("empty dates: the plan is clean for the first three", "\(blank.items.prefix(3).flatMap(\.issues).count)", "0")
}

// MARK: Messages name fields the way the person sees them

do {
    func record(_ n: Int, _ type: String, _ title: String, _ secure: String) -> String {
        "{\"uuid\":\"NAME\(n)\",\"typeName\":\"\(type)\",\"title\":\"\(title)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\(secure)}}"
    }
    func bad(_ name: String, _ kind: String = "monthYear") -> String { "\"sections\":[{\"title\":\"\",\"fields\":[{\"k\":\"\(kind)\",\"n\":\"\(name)\",\"t\":\"\",\"v\":\"junk\"}]}]" }
    let named = try OnePasswordPIF.plan(from: try writeExport("field-names", [
        record(1, "wallet.financial.CreditCard", "Names card", "\"ccnum\":\"4000000000000002\",\"validFrom_mm\":\"x\",\"validFrom_yy\":\"y\",\"expiry_mm\":\"13\",\"expiry_yy\":\"2027\""),
        record(2, "wallet.computer.License", "Names licence", bad("order_date", "date")),
        record(3, "wallet.financial.CreditCard", "Names section", "\"ccnum\":\"4000000000000002\"," + bad("validFrom")),
        record(4, "wallet.onlineservices.Email.v2", "Names mail", bad("pop_server", "date")),
        record(5, "wallet.mystery.Unknown", "Names unknown", "\"reg_code\":\"abc\""),
    ]), now: now)
    let texts = named.items.flatMap(\.issues).map(\.detail)
    expect("names: an unreadable valid-from date is called Valid from", texts.contains("the \u{2018}Valid from\u{2019} date could not be read, so it was saved as text exactly as written"))
    expect("names: an unreadable expiry is called Expiry date", texts.contains("the \u{2018}Expiry date\u{2019} could not be read, so it was saved as text exactly as written"))
    expect("names: other names are spelled in words", texts.contains("the \u{2018}Order date\u{2019} could not be read, so it was saved as text exactly as written") && texts.contains("the \u{2018}Pop server\u{2019} date could not be read, so it was saved as text exactly as written"))
    expect("names: an unknown type is a full sentence", texts.contains("this is an item type Psss does not know, so its fields were kept as a custom item"))
    let internalNames = ["validFrom", "expiry_mm", "expiry_yy", "ccnum", "cvv", "pop_", "smtp_", "reg_code", "cardholder", "order_date", "_mm", "_yy"]
    check("names: no produced text holds an internal field name", texts.filter { text in internalNames.contains { text.contains($0) } }.joined(separator: " | "), "")
    // Every text produced anywhere in this run, not only these.
    let leaked = ImportIssueLog.all.map(\.detail).filter { text in internalNames.contains { text.contains($0) } }
    check("names: nor does any text of any fixture", Array(Set(leaked)).sorted().joined(separator: " | "), "")
}

// MARK: Round 6b: partial dates, zero, look-alike twins that meet hand-made and CSV entries

do {
    func card(_ n: Int, _ title: String, _ secure: String) -> String {
        "{\"uuid\":\"PART\(n)\",\"typeName\":\"wallet.financial.CreditCard\",\"title\":\"\(title)\",\"createdAt\":1700000000,\"updatedAt\":1700500000,\"secureContents\":{\"ccnum\":\"4000000000000002\",\(secure)}}"
    }
    let part = try OnePasswordPIF.plan(from: try writeExport("partial-dates", [
        card(1, "Month only", "\"expiry_mm\":\"07\""), card(2, "Year only", "\"expiry_yy\":\"2031\""), card(3, "Valid month only", "\"validFrom_mm\":\"03\""),
        card(4, "Zero", "\"sections\":[{\"title\":\"\",\"fields\":[{\"k\":\"monthYear\",\"n\":\"validFrom\",\"t\":\"valid from\",\"v\":0}]}]"),
    ]), now: now)
    func lone(_ title: String) -> String { item(part, title)!.fields.filter { $0.role == .custom }.map { "\($0.label)=\($0.value)" }.joined(separator: ",") + " | " + item(part, title)!.issues.map(\.detail).joined(separator: " | ") }
    check("partial dates: a lone month is kept under Expiry and reported once", lone("Month only"), "Expiry date=07 | the expiry date is incomplete in 1Password and was saved as written")
    check("partial dates: a lone year is kept under Expiry and reported once", lone("Year only"), "Expiry date=2031 | the expiry date is incomplete in 1Password and was saved as written")
    check("partial dates: a lone valid-from month is kept under Valid from", lone("Valid month only"), "Valid from=03 | the valid from date is incomplete in 1Password and was saved as written")
    check("partial dates: zero means empty, nothing stored and nothing reported", lone("Zero"), " | ")
}

do {
    // A hand-made login and a CSV login, then an export whose items share one internal ID and match them.
    func handMade(_ title: String, _ password: String, csv: Bool) throws -> KDBXDocument {
        var document = try emptyVault()
        _ = try document.apply(try csvPlan("title,url,username,password\n\(title),site.example.net,u,\(password)\n"))
        if !csv, let node = entriesTitled(document, title).first { node.children.removeAll { $0.name == "CustomData" } }
        return document
    }
    for csv in [false, true] {
        var document = try handMade("hand", "p1", csv: csv)
        let twins = planOf([mk("1password:TWIN", "hand", password: "p1"), mk("1password:TWIN", "other", password: "p2")])
        var shared = twins
        shared.separateSharedIdentifiers()
        let summary = try document.apply(shared)
        check("twins \(csv ? "csv" : "hand-made"): the matching login is merged into, the other is added as a similar login, two entries", "\(allEntries(document).count) \(summary.merged) \(summary.addedCount) \(summary.similarAdded)", "2 1 1 1")
        check("twins \(csv ? "csv" : "hand-made"): another password is said only for the item whose password differs", summary.issues.filter { $0.detail.contains("different password") }.map { $0.item ?? "-" }.joined(separator: ","), "other")
        let markers = liveMarkers(document)
        expect("twins \(csv ? "csv" : "hand-made"): markers are distinct", Set(markers).count == markers.count)
        var again = twins
        again.separateSharedIdentifiers()
        let second = try document.apply(again)
        check("twins \(csv ? "csv" : "hand-made"): importing again changes nothing", "\(second.needsWrite) \(allEntries(document).count)", "false 2")
    }
    // A rich note merges too.
    var noteVault = try emptyVault()
    _ = try noteVault.apply(try csvPlan("title,url,username,password\nNote login,site.example.net,u,p1\n"))
    var richTwins = planOf([mk("1password:RICH", "Note login", password: "p1", extra: [ImportField(.notes, value: "kept notes")]), mk("1password:RICH", "Rich other", password: "p2")])
    richTwins.separateSharedIdentifiers()
    let richSummary = try noteVault.apply(richTwins)
    check("twins: a rich item with notes is merged into the matching entry", "\(richSummary.merged) \(allEntries(noteVault).count) \(strings(entry(noteVault, "Note login")!)["Notes"]?.value ?? "-")", "1 2 kept notes")
}

// MARK: Round 6: every kind of issue, by construction

do {
    // A plan with distinctive secrets: nothing the issues say may contain one of them, cleaned or not.
    let secrets = ["S3CR3T-A", "S3CR3T-B", "S3CR3T-C", "S3CR3T-D", "S3CR3T-E"]
    var items: [ImportItem] = []
    var changed = mk("1password:S1", "Changed secret", password: "S3CR3T-A\u{FFFF}tail")
    changed.history = [ImportRevision(password: "S3CR3T-B\u{FFFE}old", date: now), ImportRevision(password: "   ", date: now)]
    changed.fields.append(ImportField(.code, value: "      ", concealed: true))
    changed.fields.append(ImportField(.custom, label: "Pin", value: "S3CR3T-C\u{FFFF}", concealed: true))
    changed.sanitize()
    items.append(changed)
    var emptied = mk("1password:S2", "Emptied\u{FFFF}", password: "S3CR3T-D")
    emptied.sanitize(emptied: true)
    items.append(emptied)
    var vault = try emptyVault()
    let first = try vault.apply(planOf(items))
    var moved = items[0]
    moved.fields = moved.fields.map { var f = $0; if f.role == .password { f.value = "S3CR3T-E" }; return f }
    let again = try vault.apply(planOf([moved] + [mk("1password:S3", "Twin", password: "S3CR3T-A", site: "twin.example.net"), mk("1password:S4", "Twin two", password: "S3CR3T-B", site: "twin.example.net")]))
    let texts = (first.issues + again.issues).map(\.detail)
    expect("every kind: the secret-bearing fixture produced issues", texts.count >= 3)
    for secret in secrets { expect("every kind: no text holds \(secret)", !texts.contains { $0.contains(secret) }) }
}

// MARK: Limits by default, and what they say (D14)

do {
    let l = OnePasswordPIF.Limits.standard
    check("limits: the defaults are 10 MB a file, 50 MB in all, 100 a file per item", "\(l.attachmentBytes / 1_048_576) \(l.allAttachmentBytes / 1_048_576) \(l.attachmentsPerItem)", "10 50 100")
    func sparse(_ path: String, megabytes: Int) throws -> (String, Data) { ("attachments/\(path)", Data()) }
    let folder = try writeExport("big-files", [noteJSON(1, "One big"), noteJSON(2, "Six big")])
    func makeSparse(_ relative: String, megabytes: Int) throws {
        let url = folder.appendingPathComponent(relative)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        fm.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(megabytes) * 1_048_576)
        try handle.close()
    }
    try makeSparse("attachments/\(uid(1))/huge.bin", megabytes: 11)
    for i in 0..<6 { try makeSparse("attachments/\(uid(2))/part\(i).bin", megabytes: 9) }
    let p = try OnePasswordPIF.plan(from: folder, now: now)
    check("limits: an 11 MB file is refused, and the message names 10 MB", "\(item(p, "One big")!.attachments.count) \(item(p, "One big")!.issues.map(\.detail).joined())", "0 1 attachment is larger than the limit of 10 MB, so it was not imported")
    check("limits: 54 MB in six files keeps five, and the message names 50 MB", "\(item(p, "Six big")!.attachments.count) \(item(p, "Six big")!.issues.map(\.detail).joined())", "5 1 attachment was not imported because all attachments together can hold at most 50 MB")
    try? fm.removeItem(at: folder)
}

// MARK: KeePassXC round trip

if run(["which", "keepassxc-cli"]).status == 0 {
    let version = run(["keepassxc-cli", "--version"]).out.trimmingCharacters(in: .whitespacesAndNewlines)
    print("note keepassxc-cli \(version)")
    let path = work.appendingPathComponent("roundtrip.kdbx")
    let password = "xc pw\n"
    var vault = try KDBX.create(name: "Round trip", credentials: .init(password: "xc pw"), kdf: light)
    var imported = 0
    for name in ["logins", "codes", "history", "meta", "attachments", "cards", "kinds"] {
        imported += try vault.apply(plan(name, limits: attachmentLimits)).itemCount
    }
    try KDBX.save(vault).write(to: path)
    func cli(_ args: [String], input: String = password) -> (status: Int32, out: String) { run(["keepassxc-cli"] + args, input: input) }

    let listing = cli(["ls", "-q", "-R", "-f", path.path]).out
    expect("keepassxc: nested groups are listed", listing.contains("Work/Projects/In nested folder") && listing.contains("Work/In top folder"))
    expect("keepassxc: root entries are listed", listing.contains("Example Mail") && listing.contains("Fixture Card"))
    let mail = cli(["show", "-q", "-s", "--all", path.path, "Example Mail"]).out
    expect("keepassxc: the extra website is visible", mail.contains("https://accounts.example.net/login"))
    expect("keepassxc: the password is visible", mail.contains("Alpha-pass-1"))
    let card = cli(["show", "-q", "-s", "--all", path.path, "Fixture Card"]).out
    expect("keepassxc: custom strings are visible", card.contains("Security code") && card.contains("123") && card.contains("Valid from") && card.contains("01/2020") && card.contains("Contact Information: issuing bank"))
    let sections = cli(["show", "-q", "-s", "--all", path.path, "Code unreadable"]).out
    expect("keepassxc: an unreadable code is a visible field", sections.contains("One-time code") && sections.contains("not-a-code-fixture"))
    let tagged = cli(["show", "-q", "-s", "--all", path.path, "Tagged"]).out
    expect("keepassxc: tags are visible", tagged.contains("alpha") && tagged.contains("beta gamma"))
    check("keepassxc: a current six-digit code", cli(["show", "-q", "-t", path.path, "Code bare"]).out.trimmingCharacters(in: .whitespacesAndNewlines).count == 6 ? "six" : "other", "six")
    check("keepassxc: an eight-digit code from a link", cli(["show", "-q", "-t", path.path, "Code link"]).out.trimmingCharacters(in: .whitespacesAndNewlines).count == 8 ? "eight" : "other", "eight")
    expect("keepassxc: attachments are listed", cli(["show", "-q", "--show-attachments", path.path, "Two files"]).out.contains("copy of report.txt"))
    let exported = work.appendingPathComponent("exported.txt")
    for name in ["report.txt", "copy of report.txt"] {
        try? fm.removeItem(at: exported)
        _ = cli(["attachment-export", "-q", path.path, "Two files", name, exported.path])
        let original = try Data(contentsOf: fixtures.appendingPathComponent("attachments/attachments/\(uid(0x9001))/\(name)"))
        check("keepassxc: attachment \(name) exports with equal bytes", ((try? Data(contentsOf: exported)) == original) ? "equal" : "different", "equal")
    }

    // The XML export has the history, tags, groups and dates.
    let xml = try XMLTree.parse(Data(cli(["export", "-q", "-f", "xml", path.path]).out.utf8))
    var nodes: [(entry: XNode, path: [String])] = []
    func walk(_ group: XNode, _ names: [String]) {
        for child in group.children {
            if child.name == "Entry" { nodes.append((child, names)) }
            if child.name == "Group" { walk(child, names + [child.child("Name")?.text ?? ""]) }
        }
    }
    if let root = xml.child("Root")?.child("Group") { walk(root, []) }
    func exportedEntry(_ title: String) -> (entry: XNode, path: [String])? { nodes.first { EntryMapping.string($0.entry, "Title") == title } }
    check("keepassxc xml: every entry is there", "\(nodes.count)", "\(imported)")
    check("keepassxc xml: history count", "\(exportedEntry("History login")?.entry.child("History")?.children.count ?? -1)", "2")
    check("keepassxc xml: a trimmed history", "\(exportedEntry("Long history")?.entry.child("History")?.children.count ?? -1)", "10")
    check("keepassxc xml: tags (KeePassXC writes the separator as a comma)", (exportedEntry("Tagged")?.entry.child("Tags")?.text ?? "").replacingOccurrences(of: ",", with: ";"), "alpha;beta gamma")
    check("keepassxc xml: nested groups", exportedEntry("In nested folder")?.path.joined(separator: "/") ?? "", "Work/Projects")
    check("keepassxc xml: creation time", seconds(exportedEntry("Tagged")?.entry.child("Times")?.child("CreationTime")?.text), "1700000000.0")
    let taggedTimes = exportedEntry("Tagged")?.entry.child("Times")
    check("keepassxc xml: exact created and edited dates of an imported entry, as stored and as read", "\(taggedTimes?.child("CreationTime")?.text ?? "") \(taggedTimes?.child("LastModificationTime")?.text ?? "") \(shown(KeePassTime.date(taggedTimes?.child("CreationTime")?.text ?? "") ?? .distantPast)) \(shown(KeePassTime.date(taggedTimes?.child("LastModificationTime")?.text ?? "") ?? .distantPast))",
          "AOjl3A4AAAA= IInt3A4AAAA= 2023-11-14T22:13:20Z 2023-11-20T17:06:40Z")
    check("keepassxc xml: modification time", seconds(exportedEntry("Tagged")?.entry.child("Times")?.child("LastModificationTime")?.text), "1700500000.0")
    let oldest = exportedEntry("History login")?.entry.child("History")?.children.first
    check("keepassxc xml: a snapshot's time and password", "\(seconds(oldest?.child("Times")?.child("LastModificationTime")?.text)) \(oldest.flatMap { EntryMapping.string($0, "Password") } ?? "")", "1699000000.0 old-a1")

    // Saved by KeePassXC: do the source identifiers survive?
    func sources(_ document: KDBXDocument) -> Int { allEntries(document).filter { KeePassImport.sourceID(of: $0) != nil }.count }
    let expectedSources = sources(try KDBX.open(Data(contentsOf: path), credentials: .init(password: "xc pw")))
    _ = cli(["edit", "-q", "-u", "edited-in-keepassxc", path.path, "Tagged"])
    _ = cli(["add", "-q", "-u", "zed", "-p", path.path, "Added in KeePassXC"], input: password + "zeds-secret\n")
    let resaved = try KDBX.open(Data(contentsOf: path), credentials: .init(password: "xc pw"))
    let kept = sources(resaved)
    print("note entry custom data PSSS_SOURCE after a KeePassXC save: \(kept) of \(expectedSources) kept")
    check("keepassxc: PSSS_SOURCE survives a KeePassXC save", "\(kept)", "\(expectedSources)")
    check("keepassxc: the edit is there", vaultItem(resaved, titled: "Tagged")?.account ?? "", "edited-in-keepassxc")
    check("keepassxc: extra websites survive", EntryMapping.string(entry(resaved, "Example Mail")!, "KP2A_URL") ?? "", "https://accounts.example.net/login")
    check("keepassxc: attachments survive", "\(entry(resaved, "Two files")!.children(named: "Binary").count) \(resaved.binaries.count)", "2 \(vault.binaries.count)")
    let again = resaved.preview(try plan("logins"))
    check("keepassxc: a second import after a KeePassXC save adds nothing", "\(again.itemCount) \(again.duplicatesSkipped)", "0 2")
    let againMeta = resaved.preview(try plan("meta"))
    check("keepassxc: nor does the larger one", "\(againMeta.itemCount)", "0")

    // Text the file cannot hold, cleaned: KeePassXC opens the file and sees one of each name.
    let smallFile = work.appendingPathComponent("small.txt")
    try Data("small enough\n".utf8).write(to: smallFile)
    var hostileVault = try KDBX.create(name: "Hostile", credentials: .init(password: "xc pw"), kdf: light)
    try hostileVault.apply(hostilePlan(smallFile))
    let hostilePath = work.appendingPathComponent("hostile.kdbx")
    try KDBX.save(hostileVault).write(to: hostilePath)
    let hostileListing = cli(["ls", "-q", "-R", "-f", hostilePath.path])
    check("keepassxc: a file made from hostile text opens and lists the entry", "\(hostileListing.status) \(hostileListing.out.contains("Badtitle"))", "0 true")
    let hostileShow = cli(["show", "-q", "-s", "--all", hostilePath.path, "Folder/Badtitle"]).out
    check("keepassxc: and shows the cleaned fields", "\(hostileShow.contains("pass")) \(hostileShow.contains("Label (2)")) \(hostileShow.contains("Title (2)"))", "true true true")

    // An update: KeePassXC sees the new password and one history record.
    var updated = try KDBX.create(name: "Updated", credentials: .init(password: "xc pw"), kdf: light)
    let before = try plan("logins")
    try updated.apply(before)
    var after = before
    after.items[0].fields = after.items[0].fields.map { var f = $0; if f.role == .password { f.value = "Alpha-pass-2" }; return f }
    try updated.apply(after)
    let updatedPath = work.appendingPathComponent("updated.kdbx")
    try KDBX.save(updated).write(to: updatedPath)
    check("keepassxc: an updated entry shows the new password", cli(["show", "-q", "-s", "-a", "Password", updatedPath.path, "Example Mail"]).out.trimmingCharacters(in: .whitespacesAndNewlines), "Alpha-pass-2")
    let updatedXML = try XMLTree.parse(Data(cli(["export", "-q", "-f", "xml", updatedPath.path]).out.utf8))
    var updatedEntries: [XNode] = []
    updatedXML.walk { if $0.name == "Entry" && $0.child("String") != nil && $0.child("UUID") != nil { updatedEntries.append($0) } }
    check("keepassxc: and one history record with the old one", "\(updatedEntries.first { EntryMapping.string($0, "Title") == "Example Mail" }.map { historyPasswords($0) } ?? [])", "[\"Alpha-pass-1\"]")
} else {
    print("skip keepassxc round trip: keepassxc-cli not installed")
}

// MARK: Every issue kind has a fixture, and no text holds a secret, a type name or an internal string

do {
    let made = ImportIssueLog.all
    let seenKinds = Set(made.map(\.kind))
    let missing = ImportIssue.Kind.allCases.filter { !seenKinds.contains($0) }.map(\.rawValue)
    check("every kind: each issue kind is produced by at least one fixture", missing.joined(separator: ","), "")
    let forbidden = ["PSSS_", "xn--", "S3CR3T", "wallet.", "webforms.", "securenotes.", "passwords.", "category:", "(s)", "identifier", "hash", "marker", "UUID", "fingerprint"]
    var bad: [String] = []
    for issue in made {
        for word in forbidden where issue.detail.lowercased().contains(word.lowercased()) {
            // The sentences about a shared internal ID name an ID on purpose.
            if word == "identifier" || word == "UUID" { continue }
            bad.append("\(issue.kind.rawValue): \(word) in \(issue.detail)")
        }
        if issue.detail.contains("\u{FFFF}") || issue.detail.contains("\u{FFFE}") { bad.append("\(issue.kind.rawValue): an unstorable character in \(issue.detail)") }
    }
    var rawNames: [String] = []
    for issue in made {
        for name in ["validFrom", "expiry_mm", "expiry_yy", "validFrom_mm", "ccnum", "cvv", "pop_", "smtp_", "reg_code"] where issue.detail.contains(name) {
            rawNames.append("\(issue.kind.rawValue): \(name) in \(issue.detail)")
        }
    }
    check("every kind: no text holds a raw field name from the mapping tables", Array(Set(rawNames)).sorted().prefix(6).joined(separator: "\n"), "")
    check("every kind: no text holds a secret, a type name, a marker or a plural in brackets", Array(Set(bad)).sorted().prefix(8).joined(separator: "\n"), "")
}

try? fm.removeItem(at: work)
print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
