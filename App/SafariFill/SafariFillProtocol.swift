import Foundation

// What the Safari extension's popup may ask its handler on iPhone and iPad: `status` (what can be filled, with nothing to fill it
// with) and `release` (the values of one card or address). See `docs/plans/ios-safari-fill.md`, section 4. This is not
// `BrowserProtocol`. Nothing here logs, and no reply to a refused request carries anything but an error word.
//
// The origin is the popup's word, which only the extension's own pages can send; the page checks it again before it writes.

/// Why a request was refused. The word is all the popup is told.
enum SafariFillRefusal: String, Sendable {
    /// Another version or another request type.
    case unsupported
    /// Not the exact shape of a request: a missing, extra, wrong-typed or over-long value, or a role the kind does not have.
    case invalid
    /// A page that may not be filled.
    case forbidden
    /// No grant that may be used now.
    case locked
    /// A reference or vault that the current grant does not hold.
    case notFound = "not-found"
    /// The Keychain or the vault list cannot be read. Nothing is released.
    case unavailable
}

/// Which pages may be filled. Takes only a serialized origin, as `URL.origin` writes one: `https://host` with an optional port,
/// lowercase ASCII (international names in their `xn--` form), and nothing else: no user, path, query or fragment, no default
/// port, a numeric host only as four plain decimals, and an IPv6 address only in hexadecimal groups without leading zeros.
enum SafariFillOrigin {
    static let maxLength = 300
    private static let maxHost = 253
    private static let loopback: Set<String> = ["localhost", "127.0.0.1", "[::1]"]
    #if DEBUG
    static let loopbackHTTPByDefault = true
    #else
    static let loopbackHTTPByDefault = false
    #endif

    /// HTTPS only. `allowsLoopbackHTTP` (Debug builds) also takes plain HTTP to this device.
    static func isAllowed(_ origin: String, allowsLoopbackHTTP: Bool) -> Bool {
        guard origin.utf16.count <= maxLength, origin.utf8.allSatisfy({ $0 > 0x20 && $0 < 0x7F }) else { return false }
        let secure = origin.hasPrefix("https://")
        guard secure || (allowsLoopbackHTTP && origin.hasPrefix("http://")) else { return false }
        let authority = origin.utf8.dropFirst(secure ? 8 : 7)
        let host: Substring.UTF8View, rest: Substring.UTF8View
        if authority.first == UInt8(ascii: "[") {
            guard let close = authority.firstIndex(of: UInt8(ascii: "]")) else { return false }
            let inside = authority[authority.index(after: authority.startIndex)..<close]
            guard isIPv6(String(decoding: inside, as: UTF8.self)) else { return false }
            host = authority[...close]
            rest = authority[authority.index(after: close)...]
        } else {
            let colon = authority.firstIndex(of: UInt8(ascii: ":")) ?? authority.endIndex
            host = authority[..<colon]
            rest = authority[colon...]
            guard host.allSatisfy({ "abcdefghijklmnopqrstuvwxyz0123456789-._".utf8.contains($0) }) else { return false }
            // No empty label; one dot at the end names the same host fully.
            var labels = host.split(separator: UInt8(ascii: "."), omittingEmptySubsequences: false)
            if labels.count > 1, labels.last?.isEmpty == true { labels.removeLast() }
            guard labels.allSatisfy({ !$0.isEmpty }) else { return false }
            // A browser reads a host that ends in a number as an IPv4 address, and writes that one way only.
            if let last = labels.last, isNumber(String(decoding: last, as: UTF8.self)) {
                guard labels.count == 4, host.last != UInt8(ascii: "."), labels.allSatisfy({ label in
                    let text = String(decoding: label, as: UTF8.self)
                    return UInt8(text).map { String($0) == text } == true
                }) else { return false }
            }
        }
        guard !host.isEmpty, host.count <= maxHost else { return false }
        if !rest.isEmpty {
            let port = rest.dropFirst()
            guard rest.first == UInt8(ascii: ":"), (1...5).contains(port.count), port.first != UInt8(ascii: "0"),
                  port.allSatisfy({ (UInt8(ascii: "0")...UInt8(ascii: "9")).contains($0) }),
                  let number = Int(String(decoding: port, as: UTF8.self)), number <= 65535,
                  number != (secure ? 443 : 80) else { return false }
        }
        return secure || loopback.contains(String(decoding: host, as: UTF8.self))
    }

