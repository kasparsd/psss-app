import CryptoKit
import Foundation

/// Reads and edits the entries of a decrypted KDBX document, and maps them to `VaultItem`.
///
/// Entries are edited in place, so every field this app does not know about stays as it was. Before a change that matters,
/// the old version goes into the entry's history, as KeePass does; see `KeePassHistory.swift`. Deleting moves an entry to the
/// Recycle Bin; see `RecycleBin.swift`.
extension KDBXDocument {
    var rootNode: XNode? { root.child("Root") }
    var meta: XNode? { root.child("Meta") }

    var rootGroup: XNode? { rootNode?.child("Group") }

    var databaseName: String {
        get { meta?.child("DatabaseName")?.text ?? "" }
        set { meta?.setChildText("DatabaseName", newValue); meta?.setChildText("DatabaseNameChanged", KeePassTime.storedNow) }
    }

    var lastModified: Date? { KeePassTime.date(rootGroup?.child("Times")?.child("LastModificationTime")?.text ?? "") }

    /// An entry with the group it sits in, and whether that group is the Recycle Bin or inside it.
    struct EntryLocation {
        let entry: XNode
        let group: XNode
        let inBin: Bool
        /// For an entry in the bin: the latest `LocationChanged` of the groups between the bin and the entry (the bin itself not
        /// counted). Another app that recycles a whole group stamps the group, not the entries inside, so this is when they
        /// were deleted too. Nil outside the bin, or when no such group has a time.
        var groupDeleted: Date?
        /// For an entry in the bin: some group between the bin and the entry has a `LocationChanged` that cannot be read. The
        /// entry is then never purged automatically.
        var groupUnreadable: Bool

        init(entry: XNode, group: XNode, inBin: Bool, groupDeleted: Date? = nil, groupUnreadable: Bool = false) {
            self.entry = entry; self.group = group; self.inBin = inBin; self.groupDeleted = groupDeleted; self.groupUnreadable = groupUnreadable
        }
    }

    /// The group identifier `Meta/RecycleBinUUID` names, whether or not the bin is switched on. Nil when there is none, it is the
    /// all-zero identifier, or it is the root group's: a bin that is the root would hide every entry and let a purge delete
    /// them all, so a corrupt file with that value has no bin.
    var rawRecycleBinID: String? {
        guard let id = meta?.child("RecycleBinUUID")?.text, !id.isEmpty, id != Data(count: 16).base64EncodedString(),
              id != rootGroup?.child("UUID")?.text else { return nil }
        // Two groups with the bin's identifier is a corrupt file (a copy that kept its identifier): there is no bin to trust.
        var carriers = 0
        func visit(_ group: XNode) {
            if group.child("UUID")?.text == id { carriers += 1 }
            for child in group.children where child.name == "Group" { visit(child) }
        }
        if let rootGroup { visit(rootGroup) }
        return carriers > 1 ? nil : id
    }

    /// The Recycle Bin's group identifier as stored in `Meta`, or nil when the bin is switched off, has none yet or names the
    /// root group.
    var recycleBinID: String? {
        guard meta?.child("RecycleBinEnabled")?.text.lowercased() != "false" else { return nil }
        return rawRecycleBinID
    }

    /// A group's `LocationChanged`, the time it was last moved (another app sets it when it recycles the group).
    static func locationChanged(of node: XNode) -> Date? {
        node.child("Times")?.child("LocationChanged").flatMap { KeePassTime.date($0.text) }
    }

    /// The same, saying also whether the element is there at all, so a time that is present but unreadable can be told from none.
    static func locationChangedEvidence(of node: XNode) -> (date: Date?, present: Bool) {
        guard let element = node.child("Times")?.child("LocationChanged") else { return (nil, false) }
        return (KeePassTime.date(element.text), true)
    }

