import CryptoKit
import Foundation

/// The rules that decide what an import does with each item, in this order:
///
/// 1. The same source identifier as an entry in the vault. The same content is skipped. Changed content updates that entry in
///    place. An entry in the recycle bin is left alone and reported, changed or not, so a deleted item does not come back.
/// 2. An identifier the person deleted in Psss (kept in the vault's `PSSS_DELETED_SOURCES`) is not imported again, unless the
///    plan asks for it.
/// 3. A 1Password item whose site, username and password match an entry that has no 1Password identifier (typed by hand or
///    imported from a CSV) merges into that entry: the richer source fills in what the plainer one lacks. When several entries
///    match, the one from a CSV goes first, then the one modified most recently, then the first in the file. An entry that was
///    already merged into during this import is not merged into twice: the second item is added and listed as similar.
/// 4. A login with the same site, username and password as another entry is skipped. An entry in the recycle bin does not count.
/// 5. The same site and username with another password is added and reported, since it may be an account the person really
///    has twice.
enum ImportDuplicates {
    /// What the vault already holds, reduced to what the rules compare.
    struct Existing: Sendable {
        var sourceID: String?
        var hosts: [String]
        var username: String
        var password: String
        /// The content fingerprint stored when the entry was imported, if it was imported by this code.
        var contentHash: String?
        var inRecycleBin = false
        var title = ""
        /// The stored hashes are in an older form than this version writes, and want a refresh when nothing else changes.
        var baselineStale = false
        /// The entry's identifier, which salts what is stored about it.
        var entryID = ""
        /// The entry's last modification time as the file wrote it. Parsed only when a choice between entries needs it, since
        /// reading a date costs far more than the rest of describing an entry.
        var modifiedText = ""
        private var parsed: Date?
        var modified: Date {
            get { parsed ?? KeePassTime.date(modifiedText) ?? .distantPast }
            set { parsed = newValue }
        }

        /// Typed by hand, or imported from a CSV, which carries no identifier: a source that has less than a 1Password item.
        var isPlain: Bool { sourceID == nil || sourceID?.hasPrefix("csv:") == true }
        var isFromCSV: Bool { sourceID?.hasPrefix("csv:") == true }

        /// Whether the entry was imported from an item with this fingerprint. An entry imported before the fingerprint was salted
        /// and covered the folder and the attachment bytes has a stored value that cannot match: its first re-import compares it
        /// field by field instead, finds nothing to change, and counts it as already present.
        func holds(_ fingerprint: String) -> Bool {
            guard let contentHash else { return false }
            return contentHash == ImportItem.salted(entryID, fingerprint)
        }
    }

    enum Decision: Sendable, Equatable {
        case add
        case duplicate
        /// Added, but a login with the same site and username and another password exists.
        case addSimilar
        /// Same source identifier, other content: the entry at this position of `existing` changes in place.
        case update(Int)
        /// A richer item for the plainer entry at this position of `existing`.
        case merge(Int)
        /// The same source identifier as an entry in the recycle bin, at this position.
        case inRecycleBin(Int)
        /// The person deleted this item in Psss.
        case deletedByPerson
    }

    /// What `decide` found: one decision per plan item, and which of them were matched to an entry by its fields.
    struct Outcome: Sendable {
        var decisions: [Decision]
        /// Items of a group that shares one identifier, matched to an existing entry by their fields because no entry had their
        /// exact identifier (the title or site changed since the import).
        var matchedByFields: Set<Int>
    }

    static func classify(_ plan: ImportPlan, against existing: [Existing], deleted: Set<String> = []) -> [Decision] {
        decide(plan, against: existing, deleted: deleted).decisions
    }

    /// The title an entry gets: the item's own, or the host of its first site when it has none.
    static func effectiveTitle(_ item: ImportItem) -> String {
        let title = ImportText.clean(item.title)
        if !title.isEmpty || item.kind != .login { return title }
        return item.websites.first.map { host(ImportText.clean($0)) } ?? ""
    }

