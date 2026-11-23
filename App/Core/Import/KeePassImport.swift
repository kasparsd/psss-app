import CryptoKit
import Foundation

/// Writes an import plan into a KDBX document as entries, directly and not through the flat `VaultItem`, so custom fields,
/// several websites, tags, history and attachments are in the file even before the interface shows them.
///
/// An entry made here reads back through `items()` as the kind it was meant to be (the `PSSS_TYPE` hint and the standard
/// strings are the ones `EntryMapping` uses), and editing it with `upsert` leaves everything else in the entry as it was.
extension KDBXDocument {
    /// What `apply` would do against this vault, without changing it: counts, duplicates, updates, merges and issues. It runs the
    /// same comparison `apply` runs, so the two always agree.
    func preview(_ plan: ImportPlan) -> ImportSummary {
        let resolutions = KeePassImport.resolve(plan, in: self)
        return KeePassImport.account(plan, resolutions, historyLimit: KeePassImport.historyLimit(in: self))
    }

    /// Applies the plan. All or nothing: the work is done on a copy of the entry tree, the entries it wrote are serialized and
    /// read back as a second line of defence, and the document is replaced only when everything succeeded, so a throw leaves
    /// this document exactly as it was. The old tree stays valid for whoever holds a copy of the document, which is how a failed
    /// write is rolled back.
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
    /// Entry custom data with what the import wrote, as fingerprints, so a later import can tell a change in the source from a
    /// change the person made here.
    static let hashesKey = "PSSS_IMPORT_HASHES"

    // MARK: Accounting

    static func historyLimit(in document: KDBXDocument) -> Int {
        Int(document.root.child("Meta")?.child("HistoryMaxItems")?.text ?? "") ?? 10
    }

    /// The revisions that fit under the vault's limit, newest kept, and how many were left out.
    static func kept(_ item: ImportItem, limit: Int) -> (revisions: [ImportRevision], dropped: Int) {
        guard limit >= 0, item.history.count > limit else { return (item.history, 0) }
        return (Array(item.history.suffix(limit)), item.history.count - limit)
    }

    static func account(_ plan: ImportPlan, _ resolutions: [Resolution], historyLimit limit: Int) -> ImportSummary {
        var summary = ImportSummary()
        summary.trashedSkipped = plan.skipped.trashed
        summary.unreadable = plan.skipped.unreadable
        summary.webFormFieldsSkipped = plan.skipped.webFormFields
        summary.rowsSkipped = plan.skipped.rows
        summary.missingDates = plan.missingDates
        summary.issues = plan.issues
        for (item, resolution) in zip(plan.items, resolutions) {
            let title: String? = item.title.isEmpty ? nil : item.title
            switch resolution {
            case .skip:
                summary.duplicatesSkipped += 1
                continue
            case .addSimilar:
                summary.similarAdded += 1
                summary.issues.append(ImportIssue(kind: .similarLogin, item: title,
                                                  detail: String(localized: "a login for this site and username with another password was already in the vault, so this one was added separately")))
            case .update(let change):
                summary.updated += 1
                summary.attachments += change.attachments.count
                summary.historyEntries += change.historyAdds.count
                if !change.overwritten.isEmpty {
                    summary.issues.append(ImportIssue(kind: .updatedOverwrote, item: title,
                                                      detail: String(localized: "it changed in 1Password, so \(change.overwritten.joined(separator: ", ")) here was replaced with the new value. The earlier version is in its history")))
                }
                summary.issues += item.issues
                continue
            case .merge(let change):
                summary.merged += 1
                summary.attachments += change.attachments.count
                summary.historyEntries += change.historyAdds.count
                if !change.conflicts.isEmpty {
                    summary.issues.append(ImportIssue(kind: .mergeConflict, item: title,
                                                      detail: String(localized: "it already held another value for \(change.conflicts.joined(separator: ", ")), so that value was kept and the imported one was saved in a field ending in (1Password)")))
                }
                summary.issues += item.issues
                continue
            case .add: break
            }
            summary.issues += item.issues
            let (revisions, dropped) = kept(item, limit: limit)
            if dropped > 0 {
                summary.issues.append(ImportIssue(kind: .historyTrimmed, item: title,
                                                  detail: String(localized: "\(dropped) older passwords were not kept because the vault keeps \(limit)")))
            }
            var counted = item
            counted.history = revisions
            summary.count(counted)
        }
        return summary
    }