    /// Every entry outside history, in document order, each marked with whether it sits in the Recycle Bin.
    func locations() -> [EntryLocation] {
        let bin = recycleBinID
        var found: [EntryLocation] = []
        func visit(_ group: XNode, inBin: Bool, floor: Date?, unreadable: Bool) {
            for child in group.children {
                if child.name == "Entry" {
                    found.append(EntryLocation(entry: child, group: group, inBin: inBin, groupDeleted: inBin ? floor : nil, groupUnreadable: inBin && unreadable))
                } else if child.name == "Group" {
                    if inBin {
                        let own = Self.locationChangedEvidence(of: child)
                        visit(child, inBin: true, floor: [floor, own.date].compactMap { $0 }.max(), unreadable: unreadable || (own.present && own.date == nil))
                    } else {
                        visit(child, inBin: bin != nil && child.child("UUID")?.text == bin, floor: nil, unreadable: false)
                    }
                }
            }
        }
        if let rootGroup { visit(rootGroup, inBin: false, floor: nil, unreadable: false) }
        return found
    }

    /// Every live entry with its group, skipping the recycle bin and history.
    private func liveEntries() -> [(entry: XNode, group: XNode)] {
        locations().filter { !$0.inBin }.map { ($0.entry, $0.group) }
    }

    func items() -> [VaultItem] { liveEntries().compactMap { EntryMapping.item(from: $0.entry, document: self) } }

    /// Adds the item, or updates the entry with the same identifier. Returns false when nothing changed.
    ///
    /// An identifier is looked up in the live entries first and then in the Recycle Bin, so a write never makes a second entry
    /// with an identifier that exists. An item whose entry sits in the bin is restored and updated (the safest reading of a
    /// save for something the person deleted: it comes back, with its history, and takes the new values), and that counts as a
    /// change even when the values are the same.
    @discardableResult
    func upsert(_ item: VaultItem) -> Bool { upsert([item]) }

    /// Adds or updates many items in one pass: the tree is walked once to index the entries by identifier, so a batch of N items
    /// costs O(entries + N), not O(entries x N). Items with one identifier are applied in order. Returns whether anything changed.
    @discardableResult
    func upsert(_ items: [VaultItem]) -> Bool {
        var index: [UUID: [EntryLocation]] = [:]
        for location in locations() {
            if !location.inBin { dropStaleBinMarks(of: location.entry) }
            if let id = EntryMapping.uuid(of: location.entry) { index[id, default: []].append(location) }
        }
        var changed = false
        for item in items {
            let matches = index[item.id] ?? []
            if let found = matches.first(where: { !$0.inBin }) ?? matches.first {
                if found.inBin {
                    // Only a bin entry matched, so no live entry has this identifier and a restore cannot duplicate one.
                    guard let restored = restoreFromBin(found, knownUnique: true) else { continue }
                    index[item.id] = [restored] + matches.filter { $0.entry !== found.entry }
                    changed = true
                }
                if update(found.entry, with: item) { changed = true }
            } else if let group = rootGroup {
                let entry = EntryMapping.newEntry(id: item.id)
                EntryMapping.apply(item, to: entry, document: self)
                group.children.append(entry)
                index[item.id] = [EntryLocation(entry: entry, group: group, inBin: false)]
                changed = true
            }
        }
        return changed
    }

    /// Changes an existing entry to the item's content. A revision goes into the history unless the change is small, recent and
    /// touches no secret (see `Coalescing`).
    private func update(_ entry: XNode, with item: VaultItem) -> Bool {
        guard let current = EntryMapping.item(from: entry, document: self) else { return false }
        // Same content: nothing to revise. A flag another app left off the password, code or passkey key is put back, and that
        // alone is a reason to write, since this entry is being saved.
        if EntryMapping.sameContent(current, item) { return EntryMapping.correctProtection(entry) }
        let snapshot = historySnapshot(of: entry)
        let before = Self.modificationTime(of: entry)
        EntryMapping.apply(item, to: entry, document: self)
        let now = KeePassTime.now
        let recent = before.map { now.timeIntervalSince($0) < Self.coalescingWindow } ?? false
        if !recent || EntryMapping.touchesSecret(from: snapshot, to: entry) { pushHistory(snapshot, to: entry) }
        stampModified(entry)
        return true
    }

    /// Stamps the database as modified, so its "Modified" date follows every write.
    func touchModified() { rootGroup?.child("Times")?.setChildText("LastModificationTime", KeePassTime.storedNow) }

    /// Removes the entry for good, wherever it is, and records the deletion. Same as `deletePermanently`.
    func remove(_ id: UUID) { deletePermanently(id) }

    // MARK: Times

    static func modificationTime(of entry: XNode) -> Date? {
        entry.child("Times")?.child("LastModificationTime").flatMap { KeePassTime.date($0.text) }
    }