    /// One decision per plan item, in order. Items accepted earlier in the same plan count as existing for the later ones.
    /// `deleted` holds the source identifiers the person deleted in Psss.
    static func decide(_ plan: ImportPlan, against existing: [Existing], deleted: Set<String> = []) -> Outcome {
        var byID: [String: Int] = [:]
        var byBase: [String: [Int]] = [:]
        var passwords: [String: Set<String>] = [:]
        var withoutPassword = Set<String>()
        var mergeable: [String: [Int]] = [:]
        var consumed = Set<Int>()
        for (index, entry) in existing.enumerated() {
            if let id = entry.sourceID {
                // A live entry is the one an update meets, even when another with the same identifier is in the recycle bin.
                if let first = byID[id] { if existing[first].inRecycleBin, !entry.inRecycleBin { byID[id] = index } } else { byID[id] = index }
                if !entry.inRecycleBin {
                    let base = id.range(of: "#", options: .backwards).map { String(id[..<$0.lowerBound]) } ?? id
                    byBase[base, default: []].append(index)
                }
            }
            // An entry in the recycle bin never blocks or absorbs an imported item.
            guard !entry.inRecycleBin else { continue }
            for host in entry.hosts {
                passwords[key(host, entry.username), default: []].insert(entry.password)
                if entry.password.isEmpty { withoutPassword.insert(key(host, entry.username, entry.title)) }
                if entry.isPlain, !entry.password.isEmpty { mergeable[key(host, entry.username, entry.password), default: []].append(index) }
            }
        }
        // Which of several matching entries is merged into: from a CSV first, then the most recently modified, then file order.
        for (k, list) in mergeable where list.count > 1 {
            mergeable[k] = list.sorted {
                let a = existing[$0], b = existing[$1]
                if a.isFromCSV != b.isFromCSV { return a.isFromCSV }
                if a.modified != b.modified { return a.modified > b.modified }
                return $0 < $1
            }
        }

        // Items that share an identifier with others of the export carry a suffix made of their own content. When no entry has
        // the exact identifier (the title or site was edited), the unclaimed entries of the group are matched by their fields.
        var fuzzy: [Int: Int] = [:]
        var groups: [String: [Int]] = [:]
        for (position, item) in plan.items.enumerated() { if let base = item.sharedBase { groups[base, default: []].append(position) } }
        for (base, members) in groups {
            var claimed = Set<Int>()
            var open: [Int] = []
            for position in members {
                if let id = plan.items[position].sourceID, let index = byID[id], !existing[index].inRecycleBin { claimed.insert(index) } else { open.append(position) }
            }
            var candidates = (byBase[base] ?? []).filter { !claimed.contains($0) }
            for position in open where !candidates.isEmpty {
                let item = plan.items[position]
                let title = effectiveTitle(item)
                let hosts = Set(item.websites.map { host($0) })
                var best: (score: Int, at: Int)?
                for (slot, index) in candidates.enumerated() {
                    let entry = existing[index]
                    let score = (entry.title == title ? 1 : 0) + (entry.username == item.username ? 1 : 0) + (entry.hosts.contains { hosts.contains($0) } ? 1 : 0)
                    if score >= 2, best == nil || score > best!.score { best = (score, slot) }
                }
                if let best { fuzzy[position] = candidates[best.at]; candidates.remove(at: best.at) }
            }
        }
        var matchedByFields = Set<Int>()
        var planIDs = Set<String>()

        var decisions: [Decision] = []
        decisions.reserveCapacity(plan.items.count)
        for (position, item) in plan.items.enumerated() {
            if let id = item.sourceID {
                if planIDs.contains(id) { decisions.append(.duplicate); continue }
                let direct = byID[id].flatMap { existing[$0].inRecycleBin && fuzzy[position] != nil ? nil : $0 }
                if let index = direct ?? fuzzy[position] {
                    planIDs.insert(id)
                    if direct == nil { matchedByFields.insert(position) }
                    if existing[index].inRecycleBin {
                        decisions.append(.inRecycleBin(index))
                    } else if consumed.contains(index) {
                        decisions.append(.duplicate)
                    } else if direct != nil, existing[index].holds(item.fingerprint), !existing[index].baselineStale {
                        decisions.append(.duplicate)
                    } else {
                        // Other content, or the same content with hashes in an older form that a write brings up to date.
                        consumed.insert(index)
                        decisions.append(.update(index))
                    }
                    continue
                }
                if !plan.includeDeleted, deleted.contains(id) {
                    planIDs.insert(id)
                    decisions.append(.deletedByPerson)
                    continue
                }
            }
            let hosts = item.kind == .login ? item.websites.map(host).filter { !$0.isEmpty } : []
            // Only a 1Password item is richer than a plain entry. A CSV row never is.
            let richer = item.sourceID.map { !$0.hasPrefix("csv:") } ?? false
            var forcedSimilar = false
            if richer, !item.password.isEmpty {
                var target: Int?
                var matched = false
                for host in hosts where target == nil {
                    guard let candidates = mergeable[key(host, item.username, item.password)] else { continue }
                    matched = true
                    target = candidates.first { !consumed.contains($0) }
                }
                if let target {
                    consumed.insert(target)
                    planIDs.insert(item.sourceID ?? "")
                    decisions.append(.merge(target))
                    continue
                }
                // Every entry it would merge into was taken by an earlier item of this import: this one is its own item.
                forcedSimilar = matched
            }
            // Without a password, the same site, user name and title as an entry that has none is the same login.
            let title = effectiveTitle(item)
            if item.password.isEmpty, !hosts.isEmpty {
                if hosts.contains(where: { withoutPassword.contains(key($0, item.username, title)) }) {
                    decisions.append(.duplicate)
                    continue
                }
            }
            var decision = Decision.add
            if forcedSimilar {
                decision = .addSimilar
            } else if !hosts.isEmpty {
                var similar = false
                for host in hosts {
                    guard let known = passwords[key(host, item.username)] else { continue }
                    if !item.password.isEmpty, known.contains(item.password) { decision = .duplicate; break }
                    similar = true
                }
                if decision != .duplicate, similar { decision = .addSimilar }
            }
            decisions.append(decision)
            if decision != .duplicate {
                if let id = item.sourceID { planIDs.insert(id) }
                for host in hosts {
                    passwords[key(host, item.username), default: []].insert(item.password)
                    if item.password.isEmpty { withoutPassword.insert(key(host, item.username, title)) }
                }
            }
        }
        return Outcome(decisions: decisions, matchedByFields: matchedByFields)
    }

