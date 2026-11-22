import Foundation

/// One 1Password item after the Mac and Windows shapes are read into the same form. `secure` is `secureContents` on Mac
/// and `details` on Windows; its keys are the same.
struct OnePasswordRecord {
    var uuid: String
    /// `typeName`, or the Windows category code translated to it. A name this file does not know is kept as written.
    var typeName: String
    var title: String
    var created: Date?
    var updated: Date?
    var favourite: Bool
    var tags: [String]
    var location: String
    var websites: [String]
    var secure: [String: Any]
    /// The title of a numeric type, kept in `unknown_overview`.
    var fallbackTitle: String = ""
}

/// The category and field mapping from `docs/plans/1password-7-import.md`. It keys on `typeName` and on the field name `n`,
/// since titles vary with language and version. Shared later with 1PUX.
enum PlanBuilder {
    struct Built {
        var item: ImportItem
        var webFormFields: Int
        var missingDate: Bool
    }

    static let loginType = "webforms.WebForm"
    static let passwordType = "passwords.Password"
    static let noteType = "securenotes.SecureNote"
    static let cardType = "wallet.financial.CreditCard"

    /// Kinds that become a custom item and are not reported as unknown.
    static let customTypes: Set<String> = [
        "identities.Identity", "wallet.financial.BankAccountUS", "wallet.computer.Database", "wallet.government.DriversLicense",
        "wallet.government.HuntingLicense", "wallet.government.Passport", "wallet.government.SsnUS", "wallet.membership.Membership",
        "wallet.membership.RewardProgram", "wallet.onlineservices.Email.v2", "wallet.computer.UnixServer", "wallet.computer.Router",
        "wallet.computer.License", "wallet.onlineservices.Email", "wallet.onlineservices.GenericAccount", "wallet.onlineservices.FTP",
        "wallet.onlineservices.DotMac", "wallet.onlineservices.InstantMessenger", "wallet.onlineservices.ISP",
        "wallet.onlineservices.AmazonS3", "wallet.computer.MySQLConnection"
    ]

    /// The field that holds the host or address of kinds a person looks up by site.
    private static let hostField: [String: String] = [
        "wallet.computer.UnixServer": "url", "wallet.computer.Router": "server",
        "wallet.computer.Database": "hostname", "wallet.onlineservices.Email.v2": "pop_server"
    ]

    private struct SectionField {
        var section: String
        var name: String
        var title: String
        var kind: String
        var value: Any?
    }

    private struct Custom {
        var name: String
        var label: String
        var section: String
        var value: String
        var concealed: Bool
    }