    /// The time a content change is stamped with: the current second, but never the previous one or earlier. Two saves within a
    /// second, or a clock that went backwards, still move the time forward, so a merge can tell versions apart.
    static func nextModificationTime(after previous: Date?, now: Date) -> Date {
        let current = now.timeIntervalSince1970.rounded(.down)
        guard let previous else { return Date(timeIntervalSince1970: current) }
        return Date(timeIntervalSince1970: max(current, previous.timeIntervalSince1970.rounded(.down) + 1))
    }

    /// The entry's `Times`, made (all seven fields, at the right place) when the entry has none.
    @discardableResult
    func ensureTimes(_ entry: XNode) -> (times: XNode, created: Bool) {
        if let times = entry.child("Times") { return (times, false) }
        let now = KeePassTime.storedNow
        let times = XNode("Times", children: [XNode("CreationTime", text: now), XNode("LastModificationTime", text: now),
                                              XNode("LastAccessTime", text: now), XNode("ExpiryTime", text: now),
                                              XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                              XNode("LocationChanged", text: now)])
        let index = entry.children.firstIndex { ["String", "Binary", "AutoType", "CustomData", "History"].contains($0.name) } ?? entry.children.endIndex
        entry.children.insert(times, at: index)
        return (times, true)
    }

    /// Moves `LastModificationTime` forward for a content change. An entry without `Times` gets them now.
    func stampModified(_ entry: XNode) {
        let (times, created) = ensureTimes(entry)
        if created { return }
        let previous = times.child("LastModificationTime").flatMap { KeePassTime.date($0.text) }
        times.setChildText("LastModificationTime", KeePassTime.stored(Self.nextModificationTime(after: previous, now: KeePassTime.now)))
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
    /// When the passkey was first written, as ISO 8601 text. Passkeys made by other apps lack it, and then the entry's creation
    /// time stands in.
    static let passkeyCreated = "PSSS_PASSKEY_CREATED"
    private static let passkeyKeys = [passkeyCredential, passkeyKey, passkeyRelyingParty, passkeyUsername, passkeyUserHandle]
    /// The strings Psss itself keeps protected: the password (a card's number too), the one-time code and the passkey's private key.
    private static let protectedKeys: Set<String> = ["Password", "otp", passkeyKey]
    /// Strings whose change is a change of a secret, even where the file does not mark them protected.
    private static let secretKeys: Set<String> = protectedKeys.union([
        passkeyCredential, passkeyRelyingParty, passkeyUserHandle, passkeyCreated,
        "TimeOtp-Secret-Base32", "TOTP Seed", "TimeOtp-Length", "TimeOtp-Period", "TimeOtp-Algorithm"])

    static func uuid(of entry: XNode) -> UUID? {
        guard let data = Data(base64Encoded: entry.child("UUID")?.text ?? ""), data.count == 16 else { return nil }
        return UUID(uuid: data.withUnsafeBytes { $0.load(as: uuid_t.self) })
    }

    static func string(_ entry: XNode, _ key: String) -> String? {
        entry.children(named: "String").first { $0.child("Key")?.text == key }?.child("Value")?.text
    }

    /// Sets, adds or removes a string. A new string is protected when Psss protects that key or the file's memory protection says
    /// so. An existing string's flag is corrected for the keys Psss itself protects (password, one-time code, passkey private
    /// key) and left as found for every other key.
    private static func setString(_ entry: XNode, _ key: String, _ value: String?, document: KDBXDocument, keepEmpty: Bool) {
        let existing = entry.children(named: "String").first { $0.child("Key")?.text == key }
        guard let value, !value.isEmpty || keepEmpty else {
            if let existing { entry.children.removeAll { $0 === existing } }
            return
        }
        if let existing {
            let node: XNode
            if let found = existing.child("Value") { node = found } else {
                node = XNode("Value")
                existing.children.append(node)
            }
            node.text = value
            if protectedKeys.contains(key) { node.setAttribute("Protected", "True") }
            return
        }
        let node = XNode("Value", text: value)
        if protectedKeys.contains(key) || document.protectsStandardField(key) { node.setAttribute("Protected", "True") }
        let string = XNode("String", children: [XNode("Key", text: key), node])
        let index = entry.children.firstIndex { ["Binary", "AutoType", "CustomData", "History"].contains($0.name) } ?? entry.children.endIndex
        entry.children.insert(string, at: index)
    }

    /// Puts the protected flag back on the strings Psss keeps protected (password, one-time code, passkey key) when another app
    /// left it off. Returns whether it changed anything. Every write of an entry calls it.
    @discardableResult
    static func correctProtection(_ entry: XNode) -> Bool {
        var changed = false
        for node in entry.children(named: "String") {
            guard let key = node.child("Key")?.text, protectedKeys.contains(key), let value = node.child("Value"),
                  value.attribute("Protected")?.lowercased() != "true" else { continue }
            value.setAttribute("Protected", "True")
            changed = true
        }
        return changed
    }

    /// Every string of the entry: its value and whether the file marks it protected.
    static func strings(_ entry: XNode) -> [String: (value: String, isProtected: Bool)] {
        var found: [String: (String, Bool)] = [:]
        for node in entry.children(named: "String") {
            guard let key = node.child("Key")?.text, found[key] == nil else { continue }
            found[key] = (node.child("Value")?.text ?? "", node.child("Value")?.attribute("Protected")?.lowercased() == "true")
        }
        return found
    }

    /// Whether going from the old copy of an entry to its current state changed a secret: a protected string, the password
    /// (a card's number), the one-time code or any passkey field. A change to a secret always makes a revision.
    static func touchesSecret(from old: XNode, to new: XNode) -> Bool {
        let before = strings(old), after = strings(new)
        for key in Set(before.keys).union(after.keys) {
            let a = before[key], b = after[key]
            if a?.value == b?.value { continue }
            if secretKeys.contains(key) || a?.isProtected == true || b?.isProtected == true { return true }
        }
        return false
    }

    // MARK: Entry to item

    static func item(from entry: XNode, document: KDBXDocument) -> VaultItem? {
        guard let id = uuid(of: entry) else { return nil }
        var title = string(entry, "Title") ?? "", account = string(entry, "UserName") ?? ""
        let website = string(entry, "URL") ?? "", secret = string(entry, "Password") ?? "", notes = string(entry, "Notes") ?? ""
        let otp = otpSetup(entry)
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
            if !website.isEmpty || !account.isEmpty || !otp.secret.isEmpty || passkey != nil { kind = .login }
            else if secret.isEmpty && !notes.isEmpty { kind = .secureNote }
            else { kind = .keePassEntry }
        }
        let times = entry.child("Times")
        var item = VaultItem(id: id, kind: kind, title: title, account: account, website: website, secret: secret,
                             expiry: kind == .creditCard ? string(entry, cardExpiryKey) ?? "" : "", notes: notes,
                             otpSecret: kind == .login ? otp.secret : "", otpSettings: kind == .login ? otp.settings : .standard,
                             created: times?.child("CreationTime").flatMap { KeePassTime.date($0.text) },
                             modified: times?.child("LastModificationTime").flatMap { KeePassTime.date($0.text) })
        item.passkey = passkey
        return item
    }

