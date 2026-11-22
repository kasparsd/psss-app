import CryptoKit
import Foundation

/// Writes an import plan into a KDBX document as entries, directly and not through the flat `VaultItem`, so custom fields,
/// several websites, tags, history and attachments are in the file even before the interface shows them.
///
/// An entry made here reads back through `items()` as the kind it was meant to be (the `PSSS_TYPE` hint and the standard
/// strings are the ones `EntryMapping` uses), and editing it with `upsert` leaves everything else in the entry as it was.
extension KDBXDocument {
    /// What `apply` would do against this vault, without changing it: counts, duplicates and issues.
    func preview(_ plan: ImportPlan) -> ImportSummary {
        let decisions = ImportDuplicates.classify(plan, against: KeePassImport.existing(in: self))
        return KeePassImport.account(plan, decisions, historyLimit: KeePassImport.historyLimit(in: self))
    }

    /// Adds the plan's items. All or nothing: the work is done on a copy of the entry tree and the document is replaced only
    /// when everything succeeded, so a throw leaves this document exactly as it was. The old tree stays valid for whoever
    /// holds a copy of the document, which is how a failed write is rolled back.
    @discardableResult
    mutating func apply(_ plan: ImportPlan) throws -> ImportSummary {
        var working = self
        working.root = root.deepCopy()
        let summary = try KeePassImport.write(plan, into: &working)
        self = working
        return summary
    }
}

enum KeePassImport {
    /// Entry custom data that remembers where an item came from, such as `1password:<uuid>`.
    static let sourceKey = "PSSS_SOURCE"

    // MARK: Accounting

    static func historyLimit(in document: KDBXDocument) -> Int {
        Int(document.root.child("Meta")?.child("HistoryMaxItems")?.text ?? "") ?? 10
    }

    /// The revisions that fit under the vault's limit, newest kept, and how many were left out.
    static func kept(_ item: ImportItem, limit: Int) -> (revisions: [ImportRevision], dropped: Int) {
        guard limit >= 0, item.history.count > limit else { return (item.history, 0) }
        return (Array(item.history.suffix(limit)), item.history.count - limit)
    }

    static func account(_ plan: ImportPlan, _ decisions: [ImportDuplicates.Decision], historyLimit limit: Int) -> ImportSummary {
        var summary = ImportSummary()
        summary.trashedSkipped = plan.skipped.trashed
        summary.unreadable = plan.skipped.unreadable
        summary.webFormFieldsSkipped = plan.skipped.webFormFields
        summary.rowsSkipped = plan.skipped.rows
        summary.missingDates = plan.missingDates
        summary.issues = plan.issues
        for (item, decision) in zip(plan.items, decisions) {
            if decision == .duplicate { summary.duplicatesSkipped += 1; continue }
            if decision == .addSimilar {
                summary.similarAdded += 1
                summary.issues.append(ImportIssue(kind: .similarLogin, item: item.title.isEmpty ? nil : item.title,
                                                  detail: String(localized: "a login for this site and username with another password was already in the vault, so this one was added separately")))
            }
            summary.issues += item.issues
            let (revisions, dropped) = kept(item, limit: limit)
            if dropped > 0 {
                summary.issues.append(ImportIssue(kind: .historyTrimmed, item: item.title.isEmpty ? nil : item.title,
                                                  detail: String(localized: "\(dropped) older passwords were not kept because the vault keeps \(limit)")))
            }
            var counted = item
            counted.history = revisions
            summary.count(counted)
        }
        return summary
    }

    // MARK: Existing entries

    /// Every entry outside history, reduced to what the duplicate rule compares. Logins only carry a site.
    static func existing(in document: KDBXDocument) -> [ImportDuplicates.Existing] {
        var found: [ImportDuplicates.Existing] = []
        func visit(_ group: XNode) {
            for child in group.children {
                if child.name == "Group" { visit(child) } else if child.name == "Entry" { found.append(describe(child)) }
            }
        }
        if let root = document.rootGroup { visit(root) }
        return found
    }

    private static func describe(_ entry: XNode) -> ImportDuplicates.Existing {
        var hosts: [String] = []
        var strings: [String: String] = [:]
        for node in entry.children where node.name == "String" {
            guard let key = node.child("Key")?.text else { continue }
            let value = node.child("Value")?.text ?? ""
            strings[key] = value
            if (key == "URL" || key.hasPrefix("KP2A_URL")) && !value.isEmpty {
                let host = ImportDuplicates.host(value)
                if !host.isEmpty { hosts.append(host) }
            }
        }
        let type = strings[EntryMapping.typeKey]
        return ImportDuplicates.Existing(sourceID: sourceID(of: entry) ?? strings[sourceKey],
                                         hosts: type == nil || type == "login" ? hosts : [],
                                         username: strings["UserName"] ?? "", password: strings["Password"] ?? "")
    }

    /// The `PSSS_SOURCE` custom data of an entry.
    static func sourceID(of entry: XNode) -> String? {
        entry.child("CustomData")?.children(named: "Item").first { $0.child("Key")?.text == sourceKey }?.child("Value")?.text
    }

