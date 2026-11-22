import CryptoKit
import Foundation

/// Reads and edits the entries of a decrypted KDBX document, and maps them to `VaultItem`.
///
/// Entries are edited in place, so every field this app does not know about stays as it was. Before a change,
/// the old version goes into the entry's history, as KeePass does.
extension KDBXDocument {
    private var rootNode: XNode? { root.child("Root") }
    private var meta: XNode? { root.child("Meta") }

    var rootGroup: XNode? { rootNode?.child("Group") }

    var databaseName: String {
        get { meta?.child("DatabaseName")?.text ?? "" }
        set { meta?.setChildText("DatabaseName", newValue); meta?.setChildText("DatabaseNameChanged", KeePassTime.string(.now)) }
    }

    var lastModified: Date? { KeePassTime.date(rootGroup?.child("Times")?.child("LastModificationTime")?.text ?? "") }

    /// Every live entry with its group, skipping the recycle bin and history.
    private func liveEntries() -> [(entry: XNode, group: XNode)] {
        let recycleBin = meta?.child("RecycleBinEnabled")?.text.lowercased() == "false" ? nil : meta?.child("RecycleBinUUID")?.text
        var found: [(XNode, XNode)] = []
        func visit(_ group: XNode) {
            if let recycleBin, group.child("UUID")?.text == recycleBin, recycleBin != Data(count: 16).base64EncodedString() { return }
            for child in group.children {
                if child.name == "Entry" { found.append((child, group)) } else if child.name == "Group" { visit(child) }
            }
        }
        if let rootGroup { visit(rootGroup) }
        return found
    }

    func items() -> [VaultItem] { liveEntries().compactMap { EntryMapping.item(from: $0.entry, document: self) } }

    /// Adds the item, or updates the entry with the same identifier. Returns false when nothing changed.
    @discardableResult
    func upsert(_ item: VaultItem) -> Bool {
        if let (entry, _) = liveEntries().first(where: { EntryMapping.uuid(of: $0.entry) == item.id }) {
            guard let current = EntryMapping.item(from: entry, document: self), !EntryMapping.sameContent(current, item) else { return false }
            pushHistory(entry)
            EntryMapping.apply(item, to: entry, document: self)
            stamp(entry, modified: true)
            return true
        }
        guard let group = rootGroup else { return false }
        let entry = EntryMapping.newEntry(id: item.id)
        EntryMapping.apply(item, to: entry, document: self)
        group.children.append(entry)
        return true
    }

    /// Records use without a history entry: only the last-access time and the usage count change.
    func markUsed(_ id: UUID) {
        guard let (entry, _) = liveEntries().first(where: { EntryMapping.uuid(of: $0.entry) == id }), let times = entry.child("Times") else { return }
        times.setChildText("LastAccessTime", KeePassTime.string(.now))
        times.setChildText("UsageCount", String((Int(times.child("UsageCount")?.text ?? "0") ?? 0) + 1))
    }

    /// Removes the entry for good and records the deletion so another device does not bring it back.
    func remove(_ id: UUID) {
        guard let (entry, group) = liveEntries().first(where: { EntryMapping.uuid(of: $0.entry) == id }) else { return }
        group.children.removeAll { $0 === entry }
        if let deleted = rootNode?.child("DeletedObjects") {
            deleted.children.append(XNode("DeletedObject", children: [
                XNode("UUID", text: id.kdbxBase64), XNode("DeletionTime", text: KeePassTime.string(.now))]))
        }
    }

    private func stamp(_ entry: XNode, modified: Bool) {
        guard let times = entry.child("Times") else { return }
        let now = KeePassTime.string(.now)
        if modified { times.setChildText("LastModificationTime", now) }
    }

    private func pushHistory(_ entry: XNode) {
        let snapshot = entry.deepCopy()
        snapshot.children.removeAll { $0.name == "History" }
        let history: XNode
        if let existing = entry.child("History") { history = existing } else {
            history = XNode("History")
            entry.children.append(history)
        }
        history.children.append(snapshot)
        let limit = Int(meta?.child("HistoryMaxItems")?.text ?? "") ?? 10
        if limit >= 0, history.children.count > limit { history.children.removeFirst(history.children.count - limit) }
    }

    fileprivate var protectsStandardField: (String) -> Bool {
        let mapping = ["Title": "ProtectTitle", "UserName": "ProtectUserName", "Password": "ProtectPassword",
                       "URL": "ProtectURL", "Notes": "ProtectNotes"]
        return { key in
            guard let flag = mapping[key] else { return false }
            return meta?.child("MemoryProtection")?.child(flag)?.text.lowercased() == "true"
        }
    }
}