    static func build(_ r: OnePasswordRecord, now: Date) -> Built {
        let title = r.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? r.fallbackTitle : r.title
        var issues: [ImportIssue] = []
        func issue(_ kind: ImportIssue.Kind, _ detail: String) {
            issues.append(ImportIssue(kind: kind, item: title.isEmpty ? nil : title, detail: detail))
        }
        let secure = r.secure

        // Websites: the list, else the one `location` repeats.
        var websites: [String] = []
        for site in r.websites + (r.websites.isEmpty ? [r.location] : []) {
            let trimmed = site.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !websites.contains(trimmed) { websites.append(trimmed) }
        }

        let kind: ImportItemKind
        switch r.typeName {
        case loginType: kind = .login
        case passwordType: kind = websites.isEmpty ? .custom : .login
        case noteType: kind = .note
        case cardType: kind = .card
        default:
            kind = .custom
            if !customTypes.contains(r.typeName) {
                issue(.unknownKind, String(localized: "the item type \(r.typeName) is not known, so its fields were kept as custom fields"))
            }
        }

        // Credentials.
        var username = "", password = "", webFormFields = 0
        if r.typeName == loginType {
            var haveUser = false, havePassword = false
            for case let field as [String: Any] in (secure["fields"] as? [Any]) ?? [] {
                let designation = (field["designation"] as? String)?.lowercased()
                let value = Value.scalarText(field["value"]) ?? ""
                if designation == "username", !haveUser { username = value; haveUser = true }
                else if designation == "password", !havePassword { password = value; havePassword = true }
                else { webFormFields += 1 }
            }
            if !havePassword { password = (secure["password"] as? String) ?? "" }
        } else if r.typeName == passwordType {
            password = Value.scalarText(secure["password"]) ?? ""
        }
        let notes = (secure["notesPlain"] as? String) ?? ""

        // Sections, then flat keys for what the sections lack.
        let sections = sectionFields(secure)
        var seen = Set<String>()
        var customs: [Custom] = []
        var cardFields: [ImportField] = []
        var validFrom: Custom?
        var codes: [String] = []

        func ingest(_ field: SectionField) {
            if field.name.hasPrefix("TOTP_") {
                if let text = Value.scalarText(field.value), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    codes.append(text)
                    seen.insert(field.name)
                }
                return
            }
            if kind == .card, field.name == "type" || field.kind == "cctype" { seen.insert(field.name); return }
            guard let rendered = render(field, typeName: r.typeName, shortYear: kind == .card && field.name == "expiry") else { return }
            seen.insert(field.name)
            if kind == .card {
                switch field.name {
                case "cardholder": cardFields.append(ImportField(.cardholder, value: rendered.text)); return
                case "ccnum": cardFields.append(ImportField(.cardNumber, value: rendered.text, concealed: true)); return
                case "expiry": cardFields.append(ImportField(.expiry, value: rendered.text)); return
                case "cvv": cardFields.append(ImportField(.securityCode, label: "Security code", value: rendered.text, concealed: true)); return
                case "pin": cardFields.append(ImportField(.pin, label: "PIN", value: rendered.text, concealed: true)); return
                case "validFrom":
                    validFrom = Custom(name: "validFrom", label: "Valid from", section: "", value: rendered.text, concealed: false)
                    return
                default: break
                }
            }
            let label = field.title.isEmpty ? field.name : field.title
            customs.append(Custom(name: field.name, label: label, section: field.section, value: rendered.text, concealed: rendered.concealed))
        }
        sections.forEach(ingest)

        if kind == .card || (kind == .custom && r.typeName != passwordType) {
            let reserved: Set<String> = ["fields", "URLs", "notesPlain", "passwordHistory", "sections", "unknown_details"]
            let flat = secure.filter { !reserved.contains($0.key) }
            for key in flat.keys.sorted() {
                if key.hasSuffix("_yy"), flat[String(key.dropLast(3)) + "_mm"] != nil { continue }
                if key.hasSuffix("_mm"), let year = flat[String(key.dropLast(3)) + "_yy"] {
                    let base = String(key.dropLast(3))
                    guard !seen.contains(base), let month = Value.number(flat[key]), let yyyy = Value.number(year) else { continue }
                    ingest(SectionField(section: "", name: base, title: "", kind: "monthYear", value: NSNumber(value: Int(yyyy) * 100 + Int(month))))
                    continue
                }
                guard !seen.contains(key) else { continue }
                ingest(SectionField(section: "", name: key, title: "", kind: "", value: flat[key]))
            }
        }

        // Labels: the fixed ones first, then custom fields in order, so a custom field never takes a fixed name.
        var labels = ImportLabels()
        for i in cardFields.indices where !cardFields[i].label.isEmpty { cardFields[i].label = labels.claim(cardFields[i].label) }
        if var from = validFrom { from.label = labels.claim(from.label); validFrom = from }
        var customFields: [ImportField] = []
        func addCustom(_ c: Custom, claimed: Bool = false) {
            let named = c.section.isEmpty ? c.label : "\(c.section): \(c.label)"
            customFields.append(ImportField(.custom, label: claimed ? c.label : labels.claim(named), value: c.value, concealed: c.concealed))
        }
        if let validFrom { addCustom(validFrom, claimed: true) }
        for c in customs { addCustom(c) }

        // One-time codes: the first readable one is the code of a login, everything else stays as a hidden field.
        var codeValue: String?
        for text in codes {
            if case .setup = TOTP.parse(text) {
                if kind == .login, codeValue == nil { codeValue = text; continue }
                if kind == .login { issue(.extraCode, String(localized: "another one-time code was kept as a hidden field")) }
            } else {
                issue(.unreadableCode, String(localized: "the one-time code could not be read and was kept as a hidden field"))
            }
            addCustom(Custom(name: "", label: "One-time code", section: "", value: text, concealed: true))
        }