    static func host(_ website: String) -> String { SiteMatch.normalizedHost(website) }

    private static func key(_ parts: String...) -> String { parts.joined(separator: "\u{0}") }
}

/// A SHA-256 of a file's bytes, read in pieces so a large file is never held whole. Remembered by path and size, since the
/// same file is asked about when the plan is compared and again when it is written.
final class AttachmentDigest: @unchecked Sendable {
    static let shared = AttachmentDigest()
    private let lock = NSLock()
    private var known: [String: String] = [:]

    /// Remembered by path, size and modification time, so a file replaced between two imports is read again.
    private func cacheKey(_ url: URL, size: Int) -> String {
        var info = stat()
        let stamp = stat(url.path, &info) == 0 ? "\(info.st_mtimespec.tv_sec).\(info.st_mtimespec.tv_nsec).\(info.st_ino)" : "?"
        return url.path + "\u{0}" + String(size) + "\u{0}" + stamp
    }

    /// Lowercase hex, or a text that cannot equal a digest when the file cannot be read (applying reports that).
    func hex(of url: URL, size: Int) -> String {
        let key = cacheKey(url, size: size)
        lock.lock(); let cached = known[key]; lock.unlock()
        if let cached { return cached }
        var hasher = SHA256()
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "unreadable" }
        defer { try? handle.close() }
        while let chunk = try? handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        let digest = Hex.string(hasher.finalize())
        lock.lock(); known[key] = digest; lock.unlock()
        return digest
    }

    /// Records the digest of bytes that were just read, so the file is not read a second time.
    func remember(_ url: URL, size: Int, digest: String) {
        let key = cacheKey(url, size: size)
        lock.lock(); known[key] = digest; lock.unlock()
    }
}

extension ImportItem {
    /// A fingerprint of what the source says about the item: kind, title, fields, tags, folder, earlier passwords and the name
    /// and SHA-256 of every attachment. Dates and issues are left out, so an item that did not change in the source has the same
    /// fingerprint every time it is exported. Text is cleaned the way the writer stores it first.
    var fingerprint: String {
        var hasher = SHA256()
        func put(_ text: String) {
            hasher.update(data: Data(ImportText.clean(text).utf8))
            hasher.update(data: Data([0]))
        }
        put(kind.rawValue)
        put(title)
        for field in fields { put(field.role.rawValue); put(field.label); put(field.value); put(field.concealed ? "1" : "0") }
        put("tags")
        for tag in tags { put(tag) }
        put("folder")
        for name in folder { put(name) }
        put("history")
        for revision in history { put(revision.password) }
        put("files")
        for file in attachments { put(file.name); put(AttachmentDigest.shared.hex(of: file.url, size: file.size)) }
        return Hex.string(hasher.finalize().prefix(16))
    }

    /// Eight hex digits of what an item is, not what it holds: kind, title, first site and user name. They rarely change, so they
    /// tell apart items that share an identifier.
    var identityDigest: String {
        var hasher = SHA256()
        for part in [kind.rawValue, ImportText.clean(title), ImportText.clean(websites.first ?? ""), ImportText.clean(username)] {
            hasher.update(data: Data(part.utf8))
            hasher.update(data: Data([0]))
        }
        return Hex.string(hasher.finalize().prefix(4))
    }

    /// The fingerprint as stored in an entry: salted with the entry's own identifier, so the same item in two vaults, or twice in
    /// one, leaves different bytes behind.
    static func salted(_ entryID: String, _ fingerprint: String) -> String {
        var hasher = SHA256()
        for part in [entryID, fingerprint] { hasher.update(data: Data(part.utf8)); hasher.update(data: Data([0])) }
        return Hex.string(hasher.finalize().prefix(16))
    }
}

/// Lowercase hex without a format string, which costs microseconds a byte when there are hundreds of thousands of hashes.
enum Hex {
    private static let digits = Array("0123456789abcdef".utf8)

    static func string<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        var out: [UInt8] = []
        out.reserveCapacity(bytes.underestimatedCount * 2)
        for byte in bytes {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 15)])
        }
        return String(decoding: out, as: UTF8.self)
    }
}
