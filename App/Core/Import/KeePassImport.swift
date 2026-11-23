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
        let resolved = KeePassImport.resolve(plan, in: self)
        return KeePassImport.account(plan, resolved, historyLimit: KeePassImport.historyLimit(in: self))
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

    /// The name the app shows for a stored key: what a message says when it names a field. Keys the app does not rename (a custom
    /// field's own name, a PIN, a security code) are shown as they are.
    static func displayLabel(_ key: String, kind: ImportItemKind) -> String {
        switch key {
        case "Title": return "Title"
        case "UserName": return kind == .card ? "Cardholder" : "Username"
        case "Password": return kind == .card ? "Card number" : "Password"
        case "URL": return "Website"
        case "Notes": return "Notes"
        case "otp": return "Verification code"
        case EntryMapping.cardExpiryKey: return "Expiry"
        default: return key.hasPrefix("KP2A_URL") ? "Website" : key
        }
    }

    /// The revisions that fit under the vault's limit, newest kept, and how many were left out.
    static func kept(_ item: ImportItem, limit: Int) -> (revisions: [ImportRevision], dropped: Int) {
        guard limit >= 0, item.history.count > limit else { return (item.history, 0) }
        return (Array(item.history.suffix(limit)), item.history.count - limit)
    }

    static func account(_ plan: ImportPlan, _ resolved: Resolved, historyLimit limit: Int) -> ImportSummary {
        var summary = ImportSummary()
        summary.duplicatesInExport = plan.duplicatesInExport
        summary.trashedSkipped = plan.skipped.trashed
        summary.unreadable = plan.skipped.unreadable
        summary.webFormFieldsSkipped = plan.skipped.webFormFields
        summary.rowsSkipped = plan.skipped.rows
        summary.missingDates = plan.missingDates
        summary.issues = plan.issues + resolved.issues
        for (position, (item, resolution)) in zip(plan.items, resolved.items).enumerated() {
            let title: String? = item.title.isEmpty ? nil : item.title
            switch resolution {
            case .skip:
                summary.duplicatesSkipped += 1
                continue
            case .addSimilar:
                summary.similarAdded += 1
                let why: String
                switch resolved.similar[position] ?? .password {
                case .password: why = String(localized: "the vault already has a login for this site and user name with a different password, so this one was added as a separate entry. Delete the one you do not need.")
                case .incomingHasNone: why = String(localized: "the vault already has a login for this site and user name with a password, and this one has none, so it was added as a separate entry. Delete the one you do not need.")
                case .existingHasNone: why = String(localized: "the vault already has a login for this site and user name without a password, and this one has one, so it was added as a separate entry. Delete the one you do not need.")
                case .otherTitle: why = String(localized: "the vault already has a login for this site and user name with another title and no password, so this one was added as a separate entry. Delete the one you do not need.")
                case .mergeTaken: why = String(localized: "the login it matches was already combined with another item of this import, so this one was added as a separate entry")
                }
                // A look-alike of a CSV login is told once, in the look-alike line below.
                if resolved.looksLike[position] == nil { summary.issues.append(ImportIssue(kind: .similarLogin, item: title, detail: why)) }
            case .refresh:
                summary.refreshed += 1
                continue
            case .inRecycleBin:
                summary.issues.append(ImportIssue(kind: .inRecycleBin, item: title,
                                                  detail: String(localized: "you deleted it here earlier, so it was not imported again. The deleted copy was left as it is.")))
                continue
            case .deletedByPerson:
                summary.deletedNotImported += 1
                summary.deletedItems.append(SkippedItem(title: item.title, kind: item.kind))
                continue
            case .update(let change):
                summary.updated += 1
                for name in change.removedFiles { summary.removedAttachments.append(RemovedAttachment(item: item.title, file: name)) }
                if !change.removedFiles.isEmpty {
                    let names = change.removedFiles.prefix(3).joined(separator: ", ")
                    let more = change.removedFiles.count - 3
                    let detail: String
                    if change.removedFiles.count == 1 {
                        detail = String(localized: "an attachment removed in 1Password was removed here too: \(names)")
                    } else if more > 0 {
                        detail = String(localized: "\(change.removedFiles.count) attachments removed in 1Password were removed here too: \(names) and \(more) more")
                    } else {
                        detail = String(localized: "\(change.removedFiles.count) attachments removed in 1Password were removed here too: \(names)")
                    }
                    summary.issues.append(ImportIssue(kind: .attachmentRemoved, item: title, detail: detail))
                }
                summary.attachments += change.attachments.count
                summary.historyEntries += change.historyAdds.count
                if !change.overwritten.isEmpty {
                    let tail = change.keepsEarlier
                        ? String(localized: "Psss kept the earlier value.")
                        : String(localized: "This vault keeps no earlier versions, so the earlier value is gone.")
                    summary.issues.append(ImportIssue(kind: .updatedOverwrote, item: title,
                                                      detail: String(localized: "it changed in 1Password, so your edit to \(change.overwritten.joined(separator: ", ")) here was replaced with the new value. \(tail)")))
                }
                if !change.emptied.isEmpty || !change.removed.isEmpty {
                    summary.issues.append(ImportIssue(kind: .secretEmptied, item: title, detail: emptiedLine(change)))
                }
                summary.issues += item.issues
                continue
            case .merge(let change):
                summary.merged += 1
                summary.attachments += change.attachments.count
                summary.historyEntries += change.historyAdds.count
                if !change.conflicts.isEmpty {
                    summary.issues.append(ImportIssue(kind: .mergeConflict, item: title,
                                                      detail: String(localized: "the vault already had a different value for \(change.conflicts.joined(separator: ", ")), so it was kept. Psss also kept the value from 1Password.")))
                }
                if change.notesCombined {
                    summary.issues.append(ImportIssue(kind: .notesCombined, item: title,
                                                      detail: String(localized: "its notes differed, so the notes from 1Password were added below the notes already here")))
                }
                if change.codeNotInUse {
                    summary.issues.append(ImportIssue(kind: .codeNotInUse, item: title,
                                                      detail: String(localized: "it already had a verification code, so the one from 1Password was kept apart and is not used for signing in")))
                }
                summary.issues += item.issues
                continue
            case .add: break
            }
            if let other = resolved.looksLike[position] {
                summary.possibleMatches.append(PossibleMatch(title: item.title, kind: item.kind, existingTitle: other.title))
                summary.issues.append(ImportIssue(kind: .looksLikeExisting, item: title,
                                                  detail: other.differsInTitle
                                                    ? String(localized: "it looks like \u{2018}\(other.title)\u{2019}, which has a different title, so it was added as a separate entry. Delete the one you do not need.")
                                                    : String(localized: "it looks like \u{2018}\(other.title)\u{2019}, which has a different site, so it was added as a separate entry. Delete the one you do not need.")))
            }
            summary.issues += item.issues
            let (revisions, dropped) = kept(item, limit: limit)
            if dropped > 0 {
                summary.issues.append(ImportIssue(kind: .historyTrimmed, item: title,
                                                  detail: dropped == 1
                                                    ? String(localized: "1 older password was not kept because the vault keeps at most \(limit) per item")
                                                    : String(localized: "\(dropped) older passwords were not kept because the vault keeps at most \(limit) per item")))
            }
            var counted = item
            counted.history = revisions
            summary.count(counted)
        }
        if summary.deletedNotImported > 0 {
            summary.issues.append(ImportIssue(kind: .deletedNotImported, item: nil,
                                              detail: summary.deletedNotImported == 1
                                                ? String(localized: "1 item you deleted in Psss was not imported again")
                                                : String(localized: "\(summary.deletedNotImported) items you deleted in Psss were not imported again")))
        }
        summary.secretsChanged = summary.issues.filter { $0.kind == .secretChanged }.count
        return summary
    }

    /// "a", "a and b", "a, b and c".
    private static func listed(_ names: [String]) -> String {
        names.count < 2 ? names.joined() : names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
    }

    /// The one line for an update that emptied the password or card number, or removed a setup key, PIN, security code, card
    /// expiry or hidden custom field, because the source did.
    static func emptiedLine(_ change: Change) -> String {
        let total = change.emptied.count + change.removed.count
        let isAre = change.emptied.count == 1 ? "is" : "are"
        let wasWere = change.removed.count == 1 ? "was" : "were"
        let emptied = "\(listed(change.emptied)) \(isAre) empty", removed = "\(listed(change.removed)) \(wasWere) removed"
        let tail: String
        if change.keepsEarlier { tail = total == 1 ? String(localized: "Psss kept the earlier value.") : String(localized: "Psss kept the earlier values.") }
        else { tail = total == 1 ? String(localized: "This vault keeps no earlier versions, so the earlier value is gone.") : String(localized: "This vault keeps no earlier versions, so the earlier values are gone.") }
        if change.removed.isEmpty {
            return total == 1 ? String(localized: "\(emptied) in 1Password now, so it was emptied here too. \(tail)")
                              : String(localized: "\(emptied) in 1Password now, so they were emptied here too. \(tail)")
        }
        if change.emptied.isEmpty {
            return total == 1 ? String(localized: "\(removed) in 1Password, so it was removed here too. \(tail)")
                              : String(localized: "\(removed) in 1Password, so they were removed here too. \(tail)")
        }
        return String(localized: "\(emptied) and \(removed) in 1Password, so they were emptied or removed here too. \(tail)")
    }

    // MARK: Existing entries

    /// What the import does with one item.
    enum Resolution {
        case add
        case addSimilar
        case skip
        /// The same identifier as an entry in the recycle bin: left alone and reported.
        case inRecycleBin
        /// The person deleted this item in Psss.
        case deletedByPerson
        case update(Change)
        case merge(Change)
        /// Nothing differs, but the stored hashes are in an older form and are rewritten in the current one.
        case refresh(Change)
    }

    /// One resolution per plan item, and what the vault says about items that are no longer in the source.
    struct Resolved {
        var items: [Resolution]
        var issues: [ImportIssue]
        /// Why an item that was added is listed as similar, by position in the plan.
        var similar: [Int: ImportDuplicates.SimilarReason] = [:]
        /// CSV rows that look like an earlier CSV login: the title of that entry and what differs.
        var looksLike: [Int: (title: String, differsInTitle: Bool)] = [:]
        /// The identifier an item is stored under when it is not the one it carries, by position in the plan. It differs when the
        /// identifier is already held by another entry of the vault, so that no two live entries ever hold the same one.
        var identifiers: [Int: String] = [:]
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
        /// Attachment names an update removes: the source dropped them and the person did not change them.
        var removedFiles: [String] = []
        /// The group path an update moves the entry to: the source moved it and the person did not.
        var moveTo: [String]?
        var parent: XNode?
        var notesCombined = false
        var codeNotInUse = false
        /// The entry keeps its own source identifier (it was paired among items that are alike).
        var keepSource = false
        /// Attachment names that already exist with other bytes and take the new ones (an update only).
        var replaced: Set<String> = []
        var historyAdds: [ImportRevision] = []
        /// Labels of fields the person had changed here that an update replaced.
        var overwritten: [String] = []
        /// Labels of fields a merge left alone because they held another value.
        var conflicts: [String] = []
        /// The password or card number an update emptied because the source did, as "the password".
        var emptied: [String] = []
        /// The setup key, PIN, security code, card expiry or hidden custom fields an update removed because the source did.
        var removed: [String] = []
        /// Whether the vault's history settings keep the version this change replaces (not with a limit of 0, nor one that is too big).
        var keepsEarlier = true
        var creation: Date?
        var baseline: Baseline

        var isEmpty: Bool {
            sets.isEmpty && removes.isEmpty && tags == nil && attachments.isEmpty && removedFiles.isEmpty && moveTo == nil
                && historyAdds.isEmpty && creation == nil
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

    /// What was written by an import: a salted fingerprint of the whole item, one per field, the tags, the folder it was in and the
    /// SHA-256 of each attachment, so a later import can tell a change in the source from a change the person made here.
    struct Baseline {
        /// Version 3: content salted with the entry identifier, folder, and attachment digests salted per entry and name.
        static let current = 3
        var version = Baseline.current
        var content: String
        var fields: [String: String]
        var tags: [String]
        /// Where the source had the item. Nil in a baseline that did not record it.
        var folder: [String]?
        /// Attachment name to the SHA-256 of its bytes, salted with the entry identifier and the name.
        var files: [String: String] = [:]

        var json: String {
            var object: [String: Any] = ["v": Baseline.current, "content": content, "fields": fields, "tags": tags, "files": files]
            if let folder { object["folder"] = folder }
            guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return "" }
            return String(decoding: data, as: UTF8.self)
        }

        init(content: String, fields: [String: String], tags: [String], folder: [String]? = nil, files: [String: String] = [:]) {
            self.content = content
            self.fields = fields
            self.tags = tags
            self.folder = folder
            self.files = files
        }

        init?(json: String) {
            guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
                  let content = object["content"] as? String else { return nil }
            self.content = content
            version = (object["v"] as? Int) ?? 1
            fields = (object["fields"] as? [String: String]) ?? [:]
            tags = (object["tags"] as? [String]) ?? []
            folder = object["folder"] as? [String]
            // Digests of an older form cannot be compared; they are left out and a write brings them up to date.
            files = version >= Baseline.current ? (object["files"] as? [String: String]) ?? [:] : [:]
        }
    }

    struct Known {
        var node: XNode
        var parent: XNode
        /// The names of the groups above the entry, below the root group.
        var path: [String]
        var existing: ImportDuplicates.Existing
    }

    /// Every entry outside history, reduced to what the rules compare, in document order. Logins only carry a site.
    static func known(in document: KDBXDocument) -> [Known] {
        var found: [Known] = []
        let meta = document.root.child("Meta")
        let zero = Data(count: 16).base64EncodedString()
        var bin = meta?.child("RecycleBinUUID")?.text
        if bin == zero { bin = nil }
        func visit(_ group: XNode, path: [String], inBin: Bool) {
            for child in group.children {
                if child.name == "Group" {
                    visit(child, path: path + [child.child("Name")?.text ?? ""], inBin: inBin || (bin != nil && child.child("UUID")?.text == bin))
                } else if child.name == "Entry" {
                    var entry = describe(child)
                    entry.inRecycleBin = inBin
                    found.append(Known(node: child, parent: group, path: path, existing: entry))
                }
            }
        }
        if let root = document.rootGroup { visit(root, path: [], inBin: false) }
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
        let baselineOnce = baseline(of: entry)
        var existing = ImportDuplicates.Existing(sourceID: sourceID(of: entry) ?? strings[sourceKey],
                                         hosts: type == nil || type == "login" ? hosts : [],
                                         username: strings["UserName"] ?? "", password: strings["Password"] ?? "",
                                         contentHash: baselineOnce?.content, entryID: entry.child("UUID")?.text ?? "",
                                         modifiedText: entry.child("Times")?.child("LastModificationTime")?.text ?? "")
        existing.title = strings["Title"] ?? ""
        // An entry with a source and no stored hashes at all comes from the first importer, and is refreshed like an old one.
        existing.baselineStale = (baselineOnce?.version ?? (existing.sourceID == nil ? Baseline.current : 0)) < Baseline.current
        return existing
    }

    /// The `PSSS_SOURCE` custom data of an entry.
    static func sourceID(of entry: XNode) -> String? { customData(entry, sourceKey) }

    static func baseline(of entry: XNode) -> Baseline? { customData(entry, hashesKey).flatMap(Baseline.init(json:)) }

    private static func customData(_ entry: XNode, _ key: String) -> String? {
        entry.child("CustomData")?.children(named: "Item").first { $0.child("Key")?.text == key }?.child("Value")?.text
    }

    /// The decisions of the duplicate rules, with each update and merge worked out. An update that would change nothing is a
    /// skip. Both `preview` and `apply` call this, so they cannot disagree.
    static func resolve(_ plan: ImportPlan, in document: KDBXDocument) -> Resolved {
        resolutions(plan, known: known(in: document), document: document)
    }

    private static func resolutions(_ plan: ImportPlan, known: [Known], document: KDBXDocument) -> Resolved {
        let outcome = ImportDuplicates.decide(plan, against: known.map(\.existing), deleted: DeletedSources.read(from: document.root)) { index in
            let node = known[index].node
            let fields = baseline(of: node)?.fields ?? [:]
            let history = (node.child("History")?.children(named: "Entry") ?? []).map { EntryMapping.string($0, "Password") ?? "" }
            return ImportDuplicates.EntryDetail(fieldHashes: fields, history: history)
        }
        let decisions = outcome.decisions
        let protected = protectedStandard(in: document)
        let limit = historyLimit(in: document)
        let maxSize = Int(document.root.child("Meta")?.child("HistoryMaxSize")?.text.trimmingCharacters(in: .whitespaces) ?? "") ?? 6_291_456
        let keeps: (XNode, [ImportRevision]) -> Bool = { entry, adds in
            historyKeeps(entry, adds: adds, limit: limit, maxSize: maxSize, document: document)
        }
        var out: [Resolution] = []
        out.reserveCapacity(decisions.count)
        for (position, (item, decision)) in zip(plan.items, decisions).enumerated() {
            switch decision {
            case .add: out.append(.add)
            case .addSimilar: out.append(.addSimilar)
            case .duplicate: out.append(.skip)
            case .inRecycleBin: out.append(.inRecycleBin)
            case .deletedByPerson: out.append(.deletedByPerson)
            case .update(let index):
                // An entry that still names its source but has lost the stored hashes (another app dropped the custom data) leaves
                // no way to tell who changed what. It is treated like a merge: the vault's value stays and the source's is kept apart.
                let hasBaseline = baseline(of: known[index].node) != nil
                var change = diff(item, known: known[index], merge: !hasBaseline, protected: protected, binaries: document.binaries, limit: limit, keeps: keeps)
                change.keepSource = outcome.keepsIdentifier.contains(position)
                if !hasBaseline {
                    out.append(change.isEmpty ? .refresh(change) : .merge(change))
                    continue
                }
                // Nothing to change in the entry still needs a write when its hashes are old, or when it is now matched under a new
                // identifier.
                // It also needs one when the entry was last written from another version of the item, so that it is paired with this
                // version the next time without having to be worked out again.
                let rewrites = known[index].existing.baselineStale || outcome.matchedByFields[position] != nil
                    || !known[index].existing.holds(item.fingerprint)
                out.append(!change.isEmpty ? .update(change) : rewrites ? .refresh(change) : .skip)
            case .merge(let index):
                out.append(.merge(diff(item, known: known[index], merge: true, protected: protected, binaries: document.binaries, limit: limit, keeps: keeps)))
            }
        }
        // Items that were deleted in the source after an earlier import stay in the vault, and the person is told.
        var issues: [ImportIssue] = []
        var saidGroups = Set<String>()
        for (position, index) in outcome.matchedByFields.sorted(by: { $0.key < $1.key }) {
            let title = plan.items[position].title
            let plainID = known[index].existing.sourceID.map { !$0.contains("#") } ?? false
            if plainID, let base = plan.items[position].sharedBase {
                // The first item of a group carries the line about the shared internal ID, when that item is shown. Otherwise it is
                // said once here.
                let carrier = plan.items.firstIndex { $0.sharedBase == base } ?? position
                var shown = false
                switch out[carrier] { case .add, .addSimilar, .update, .merge: shown = true; default: break }
                if shown || !saidGroups.insert(base).inserted { continue }
                issues.append(ImportIssue(kind: .sharedIdentifier, item: plan.items[carrier].title.isEmpty ? nil : plan.items[carrier].title,
                                          detail: String(localized: "\(plan.items.filter { $0.sharedBase == base }.count) items shared one internal ID in 1Password and were kept as separate entries")))
                continue
            }
            issues.append(ImportIssue(kind: .sharedIdentifier, item: title.isEmpty ? nil : title,
                                      detail: String(localized: "its title or site changed in 1Password since the last import, so it was matched to the entry it had before instead of being added again")))
        }
        for group in outcome.pairedByOrder {
            let title = plan.items[group.position].title
            issues.append(ImportIssue(kind: .pairingLimit, item: title.isEmpty ? nil : title,
                                      detail: String(localized: "\(group.count) items look the same and share one internal ID in 1Password, which is too many to match one by one with what is already here, so they were matched in the order of the export. If you changed any of them here, check them.")))
        }
        if !plan.trashedSources.isEmpty {
            var live = Set<String>()
            for entry in known where !entry.existing.inRecycleBin { if let id = entry.existing.sourceID { live.insert(id) } }
            for trashed in plan.trashedSources where live.contains(trashed.id) {
                issues.append(ImportIssue(kind: .trashedInSource, item: trashed.title.isEmpty ? nil : trashed.title,
                                          detail: String(localized: "it was deleted in 1Password, but it is still in your vault")))
            }
        }
        var resolved = Resolved(items: out, issues: issues, similar: outcome.similar)
        separateIdentifiers(plan, known: known, outcome: outcome, resolved: &resolved)
        for (position, found) in outcome.looksLike {
            resolved.looksLike[position] = (known[found.existing].existing.title, found.differsInTitle)
        }
        return resolved
    }

    /// No two live entries may end up with the same `PSSS_SOURCE`. Pairing among alike items lets an entry keep its own identifier,
    /// and an item that found no entry would then be added under an identifier that entry holds. Whoever holds an identifier now
    /// keeps it: an added item gets the next free one, and an entry that would take another's identifier keeps its own.
    private static func separateIdentifiers(_ plan: ImportPlan, known: [Known], outcome: ImportDuplicates.Outcome, resolved: inout Resolved) {
        var held: [Int: String] = [:]
        for (index, entry) in known.enumerated() where !entry.existing.inRecycleBin { if let id = entry.existing.sourceID { held[index] = id } }
        // The identifier each entry will hold once the import is written.
        var target: [Int: Int] = [:]
        var indexOf: [ObjectIdentifier: Int] = [:]
        for (index, entry) in known.enumerated() { indexOf[ObjectIdentifier(entry.node)] = index }
        for (position, resolution) in resolved.items.enumerated() {
            switch resolution {
            case .update(let change), .merge(let change), .refresh(let change):
                if let index = indexOf[ObjectIdentifier(change.entry)] { target[position] = index }
            default: break
            }
        }
        var final = held
        for (position, index) in target.sorted(by: { $0.key < $1.key }) {
            guard let id = plan.items[position].sourceID, !outcome.keepsIdentifier.contains(position), !known[index].existing.inRecycleBin else { continue }
            final[index] = id
        }
        var counts: [String: Int] = [:]
        for id in final.values { counts[id, default: 0] += 1 }
        func keepOwn(_ position: Int, _ index: Int) {
            switch resolved.items[position] {
            case .update(var change): change.keepSource = true; resolved.items[position] = .update(change)
            case .merge(var change): change.keepSource = true; resolved.items[position] = .merge(change)
            case .refresh(var change): change.keepSource = true; resolved.items[position] = .refresh(change)
            default: break
            }
            if let own = held[index] { counts[final[index] ?? "", default: 0] -= 1; final[index] = own; counts[own, default: 0] += 1 }
        }
        func fresh(_ id: String) -> String {
            var stem = id
            if let dash = id.lastIndex(of: "-"), id[id.index(after: dash)...].allSatisfy(\.isNumber), !id[id.index(after: dash)...].isEmpty,
               id[..<dash].contains("#") { stem = String(id[..<dash]) }
            var n = 2
            while counts[stem + "-\(n)", default: 0] > 0 { n += 1 }
            return stem + "-\(n)"
        }
        // An entry that takes an identifier somebody else holds keeps its own instead.
        for (position, index) in target.sorted(by: { $0.key < $1.key }) {
            guard let id = final[index], counts[id, default: 0] > 1 else { continue }
            if held[index] == id { continue }
            // A merge target has no 1Password identifier of its own (it is typed by hand or from a CSV): it takes a free one, or the
            // next import would merge the same item into it again.
            var isMerge = false
            if case .merge = resolved.items[position] { isMerge = true }
            if held[index] != nil, !isMerge { keepOwn(position, index) } else {
                let other = fresh(id)
                final[index] = other; counts[id, default: 0] -= 1; counts[other, default: 0] += 1
                resolved.identifiers[position] = other
            }
        }
        for (position, resolution) in resolved.items.enumerated() {
            switch resolution {
            case .add, .addSimilar:
                guard let id = plan.items[position].sourceID, counts[id, default: 0] > 0 else {
                    if let id = plan.items[position].sourceID { counts[id, default: 0] += 1 }
                    continue
                }
                let other = fresh(id)
                counts[other, default: 0] += 1
                resolved.identifiers[position] = other
            default: break
            }
        }
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
        if card, let expiry = item.first(.expiry), !expiry.isEmpty { string(EntryMapping.cardExpiryKey, expiry) }

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
        for field in item.fields where [.securityCode, .pin, .custom].contains(field.role) && !clean(field.value).isEmpty {
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

    static func fieldHash(_ entryID: String, _ key: String, _ value: String) -> String {
        var hasher = SHA256()
        for part in [entryID, key, value] { hasher.update(data: Data(part.utf8)); hasher.update(data: Data([0])) }
        return Hex.string(hasher.finalize().prefix(12))
    }

    /// What the baseline keeps of an attachment: its digest salted with the entry and the file name.
    private static func fileHash(_ entryID: String, _ name: String, _ digest: String) -> String { fieldHash(entryID, "file:" + name, digest) }

    private static func splitTags(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == ";" || $0 == "," }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // MARK: Updates and merges

    /// The SHA-256 of an attachment's bytes as the vault holds them (the pool keeps a protection flag byte in front).
    private static func hex(ofPooled data: Data) -> String {
        Hex.string(SHA256.hash(data: data.dropFirst()))
    }

    /// Whether the entry's own title is only its site, which says nothing the imported title does not say better.
    private static func isHostTitle(_ title: String, hosts: Set<String>) -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.contains(" ") else { return false }
        let host = ImportDuplicates.host(trimmed)
        return !host.isEmpty && hosts.contains(host)
    }

    private static func oneTimeSecret(_ value: String) -> String? {
        if case .setup(let setup) = TOTP.parse(value) { return setup.secret }
        return nil
    }

    /// What an item changes in an entry it has met before. An update (same source identifier) writes the source's new values and
    /// leaves what the source never had or the person changed. A merge (the same login from a richer source) only fills in: a user
    /// name, password or custom field that differs is kept and the imported one is added as a field ending in "(1Password)"; a
    /// title never conflicts; differing notes are joined; a differing one-time code is kept apart and is not in use.
    private static func diff(_ item: ImportItem, known: Known, merge: Bool, protected: Set<String>, binaries: [Data], limit: Int,
                             keeps: (XNode, [ImportRevision]) -> Bool) -> Change {
        let entry = known.node
        let rendered = render(item, protected: protected)
        let entryID = entry.child("UUID")?.text ?? ""
        let before = baseline(of: entry)
        var current: [String: String] = [:]
        for node in entry.children where node.name == "String" {
            if let key = node.child("Key")?.text { current[key] = node.child("Value")?.text ?? "" }
        }
        // What the entry holds as attachments, by name, with the digest of the bytes.
        var held: [String: String] = [:]
        for node in entry.children where node.name == "Binary" {
            guard let name = node.child("Key")?.text, let ref = node.child("Value")?.attribute("Ref").flatMap(Int.init), binaries.indices.contains(ref) else { continue }
            held[name] = fileHash(entryID, name, hex(ofPooled: binaries[ref]))
        }
        var files: [String: String] = [:]
        for file in item.attachments {
            let name = ImportText.clean(file.name)
            files[name] = fileHash(entryID, name, AttachmentDigest.shared.hex(of: file.url, size: file.size))
        }
        let folder = item.folder.map(ImportText.clean)

        var change = Change(entry: entry, rendered: rendered, isMerge: merge,
                            baseline: Baseline(content: ImportItem.salted(entryID, item.fingerprint), fields: [:], tags: rendered.tags,
                                               folder: folder, files: files))
        change.parent = known.parent

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
        func shown(_ key: String) -> String { displayLabel(key, kind: item.kind) }

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
            guard let now = current[key] else {
                // A value that is empty on both sides is not written.
                if !pair.value.isEmpty { change.sets.append(pair); used.insert(key) }
                continue
            }
            if now == pair.value { continue }
            if merge {
                if now.isEmpty {
                    change.sets.append(pair)
                    continue
                }
                if pair.value.isEmpty { continue }
                switch key {
                case "URL":
                    // The same site with another path is the same site: the match was made on it.
                    if ImportDuplicates.host(now) != ImportDuplicates.host(pair.value) {
                        change.sets.append(Pair(key: freeLabel("Website (1Password)"), value: pair.value, protected: pair.protected))
                        if !change.conflicts.contains("Website") { change.conflicts.append("Website") }
                    }
                case "Title":
                    // A title is not worth a conflict: the entry's own stays unless it is only its site.
                    if isHostTitle(now, hosts: knownHosts) { change.sets.append(pair) }
                case "Notes":
                    if !now.contains(pair.value) {
                        change.sets.append(Pair(key: key, value: now + "\n\n" + pair.value, protected: pair.protected))
                        change.notesCombined = true
                    }
                case "otp":
                    if let a = oneTimeSecret(now), let b = oneTimeSecret(pair.value), a == b { continue }
                    change.sets.append(Pair(key: freeLabel("One-time code (1Password)"), value: pair.value, protected: true))
                    change.codeNotInUse = true
                default:
                    change.sets.append(Pair(key: freeLabel("\(shown(key)) (1Password)"), value: pair.value, protected: pair.protected))
                    if !change.conflicts.contains(shown(key)) { change.conflicts.append(shown(key)) }
                }
            } else {
                // Only a field the source changed is written. One the source left alone keeps what the person made of it.
                if let known = before?.fields[key], known == fieldHash(entryID, key, pair.value) { continue }
                if key == "Password", !now.isEmpty, pair.value.isEmpty { change.emptied.append(item.kind == .card ? "the card number" : "the password") }
                if let known = before?.fields[key], known != fieldHash(entryID, key, now), key != EntryMapping.typeKey,
                   !change.overwritten.contains(shown(key)) { change.overwritten.append(shown(key)) }
                change.sets.append(pair)
            }
        }
        // A field the source dropped goes too, unless the person changed it here.
        if !merge, let before {
            let live = Set(rendered.pairs.map(\.key))
            for (key, hash) in before.fields.sorted(by: { $0.key < $1.key }) where !live.contains(key) {
                if let now = current[key], fieldHash(entryID, key, now) == hash {
                    change.removes.append(key)
                    // A secret (hidden) field, a code setup or a card's expiry that the source dropped is said, by the name the app shows.
                    let hidden = entry.children.first { $0.name == "String" && $0.child("Key")?.text == key }?.child("Value")?.attribute("Protected") == "True"
                    if !now.isEmpty, hidden || key == "otp" || (item.kind == .card && key == EntryMapping.cardExpiryKey) {
                        switch key {
                        case "otp": change.removed.append("the verification code setup")
                        case EntryMapping.cardExpiryKey: change.removed.append("the card expiry")
                        case "PIN": change.removed.append("the PIN")
                        case "Security code": change.removed.append("the security code")
                        default: change.removed.append("\u{2018}\(key)\u{2019}")
                        }
                    }
                }
            }
        }
        // What the source said, not what the entry holds: a value the person changed then still differs from it next time.
        change.baseline.fields = rendered.pairs.reduce(into: [:]) { $0[$1.key] = fieldHash(entryID, $1.key, $1.value) }

        // Tags: a merge adds. An update applies what the source added or removed since the last import, so a tag the person
        // removed here stays removed and one the person added stays.
        let heldTags = splitTags(entry.child("Tags")?.text ?? "")
        var wanted = heldTags
        if merge {
            for tag in rendered.tags where !wanted.contains(tag) { wanted.append(tag) }
        } else {
            let earlier = Set(before?.tags ?? [])
            let dropped = earlier.subtracting(rendered.tags)
            wanted = heldTags.filter { !dropped.contains($0) }
            for tag in rendered.tags where !wanted.contains(tag) && !earlier.contains(tag) { wanted.append(tag) }
        }
        if wanted != heldTags { change.tags = wanted }

        // Attachments, by name and bytes. The same name and the same bytes is the same file.
        for file in item.attachments {
            let name = ImportText.clean(file.name)
            let digest = files[name] ?? ""
            if let present = held[name] {
                if present == digest { continue }
                if merge { change.attachments.append(file); continue }
                // The source did not change it: the person replaced it here, and that stays.
                if before?.files[name] == digest { continue }
                change.replaced.insert(name)
            } else if !merge, before?.files[name] == digest {
                // The source did not change it and the person removed it here.
                continue
            }
            change.attachments.append(file)
        }
        // An attachment the source dropped goes too, unless the person changed it here. The bytes stay in the entry's history.
        if !merge, let before {
            for (name, digest) in before.files.sorted(by: { $0.key < $1.key }) where files[name] == nil && held[name] == digest {
                change.removedFiles.append(name)
            }
        }

        // Where it is: an update follows the source's move unless the person moved it here.
        if !merge, let was = before?.folder, was != folder, known.path == was { change.moveTo = folder }

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
        change.keepsEarlier = keeps(entry, change.historyAdds)
        if merge, let heldDate = stamp(entry.child("Times")?.child("CreationTime")), item.created < heldDate {
            change.creation = item.created
        }
        return change
    }

    /// Whether the version an update replaces is still in the entry's history once the vault's limits have pruned it: not when the
    /// vault keeps no versions, and not when that version alone is bigger than `HistoryMaxSize`. The records are ordered the way
    /// `apply` orders them (by time, then as they were added) and pruned oldest first, as `KDBXDocument.trim` prunes.
    static func historyKeeps(_ entry: XNode, adds: [ImportRevision], limit: Int, maxSize: Int, document: KDBXDocument) -> Bool {
        if limit == 0 { return false }
        var records: [(time: Date, size: Int, isNew: Bool)] = []
        for record in entry.child("History")?.children(named: "Entry") ?? [] {
            records.append((stamp(record.child("Times")?.child("LastModificationTime")) ?? .distantPast, document.historySize(of: record), false))
        }
        let own = document.historySize(of: entry)
        records.append((stamp(entry.child("Times")?.child("LastModificationTime")) ?? .distantPast, own, true))
        for revision in adds { records.append((revision.date, own, false)) }
        let ordered = records.enumerated().sorted { ($0.element.time, $0.offset) < ($1.element.time, $1.offset) }.map(\.element)
        var kept = limit > 0 && ordered.count > limit ? Array(ordered.suffix(limit)) : ordered
        if maxSize >= 0 {
            var total = kept.reduce(0) { $0 + $1.size }
            while total > maxSize, !kept.isEmpty { total -= kept.removeFirst().size }
        }
        return kept.contains { $0.isNew }
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
        var rootGroup: XNode?
    }

    fileprivate static func write(_ plan: ImportPlan, into document: inout KDBXDocument) throws -> ImportSummary {
        guard let rootGroup = document.rootGroup else { throw ImportError.vaultStructure }
        let meta = document.root.child("Meta")
        let limit = historyLimit(in: document)
        let resolved = resolve(plan, in: document)
        let summary = account(plan, resolved, historyLimit: limit)

        let zero = Data(count: 16).base64EncodedString()
        var recycleBin = meta?.child("RecycleBinEnabled")?.text.lowercased() == "false" ? nil : meta?.child("RecycleBinUUID")?.text
        if recycleBin == zero { recycleBin = nil }
        var state = State(binaries: document.binaries, protected: protectedStandard(in: document), recycleBin: recycleBin,
                          now: ImportTime.iso(plan.importedAt))
        state.rootGroup = rootGroup

        for (position, (original, resolution)) in zip(plan.items, resolved.items).enumerated() {
            var item = original
            if let id = resolved.identifiers[position] { item.sourceID = id }
            switch resolution {
            case .skip, .inRecycleBin, .deletedByPerson: continue
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
            case .refresh(let change):
                refresh(change, item: item, state: state)
                state.touched.append(change.entry)
            }
        }

        // The vault's own limits on history (count and size) apply to what was written, as they do to every save.
        document.binaries = state.binaries
        for node in state.touched where node.name == "Entry" {
            if let history = node.child("History") {
                document.trim(history)
                if history.children.isEmpty { node.children.removeAll { $0 === history } }
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
            var files: [String: String] = [:]
            for file in item.attachments {
                let name = ImportText.clean(file.name)
                files[name] = fileHash(entryID, name, AttachmentDigest.shared.hex(of: file.url, size: file.size))
            }
            let baseline = Baseline(content: ImportItem.salted(entryID, item.fingerprint),
                                    fields: rendered.pairs.reduce(into: [:]) { $0[$1.key] = fieldHash(entryID, $1.key, $1.value) },
                                    tags: rendered.tags, folder: item.folder.map(ImportText.clean), files: files)
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

    /// Rewrites only the stored hashes of an entry, in the current form. Nothing the person sees changes.
    private static func refresh(_ change: Change, item: ImportItem, state: State) {
        let entry = change.entry
        let data = entry.child("CustomData") ?? {
            let node = XNode("CustomData")
            entry.children.insert(node, at: entry.children.firstIndex { $0.name == "History" } ?? entry.children.count)
            return node
        }()
        func put(_ key: String, _ value: String) {
            if let node = data.children(named: "Item").first(where: { $0.child("Key")?.text == key }) { node.setChildText("Value", value) }
            else { data.children.append(XNode("Item", children: [XNode("Key", text: key), XNode("Value", text: value), XNode("LastModificationTime", text: state.now)])) }
        }
        if let source = item.sourceID, !change.keepSource { put(sourceKey, ImportText.clean(source)) }
        if let node = data.children(named: "Item").first(where: { $0.child("Key")?.text == hashesKey }) {
            node.setChildText("Value", change.baseline.json)
        } else {
            data.children.append(XNode("Item", children: [XNode("Key", text: hashesKey), XNode("Value", text: change.baseline.json), XNode("LastModificationTime", text: state.now)]))
        }
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
        // A version that says what the entry says now (a merge that only adds the source's identifier) is not worth a record.
        if !change.sets.isEmpty || !change.removes.isEmpty || change.tags != nil || !change.attachments.isEmpty || !change.removedFiles.isEmpty { records.append(snapshot) }
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
        for name in change.removedFiles {
            entry.children.removeAll { $0.name == "Binary" && $0.child("Key")?.text == name }
        }
        if let target = change.moveTo, let parent = change.parent, let rootGroup = state.rootGroup {
            let destination = group(for: target, root: rootGroup, state: &state)
            if destination !== parent {
                parent.children.removeAll { $0 === entry }
                destination.children.append(entry)
                entry.child("Times")?.setChildText("LocationChanged", state.now)
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
        if let source = item.sourceID, !change.keepSource { put(sourceKey, ImportText.clean(source)) }
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
        AttachmentDigest.shared.remember(attachment.url, size: attachment.size,
                                         digest: Hex.string(SHA256.hash(data: stored.dropFirst())))
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

/// KeePass times as the codec stores them. A date outside years 1 to 9999, or one that is not a number, is clamped by the codec,
/// so no input can trap or write a time the file cannot hold.
enum ImportTime {
    /// The codec's stored form (base64 for KDBX 4), which is what Psss writes everywhere else.
    static func iso(_ date: Date) -> String { KeePassTime.stored(date) }
}