extension UUID {
    var kdbxBase64: String { withUnsafeBytes(of: uuid) { Data($0) }.base64EncodedString() }
}

enum EntryMapping {
    /// Private field that remembers which template an entry was created with. Other apps ignore it.
    static let typeKey = "PSSS_TYPE"
    static let cardExpiryKey = "Expiry"

    // KeePassXC passkey fields, so a passkey made here opens there and the other way round.
    static let passkeyCredential = "KPEX_PASSKEY_CREDENTIAL_ID"
    static let passkeyKey = "KPEX_PASSKEY_PRIVATE_KEY_PEM"
    static let passkeyRelyingParty = "KPEX_PASSKEY_RELYING_PARTY"
    static let passkeyUsername = "KPEX_PASSKEY_USERNAME"
    static let passkeyUserHandle = "KPEX_PASSKEY_USER_HANDLE"
    private static let passkeyKeys = [passkeyCredential, passkeyKey, passkeyRelyingParty, passkeyUsername, passkeyUserHandle]
    private static let protectedKeys: Set<String> = ["Password", "otp", passkeyKey]

    static func uuid(of entry: XNode) -> UUID? {
        guard let data = Data(base64Encoded: entry.child("UUID")?.text ?? ""), data.count == 16 else { return nil }
        return UUID(uuid: data.withUnsafeBytes { $0.load(as: uuid_t.self) })
    }

    static func string(_ entry: XNode, _ key: String) -> String? {
        entry.children(named: "String").first { $0.child("Key")?.text == key }?.child("Value")?.text
    }

    private static func setString(_ entry: XNode, _ key: String, _ value: String?, document: KDBXDocument, keepEmpty: Bool) {
        let existing = entry.children(named: "String").first { $0.child("Key")?.text == key }
        guard let value, !value.isEmpty || keepEmpty else {
            if let existing { entry.children.removeAll { $0 === existing } }
            return
        }
        if let existing, let node = existing.child("Value") { node.text = value; return }
        let node = XNode("Value", text: value)
        if protectedKeys.contains(key) || document.protectsStandardField(key) { node.setAttribute("Protected", "True") }
        let string = XNode("String", children: [XNode("Key", text: key), node])
        let index = entry.children.firstIndex { ["Binary", "AutoType", "History"].contains($0.name) } ?? entry.children.endIndex
        entry.children.insert(string, at: index)
    }

    // MARK: Entry to item

    static func item(from entry: XNode, document: KDBXDocument) -> VaultItem? {
        guard let id = uuid(of: entry) else { return nil }
        var title = string(entry, "Title") ?? "", account = string(entry, "UserName") ?? ""
        let website = string(entry, "URL") ?? "", secret = string(entry, "Password") ?? "", notes = string(entry, "Notes") ?? ""
        let otp = otpSecret(entry)
        let passkey = passkey(entry)

        // A login without a name is stored under its host so other KeePass apps show something; read it back as empty.
        if !website.isEmpty, title == SharedVault.host(website) { title = "" }

        let kind: ItemKind
        switch string(entry, typeKey) {
        case "card": kind = .creditCard
        case "note": kind = .secureNote
        case "custom": kind = .keePassEntry
        case "login": kind = .login
        default:
            if !website.isEmpty || !account.isEmpty || !otp.isEmpty || passkey != nil { kind = .login }
            else if secret.isEmpty && !notes.isEmpty { kind = .secureNote }
            else { kind = .keePassEntry }
        }
        let times = entry.child("Times")
        let count = Int(times?.child("UsageCount")?.text ?? "") ?? 0
        let accessed = KeePassTime.date(times?.child("LastAccessTime")?.text ?? "")
        var item = VaultItem(id: id, kind: kind, title: title, account: account, website: website, secret: secret,
                             expiry: kind == .creditCard ? string(entry, cardExpiryKey) ?? "" : "", notes: notes,
                             otpSecret: kind == .login ? otp : "", lastUsed: count > 0 ? accessed : nil, useCount: count)
        item.passkey = passkey
        return item
    }

    /// The TOTP secret as Base32, from KeePassXC's `otp` (an otpauth link or a bare secret) or the older KeeOtp fields.
    private static func otpSecret(_ entry: XNode) -> String {
        if let value = string(entry, "otp"), !value.isEmpty {
            if let components = URLComponents(string: value), components.scheme == "otpauth",
               let secret = components.queryItems?.first(where: { $0.name.lowercased() == "secret" })?.value {
                return TOTP.normalizedSecret(secret) ?? ""
            }
            return TOTP.normalizedSecret(value) ?? ""
        }
        for key in ["TimeOtp-Secret-Base32", "TOTP Seed"] {
            if let value = string(entry, key), let secret = TOTP.normalizedSecret(value) { return secret }
        }
        return ""
    }

