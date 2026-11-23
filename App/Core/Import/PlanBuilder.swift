import Foundation

/// A date as the source wrote it: absent (or 0), unusable (not a number, not finite, outside year 1 to 9999), or a date.
enum Stamp: Sendable, Equatable {
    case missing, invalid, ok(Date)

    var date: Date? { if case .ok(let date) = self { date } else { nil } }
}

/// One 1Password item after the Mac and Windows shapes are read into the same form. `secure` is `secureContents` on Mac
/// and `details` on Windows; its keys are the same.
struct OnePasswordRecord {
    var uuid: String
    /// `typeName`, or the Windows category code translated to it. A name this file does not know is kept as written.
    var typeName: String
    var title: String
    var created: Stamp
    var updated: Stamp
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
        /// Tags that held `;` or `,`, which separate tags in the vault file, and were changed to a space.
        var tagsAltered: Int
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
        /// A value that could not be made into a month and year: kept as written, as a plain custom field.
        var raw = false
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
            let trimmed = ImportText.clean(site).trimmingCharacters(in: .whitespacesAndNewlines)
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
        var codes: [(text: String, section: String)] = []
        var blankCodes: [ImportField] = []
        var unreadableValues: [String] = []

        func ingest(_ field: SectionField) {
            if field.name.hasPrefix("TOTP_") {
                if let text = Value.scalarText(field.value), !text.isEmpty {
                    seen.insert(field.name)
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        codes.append((text, ImportText.clean(field.section)))
                    } else if ImportText.clean(text) == text {
                        // Spaces are not a code: it is left out, and the item says so.
                        issue(.secretSpaces, String(localized: "the one-time code is only spaces and was left out"))
                    } else {
                        // Characters the file cannot hold: kept as it is so that cleaning reports it like any other secret.
                        blankCodes.append(ImportField(.code, value: text, concealed: true))
                    }
                }
                return
            }
            if kind == .card, field.name == "type" || field.kind == "cctype" { seen.insert(field.name); return }
            guard let rendered = render(field, typeName: r.typeName, shortYear: kind == .card && field.name == "expiry") else { return }
            seen.insert(field.name)
            if rendered.unreadable || field.raw { unreadableValues.append(field.title.isEmpty ? field.name : field.title) }
            if kind == .card, !rendered.unreadable, !field.raw {
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
                    guard !seen.contains(base) else { continue }
                    if let month = Value.integer(flat[key], in: 1...12), var yyyy = Value.integer(year, in: 0...9999), yyyy > 0 {
                        if yyyy < 100 { yyyy += 2000 }
                        ingest(SectionField(section: "", name: base, title: "", kind: "monthYear", value: NSNumber(value: yyyy * 100 + month)))
                    } else {
                        let text = "\(Value.scalarText(flat[key]) ?? "")/\(Value.scalarText(year) ?? "")"
                        ingest(SectionField(section: "", name: base, title: "", kind: "", value: text, raw: true))
                    }
                    continue
                }
                guard !seen.contains(key) else { continue }
                ingest(SectionField(section: "", name: key, title: "", kind: "", value: flat[key]))
            }
        }

        // Labels: the fixed ones first, then custom fields in order, so a custom field never takes a fixed name.
        var emptied = false
        var labels = ImportLabels()
        for i in cardFields.indices where !cardFields[i].label.isEmpty { cardFields[i].label = labels.claim(cardFields[i].label) }
        if var from = validFrom { from.label = labels.claim(from.label); validFrom = from }
        var customFields: [ImportField] = []
        func addCustom(_ c: Custom, claimed: Bool = false) {
            let named = c.section.isEmpty ? c.label : "\(c.section): \(c.label)"
            if !named.isEmpty, ImportText.clean(named).isEmpty { emptied = true }
            customFields.append(ImportField(.custom, label: claimed ? c.label : labels.claim(named), value: c.value, concealed: c.concealed))
        }
        if let validFrom { addCustom(validFrom, claimed: true) }
        for c in customs { addCustom(c) }

        // One-time codes: the first readable one is the code of a login, everything else stays as a hidden field. A later code
        // is named after its section when it has one, and by its position when not.
        var codeValue: String?
        for (index, code) in codes.enumerated() {
            if case .setup = TOTP.parse(code.text) {
                if kind == .login, codeValue == nil { codeValue = code.text; continue }
                if kind == .login { issue(.extraCode, String(localized: "another one-time code was kept as a hidden field")) }
            } else {
                issue(.unreadableCode, String(localized: "the one-time code could not be read and was kept as a hidden field"))
            }
            let label = index == 0 ? "One-time code" : !code.section.isEmpty ? "One-time code (\(code.section))" : "One-time code \(index + 1)"
            addCustom(Custom(name: "", label: label, section: "", value: code.text, concealed: true))
        }
        for name in unreadableValues {
            issue(.unreadableValue, String(localized: "the value of \(name) could not be read as a date and was kept as written"))
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
        fields += blankCodes
        if !notes.isEmpty { fields.append(ImportField(.notes, value: notes)) }
        if kind == .card { fields += cardFields.filter { [.securityCode, .pin].contains($0.role) } }
        fields += customFields

        // Dates. A missing or unusable one is replaced by the other, else by the import time, and the item says so.
        var missingDate = false
        let created: Date, modified: Date
        func why(_ stamp: Stamp) -> String { stamp == .invalid ? "out of range" : "missing" }
        switch (r.created, r.updated) {
        case (.ok(let c), .ok(let u)): created = c; modified = u
        case (.ok(let c), let other):
            created = c; modified = c; missingDate = true
            issue(.dateMissing, String(localized: "last edit date \(why(other)), used the creation date"))
        case (let other, .ok(let u)):
            created = u; modified = u; missingDate = true
            issue(.dateMissing, String(localized: "creation date \(why(other)), used the last edit date"))
        default:
            created = now; modified = now; missingDate = true
            issue(.dateMissing, String(localized: "creation and last edit dates \(why(r.created == .invalid || r.updated == .invalid ? .invalid : .missing)), used the import time"))
        }

        // Everything is cleaned the way the writer stores it before it is compared.

        // Password history, oldest first, without the password that is current.
        let current = fields.first { $0.role == .password }?.value
            ?? customs.first { $0.name == "password" }.map { $0.value } ?? ((secure["password"] as? String) ?? "")
        var revisions: [(date: Date, index: Int, password: String)] = []
        var badTimes = 0
        for (index, entry) in ((secure["passwordHistory"] as? [Any]) ?? []).enumerated() {
            guard let entry = entry as? [String: Any], let value = Value.scalarText(entry["value"]),
                  !value.isEmpty, value != current else { continue }
            let when = Value.stamp(entry["time"]).date
            if when == nil { badTimes += 1 }
            revisions.append((when ?? modified, index, value))
        }
        if badTimes > 0 {
            issue(.dateMissing, String(localized: "\(badTimes) password history dates missing or out of range, used the last edit date"))
        }
        revisions.sort { ($0.date, $0.index) < ($1.date, $1.index) }

        // Tags, with the favourite as one of them. The vault file separates tags with `;` and `,`, so those become a space.
        var tags: [String] = []
        var tagsAltered = 0
        for tag in r.tags + (r.favourite ? ["Favorite"] : []) {
            let plain = ImportText.clean(tag)
            let clean = plain.replacingOccurrences(of: ";", with: " ").replacingOccurrences(of: ",", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if clean != plain.trimmingCharacters(in: .whitespacesAndNewlines) { tagsAltered += 1 }
            if !clean.isEmpty, !tags.contains(clean) { tags.append(clean) }
        }

        var item = ImportItem(sourceID: r.uuid.isEmpty ? nil : "1password:" + r.uuid, kind: kind, title: title, fields: fields,
                              tags: tags, created: created, modified: modified,
                              history: revisions.map { ImportRevision(password: $0.password, date: $0.date) }, issues: issues)
        item.sanitize(emptied: emptied)
        // An item with no identifier gets one made of what it is, so a second import finds it again.
        if r.uuid.isEmpty { item.sourceID = "1password:nouuid:" + item.identityHash(8) }
        return Built(item: item, webFormFields: webFormFields, missingDate: missingDate, tagsAltered: tagsAltered)
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
        return lower == "pin" || lower == "telephonepin" || lower.hasSuffix("password") || lower.contains("secret")
            || (typeName == "wallet.government.SsnUS" && lower == "number")
    }

    /// The text and protection of a field by its kind, or nil when it is empty. `unreadable` is set when a date or month and year
    /// could not be read, so the raw text is kept instead.
    private static func render(_ field: SectionField, typeName: String, shortYear: Bool) -> (text: String, concealed: Bool, unreadable: Bool)? {
        guard let value = field.value, !(value is NSNull) else { return nil }
        let concealed = field.kind == "concealed" || isSecretName(field.name, typeName: typeName)
        var text: String
        var unreadable = false
        let raw = Value.scalarText(value) ?? Value.compactJSON(value)
        switch field.kind {
        case "date":
            // A date of 0 is a real date (1970-01-01) as long as the field has a value key, which this function has checked.
            if let day = Value.day(value) { text = day } else { text = raw; unreadable = true }
        case "monthYear":
            if let (year, month) = Value.yearMonth(value) {
                text = shortYear ? String(format: "%02d/%02d", month, year % 100) : String(format: "%02d/%04d", month, year)
            } else { text = raw; unreadable = true }
        default:
            if let dictionary = value as? [String: Any], field.kind == "address" || Value.looksLikeAddress(dictionary) {
                text = Value.addressText(dictionary)
            } else {
                text = raw
            }
        }
        // A secret is never trimmed: a value of only spaces is kept as it is (and reported), and only an empty one is skipped.
        let secret = concealed || (typeName.hasPrefix("wallet.financial.CreditCard") && ["ccnum", "cvv", "pin"].contains(field.name))
        if secret { return text.isEmpty ? nil : (text, concealed, unreadable) }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : (text, concealed, unreadable)
    }

    /// Reads JSON values the way 1Password writes them, which is loosely: a month can be a number or a string.
    /// Every read is total: no input can trap.
    enum Value {
        static func isBool(_ any: Any?) -> Bool {
            guard let number = any as? NSNumber else { return false }
            return CFGetTypeID(number) == CFBooleanGetTypeID()
        }

        /// A finite number from a number or a numeric string. NaN, infinity and booleans are nil.
        static func number(_ any: Any?) -> Double? {
            if isBool(any) { return nil }
            var d: Double?
            if let number = any as? NSNumber { d = number.doubleValue }
            else if let text = any as? String { d = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
            guard let d, d.isFinite else { return nil }
            return d
        }

        /// A whole number inside a range, from a number or string. Nil when it is not whole or out of the range.
        static func integer(_ any: Any?, in range: ClosedRange<Int>) -> Int? {
            guard let d = number(any) else { return nil }
            let whole = d.rounded(.down)
            guard whole >= Double(range.lowerBound), whole <= Double(range.upperBound) else { return nil }
            return Int(whole)
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

        /// The years 1 to 9999 as seconds since 1970, the range every date in the vault file can hold.
        private static let seconds: ClosedRange<Double> = -62_135_596_800...253_402_300_799

        /// A Unix time in seconds. A value of 13 digits or more is milliseconds. Zero, negative and missing are no date,
        /// and so is anything outside years 1 to 9999 (`.invalid`).
        static func stamp(_ any: Any?) -> Stamp {
            guard any != nil, !(any is NSNull) else { return .missing }
            guard var value = number(any) else { return .invalid }
            if value <= 0 { return .missing }
            if value >= 1e12 { value /= 1000 }
            guard seconds.contains(value) else { return .invalid }
            return .ok(Date(timeIntervalSince1970: value))
        }

        /// The calendar date of a Unix time read in UTC, as `YYYY-MM-DD`, or nil when it is not a number or outside years 1 to 9999.
        /// 1Password stores dates at 12:01 UTC.
        static func day(_ any: Any?) -> String? {
            guard let value = number(any), seconds.contains(value) else { return nil }
            let (y, m, d) = civil(daysSinceEpoch: floorDivide(Int64(value.rounded(.down)), 86_400))
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

        /// `YYYYMM` as a year and a month, or nil when it is not a whole number or the month is not 1 to 12 or the year not 1 to 9999.
        static func yearMonth(_ any: Any?) -> (Int, Int)? {
            guard let n = integer(any, in: 100...999_912) else { return nil }
            let month = n % 100, year = n / 100
            return (1...12).contains(month) && (1...9999).contains(year) ? (year, month) : nil
        }

        private static let addressKeys = ["street", "city", "state", "zip", "country"]

        static func looksLikeAddress(_ dictionary: [String: Any]) -> Bool { addressKeys.contains { dictionary[$0] != nil } }

        /// The known parts first, then every other key as `key: value`. Nested objects are flattened the same way, so no part is lost.
        static func addressText(_ dictionary: [String: Any]) -> String {
            var lines = addressKeys.compactMap { scalarText(dictionary[$0]) }.filter { !$0.isEmpty }
            func flatten(_ dictionary: [String: Any], prefix: String, skipKnown: Bool) {
                for key in dictionary.keys.sorted() where !(skipKnown && addressKeys.contains(key)) {
                    let name = prefix.isEmpty ? key : "\(prefix).\(key)"
                    let value = dictionary[key]
                    if let nested = value as? [String: Any] { flatten(nested, prefix: name, skipKnown: false) }
                    else if let text = scalarText(value) ?? value.flatMap({ $0 is NSNull ? nil : compactJSON($0) }), !text.isEmpty {
                        lines.append("\(name): \(text)")
                    }
                }
            }
            flatten(dictionary, prefix: "", skipKnown: true)
            return lines.joined(separator: "\n")
        }
    }
}