    // MARK: Writing

    private struct State {
        var binaries: [Data]
        var index: [Data: Int]?
        var protectedStandard: Set<String>
        var groups: [String: XNode] = [:]
        var recycleBin: String?
        var now: String
    }

    fileprivate static func write(_ plan: ImportPlan, into document: inout KDBXDocument) throws -> ImportSummary {
        guard let rootGroup = document.rootGroup else { throw ImportError.vaultStructure }
        let meta = document.root.child("Meta")
        let limit = historyLimit(in: document)
        let decisions = ImportDuplicates.classify(plan, against: existing(in: document))
        let summary = account(plan, decisions, historyLimit: limit)

        let protection = meta?.child("MemoryProtection")
        var protectedStandard = Set<String>()
        for (key, flag) in [("Title", "ProtectTitle"), ("UserName", "ProtectUserName"), ("URL", "ProtectURL"), ("Notes", "ProtectNotes")]
        where protection?.child(flag)?.text.lowercased() == "true" { protectedStandard.insert(key) }
        let zero = Data(count: 16).base64EncodedString()
        var recycleBin = meta?.child("RecycleBinEnabled")?.text.lowercased() == "false" ? nil : meta?.child("RecycleBinUUID")?.text
        if recycleBin == zero { recycleBin = nil }
        var state = State(binaries: document.binaries, protectedStandard: protectedStandard, recycleBin: recycleBin,
                          now: ImportTime.iso(plan.importedAt))

        for (item, decision) in zip(plan.items, decisions) where decision != .duplicate {
            let entry = try makeEntry(item, limit: limit, state: &state)
            group(for: item.folder, root: rootGroup, state: &state).children.append(entry)
        }
        document.binaries = state.binaries
        return summary
    }

    private static func makeEntry(_ item: ImportItem, limit: Int, state: inout State) throws -> XNode {
        let websites = item.websites
        var title = item.title
        if item.kind == .login, title.isEmpty, let first = websites.first {
            let host = ImportDuplicates.host(first)
            if !host.isEmpty { title = host }
        }
        let created = ImportTime.iso(item.created), modified = ImportTime.iso(item.modified)

        var strings: [XNode] = []
        func string(_ key: String, _ value: String, protected: Bool? = nil) {
            let node = XNode("Value", text: value)
            if protected ?? state.protectedStandard.contains(key) { node.setAttribute("Protected", "True") }
            strings.append(XNode("String", children: [XNode("Key", text: key), node]))
        }
        let card = item.kind == .card
        string("Title", title)
        string("UserName", card ? item.first(.cardholder) ?? "" : item.username)
        string("Password", card ? item.first(.cardNumber) ?? "" : item.password, protected: true)
        string("URL", websites.first ?? "")
        string("Notes", item.first(.notes) ?? "")
        switch item.kind {
        case .login:
            // Without a site, a username or a code the reader would take the entry for a note or a custom item.
            if websites.isEmpty, item.username.isEmpty, item.first(.code) == nil { string(EntryMapping.typeKey, "login") }
        case .card: string(EntryMapping.typeKey, "card")
        case .note: string(EntryMapping.typeKey, "note")
        case .custom: string(EntryMapping.typeKey, "custom")
        }
        if card { string(EntryMapping.cardExpiryKey, item.first(.expiry) ?? "") }

        var labels = ImportLabels()
        var extraCodes: [ImportField] = []
        if let code = item.first(.code) {
            // Only a login reads `otp` back, and editing any other kind through `upsert` removes it. A code on another kind
            // stays a hidden field, which an edit never touches.
            if item.kind == .login, case .setup(let setup) = TOTP.parse(code) {
                let issuer = setup.issuer.isEmpty ? (title.isEmpty ? ImportDuplicates.host(websites.first ?? "") : title) : setup.issuer
                string("otp", TOTP.setupURL(secret: setup.secret, issuer: issuer, account: setup.account.isEmpty ? item.username : setup.account,
                                             settings: setup.settings), protected: true)
            } else {
                extraCodes.append(ImportField(.custom, label: "One-time code", value: code, concealed: true))
            }
        }
        for (offset, site) in websites.dropFirst().enumerated() { string(offset == 0 ? "KP2A_URL" : "KP2A_URL_\(offset)", site) }
        for field in item.fields where [.securityCode, .pin, .custom].contains(field.role) {
            string(labels.claim(field.label.isEmpty ? field.role.rawValue : field.label), field.value, protected: field.concealed)
        }
        for field in extraCodes { string(labels.claim(field.label), field.value, protected: true) }

        var binaries: [XNode] = []
        var names = Set<String>()
        for attachment in item.attachments {
            let index = try pool(attachment, state: &state)
            binaries.append(XNode("Binary", children: [XNode("Key", text: unique(attachment.name, &names)),
                                                       XNode("Value", attributes: [("Ref", String(index))])]))
        }

        let times = XNode("Times", children: [
            XNode("CreationTime", text: created), XNode("LastModificationTime", text: modified), XNode("LastAccessTime", text: modified),
            XNode("ExpiryTime", text: created), XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
            XNode("LocationChanged", text: created)])
        var children = [XNode("UUID", text: UUID().kdbxBase64), XNode("IconID", text: "0")]
        let tags = item.tags.joined(separator: ";")
        if !tags.isEmpty { children.append(XNode("Tags", text: tags)) }
        children.append(times)
        children += strings
        children += binaries
        children.append(XNode("AutoType", children: [XNode("Enabled", text: "True"), XNode("DataTransferObfuscation", text: "0")]))
        if let source = item.sourceID {
            children.append(XNode("CustomData", children: [XNode("Item", children: [
                XNode("Key", text: sourceKey), XNode("Value", text: source), XNode("LastModificationTime", text: modified)])]))
        }
        let entry = XNode("Entry", children: children)

        // History: whole earlier versions, oldest first, each with the password it had and the time it was replaced.
        let revisions = kept(item, limit: limit).revisions
        if !revisions.isEmpty {
            let history = XNode("History")
            for revision in revisions {
                let snapshot = entry.deepCopy()
                snapshot.children.first { $0.name == "String" && $0.child("Key")?.text == "Password" }?.child("Value")?.text = revision.password
                snapshot.child("Times")?.setChildText("LastModificationTime", ImportTime.iso(revision.date))
                history.children.append(snapshot)
            }
            entry.children.append(history)
        }
        return entry
    }