    /// The TOTP secret as Base32 with its digits, period and algorithm, from KeePassXC's `otp` (an otpauth link or a bare
    /// secret) or the older KeeOtp fields.
    private static func otpSetup(_ entry: XNode) -> (secret: String, settings: TOTPSettings) {
        if let value = string(entry, "otp"), !value.isEmpty {
            if case .setup(let setup) = TOTP.parse(value) { return (setup.secret, setup.settings) }
            return ("", .standard)
        }
        for key in ["TimeOtp-Secret-Base32", "TOTP Seed"] {
            if let value = string(entry, key), let secret = TOTP.normalizedSecret(value) {
                var settings = TOTPSettings.standard
                if let digits = string(entry, "TimeOtp-Length").flatMap(Int.init), (6...8).contains(digits) { settings.digits = digits }
                if let period = string(entry, "TimeOtp-Period").flatMap(Int.init), period > 0 { settings.period = period }
                if let name = string(entry, "TimeOtp-Algorithm")?.uppercased().replacingOccurrences(of: "HMAC-", with: "").replacingOccurrences(of: "-", with: ""),
                   let algorithm = TOTPSettings.Algorithm(rawValue: name) { settings.algorithm = algorithm }
                return (secret, settings)
            }
        }
        return ("", .standard)
    }