    /// Decimal, or hexadecimal after `0x`.
    private static func isNumber(_ label: String) -> Bool {
        if label.hasPrefix("0x") { return label.dropFirst(2).allSatisfy(\.isHexDigit) }
        return !label.isEmpty && label.allSatisfy(\.isNumber)
    }

    /// Eight groups, or fewer around one `::`.
    private static func isIPv6(_ text: String) -> Bool {
        let halves = text.components(separatedBy: "::")
        guard halves.count <= 2 else { return false }
        let groups = halves.flatMap { $0.isEmpty ? [] : $0.split(separator: ":", omittingEmptySubsequences: false) }
        return (halves.count == 2 ? groups.count < 8 : groups.count == 8) && groups.allSatisfy { group in
            (1...4).contains(group.count) && group.allSatisfy { "0123456789abcdef".contains($0) } && (group.count == 1 || group.first != "0")
        }
    }
}

/// The person's own text made fit to show in the popup before anything is released: one line, nothing invisible or reordering,
/// no card number, cut short. It changes only what `status` says, never what is filled. The popup still uses `textContent`.
///
/// A card number can be typed into any name, spaced, dashed, dotted, split by words, written in other digits or shared between
/// the texts of a row, so nothing tries to find it: the texts of one row are counted together, and when they hold more than
/// `maxPlainDigits` digits of any kind, only the last four of the row stay. A house number, year or postcode stays; a phone
/// number in a label does not. Numbers spelled out in words are not recognized, and a number shared between rows is not either.
enum SafariFillText {
    static let maxCharacters = 80
    static let maxScalars = 160
    /// Longer text is cut before it is read, and its row then shows no digit at all.
    static let maxInput = 4096
    static let maxPlainDigits = 7
    static let revealedDigits = 4
    private static let maxMarksPerBase = 4

    /// A text that is a row of its own.
    static func line(_ text: String) -> String { row([text])[0] }

    /// The texts of one row, in the order shown. `shown` is how many digits the row shows besides them (a card's last four): they
    /// count towards the limit and come out of the four that may stay.
    static func row(_ texts: [String], shown: Int = 0) -> [String] {
        var lines = texts.map(clean)
        let anyCut = lines.contains { $0.cut }
        let total = lines.reduce(shown) { $0 + $1.scalars.reduce(0) { $0 + digits($1) } }
        if anyCut || total > maxPlainDigits {
            var room = anyCut ? 0 : max(0, revealedDigits - shown)
            for index in lines.indices.reversed() { mask(&lines[index].scalars, room: &room) }
        }
        return lines.map { truncated(String(String.UnicodeScalarView($0.scalars)), cut: $0.cut) }
    }