    /// The position of the attachment's bytes in the binary pool. Identical bytes are stored once.
    private static func pool(_ attachment: ImportAttachment, state: inout State) throws -> Int {
        let data: Data
        do { data = try Data(contentsOf: attachment.url) } catch { throw ImportError.attachmentUnreadable(attachment.name) }
        guard data.count == attachment.size else { throw ImportError.attachmentChanged(attachment.name) }
        if state.index == nil {
            var index: [Data: Int] = [:]
            for (position, existing) in state.binaries.enumerated() {
                let digest = Data(SHA256.hash(data: existing))
                if index[digest] == nil { index[digest] = position }
            }
            state.index = index
        }
        let stored = Data([0]) + data
        let key = Data(SHA256.hash(data: stored))
        if let position = state.index?[key] { return position }
        state.binaries.append(stored)
        state.index?[key] = state.binaries.count - 1
        return state.binaries.count - 1
    }

    /// A name that is not yet used in this entry, comparing without case: "scan.pdf" then "scan (2).pdf".
    private static func unique(_ name: String, _ used: inout Set<String>) -> String {
        let base = name.isEmpty ? "attachment" : name
        var candidate = base
        var n = 2
        while !used.insert(candidate.lowercased()).inserted {
            let url = URL(fileURLWithPath: base)
            let ext = url.pathExtension
            let stem = ext.isEmpty ? base : String(base.dropLast(ext.count + 1))
            candidate = ext.isEmpty ? "\(stem) (\(n))" : "\(stem) (\(n)).\(ext)"
            n += 1
        }
        return candidate
    }

    /// The group for a folder path under the root, found or created. The recycle bin is never a target.
    private static func group(for path: [String], root: XNode, state: inout State) -> XNode {
        var parent = root
        var key = ""
        for name in path {
            key += "\u{1}" + name
            if let cached = state.groups[key] { parent = cached; continue }
            let found = parent.children.first {
                $0.name == "Group" && $0.child("Name")?.text == name && $0.child("UUID")?.text != state.recycleBin
            }
            let node = found ?? newGroup(name, now: state.now)
            if found == nil { parent.children.append(node) }
            state.groups[key] = node
            parent = node
        }
        return parent
    }

    private static func newGroup(_ name: String, now: String) -> XNode {
        XNode("Group", children: [
            XNode("UUID", text: UUID().kdbxBase64), XNode("Name", text: name), XNode("Notes"), XNode("IconID", text: "48"),
            XNode("Times", children: [XNode("CreationTime", text: now), XNode("LastModificationTime", text: now),
                                      XNode("LastAccessTime", text: now), XNode("ExpiryTime", text: now),
                                      XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                      XNode("LocationChanged", text: now)]),
            XNode("IsExpanded", text: "True"), XNode("DefaultAutoTypeSequence"), XNode("EnableAutoType", text: "null"),
            XNode("EnableSearching", text: "null"), XNode("LastTopVisibleEntry", text: Data(count: 16).base64EncodedString())])
    }
}

/// KeePass times as ISO 8601 UTC, made without a formatter so tens of thousands of entries stay quick.
enum ImportTime {
    static func iso(_ date: Date) -> String {
        let seconds = Int64(date.timeIntervalSince1970.rounded(.down))
        let days = PlanBuilder.Value.floorDivide(seconds, 86_400)
        let rest = Int(seconds - days * 86_400)
        let (y, m, d) = PlanBuilder.Value.civil(daysSinceEpoch: days)
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d, rest / 3600, rest % 3600 / 60, rest % 60)
    }
}
