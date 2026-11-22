import Darwin
import Foundation

// Hostless checks for the 1Password 7 importer: the 1PIF reader, the mapping, the duplicate rule, the KDBX writer, the store,
// the CSV fallback, limits, a large generated export and a KeePassXC round trip. Run with scripts/test-import.sh.
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
func iso(_ seconds: TimeInterval) -> String { KeePassTime.string(Date(timeIntervalSince1970: seconds)) }

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
        var data = Data("attachment \(i)\n".utf8)
        data.append(Data(repeating: UInt8(i % 251), count: attachmentBytes - data.count))
        try data.write(to: folder.appendingPathComponent("file\(i).bin"))
    }
}

let largeCount = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_ITEMS"] ?? "") ?? 50_000
let largeFiles = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_FILES"] ?? "") ?? 20
let largeFileBytes = Int(ProcessInfo.processInfo.environment["PSSS_IMPORT_LARGE_FILE_MB"] ?? "") ?? 5
do {
    let directory = work.appendingPathComponent("large.1pif")
    let started = Date()
    try generateLarge(count: largeCount, attachmentFiles: largeFiles, attachmentBytes: largeFileBytes * 1024 * 1024, at: directory)
    let dataSize = (try? fm.attributesOfItem(atPath: directory.appendingPathComponent("data.1pif").path)[.size] as? Int) ?? 0
    print("note generated \(largeCount) items (\(dataSize / (1024 * 1024)) MB of records) and \(largeFiles) attachments of \(largeFileBytes) MB in \(Int(Date().timeIntervalSince(started))) s")

    let baseline = peakResidentMB()
    let readStart = Date()
    let big = try OnePasswordPIF.plan(from: directory, now: now)
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
    check("large: every item is added", "\(summary.itemCount)", "\(largeCount)")
    expect("large: applying stays under 60 s", applySeconds < 60)
    let saveStart = Date()
    let bytes = try KDBX.save(vault)
    let reopened = try KDBX.open(bytes, credentials: .init(password: "pw"))
    print("note saved and reopened \(bytes.count / (1024 * 1024)) MB in \(String(format: "%.1f", Date().timeIntervalSince(saveStart))) s, peak memory \(peakResidentMB()) MB in all")
    check("large: reopened vault holds every item", "\(reopened.items().count)", "\(largeCount)")
    check("large: reopened vault holds every attachment", "\(reopened.binaries.count)", "\(largeFiles)")
    expect("large: the whole run stays under 2500 MB of peak memory", peakResidentMB() < 2500)
    try? fm.removeItem(at: directory)
}

// MARK: Every fixture reads back as the kind the plan says