    /// One line without anything invisible, not yet masked or cut short, and whether the end was left unread.
    private static func clean(_ text: String) -> (scalars: [Unicode.Scalar], cut: Bool) {
        var kept: [Unicode.Scalar] = []
        var space = false
        var marks = 0
        var read = 0
        var cut = false
        for scalar in text.unicodeScalars {
            read += 1
            if read > maxInput { cut = true; break }
            if scalar.properties.isWhitespace || scalar.value == 0x85 {
                space = !kept.isEmpty
                continue
            }
            if isInvisible(scalar) { continue }
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark:
                marks += 1
                if marks > maxMarksPerBase || kept.isEmpty { continue }
            default:
                marks = 0
            }
            if space { kept.append(" "); space = false }
            kept.append(scalar)
        }
        return (kept, cut)
    }

    /// How many digits a scalar writes: one for a digit of any script, more for a sign such as a circled 21.
    private static func digits(_ scalar: Unicode.Scalar) -> Int {
        if scalar.isASCII { return (0x30...0x39).contains(scalar.value) ? 1 : 0 }
        let plain = String(scalar).precomposedStringWithCompatibilityMapping.unicodeScalars
        let count = plain.reduce(0) { $0 + ($1.properties.numericType == nil ? 0 : 1) }
        return count == 0 && scalar.properties.numericType != nil ? 1 : count
    }

    /// Replaces digits from the end, once `room` for the ones that stay is used up.
    private static func mask(_ scalars: inout [Unicode.Scalar], room: inout Int) {
        for index in scalars.indices.reversed() {
            let weight = digits(scalars[index])
            if weight == 0 { continue }
            if weight <= room {
                room -= weight
            } else {
                room = 0
                scalars[index] = "\u{2022}"
            }
        }
    }

    private static func truncated(_ text: String, cut: Bool) -> String {
        if !cut, text.count <= maxCharacters, text.unicodeScalars.count <= maxScalars { return text }
        var result = ""
        var scalars = 0
        for character in text.prefix(maxCharacters - 1) {
            scalars += character.unicodeScalars.count
            if scalars > maxScalars - 1 { break }
            result.append(character)
        }
        while result.last == " " { result.removeLast() }
        return result + "\u{2026}"
    }

    /// Controls, format and other default-ignorable characters (bidirectional controls, zero-width ones, variation selectors),
    /// code points with no assigned meaning, and the few that draw nothing although they are none of these.
    private static func isInvisible(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.properties.isDefaultIgnorableCodePoint { return true }
        switch scalar.value {
        case 0x2800, 0xFFFC, 0xFFFD, 0x1D159: return true
        default: break
        }
        switch scalar.properties.generalCategory {
        case .control, .format, .surrogate, .privateUse, .unassigned: return true
        default: return false
        }
    }
}

// MARK: The stored vault list

struct SafariFillListedVault: Equatable, Sendable, SafariFillRedacted {
    var id: UUID
    var name: String
}

/// Where the app's vault list is read from: the App Group's preferences in the extension, a stand-in in a test.
protocol SafariFillVaultSource {
    func object(forKey key: String) -> Any?
}

/// The vaults the app lists, read from what `VaultReference` stores. Only identifiers and names are taken.
struct SafariFillVaultList {
    static let activeKey = "vaultReference"
    static let rememberedKey = "rememberedVaults"
    static let forgottenKey = "forgottenVaultIDs"
    static let orderKey = "vaultOrder"
    /// For each stored value; bookmarks make a reference a few kilobytes.
    static let maxBytes = 1024 * 1024

    /// Nil when there is no App Group.
    var source: (any SafariFillVaultSource)?

    private struct Entry: Decodable {
        let id: UUID
        let name: String
    }

    /// The vaults in the app's fixed order, without forgotten ones. Empty when nothing is stored. Throws when there is no source,
    /// or when what names the vaults is damaged or over size: then it is not known which vaults are listed. A damaged order only
    /// loses the order.
    func vaults() throws -> [SafariFillListedVault] { try contents().listed }

    /// `vaults`, and the identifiers the app has forgotten. The values are read one after another while the app may be changing
    /// them, so a vault can be missing from both keys for a moment; only `forgotten` says that one was removed.
    func contents() throws -> (listed: [SafariFillListedVault], forgotten: Set<UUID>) {
        guard let source else { throw SafariFillError.storeUnavailable }
        func value<T: Decodable>(_ key: String, as type: T.Type) throws -> T? {
            guard let stored = source.object(forKey: key) else { return nil }
            guard let data = stored as? Data, data.count <= Self.maxBytes, let decoded = try? JSONDecoder().decode(T.self, from: data) else {
                throw SafariFillError.unreadable
            }
            return decoded
        }
        let active = try value(Self.activeKey, as: Entry.self)
        let remembered = try value(Self.rememberedKey, as: [Entry].self) ?? []
        let forgotten = Set((try value(Self.forgottenKey, as: [String].self) ?? []).compactMap(UUID.init(uuidString:)))
        let order = ((try? value(Self.orderKey, as: [String].self)) ?? []).compactMap(UUID.init(uuidString:))
        var seen = forgotten
        let entries = ([active].compactMap { $0 } + remembered).filter { seen.insert($0.id).inserted }
        let place = Dictionary(order.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: min)
        let listed = entries.enumerated()
            .sorted { (place[$0.element.id] ?? Int.max, $0.offset) < (place[$1.element.id] ?? Int.max, $1.offset) }
            .map { SafariFillListedVault(id: $0.element.id, name: $0.element.name) }
        return (listed, forgotten)
    }
}