        // The host or address of a server, router, database or mail account also becomes its website.
        if let name = hostField[r.typeName], let host = customs.first(where: { $0.name == name })?.value {
            let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !websites.contains(trimmed) { websites.append(trimmed) }
        }

        var fields: [ImportField] = []
        if kind == .card {
            fields += cardFields.filter { [.cardholder, .cardNumber, .expiry].contains($0.role) }
        } else if kind == .login || r.typeName == passwordType {
            if !username.isEmpty { fields.append(ImportField(.username, value: username)) }
            if !password.isEmpty { fields.append(ImportField(.password, value: password, concealed: true)) }
        }
        fields += websites.map { ImportField(.website, value: $0) }
        if let codeValue { fields.append(ImportField(.code, value: codeValue, concealed: true)) }
        if !notes.isEmpty { fields.append(ImportField(.notes, value: notes)) }
        if kind == .card { fields += cardFields.filter { [.securityCode, .pin].contains($0.role) } }
        fields += customFields

        // Dates.
        var missingDate = false
        let created = r.created ?? r.updated ?? { missingDate = true; return now }()
        let modified = r.updated ?? r.created ?? now
        if r.created == nil || r.updated == nil { missingDate = true }

        // Password history, oldest first, without the password that is current.
        let current = fields.first { $0.role == .password }?.value
            ?? customs.first { $0.name == "password" }?.value ?? (secure["password"] as? String) ?? ""
        var revisions: [(date: Date, index: Int, password: String)] = []
        for (index, entry) in ((secure["passwordHistory"] as? [Any]) ?? []).enumerated() {
            guard let entry = entry as? [String: Any], let value = Value.scalarText(entry["value"]),
                  !value.isEmpty, value != current else { continue }
            revisions.append((Value.epoch(entry["time"]) ?? modified, index, value))
        }
        revisions.sort { ($0.date, $0.index) < ($1.date, $1.index) }

        // Tags, with the favourite as one of them.
        var tags: [String] = []
        for tag in r.tags + (r.favourite ? ["Favorite"] : []) {
            let clean = tag.replacingOccurrences(of: ";", with: " ").replacingOccurrences(of: ",", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !clean.isEmpty, !tags.contains(clean) { tags.append(clean) }
        }

        let item = ImportItem(sourceID: r.uuid.isEmpty ? nil : "1password:" + r.uuid, kind: kind, title: title, fields: fields,
                              tags: tags, created: created, modified: modified,
                              history: revisions.map { ImportRevision(password: $0.password, date: $0.date) }, issues: issues)
        return Built(item: item, webFormFields: webFormFields, missingDate: missingDate)
    }

    // MARK: Sections and values