do {
    let names = ["logins", "codes", "cards", "notes", "kinds", "sections", "history", "meta", "attachments", "noattachments", "windows", "malformed"]
    for name in names {
        let p = try plan(name)
        var vault = try emptyVault()
        let summary = try vault.apply(p)
        let back = try reopen(vault)
        let items = back.items()
        check("\(name): every plan item is in the file", "\(items.count)", "\(summary.itemCount)")
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
    check("codes: unreadable value is kept as a hidden field", strings(bad)["One-time code"]?.value ?? "", "secret123")
    expect("codes: and it is protected", strings(bad)["One-time code"]?.protected == true)
    let two = entry(back, "Code two")!
    check("codes: the first of two is the code", vaultItem(back, titled: "Code two")?.otpSecret ?? "", "MFRGGZDFMZTWQ2LK")
    expect("codes: the second stays as a hidden field", strings(two)["One-time code"]?.value.contains("GEZDGNBVGY3TQOJQ") == true)
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
    check("kinds: an unknown and a numeric type are named", unknown.map { $0.detail.contains("wallet.example.Gadget") || $0.detail.contains("114") ? "named" : "unnamed" }.joined(separator: ","), "named,named")
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
    check("meta: the duplicate identifier is skipped", "\(summary.duplicatesSkipped) \(summary.itemCount)", "1 8")
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
    check("dates: the writer's time text equals the system's", ImportTime.iso(Date(timeIntervalSince1970: 1_795_386_026)), KeePassTime.string(Date(timeIntervalSince1970: 1_795_386_026)))
    check("dates: and for a leap day", ImportTime.iso(Date(timeIntervalSince1970: 951_782_400 + 45_678)), KeePassTime.string(Date(timeIntervalSince1970: 951_782_400 + 45_678)))
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
    check("attachments: links out of the folder are rejected and reported", "\(item(p, "Links")!.attachments.count) \(item(p, "Links")!.issues.count)", "0 2")
    check("attachments: over the limit is reported and the small file stays", "\(item(p, "Too large")!.attachments.map(\.name).joined()) \(issueCount(all, .attachmentTooLarge))", "small.txt 1")
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
    check("attachments: a total limit is reported", "\(issueCount(limited.items.flatMap(\.issues), .attachmentsTotalLimit)) \(issueCount(limited.items.flatMap(\.issues), .attachmentLimitPerItem))", "2 1")
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
    check("windows: an unknown category is named", p.items.flatMap(\.issues).first { $0.kind == .unknownKind }?.detail.contains("category:199") == true ? "named" : "unnamed", "named")
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
    check("duplicates: preview counts without writing", "\(preview.duplicatesSkipped) \(preview.similarAdded) \(preview.logins) \(vault.items().count)", "1 1 1 2")
    let summary = try vault.apply(p)
    check("duplicates: same site, username and password is skipped", "\(summary.duplicatesSkipped)", "1")
    check("duplicates: same site and username with another password is added and listed", "\(summary.similarAdded) \(issueCount(summary.issues, .similarLogin)) \(summary.logins)", "1 1 1")
    check("duplicates: the vault holds the original two and the one added", "\(vault.items().count)", "3")
    let second = try vault.apply(p)
    check("duplicates: a second import adds nothing", "\(second.itemCount) \(second.duplicatesSkipped) \(vault.items().count)", "0 2 3")
    var other = ImportPlan(source: .csv)
    other.items = [ImportItem(sourceID: nil, kind: .login, title: "Other site", fields: [ImportField(.username, value: "alex@example.net"), ImportField(.password, value: "Alpha-pass-1"), ImportField(.website, value: "other.example.net")], created: now, modified: now)]
    check("duplicates: the same credentials on another site are new", ImportDuplicates.classify(other, against: KeePassImport.existing(in: vault)).map { "\($0)" }.joined(separator: ","), "add")
    var twice = other
    twice.items.append(twice.items[0])
    check("duplicates: the same login twice in one plan is added once", ImportDuplicates.classify(twice, against: []).map { "\($0)" }.joined(separator: ","), "add,duplicate")
    var card = ImportPlan(source: .csv)
    card.items = [ImportItem(sourceID: nil, kind: .card, title: "Card", fields: [ImportField(.cardNumber, value: "1")], created: now, modified: now)]
    check("duplicates: only logins are compared by site", ImportDuplicates.classify(card, against: [ImportDuplicates.Existing(sourceID: nil, hosts: [], username: "", password: "1")]).map { "\($0)" }.joined(separator: ","), "add")
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
    check("store: the import is added", "\(summary.itemCount) \(store.items().count)", "8 8")
    check("store: one commit made one rollback copy", "\(backups())", "1")
    let onDisk = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw"))
    check("store: the file holds the items", "\(onDisk.items().count)", "8")
    let again = try store.apply(p)
    check("store: importing again adds nothing and writes nothing", "\(again.itemCount) \(backups())", "0 1")
    do { _ = try SampleVaultStore().apply(p); failures += 1; print("FAIL the sample vault took an import") } catch ImportError.sampleVault { print("ok   the sample vault refuses an import") }
    let other = try plan("logins")
    let third = try store.apply(other)
    check("store: a later import is one more commit", "\(third.itemCount) \(backups()) \(store.items().count)", "2 2 10")
    // A changed file on disk fails the write and leaves the open vault as it was.
    let intruder = try KDBX.open(Data(contentsOf: url), credentials: .init(password: "pw"))
    try KDBX.save(intruder).write(to: url)
    let codes = try plan("codes")
    do { _ = try store.apply(codes); failures += 1; print("FAIL a changed file was overwritten") } catch VaultStoreError.changedOnDisk { print("ok   a file changed elsewhere refuses the import") }
    check("store: and the open vault holds nothing of it", "\(store.items().count)", "10")
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
    let text = "Title,Url,Username,Password,OTPAuth,Notes\n\"login name\",\"example.com\",\"usernamed\",\"password\",,\"notes\",\n\"Just password\",\"google.com\",,\"pw\",,\"some notes\",\n\"Secure Notes\",,,,,\"a note body\",\n\"Credit Card\",,,,,,\n\"Coded\",\"coded.example.com\",\"c\",\"p\",\"not a code\",,\n,,,,,,\n"
    let p = try CSVSource.plan(from: text, now: now)
    check("csv: logins", "\(p.items.count) \(p.items.map(\.title).joined(separator: ","))", "3 login name,Just password,Coded")
    check("csv: skipped rows are counted, empty lines are not", "\(p.skipped.rows) \(p.recordCount)", "2 5")
    check("csv: and named by title with a reason", p.issues.filter { $0.kind == .skippedRow }.map { $0.item ?? "" }.joined(separator: ","), "Secure Notes,Credit Card")
    check("csv: a note row says so", p.issues.first { $0.item == "Secure Notes" }?.detail.contains("note") == true ? "note" : "other", "note")
    check("csv: a row with no username has none", item(p, "Just password")!.username, "")
    check("csv: the trailing comma is harmless", item(p, "login name")!.first(.notes) ?? "", "notes")
    check("csv: an unreadable code is kept as a hidden field", "\(item(p, "Coded")!.fields.first { $0.label == "One-time code" }?.value ?? "") \(issueCount(p.items.flatMap(\.issues), .unreadableCode))", "not a code 1")
    check("csv: dates are the import time and counted", "\(p.items[0].created == now) \(p.missingDates)", "true 3")
    check("csv: no source identifier", "\(p.items[0].sourceID == nil)", "true")
    expectThrows("csv: not a passwords file", .notAnExport) { _ = try CSVSource.plan(from: "a,b\n1,2\n", now: now) }
    expectThrows("csv: nothing but a header", .empty) { _ = try CSVSource.plan(from: "Title,Url,Username,Password\n", now: now) }
    // The existing reader still works for its current caller.
    check("csv: CSVImport is unchanged", "\(try CSVImport.items(from: text).items.count) \(try CSVImport.items(from: text).skipped)", "3 2")
    var vault = try emptyVault()
    let summary = try vault.apply(p)
    check("csv: applied", "\(summary.logins) \(vault.items().count)", "3 3")
    let strs = strings(entry(vault, "Coded")!)
    check("csv: no source on an entry without an identifier", "\(KeePassImport.sourceID(of: entry(vault, "Coded")!) == nil)", "true")
    check("csv: the unreadable code is protected", "\(strs["One-time code"]?.protected ?? false)", "true")
    let csvFile = work.appendingPathComponent("login.csv")
    try Data(text.utf8).write(to: csvFile)
    check("csv: the source is detected from the file", "\(try ImportSources.plan(from: csvFile, now: now).source)", "csv")
    check("csv: and from the folder", "\(try ImportSources.plan(from: fixtures.appendingPathComponent("logins"), now: now).source)", "onePasswordPIF")
}

// MARK: The owner's export, when it is there

do {
    let export = URL(fileURLWithPath: "build/1p7-export.1pif")
    if fm.fileExists(atPath: export.path) {
        let p = try OnePasswordPIF.plan(from: export, now: now)
        check("real: four items in", "\(p.items.count) \(p.recordCount)", "4 4")
        let note = item(p, "Secure Notes")!
        check("real: a secure note with its tag", "\(note.kind) \(note.tags.joined(separator: ",")) \(note.first(.notes) ?? "")", "note some this is the note. add as markdown, if you want.")
        let pass = item(p, "Just password")!
        check("real: a login for google.com with no username", "\(pass.kind) \(pass.websites.joined()) \(pass.username.isEmpty)", "login google.com true")
        check("real: with its password and notes", "\(pass.password) \(pass.first(.notes) ?? "")", "why the hell just the password? some notes")
        let login = item(p, "login name")!
        check("real: login credentials", "\(login.kind) \(login.username) \(login.password) \(login.websites.joined())", "login usernamed password example.com")
        check("real: two tags", login.tags.joined(separator: ","), "one tag,two tag")
        check("real: one custom field labelled with its section", login.fields.filter { $0.label == "Some section: label of field" }.map(\.value).joined(), "field value.")
        check("real: the unreadable one-time code is a concealed custom field", "\(login.fields.first { $0.label == "One-time code" }?.value ?? "") \(login.fields.first { $0.label == "One-time code" }?.concealed ?? false) \(login.first(.code) == nil)", "secret123 true true")
        check("real: and it is reported", "\(issueCount(login.issues, .unreadableCode))", "1")
        check("real: nothing else is custom", "\(login.fields.filter { $0.role == .custom }.count)", "2")
        let card = item(p, "Credit Card")!
        check("real: card holder, number and expiry 12/23", "\(card.first(.cardholder) ?? "") \(card.first(.cardNumber) ?? "") \(card.first(.expiry) ?? "")", "Name on Card 1234123412341234 12/23")
        check("real: security code and valid from", "\(card.first(.securityCode) ?? "") \(card.fields.first { $0.label == "Valid from" }?.value ?? "")", "223 01/2000")
        check("real: issuing bank", card.fields.first { $0.label == "Contact Information: issuing bank" }?.value ?? "", "Swedbank as issueing bank")
        let values = card.fields.map(\.value)
        check("real: no value is duplicated", "\(values.count) \(Set(values).count)", "6 6")
        check("real: dates are the export's", "\(note.created.timeIntervalSince1970) \(note.modified.timeIntervalSince1970)", "1795386180.0 1795386180.0")
        var vault = try emptyVault()
        let summary = try vault.apply(p)
        let back = try reopen(vault)
        check("real: it reads back as a note, two logins and a card", "\(back.items().count) \(summary.logins) \(summary.notes) \(summary.cards) \(summary.others)", "4 2 1 1 0")
        check("real: only the unreadable code is an issue", "\(summary.issues.count)", "1")
        let csv = URL(fileURLWithPath: "build/1p7-export.csv")
        if fm.fileExists(atPath: csv.path) {
            let c = try CSVSource.plan(from: csv, now: now)
            check("real csv: two logins, two rows skipped for a reason", "\(c.items.count) \(c.skipped.rows) \(c.issues.filter { $0.kind == .skippedRow }.count)", "2 2 2")
            let merged = try vault.apply(c)
            check("real csv: the same logins are duplicates of the 1PIF import", "\(merged.duplicatesSkipped) \(merged.itemCount)", "2 0")
        } else { print("skip real csv: build/1p7-export.csv not found") }
    } else {
        print("skip real export: build/1p7-export.1pif not found")
    }
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
    expect("keepassxc: an unreadable code is a visible field", sections.contains("One-time code") && sections.contains("secret123"))
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
} else {
    print("skip keepassxc round trip: keepassxc-cli not installed")
}

try? fm.removeItem(at: work)
print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