    // MARK: Existing entries

    /// What the import does with one item.
    enum Resolution {
        case add
        case addSimilar
        case skip
        case update(Change)
        case merge(Change)
    }

    /// Everything an update or merge would do to one entry, worked out without touching it.
    struct Change {
        var entry: XNode
        var rendered: Rendered
        var isMerge: Bool
        /// Strings to write: changed values, new fields and, in a merge, conflicting values under a new label.
        var sets: [Pair] = []
        var removes: [String] = []
        var tags: [String]?
        var attachments: [ImportAttachment] = []
        /// Attachment names that already exist with other bytes and take the new ones (an update only).
        var replaced: Set<String> = []
        var historyAdds: [ImportRevision] = []
        /// Labels of fields the person had changed here that an update replaced.
        var overwritten: [String] = []
        /// Labels of fields a merge left alone because they held another value.
        var conflicts: [String] = []
        var creation: Date?
        var baseline: Baseline

        var isEmpty: Bool {
            sets.isEmpty && removes.isEmpty && tags == nil && attachments.isEmpty && historyAdds.isEmpty && creation == nil
        }
    }

    struct Pair {
        var key: String
        var value: String
        var protected: Bool
    }

    struct Rendered {
        var title: String
        var pairs: [Pair]
        var tags: [String]
        var websites: [String]
    }

    /// What was written by an import: a fingerprint of the whole item, one per field and the tags.
    struct Baseline {
        var content: String
        var fields: [String: String]
        var tags: [String]

        var json: String {
            let object: [String: Any] = ["v": 1, "content": content, "fields": fields, "tags": tags]
            guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return "" }
            return String(decoding: data, as: UTF8.self)
        }

        init(content: String, fields: [String: String], tags: [String]) {
            self.content = content
            self.fields = fields
            self.tags = tags
        }