    static func passkey(_ entry: XNode) -> PasskeyRecord? {
        guard let credential = string(entry, passkeyCredential).flatMap(base64URL), let pem = string(entry, passkeyKey),
              let rp = string(entry, passkeyRelyingParty), !rp.isEmpty,
              let key = try? P256.Signing.PrivateKey(pemRepresentation: pem) else { return nil }
        let handle = string(entry, passkeyUserHandle).flatMap(base64URL) ?? Data()
        let created = string(entry, passkeyCreated).flatMap { KeePassTime.date($0) }
            ?? KeePassTime.date(entry.child("Times")?.child("CreationTime")?.text ?? "") ?? .now
        return PasskeyRecord(credentialID: credential, userHandle: handle, rpID: rp, privateKey: key.rawRepresentation, created: created)
    }

    // MARK: Item to entry

    static func newEntry(id: UUID) -> XNode {
        let now = KeePassTime.storedNow
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

        // Rewrite the TOTP field only when the secret or its parameters changed, so the issuer set elsewhere survives.
        let secret = item.kind == .login ? TOTP.normalizedSecret(item.otpSecret) ?? "" : ""
        let settings = secret.isEmpty ? TOTPSettings.standard : item.otpSettings
        let stored = otpSetup(entry)
        if secret != stored.secret || (!secret.isEmpty && settings != stored.settings) {
            for legacy in ["TimeOtp-Secret-Base32", "TOTP Seed", "TimeOtp-Length", "TimeOtp-Period", "TimeOtp-Algorithm"] { set(legacy, nil) }
            set("otp", secret.isEmpty ? nil : TOTP.setupURL(secret: secret, issuer: item.displayTitle, account: item.account, settings: settings))
        }

        // A flag another app left off is put back on the strings Psss keeps protected, whether or not their values changed.
        correctProtection(entry)

        if let passkey = item.passkey, let key = try? P256.Signing.PrivateKey(rawRepresentation: passkey.privateKey) {
            let stored = Self.passkey(entry)
            set(passkeyCredential, passkey.credentialID.base64URL)
            set(passkeyKey, key.pemRepresentation)
            set(passkeyRelyingParty, passkey.rpID)
            set(passkeyUsername, item.account)
            set(passkeyUserHandle, passkey.userHandle.base64URL)
            // The passkey's own date is written once, when this credential first reaches the entry. A passkey made by another app
            // keeps no date of its own, and the entry's creation time stands in when it is read.
            if stored == nil || stored?.credentialID != passkey.credentialID { set(passkeyCreated, KeePassTime.string(passkey.created)) }
        } else if item.passkey == nil, passkey(entry) != nil {
            for key in passkeyKeys + [passkeyCreated] { set(key, nil) }
        }
    }

    /// Whether two items hold the same stored content: every field the codec writes (kind, title, username, website, password or
    /// card number, notes, a card's expiry, the one-time code with its digits, period and algorithm, and the passkey's credential,
    /// user handle, relying party and private key). Usage is ignored, since it lives in the device-local `UsageLog`, never in the
    /// entry. So are the dates, which the codec owns, and the passkey's creation date, which is written once. Fields the entry's
    /// kind does not store (a code on a card, an expiry on a login) do not count.
    static func sameContent(_ a: VaultItem, _ b: VaultItem) -> Bool {
        func title(_ item: VaultItem) -> String {
            // A login without a name is stored under its host and read back as empty.
            item.kind == .login && !item.website.isEmpty && item.title == SharedVault.host(item.website) ? "" : item.title
        }
        func code(_ item: VaultItem) -> (secret: String, settings: TOTPSettings) {
            let secret = item.kind == .login ? TOTP.normalizedSecret(item.otpSecret) ?? "" : ""
            return (secret, secret.isEmpty ? .standard : item.otpSettings)
        }
        func passkey(_ item: VaultItem) -> [Data]? {
            item.passkey.map { [$0.credentialID, $0.userHandle, Data($0.rpID.utf8), $0.privateKey] }
        }
        return a.kind == b.kind && title(a) == title(b) && a.account == b.account && a.website == b.website && a.secret == b.secret
            && a.notes == b.notes && (a.kind == .creditCard ? a.expiry == b.expiry : true)
            && code(a) == code(b) && passkey(a) == passkey(b)
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