// MARK: Requests

enum SafariFillKind: String, Sendable {
    case card, address

    /// The roles a request may name, each with the key its value is returned under. The page fill (`page-fill.js`) makes the month
    /// and year from `cc-exp`, the first and last name from `name`, the street lines from `street-address` and the country's name
    /// from `country`, so those roles release what they are made from.
    var roles: [String: String] {
        switch self {
        case .card:
            ["cc-name": "cc-name", "cc-number": "cc-number", "cc-exp": "cc-exp", "cc-exp-month": "cc-exp", "cc-exp-year": "cc-exp",
             "cc-csc": "cc-csc"]
        case .address:
            ["name": "name", "given-name": "name", "family-name": "name", "organization": "organization",
             "street-address": "street-address", "address-line1": "street-address", "address-line2": "street-address",
             "address-level2": "address-level2", "address-level1": "address-level1", "postal-code": "postal-code",
             "country": "country", "country-name": "country", "email": "email", "tel": "tel"]
        }
    }
}

/// A request that has exactly the expected shape. The origin's rule and the grant are checked after.
enum SafariFillRequest: Sendable, SafariFillRedacted {
    case status(origin: String)
    case release(origin: String, vault: UUID, kind: SafariFillKind, ref: SafariFillRef, roles: [String])

    static let version = 1
    private static let maxKeys = 8
    private static let maxRoleLength = 32

    var origin: String {
        switch self {
        case .status(let origin), .release(let origin, _, _, _, _): origin
        }
    }

    /// Takes the message as the system hands it over. Throws a `SafariFillRefusal`.
    static func decode(_ message: Any?) throws(Refused) -> SafariFillRequest {
        // The count is looked at first, so a huge dictionary is never converted.
        guard let dictionary = message as? NSDictionary, dictionary.count <= maxKeys,
              let fields = dictionary as? [String: Any] else { throw Refused(.invalid) }
        // A boolean is a number to Foundation, and is not version 1.
        guard let number = fields["v"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue == Double(version) else { throw Refused(.unsupported) }
        guard let type = text(fields["type"], max: 16), type == "status" || type == "release" else { throw Refused(.unsupported) }
        let keys: Set<String> = type == "status" ? ["v", "type", "origin"] : ["v", "type", "origin", "vault", "kind", "ref", "roles"]
        guard Set(fields.keys) == keys, let origin = text(fields["origin"], max: SafariFillOrigin.maxLength) else { throw Refused(.invalid) }
        if type == "status" { return .status(origin: origin) }
        guard let vaultText = text(fields["vault"], max: 36), let vault = UUID(uuidString: vaultText),
              let kindText = text(fields["kind"], max: 16), let kind = SafariFillKind(rawValue: kindText),
              let refText = text(fields["ref"], max: SafariFillRef.length), let ref = SafariFillRef(refText),
              let list = fields["roles"] as? NSArray, (1...kind.roles.count).contains(list.count) else { throw Refused(.invalid) }
        let roles = list.compactMap { text($0, max: maxRoleLength) }.filter { kind.roles[$0] != nil }
        guard roles.count == list.count, Set(roles).count == roles.count else { throw Refused(.invalid) }
        return .release(origin: origin, vault: vault, kind: kind, ref: ref, roles: roles)
    }

    private static func text(_ value: Any?, max: Int) -> String? {
        guard let string = value as? String, !string.isEmpty, string.utf16.count <= max else { return nil }
        return string
    }

    struct Refused: Error {
        let reason: SafariFillRefusal
        init(_ reason: SafariFillRefusal) { self.reason = reason }
    }
}

/// Names one card or address of one grant: the grant's identifier in hexadecimal, a dot and the entry's identifier. An entry
/// keeps its identifier from grant to grant, so the first part is what stops an earlier list from releasing anything.
struct SafariFillRef: Equatable, Sendable, SafariFillRedacted {
    static let length = SafariFillGrant.idBytes * 2 + 1 + 36
    var grantID: Data
    var item: UUID