    private static func sectionFields(_ secure: [String: Any]) -> [SectionField] {
        let raw = (secure["sections"] as? [Any]) ?? ((secure["unknown_details"] as? [String: Any])?["sections"] as? [Any]) ?? []
        var found: [SectionField] = []
        for case let section as [String: Any] in raw {
            let title = ((section["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            for case let field as [String: Any] in (section["fields"] as? [Any]) ?? [] {
                guard let name = field["n"] as? String, let value = field["v"], !(value is NSNull) else { continue }
                found.append(SectionField(section: title, name: name, title: ((field["t"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                                          kind: (field["k"] as? String) ?? "", value: value))
            }
        }
        return found
    }

    /// Whether a value is a secret by its name, for kinds whose fields do not say so.
    static func isSecretName(_ name: String, typeName: String) -> Bool {
        let lower = name.lowercased()
        return lower == "pin" || lower == "telephonepin" || lower.hasSuffix("password")
            || (typeName == "wallet.government.SsnUS" && lower == "number")
    }

    /// The text and protection of a field by its kind, or nil when it is empty.
    private static func render(_ field: SectionField, typeName: String, shortYear: Bool) -> (text: String, concealed: Bool)? {
        guard let value = field.value, !(value is NSNull) else { return nil }
        let concealed = field.kind == "concealed" || isSecretName(field.name, typeName: typeName)
        var text: String
        switch field.kind {
        case "date":
            if let seconds = Value.number(value) { text = Value.day(Int64(seconds.rounded(.down))) } else { text = Value.scalarText(value) ?? Value.compactJSON(value) }
        case "monthYear":
            if let number = Value.number(value), let (year, month) = Value.yearMonth(number) {
                text = shortYear ? String(format: "%02d/%02d", month, year % 100) : String(format: "%02d/%04d", month, year)
            } else { text = Value.scalarText(value) ?? Value.compactJSON(value) }
        default:
            if let dictionary = value as? [String: Any], field.kind == "address" || Value.looksLikeAddress(dictionary) {
                text = Value.addressText(dictionary)
            } else {
                text = Value.scalarText(value) ?? Value.compactJSON(value)
            }
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : (text, concealed)
    }

    /// Reads JSON values the way 1Password writes them, which is loosely: a month can be a number or a string.
    enum Value {
        static func isBool(_ any: Any?) -> Bool {
            guard let number = any as? NSNumber else { return false }
            return CFGetTypeID(number) == CFBooleanGetTypeID()
        }

        static func number(_ any: Any?) -> Double? {
            if isBool(any) { return nil }
            if let number = any as? NSNumber { return number.doubleValue }
            if let text = any as? String { return Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
            return nil
        }

        /// Text for a string, number or boolean. Nil for objects, arrays and null.
        static func scalarText(_ any: Any?) -> String? {
            guard let any, !(any is NSNull) else { return nil }
            if let text = any as? String { return text }
            if isBool(any), let number = any as? NSNumber { return number.boolValue ? "true" : "false" }
            if let number = any as? NSNumber {
                let d = number.doubleValue
                if d == d.rounded(), abs(d) < 1e15 { return String(number.int64Value) }
                return number.stringValue
            }
            return nil
        }

        static func compactJSON(_ any: Any) -> String {
            guard JSONSerialization.isValidJSONObject(any),
                  let data = try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys, .withoutEscapingSlashes]) else { return String(describing: any) }
            return String(decoding: data, as: UTF8.self)
        }

        /// A Unix time in seconds. A value of 13 digits or more is milliseconds. Zero, negative and missing mean no date.
        static func epoch(_ any: Any?) -> Date? {
            guard var seconds = number(any), seconds > 0 else { return nil }
            if seconds >= 1e12 { seconds /= 1000 }
            return Date(timeIntervalSince1970: seconds)
        }

        /// The calendar date of a Unix time read in UTC, as `YYYY-MM-DD`. 1Password stores dates at 12:01 UTC.
        static func day(_ seconds: Int64) -> String {
            let (y, m, d) = civil(daysSinceEpoch: floorDivide(seconds, 86_400))
            return String(format: "%04d-%02d-%02d", y, m, d)
        }

        static func floorDivide(_ a: Int64, _ b: Int64) -> Int64 {
            let q = a / b
            return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
        }

        /// Days since 1970-01-01 to a proleptic Gregorian date.
        static func civil(daysSinceEpoch days: Int64) -> (year: Int, month: Int, day: Int) {
            let z = days + 719_468
            let era = floorDivide(z, 146_097)
            let doe = z - era * 146_097
            let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
            let mp = (5 * doy + 2) / 153
            let d = Int(doy - (153 * mp + 2) / 5 + 1)
            let m = Int(mp < 10 ? mp + 3 : mp - 9)
            let y = Int(yoe + era * 400) + (m <= 2 ? 1 : 0)
            return (y, m, d)
        }

        /// `YYYYMM` as a year and a month, or nil when the month is not 1 to 12.
        static func yearMonth(_ value: Double) -> (Int, Int)? {
            let n = Int(value)
            let month = n % 100, year = n / 100
            return (1...12).contains(month) && year > 0 ? (year, month) : nil
        }

        private static let addressKeys = ["street", "city", "state", "zip", "country"]

        static func looksLikeAddress(_ dictionary: [String: Any]) -> Bool { addressKeys.contains { dictionary[$0] != nil } }

        static func addressText(_ dictionary: [String: Any]) -> String {
            var lines = addressKeys.compactMap { scalarText(dictionary[$0]) }.filter { !$0.isEmpty }
            let extra = dictionary.keys.filter { !addressKeys.contains($0) }.sorted().compactMap { scalarText(dictionary[$0]) }.filter { !$0.isEmpty }
            lines += extra
            return lines.joined(separator: "\n")
        }
    }
}