    private static func passkey(_ entry: XNode) -> PasskeyRecord? {
        guard let credential = string(entry, passkeyCredential).flatMap(base64URL), let pem = string(entry, passkeyKey),
              let rp = string(entry, passkeyRelyingParty), !rp.isEmpty,
              let key = try? P256.Signing.PrivateKey(pemRepresentation: pem) else { return nil }
        let handle = string(entry, passkeyUserHandle).flatMap(base64URL) ?? Data()
        let created = KeePassTime.date(entry.child("Times")?.child("CreationTime")?.text ?? "") ?? .now
        return PasskeyRecord(credentialID: credential, userHandle: handle, rpID: rp, privateKey: key.rawRepresentation, created: created)
    }

    // MARK: Item to entry

    static func newEntry(id: UUID) -> XNode {
        let now = KeePassTime.string(.now)
        return XNode("Entry", children: [
            XNode("UUID", text: id.kdbxBase64), XNode("IconID", text: "0"),
            XNode("Times", children: [XNode("CreationTime", text: now), XNode("LastModificationTime", text: now),
                                      XNode("LastAccessTime", text: now), XNode("ExpiryTime", text: now),
                                      XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                      XNode("LocationChanged", text: now)]),
            XNode("AutoType", children: [XNode("Enabled", text: "True"), XNode("DataTransferObfuscation", text: "0")])
        ])
    }

    static func apply(_ item: VaultItem, to entry: XNode, document: KDBXDocument) {
        func set(_ key: String, _ value: String?, keepEmpty: Bool = false) {
            setString(entry, key, value, document: document, keepEmpty: keepEmpty)
        }
        let host = SharedVault.host(item.website)
        set("Title", item.title.isEmpty && item.kind == .login && !host.isEmpty ? host : item.title, keepEmpty: true)
        set("UserName", item.account, keepEmpty: true)
        set("Password", item.secret, keepEmpty: true)
        set("URL", item.website, keepEmpty: true)
        set("Notes", item.notes, keepEmpty: true)

        switch item.kind {
        case .login: set(typeKey, nil)
        case .creditCard: set(typeKey, "card")
        case .secureNote: set(typeKey, "note")
        case .keePassEntry: set(typeKey, "custom")
        }
        set(cardExpiryKey, item.kind == .creditCard ? item.expiry : nil)

        // Rewrite the TOTP field only when the secret changed, so period, digits and issuer set elsewhere survive.
        let secret = item.kind == .login ? TOTP.normalizedSecret(item.otpSecret) ?? "" : ""
        if secret != otpSecret(entry) {
            for legacy in ["TimeOtp-Secret-Base32", "TOTP Seed", "TimeOtp-Length", "TimeOtp-Period", "TimeOtp-Algorithm"] { set(legacy, nil) }
            set("otp", secret.isEmpty ? nil : TOTP.setupURL(secret: secret, issuer: item.displayTitle, account: item.account))
        }

        if let passkey = item.passkey, let key = try? P256.Signing.PrivateKey(rawRepresentation: passkey.privateKey) {
            set(passkeyCredential, passkey.credentialID.base64URL)
            set(passkeyKey, key.pemRepresentation)
            set(passkeyRelyingParty, passkey.rpID)
            set(passkeyUsername, item.account)
            set(passkeyUserHandle, passkey.userHandle.base64URL)
        } else if item.passkey == nil, passkey(entry) != nil {
            for key in passkeyKeys { set(key, nil) }
        }

        if let times = entry.child("Times") {
            times.setChildText("LastAccessTime", KeePassTime.string(item.lastUsed ?? .now))
            times.setChildText("UsageCount", String(item.useCount))
        }
    }

    /// Whether two items hold the same stored content. Usage counters are ignored: use alone makes no history.
    static func sameContent(_ a: VaultItem, _ b: VaultItem) -> Bool {
        a.kind == b.kind && a.title == b.title && a.account == b.account && a.website == b.website && a.secret == b.secret
            && a.notes == b.notes && a.expiry == b.expiry && (TOTP.normalizedSecret(a.otpSecret) ?? "") == (TOTP.normalizedSecret(b.otpSecret) ?? "")
            && a.passkey?.credentialID == b.passkey?.credentialID
    }

    private static func base64URL(_ text: String) -> Data? {
        var value = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while value.count % 4 != 0 { value += "=" }
        return Data(base64Encoded: value)
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