    init(grantID: Data, item: UUID) {
        self.grantID = grantID
        self.item = item
    }

    /// Only the very text `text` writes.
    init?(_ text: String) {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard text.utf16.count == Self.length, parts.count == 2, parts[0].utf8.count == SafariFillGrant.idBytes * 2,
              let item = UUID(uuidString: String(parts[1])) else { return nil }
        let hex = Array(parts[0])
        let bytes = stride(from: 0, to: hex.count - 1, by: 2).compactMap { UInt8(String(hex[$0...$0 + 1]), radix: 16) }
        self.init(grantID: Data(bytes), item: item)
        guard bytes.count == SafariFillGrant.idBytes, self.text == text else { return nil }
    }

    var text: String {
        let digits = Array("0123456789abcdef")
        return String(grantID.flatMap { [digits[Int($0 >> 4)], digits[Int($0 & 15)]] }) + "." + item.uuidString
    }
}

// MARK: Handler

/// Answers one request. Every request that passes its own checks (shape and origin) judges the grant afresh, and one that is
/// damaged or out of time is deleted. A refused request touches nothing. A grant whose vault is not listed is not used; it is
/// deleted only when a second reading of the list says the vault was removed, and otherwise left for a later request.
///
/// When something cannot be read the answer is `unavailable` and nothing is released:
/// - the Keychain (the device is locked, no access group): nothing is deleted;
/// - the vault list (no App Group, damaged): it is not known whether the grant's vault is still listed, so a grant that is in time
///   is left for later; one that is out of time or damaged is deleted as usual.
struct SafariFillHandler {
    static let maxVaults = 50

    /// Nil when this build has no access group for the grant.
    var store: (any SafariFillStore)?
    var vaults: SafariFillVaultList
    var clock: any SafariFillClock = SystemSafariFillClock()
    var allowsLoopbackHTTP = SafariFillOrigin.loopbackHTTPByDefault

    /// The handler's clock as one concrete type, which the store's methods ask for.
    private struct AnyClock: SafariFillClock {
        let base: any SafariFillClock
        func wallMilliseconds() -> Int64 { base.wallMilliseconds() }
        func continuousMilliseconds() -> Int64 { base.continuousMilliseconds() }
    }

    /// `message` is what to send back. `type` and `refusal` are the only parts a log may take: the message holds the person's data.
    struct Reply: SafariFillRedacted {
        var message: [String: Any]
        /// `status`, `release`, or nil for a request that was not understood.
        var type: String?
        var refusal: SafariFillRefusal?
    }

    func reply(to message: Any?) -> Reply {
        var type: String?
        do throws(SafariFillRequest.Refused) {
            let request = try SafariFillRequest.decode(message)
            if case .status = request { type = "status" } else { type = "release" }
            guard SafariFillOrigin.isAllowed(request.origin, allowsLoopbackHTTP: allowsLoopbackHTTP) else { throw .init(.forbidden) }
            var body = try answer(request)
            body["v"] = SafariFillRequest.version
            body["ok"] = true
            return Reply(message: body, type: type)
        } catch {
            return Reply(message: ["v": SafariFillRequest.version, "ok": false, "error": error.reason.rawValue], type: type,
                         refusal: error.reason)
        }
    }