        init?(json: String) {
            guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
                  let content = object["content"] as? String else { return nil }
            self.content = content
            fields = (object["fields"] as? [String: String]) ?? [:]
            tags = (object["tags"] as? [String]) ?? []
        }
    }

    struct Known {
        var node: XNode
        var existing: ImportDuplicates.Existing
    }

    /// Every entry outside history, reduced to what the rules compare, in document order. Logins only carry a site.
    static func known(in document: KDBXDocument) -> [Known] {
        var found: [Known] = []
        let meta = document.root.child("Meta")
        let zero = Data(count: 16).base64EncodedString()
        var bin = meta?.child("RecycleBinUUID")?.text
        if bin == zero { bin = nil }
        func visit(_ group: XNode, inBin: Bool) {
            for child in group.children {
                if child.name == "Group" {
                    visit(child, inBin: inBin || (bin != nil && child.child("UUID")?.text == bin))
                } else if child.name == "Entry" {
                    var entry = describe(child)
                    entry.inRecycleBin = inBin
                    found.append(Known(node: child, existing: entry))
                }
            }
        }
        if let root = document.rootGroup { visit(root, inBin: false) }
        return found
    }

    static func existing(in document: KDBXDocument) -> [ImportDuplicates.Existing] { known(in: document).map(\.existing) }

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
                                         username: strings["UserName"] ?? "", password: strings["Password"] ?? "",
                                         contentHash: baseline(of: entry)?.content)
    }

    /// The `PSSS_SOURCE` custom data of an entry.
    static func sourceID(of entry: XNode) -> String? { customData(entry, sourceKey) }

    static func baseline(of entry: XNode) -> Baseline? { customData(entry, hashesKey).flatMap(Baseline.init(json:)) }

    private static func customData(_ entry: XNode, _ key: String) -> String? {
        entry.child("CustomData")?.children(named: "Item").first { $0.child("Key")?.text == key }?.child("Value")?.text
    }

    /// The decisions of the duplicate rules, with each update and merge worked out. An update that would change nothing is a
    /// skip. Both `preview` and `apply` call this, so they cannot disagree.
    static func resolve(_ plan: ImportPlan, in document: KDBXDocument) -> [Resolution] {
        resolutions(plan, known: known(in: document), document: document)
    }

    private static func resolutions(_ plan: ImportPlan, known: [Known], document: KDBXDocument) -> [Resolution] {
        let decisions = ImportDuplicates.classify(plan, against: known.map(\.existing))
        let protected = protectedStandard(in: document)
        let limit = historyLimit(in: document)
        var out: [Resolution] = []
        out.reserveCapacity(decisions.count)
        for (item, decision) in zip(plan.items, decisions) {
            switch decision {
            case .add: out.append(.add)
            case .addSimilar: out.append(.addSimilar)
            case .duplicate: out.append(.skip)
            case .update(let index):
                let change = diff(item, entry: known[index].node, merge: false, protected: protected, binaries: document.binaries, limit: limit)
                out.append(change.isEmpty ? .skip : .update(change))
            case .merge(let index):
                out.append(.merge(diff(item, entry: known[index].node, merge: true, protected: protected, binaries: document.binaries, limit: limit)))
            }
        }
        return out
    }

    private static func protectedStandard(in document: KDBXDocument) -> Set<String> {
        let protection = document.root.child("Meta")?.child("MemoryProtection")
        var set = Set<String>()
        for (key, flag) in [("Title", "ProtectTitle"), ("UserName", "ProtectUserName"), ("URL", "ProtectURL"), ("Notes", "ProtectNotes")]
        where protection?.child(flag)?.text.lowercased() == "true" { set.insert(key) }
        return set
    }

    // MARK: Rendering

    /// The strings an item becomes, in the order they are written. Every text is cleaned the way the XML writer stores it, so
    /// what is compared and what is written are the same text.
    static func render(_ item: ImportItem, protected: Set<String>) -> Rendered {
        let clean = ImportText.clean
        let websites = item.websites.map(clean)
        var title = clean(item.title)
        if item.kind == .login, title.isEmpty, let first = websites.first {
            let host = ImportDuplicates.host(first)
            if !host.isEmpty { title = host }
        }
        var pairs: [Pair] = []
        func string(_ key: String, _ value: String, protected flag: Bool? = nil) {
            pairs.append(Pair(key: key, value: clean(value), protected: flag ?? protected.contains(key)))
        }
        let card = item.kind == .card
        let username = clean(item.username)
        string("Title", title)
        string("UserName", card ? item.first(.cardholder) ?? "" : username)
        string("Password", card ? item.first(.cardNumber) ?? "" : item.password, protected: true)
        string("URL", websites.first ?? "")
        string("Notes", item.first(.notes) ?? "")
        switch item.kind {
        case .login:
            // Without a site, a username or a code the reader would take the entry for a note or a custom item.
            if websites.isEmpty, username.isEmpty, item.first(.code) == nil { string(EntryMapping.typeKey, "login") }
        case .card: string(EntryMapping.typeKey, "card")
        case .note: string(EntryMapping.typeKey, "note")
        case .custom: string(EntryMapping.typeKey, "custom")
        }
        if card { string(EntryMapping.cardExpiryKey, item.first(.expiry) ?? "") }

        var labels = ImportLabels()
        var extraCodes: [ImportField] = []
        for field in item.fields where field.role == .code {
            // Only a login reads `otp` back, and editing any other kind through `upsert` removes it. A code on another kind, or
            // a second code, stays a hidden field, which an edit never touches.
            if item.kind == .login, !pairs.contains(where: { $0.key == "otp" }), case .setup(let setup) = TOTP.parse(field.value) {
                let issuer = setup.issuer.isEmpty ? (title.isEmpty ? ImportDuplicates.host(websites.first ?? "") : title) : setup.issuer
                string("otp", TOTP.setupURL(secret: setup.secret, issuer: issuer, account: setup.account.isEmpty ? username : setup.account,
                                             settings: setup.settings), protected: true)
            } else {
                extraCodes.append(ImportField(.custom, label: field.label.isEmpty ? "One-time code" : field.label, value: field.value, concealed: true))
            }
        }
        for (offset, site) in websites.dropFirst().enumerated() { string(offset == 0 ? "KP2A_URL" : "KP2A_URL_\(offset)", site) }
        for field in item.fields where [.securityCode, .pin, .custom].contains(field.role) {
            string(labels.claim(field.label.isEmpty ? field.role.rawValue : field.label), field.value, protected: field.concealed)
        }
        for field in extraCodes { string(labels.claim(field.label), field.value, protected: true) }

        var tags: [String] = []
        for tag in item.tags {
            let text = clean(tag).replacingOccurrences(of: ";", with: " ").replacingOccurrences(of: ",", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty, !tags.contains(text) { tags.append(text) }
        }
        return Rendered(title: title, pairs: pairs, tags: tags, websites: websites)
    }

    private static func stamp(_ node: XNode?) -> Date? { node.flatMap { KeePassTime.date($0.text) } }

    private static func fieldHash(_ entryID: String, _ key: String, _ value: String) -> String {
        var hasher = SHA256()
        for part in [entryID, key, value] { hasher.update(data: Data(part.utf8)); hasher.update(data: Data([0])) }
        return Data(hasher.finalize()).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    private static func splitTags(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == ";" || $0 == "," }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // MARK: Updates and merges

    /// What an item changes in an entry it has met before. An update (same source identifier) writes the source's new values and
    /// leaves what the source never had. A merge (the same login from a richer source) only fills in: a value the entry already
    /// holds and that differs is kept, and the imported one is added as a field ending in "(1Password)".
    private static func diff(_ item: ImportItem, entry: XNode, merge: Bool, protected: Set<String>, binaries: [Data], limit: Int) -> Change {
        let rendered = render(item, protected: protected)
        let entryID = entry.child("UUID")?.text ?? ""
        let before = baseline(of: entry)
        var current: [String: String] = [:]
        for node in entry.children where node.name == "String" {
            if let key = node.child("Key")?.text { current[key] = node.child("Value")?.text ?? "" }
        }
        var change = Change(entry: entry, rendered: rendered, isMerge: merge,
                            baseline: Baseline(content: item.fingerprint, fields: [:], tags: rendered.tags))

        // The hosts the entry already lists, so a merge adds only a site it does not have.
        var knownHosts = Set<String>()
        for (key, value) in current where key == "URL" || key.hasPrefix("KP2A_URL") {
            let host = ImportDuplicates.host(value)
            if !host.isEmpty { knownHosts.insert(host) }
        }
        var used = Set(current.keys)
        func freeLabel(_ base: String) -> String {
            var candidate = base
            var n = 2
            while used.contains(candidate) { candidate = "\(base) (\(n))"; n += 1 }
            used.insert(candidate)
            return candidate
        }
        func shown(_ key: String) -> String { key == "otp" ? "One-time code" : key == "KP2A_URL" || key.hasPrefix("KP2A_URL_") ? "Website" : key }

        for pair in rendered.pairs {
            let key = pair.key
            if merge, key == EntryMapping.typeKey { continue }
            if merge, key.hasPrefix("KP2A_URL") {
                let host = ImportDuplicates.host(pair.value)
                if host.isEmpty || knownHosts.contains(host) { continue }
                knownHosts.insert(host)
                var slot = 0
                var name = "KP2A_URL"
                while used.contains(name) { slot += 1; name = "KP2A_URL_\(slot)" }
                used.insert(name)
                change.sets.append(Pair(key: name, value: pair.value, protected: pair.protected))
                continue
            }
            guard let held = current[key] else {
                change.sets.append(pair)
                used.insert(key)
                continue
            }
            if held == pair.value { continue }
            // The same site with another path is the same site: the match was made on it.
            if merge, key == "URL", !held.isEmpty, ImportDuplicates.host(held) == ImportDuplicates.host(pair.value) { continue }
            if merge {
                if held.isEmpty {
                    change.sets.append(pair)
                } else if !pair.value.isEmpty {
                    change.sets.append(Pair(key: freeLabel("\(shown(key)) (1Password)"), value: pair.value, protected: pair.protected))
                    change.conflicts.append(shown(key))
                }
            } else {
                // Only a field the source changed is written. One the source left alone keeps what the person made of it.
                if let known = before?.fields[key], known == fieldHash(entryID, key, pair.value) { continue }
                if let known = before?.fields[key], known != fieldHash(entryID, key, held) { change.overwritten.append(shown(key)) }
                change.sets.append(pair)
            }
        }
        // A field the source dropped goes too, unless the person changed it here.
        if !merge, let before {
            let live = Set(rendered.pairs.map(\.key))
            for (key, hash) in before.fields.sorted(by: { $0.key < $1.key }) where !live.contains(key) {
                if let held = current[key], fieldHash(entryID, key, held) == hash { change.removes.append(key) }
            }
        }
        // What the source said, not what the entry holds: a value the person changed then still differs from it next time.
        change.baseline.fields = rendered.pairs.reduce(into: [:]) { $0[$1.key] = fieldHash(entryID, $1.key, $1.value) }

        // Tags: a merge adds. An update follows the source and keeps the tags that were never the source's.
        let held = splitTags(entry.child("Tags")?.text ?? "")
        var wanted = held
        if merge {
            for tag in rendered.tags where !wanted.contains(tag) { wanted.append(tag) }
        } else {
            let dropped = Set(before?.tags ?? []).subtracting(rendered.tags)
            wanted = held.filter { !dropped.contains($0) }
            for tag in rendered.tags where !wanted.contains(tag) { wanted.append(tag) }
        }
        if wanted != held { change.tags = wanted }

        // Attachments, by name. The same name and size is the same file.
        var sizes: [String: Int] = [:]
        for node in entry.children where node.name == "Binary" {
            guard let name = node.child("Key")?.text, let ref = node.child("Value")?.attribute("Ref").flatMap(Int.init), binaries.indices.contains(ref) else { continue }
            sizes[name] = binaries[ref].count - 1
        }
        for file in item.attachments {
            let name = ImportText.clean(file.name)
            if let size = sizes[name] {
                if size == file.size { continue }
                if !merge { change.replaced.insert(name) }
            }
            change.attachments.append(file)
        }

        // Earlier passwords the entry does not hold yet, and the earlier creation date.
        var passwords = Set<String>()
        passwords.insert(current["Password"] ?? "")
        for snapshot in entry.child("History")?.children(named: "Entry") ?? [] {
            for node in snapshot.children where node.name == "String" && node.child("Key")?.text == "Password" {
                passwords.insert(node.child("Value")?.text ?? "")
            }
        }
        for revision in kept(item, limit: limit).revisions where passwords.insert(ImportText.clean(revision.password)).inserted {
            change.historyAdds.append(revision)
        }
        if merge, let held = stamp(entry.child("Times")?.child("CreationTime")), item.created < held {
            change.creation = item.created
        }
        return change
    }

    // MARK: Writing

    private struct State {
        var binaries: [Data]
        var index: [Data: Int]?
        var protected: Set<String>
        var groups: [String: XNode] = [:]
        var recycleBin: String?
        var now: String
        var touched: [XNode] = []
    }

    fileprivate static func write(_ plan: ImportPlan, into document: inout KDBXDocument) throws -> ImportSummary {
        guard let rootGroup = document.rootGroup else { throw ImportError.vaultStructure }
        let meta = document.root.child("Meta")
        let limit = historyLimit(in: document)
        let resolutions = resolve(plan, in: document)
        let summary = account(plan, resolutions, historyLimit: limit)

        let zero = Data(count: 16).base64EncodedString()
        var recycleBin = meta?.child("RecycleBinEnabled")?.text.lowercased() == "false" ? nil : meta?.child("RecycleBinUUID")?.text
        if recycleBin == zero { recycleBin = nil }
        var state = State(binaries: document.binaries, protected: protectedStandard(in: document), recycleBin: recycleBin,
                          now: ImportTime.iso(plan.importedAt))

        for (item, resolution) in zip(plan.items, resolutions) {
            switch resolution {
            case .skip: continue
            case .add, .addSimilar:
                // KeePassFile, Root and the root group are three levels, then the folders, the entry, and a string with its key
                // (a history record goes two levels further).
                guard 3 + item.folder.count + 1 + (item.history.isEmpty ? 2 : 4) <= XMLTree.maxDepth else { throw ImportError.unreadableResult }
                let entry = try makeEntry(item, limit: limit, state: &state)
                group(for: item.folder.map(ImportText.clean), root: rootGroup, state: &state).children.append(entry)
                state.touched.append(entry)
            case .update(let change), .merge(let change):
                try apply(change, item: item, limit: limit, state: &state)
                state.touched.append(change.entry)
            }
        }

        // The second line of defence: what was written is serialized and read back, a thousand entries at a time, before the
        // vault changes. A character the writer cannot store, or any other way the entries would not survive a save, stops the
        // import here instead of corrupting the vault. The depth of the groups is checked the way the codec checks it, since a
        // folder path nested past what it reads makes a file that does not open.
        var batch: [XNode] = []
        func verify() throws {
            guard !batch.isEmpty else { return }
            defer { batch.removeAll(keepingCapacity: true) }
            do { _ = try XMLTree.parse(XMLTree.serialize(XNode("KeePassFile", children: batch))) } catch { throw ImportError.unreadableResult }
        }
        for node in state.touched {
            // A group is checked without the entries under it, which are checked on their own.
            batch.append(node.name == "Group" ? XNode("Group", children: node.children.filter { $0.name != "Group" && $0.name != "Entry" }) : node)
            if batch.count >= 1000 { try verify() }
        }
        try verify()

        document.binaries = state.binaries
        return summary
    }

    private static func makeEntry(_ item: ImportItem, limit: Int, state: inout State) throws -> XNode {
        let rendered = render(item, protected: state.protected)
        let created = ImportTime.iso(item.created), modified = ImportTime.iso(item.modified)
        let entryID = UUID().kdbxBase64

        var strings: [XNode] = []
        for pair in rendered.pairs {
            let node = XNode("Value", text: pair.value)
            if pair.protected { node.setAttribute("Protected", "True") }
            strings.append(XNode("String", children: [XNode("Key", text: pair.key), node]))
        }

        var binaries: [XNode] = []
        var names = Set<String>()
        for attachment in item.attachments {
            let index = try pool(attachment, state: &state)
            binaries.append(XNode("Binary", children: [XNode("Key", text: unique(ImportText.clean(attachment.name), &names)),
                                                       XNode("Value", attributes: [("Ref", String(index))])]))
        }

        let times = XNode("Times", children: [
            XNode("CreationTime", text: created), XNode("LastModificationTime", text: modified), XNode("LastAccessTime", text: modified),
            XNode("ExpiryTime", text: created), XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
            XNode("LocationChanged", text: created)])
        var children = [XNode("UUID", text: entryID), XNode("IconID", text: "0")]
        let tags = rendered.tags.joined(separator: ";")
        if !tags.isEmpty { children.append(XNode("Tags", text: tags)) }
        children.append(times)
        children += strings
        children += binaries
        children.append(XNode("AutoType", children: [XNode("Enabled", text: "True"), XNode("DataTransferObfuscation", text: "0")]))
        if let source = item.sourceID {
            let baseline = Baseline(content: item.fingerprint,
                                    fields: rendered.pairs.reduce(into: [:]) { $0[$1.key] = fieldHash(entryID, $1.key, $1.value) },
                                    tags: rendered.tags)
            children.append(customData(source: ImportText.clean(source), baseline: baseline, modified: modified))
        }
        let entry = XNode("Entry", children: children)

        // History: whole earlier versions, oldest first, each with the password it had and the time it was replaced.
        let revisions = kept(item, limit: limit).revisions
        if !revisions.isEmpty {
            let history = XNode("History")
            for revision in revisions {
                let snapshot = entry.deepCopy()
                snapshot.children.first { $0.name == "String" && $0.child("Key")?.text == "Password" }?.child("Value")?.text = ImportText.clean(revision.password)
                snapshot.child("Times")?.setChildText("LastModificationTime", ImportTime.iso(revision.date))
                history.children.append(snapshot)
            }
            entry.children.append(history)
        }
        return entry
    }

    private static func customData(source: String?, baseline: Baseline?, modified: String) -> XNode {
        var items: [XNode] = []
        if let source {
            items.append(XNode("Item", children: [XNode("Key", text: sourceKey), XNode("Value", text: source), XNode("LastModificationTime", text: modified)]))
        }
        if let baseline {
            items.append(XNode("Item", children: [XNode("Key", text: hashesKey), XNode("Value", text: baseline.json), XNode("LastModificationTime", text: modified)]))
        }
        return XNode("CustomData", children: items)
    }

    /// Writes a `Change` into its entry. The version the entry had is kept as the newest history record first.
    private static func apply(_ change: Change, item: ImportItem, limit: Int, state: inout State) throws {
        let entry = change.entry

        // The previous version, then the earlier passwords the source knew, oldest first.
        let history = entry.child("History") ?? {
            let node = XNode("History")
            entry.children.append(node)
            return node
        }()
        let snapshot = entry.deepCopy()
        snapshot.children.removeAll { $0.name == "History" }
        var records = history.children
        if !change.sets.isEmpty || !change.removes.isEmpty || change.tags != nil || !change.attachments.isEmpty { records.append(snapshot) }
        for revision in change.historyAdds {
            let old = snapshot.deepCopy()
            old.children.first { $0.name == "String" && $0.child("Key")?.text == "Password" }?.child("Value")?.text = ImportText.clean(revision.password)
            old.child("Times")?.setChildText("LastModificationTime", ImportTime.iso(revision.date))
            records.append(old)
        }
        func time(_ node: XNode) -> Date { stamp(node.child("Times")?.child("LastModificationTime")) ?? .distantPast }
        records = records.enumerated().sorted { (time($0.element), $0.offset) < (time($1.element), $1.offset) }.map(\.element)
        if limit >= 0, records.count > limit { records = Array(records.suffix(limit)) }
        history.children = records
        if records.isEmpty { entry.children.removeAll { $0 === history } }

        func stringNode(_ key: String) -> XNode? { entry.children.first { $0.name == "String" && $0.child("Key")?.text == key } }
        for key in change.removes {
            let doomed = stringNode(key)
            entry.children.removeAll { $0 === doomed }
        }
        for pair in change.sets {
            if let node = stringNode(pair.key), let value = node.child("Value") {
                value.text = pair.value
                if pair.protected { value.setAttribute("Protected", "True") }
            } else {
                let value = XNode("Value", text: pair.value)
                if pair.protected { value.setAttribute("Protected", "True") }
                let node = XNode("String", children: [XNode("Key", text: pair.key), value])
                let at = entry.children.lastIndex { $0.name == "String" }.map { $0 + 1 } ?? (entry.children.firstIndex { $0.name == "Times" }.map { $0 + 1 } ?? entry.children.count)
                entry.children.insert(node, at: at)
            }
        }
        if let tags = change.tags {
            if let node = entry.child("Tags") { node.text = tags.joined(separator: ";") }
            else if !tags.isEmpty {
                entry.children.insert(XNode("Tags", text: tags.joined(separator: ";")), at: entry.children.firstIndex { $0.name == "Times" } ?? entry.children.count)
            }
        }
        var names = Set(entry.children.filter { $0.name == "Binary" }.compactMap { $0.child("Key")?.text.lowercased() })
        for file in change.attachments {
            let index = try pool(file, state: &state)
            let name = ImportText.clean(file.name)
            if change.replaced.contains(name),
               let node = entry.children.first(where: { $0.name == "Binary" && $0.child("Key")?.text == name }), let ref = node.child("Value") {
                ref.setAttribute("Ref", String(index))
            } else {
                let node = XNode("Binary", children: [XNode("Key", text: unique(name, &names)), XNode("Value", attributes: [("Ref", String(index))])])
                let at = entry.children.lastIndex { $0.name == "Binary" || $0.name == "String" }.map { $0 + 1 } ?? entry.children.count
                entry.children.insert(node, at: at)
            }
        }
        if let creation = change.creation { entry.child("Times")?.setChildText("CreationTime", ImportTime.iso(creation)) }
        if !change.isEmpty || change.isMerge {
            entry.child("Times")?.setChildText("LastModificationTime", state.now)
            entry.child("Times")?.setChildText("LastAccessTime", state.now)
        }

        // Where it came from and what was written, replacing what an earlier import left.
        let data = entry.child("CustomData") ?? {
            let node = XNode("CustomData")
            let at = entry.children.firstIndex { $0.name == "History" } ?? entry.children.count
            entry.children.insert(node, at: at)
            return node
        }()
        func put(_ key: String, _ value: String) {
            if let node = data.children(named: "Item").first(where: { $0.child("Key")?.text == key }) {
                node.setChildText("Value", value)
                node.setChildText("LastModificationTime", state.now)
            } else {
                data.children.append(XNode("Item", children: [XNode("Key", text: key), XNode("Value", text: value), XNode("LastModificationTime", text: state.now)]))
            }
        }
        if let source = item.sourceID { put(sourceKey, ImportText.clean(source)) }
        put(hashesKey, change.baseline.json)
    }

    /// The position of the attachment's bytes in the binary pool. Identical bytes are stored once. The file is read straight
    /// into the buffer that goes in the pool, behind the one byte that says whether the file is protected, so only one copy
    /// of the file is ever in memory.
    private static func pool(_ attachment: ImportAttachment, state: inout State) throws -> Int {
        let descriptor = open(attachment.url.path, O_RDONLY | O_CLOEXEC)
        guard descriptor >= 0 else { throw ImportError.attachmentUnreadable(attachment.name) }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { throw ImportError.attachmentUnreadable(attachment.name) }
        guard Int(info.st_size) == attachment.size else { throw ImportError.attachmentChanged(attachment.name) }
        var stored = Data(count: attachment.size + 1)
        var filled = 0
        let ok: Bool = stored.withUnsafeMutableBytes { buffer in
            guard let base = buffer.baseAddress else { return attachment.size == 0 }
            while filled < attachment.size {
                let got = read(descriptor, base + 1 + filled, attachment.size - filled)
                if got < 0 { return false }
                if got == 0 { break }
                filled += got
            }
            return true
        }
        guard ok else { throw ImportError.attachmentUnreadable(attachment.name) }
        var extra: UInt8 = 0
        guard filled == attachment.size, read(descriptor, &extra, 1) == 0 else { throw ImportError.attachmentChanged(attachment.name) }

        if state.index == nil {
            var index: [Data: Int] = [:]
            for (position, existing) in state.binaries.enumerated() {
                let digest = Data(SHA256.hash(data: existing))
                if index[digest] == nil { index[digest] = position }
            }
            state.index = index
        }
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
            if found == nil { parent.children.append(node); state.touched.append(node) }
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

/// KeePass times as ISO 8601 UTC, made without a formatter so tens of thousands of entries stay quick. A date outside years 1
/// to 9999, or one that is not a number, is clamped, so no input can trap or write a year the file cannot hold.
enum ImportTime {
    static func iso(_ date: Date) -> String {
        var value = date.timeIntervalSince1970
        if !value.isFinite { value = 0 }
        value = min(max(value, -62_135_596_800), 253_402_300_799)
        let seconds = Int64(value.rounded(.down))
        let days = PlanBuilder.Value.floorDivide(seconds, 86_400)
        let rest = Int(seconds - days * 86_400)
        let (y, m, d) = PlanBuilder.Value.civil(daysSinceEpoch: days)
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d, rest / 3600, rest % 3600 / 60, rest % 60)
    }
}