    private func answer(_ request: SafariFillRequest) throws(SafariFillRequest.Refused) -> [String: Any] {
        guard let store else { throw .init(.unavailable) }
        guard var list = try? vaults.contents() else {
            // The grant's age and shape can still be judged.
            _ = try? store.inTime(clock: AnyClock(base: clock))
            throw .init(.unavailable)
        }
        var grant: SafariFillGrant?
        do {
            grant = try store.inTime(clock: AnyClock(base: clock))
        } catch SafariFillError.storeUnavailable {
            throw .init(.unavailable)
        } catch {
            grant = nil  // refused, and deleted by the store
        }
        if let found = grant, !list.listed.contains(where: { $0.id == found.vault.id }) {
            guard let again = try? vaults.contents() else { throw .init(.unavailable) }
            list = again
            if !again.listed.contains(where: { $0.id == found.vault.id }) {
                if again.forgotten.contains(found.vault.id) { try? store.delete(matching: found.grantID) }
                grant = nil
            }
        }
        let listed = list.listed
        switch request {
        case .status:
            return status(grant, listed: listed)
        case .release(_, let vault, let kind, let ref, let roles):
            guard let grant else { throw .init(.locked) }
            guard vault == grant.vault.id, ref.grantID == grant.grantID,
                  let values = values(of: ref.item, kind: kind, in: grant) else { throw .init(.notFound) }
            var fields: [String: String] = [:]
            for key in roles.compactMap({ kind.roles[$0] }) {
                if let value = values[key], !value.isEmpty { fields[key] = value }
            }
            return ["fields": fields]
        }
    }

    /// The values of the one entry of that kind with that identifier, as stored.
    private func values(of item: UUID, kind: SafariFillKind, in grant: SafariFillGrant) -> [String: String]? {
        switch kind {
        case .card:
            guard let card = grant.cards.first(where: { $0.id == item }) else { return nil }
            return ["cc-name": card.cardholder, "cc-number": card.number, "cc-exp": card.expiry ?? "",
                    "cc-csc": card.securityCode ?? ""]
        case .address:
            guard let address = grant.addresses.first(where: { $0.id == item }) else { return nil }
            return ["name": address.fullName, "organization": address.organization, "street-address": address.street,
                    "address-level2": address.city, "address-level1": address.region, "postal-code": address.postalCode,
                    "country": address.country, "email": address.email, "tel": address.phone]
        }
    }

    /// The vaults, and with a grant the rows of its cards and addresses. Every text goes through `SafariFillText`, a row at a time.
    ///
    /// A row's name is never empty. A card without a title is called by its network, else "Card". An address without a label is
    /// called by its full name (which is then not repeated), else "Address": never by its street.
    private func status(_ grant: SafariFillGrant?, listed: [SafariFillListedVault]) -> [String: Any] {
        var shown = Array(listed.prefix(Self.maxVaults))
        if let grant, !shown.contains(where: { $0.id == grant.vault.id }),
           let ready = listed.first(where: { $0.id == grant.vault.id }) {
            shown[shown.count - 1] = ready
        }
        let vaultRows: [[String: Any]] = shown.map { vault in
            ["id": vault.id.uuidString, "name": first(SafariFillText.line(vault.name), "Vault"), "ready": vault.id == grant?.vault.id]
        }
        let cards: [[String: Any]] = (grant?.cards ?? []).map { card in
            let lastFour = String(card.number.suffix(SafariFillText.revealedDigits))
            let texts = SafariFillText.row([card.title, card.brand], shown: lastFour.count)
            let title = texts[0], brand = texts[1]
            var row: [String: Any] = [
                "ref": SafariFillRef(grantID: grant!.grantID, item: card.id).text,
                "title": first(title, brand, "Card"),
                "brand": brand,
                "lastFour": lastFour,
                "hasCode": card.securityCode != nil,
            ]
            row["expiry"] = card.expiry
            return row
        }
        let addresses: [[String: Any]] = (grant?.addresses ?? []).map { address in
            let texts = SafariFillText.row([address.label, address.fullName, address.city])
            let label = texts[0], name = texts[1]
            return ["ref": SafariFillRef(grantID: grant!.grantID, item: address.id).text,
                    "label": first(label, name, "Address"),
                    "fullName": label.isEmpty ? "" : name,
                    "city": texts[2]]
        }
        return ["vaults": vaultRows, "cards": cards, "addresses": addresses]
    }

    private func first(_ choices: String...) -> String { choices.first { !$0.isEmpty } ?? "" }
}
