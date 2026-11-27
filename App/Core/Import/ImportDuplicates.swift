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
        var isPlain: Bool { sourceID == nil || sourceID?.hasPrefix("csv:") == true || sourceID?.hasPrefix("apple:") == true }
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

    /// Why an item was added although a login for the same site and user name exists.
    enum SimilarReason: Sendable, Equatable {
        /// Both have a password and they differ.
        case password
        /// The vault's login has a password and this one has none.
        case incomingHasNone
        /// This one has a password and the vault's login has none.
        case existingHasNone
        /// Neither has a password, and the titles differ.
        case otherTitle
        /// The entry it would have merged into was already merged into by an earlier item of this import.
        case mergeTaken
        /// A code, passkey, note or field differs from the vault's login (Apple Passwords imports).
        case otherDetails
    }

    /// A CSV row that looks like an earlier CSV login with another title or another site.
    struct LooksLike: Sendable, Equatable {
        var existing: Int
        /// What differs: the title (same site and user name) or the site (same title and user name).
        var differsInTitle: Bool
    }

    /// What the rules need to know about an entry beyond `Existing`, asked for only when several items share an identifier.
    struct EntryDetail: Sendable {
        /// The per-field hashes stored when it was imported, by field name.
        var fieldHashes: [String: String]
        /// The passwords in its history.
        var history: [String]
    }

    /// What `decide` found: one decision per plan item, and the details a message needs.
    struct Outcome: Sendable {
        var decisions: [Decision]
        /// Items of a group that shares one identifier, matched to an existing entry by their fields because no entry had their
        /// exact identifier: the position of the item and the entry.
        var matchedByFields: [Int: Int]
        /// Items matched to an entry among several that are alike (same kind, title, site and user name), by password and fields.
        /// The entry keeps its own identifier, so a reordered export changes nothing.
        var keepsIdentifier: Set<Int>
        var similar: [Int: SimilarReason]
        var looksLike: [Int: LooksLike]
        /// Groups of alike items too large to weigh one against the other: the position of the first item and the group's size.
        /// They were paired with the entries by order.
        var pairedByOrder: [(position: Int, count: Int)] = []
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

    /// The digest part of a shared identifier: `1password:x#abcd1234` and `1password:x#abcd1234-2` both give `abcd1234`.
    private static func suffixDigest(_ id: String?) -> String? {
        guard let id, let mark = id.range(of: "#", options: .backwards) else { return nil }
        return id[mark.upperBound...].split(separator: "-").first.map(String.init)
    }

    /// One decision per plan item, in order. Items accepted earlier in the same plan count as existing for the later ones.
    /// `deleted` holds the source identifiers the person deleted in Psss. `details` tells about an entry when items that are alike
    /// have to be paired with entries.
    static func decide(_ plan: ImportPlan, against existing: [Existing], deleted: Set<String> = [],
                       details: ((Int) -> EntryDetail)? = nil) -> Outcome {
        var byID: [String: Int] = [:]
        var byBase: [String: [Int]] = [:]
        // The live entries by site and user name, and the ones without a password by site, user name and title. What an item is
        // judged against is read from these, minus the entries its siblings claim (see `known`).
        var entriesBySiteUser: [String: [Int]] = [:]
        var entriesWithoutPassword: [String: [Int]] = [:]
        // What items of this import added, with the shared identifier of the item that added it.
        var addedPasswords: [String: [(base: String?, password: String)]] = [:]
        var addedWithout: [String: [String?]] = [:]
        // The entries that the items of each group of a shared identifier claim, and so change, in this same import.
        var groupClaimed: [String: Set<Int>] = [:]
        var mergeable: [String: [Int]] = [:]
        var csvBySiteUser: [String: [Int]] = [:]
        var csvByTitleUser: [String: [Int]] = [:]
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
                if entry.isPlain, !entry.password.isEmpty { mergeable[key(host, entry.username, entry.password), default: []].append(index) }
                if entry.isFromCSV {
                    csvBySiteUser[key(host, entry.username), default: []].append(index)
                    csvByTitleUser[key(entry.title, entry.username), default: []].append(index)
                }
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
        // Items that are alike in kind, title, site and user name cannot be told apart by the suffix, which only counts them, so they
        // are paired with the entries by password and fields, and only what is left over is paired by order.
        var fuzzy: [Int: Int] = [:]
        var tied = Set<Int>()
        var paired: [Int: Int] = [:]
        var keeps = Set<Int>()
        var limited: [(position: Int, count: Int)] = []
        var groups: [String: [Int]] = [:]
        for (position, item) in plan.items.enumerated() { if let base = item.sharedBase { groups[base, default: []].append(position) } }
        for (base, members) in groups {
            var digestCount: [String: Int] = [:]
            for position in members { digestCount[plan.items[position].identityDigest, default: 0] += 1 }
            var claimed = Set<Int>()
            var open: [Int] = []
            var alike: [String: [Int]] = [:]
            for position in members {
                let item = plan.items[position]
                if digestCount[item.identityDigest, default: 0] > 1 { alike[item.identityDigest, default: []].append(position); tied.insert(position); continue }
                if let id = item.sourceID, let index = byID[id], !existing[index].inRecycleBin { claimed.insert(index) } else { open.append(position) }
            }
            // The alike ones first, among the entries that carry their digest.
            for digest in alike.keys.sorted() {
                let positions = alike[digest] ?? []
                let candidates = (byBase[base] ?? []).filter { !claimed.contains($0) && suffixDigest(existing[$0].sourceID) == digest }
                let eligible = positions.filter { position in
                    if let id = plan.items[position].sourceID, let index = byID[id], existing[index].inRecycleBin { return false }
                    return true
                }
                var chosen: [Int: Int]?
                if eligible.count * candidates.count <= pairingBound { chosen = optimalPairing(plan, eligible, candidates, existing, details) }
                if chosen == nil {
                    chosen = orderedPairing(plan, eligible, candidates, existing, byID)
                    if let first = eligible.first { limited.append((first, positions.count)) }
                }
                let pairs = chosen ?? [:]
                for (position, index) in pairs { paired[position] = index; keeps.insert(position) }
                claimed.formUnion(pairs.values)
            }
            var candidates = (byBase[base] ?? []).filter { !claimed.contains($0) }
            defer { groupClaimed[base] = claimed }
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
                if let best { fuzzy[position] = candidates[best.at]; claimed.insert(candidates[best.at]); candidates.remove(at: best.at) }
            }
        }
        var excluded = Set<Int>()
        func buildSets() {
            entriesBySiteUser.removeAll(); entriesWithoutPassword.removeAll()
            for (index, entry) in existing.enumerated() where !entry.inRecycleBin && !excluded.contains(index) {
                for host in entry.hosts {
                    entriesBySiteUser[key(host, entry.username), default: []].append(index)
                    if entry.password.isEmpty { entriesWithoutPassword[key(host, entry.username, entry.title)] = (entriesWithoutPassword[key(host, entry.username, entry.title)] ?? []) + [index] }
                }
            }
        }
        /// The passwords the vault and this import hold for a site and user name, as an item of group `base` sees them: the entries
        /// that its siblings claim change in this same import, and what a sibling added is its own, so neither counts. Every other
        /// entry (typed by hand, from a CSV, from another 1Password item) counts as for any item.
        func known(_ siteUser: String, base: String?) -> [String] {
            let claimed = base.flatMap { groupClaimed[$0] }
            var out = (entriesBySiteUser[siteUser] ?? []).filter { claimed?.contains($0) != true }.map { existing[$0].password }
            for added in addedPasswords[siteUser] ?? [] where base == nil || added.base != base { out.append(added.password) }
            return out
        }
        func knownWithoutPassword(_ siteUserTitle: String, base: String?) -> Bool {
            let claimed = base.flatMap { groupClaimed[$0] }
            if (entriesWithoutPassword[siteUserTitle] ?? []).contains(where: { claimed?.contains($0) != true }) { return true }
            return (addedWithout[siteUserTitle] ?? []).contains { base == nil || $0 != base }
        }
        buildSets()
        // The decisions are made in a sweep over the plan. Entries that an item updates change in this same import, so what they
        // held before must not make another item look like a duplicate (a second import would see them changed and add it after
        // all). When any entry is updated, the sweep runs again with the sets of passwords built without those entries: what they
        // will hold is not known here (a field the person changed is kept), so they count for nothing.
        func sweep() -> (decisions: [Decision], matched: [Int: Int], similar: [Int: SimilarReason], looksLike: [Int: LooksLike]) {
            consumed.removeAll(); addedPasswords.removeAll(); addedWithout.removeAll()
            var matchedByFields: [Int: Int] = [:]
            var similar: [Int: SimilarReason] = [:]
            var looksLike: [Int: LooksLike] = [:]
            var planIDs = Set<String>()

            var decisions: [Decision] = []
            decisions.reserveCapacity(plan.items.count)
            for (position, item) in plan.items.enumerated() {
                if let id = item.sourceID {
                    if planIDs.contains(id) { decisions.append(.duplicate); continue }
                    var direct: Int?
                    if tied.contains(position) {
                        direct = paired[position]
                        if direct == nil, let index = byID[id], existing[index].inRecycleBin { direct = index }
                    } else if let index = byID[id], !(existing[index].inRecycleBin && fuzzy[position] != nil) {
                        direct = index
                    }
                    if let index = direct ?? fuzzy[position] {
                        planIDs.insert(id)
                        if direct == nil { matchedByFields[position] = index }
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
                // An item that shares an identifier is judged like any other, except that the entries its siblings claim do not count:
                // they change in this same import, and a second import would see them changed and add this item after all.
                let base = item.sharedBase
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
                    if hosts.contains(where: { knownWithoutPassword(key($0, item.username, title), base: base) }) {
                        decisions.append(.duplicate)
                        continue
                    }
                }
                var decision = Decision.add
                if forcedSimilar {
                    decision = .addSimilar
                    similar[position] = .mergeTaken
                } else if !hosts.isEmpty {
                    var reason: SimilarReason?
                    for host in hosts {
                        let seen = known(key(host, item.username), base: base)
                        if seen.isEmpty { continue }
                        if !item.password.isEmpty, seen.contains(item.password) { decision = .duplicate; break }
                        let anyPassword = seen.contains { !$0.isEmpty }
                        reason = reason ?? (item.password.isEmpty ? (anyPassword ? .incomingHasNone : .otherTitle) : (anyPassword ? .password : .existingHasNone))
                    }
                    if decision != .duplicate, let reason { decision = .addSimilar; similar[position] = reason }
                }
                decisions.append(decision)
                if decision != .duplicate {
                    if let id = item.sourceID { planIDs.insert(id) }
                    // A CSV row that matches no marker may still be a login the vault holds under another title or site.
                    if item.sourceID?.hasPrefix("csv:") == true, !hosts.isEmpty {
                        if let other = hosts.lazy.compactMap({ csvBySiteUser[key($0, item.username)]?.first { existing[$0].title != title } }).first {
                            looksLike[position] = LooksLike(existing: other, differsInTitle: true)
                        } else if let other = csvByTitleUser[key(title, item.username)]?.first(where: { entry in !existing[entry].hosts.contains { hosts.contains($0) } }) {
                            looksLike[position] = LooksLike(existing: other, differsInTitle: false)
                        }
                    }
                    for host in hosts {
                        addedPasswords[key(host, item.username), default: []].append((base, item.password))
                        if item.password.isEmpty { addedWithout[key(host, item.username, title), default: []].append(base) }
                    }
                }
            }
            return (decisions, matchedByFields, similar, looksLike)
        }
        var result = sweep()
        var updatedEntries: [Int: Int] = [:]
        for (position, decision) in result.decisions.enumerated() { if case .update(let index) = decision { updatedEntries[index] = position } }
        if !updatedEntries.isEmpty {
            excluded = Set(updatedEntries.keys)
            buildSets()
            result = sweep()
        }
        return Outcome(decisions: result.decisions, matchedByFields: result.matched, keepsIdentifier: keeps, similar: result.similar, looksLike: result.looksLike,
                       pairedByOrder: limited.sorted { $0.position < $1.position })
    }

    // MARK: Pairing items that are alike with entries

    /// The most (items times entries) that are weighed one against the other. Above it a group is paired by order. 40,000 is a group
    /// of 200 alike items: a few hundred thousand fingerprints and a table of a few hundred kilobytes, well under a second.
    static let pairingBound = 40_000

    /// What an item and an entry say about each other. An item whose content is exactly what the entry was last imported from is
    /// worth more than every other sign together (there are at most `pairingBound` of those), so an entry stays with the item it
    /// was written from, however the person edited it since and however the export is ordered. After that a password the entry holds
    /// now counts for more than one it only held earlier, and each field that still has the value it was written with counts one.
    private static let exactWeight = 10_000_000

    /// The most field comparisons (items times entries times the fields that tell the items apart) a group may cost: a comparison is a
    /// salted hash, about 4.5 microseconds, so this is under two seconds. Above it a group is paired by order.
    static let fieldBound = 400_000

    /// A pairing of items with entries that maximises the total weight (the Hungarian method, so no item loses its best entry to a
    /// tie that another item could have broken). When several pairings weigh the same, which one is taken depends only on the plan and
    /// the vault, in a fixed order of rows and columns, but it is not always the earliest pair. Only pairs with some sign of belonging
    /// together are kept; the rest is paired by order. Nil when the group costs more than `fieldBound`: the caller pairs by order.
    ///
    /// Fields cost the most, so only the ones that differ between the items of the group are compared (a field every item shares says
    /// the same of every entry), and none at all for a pair that is an exact match already.
    static func optimalPairing(_ plan: ImportPlan, _ positions: [Int], _ candidates: [Int], _ existing: [Existing],
                               _ details: ((Int) -> EntryDetail)?) -> [Int: Int]? {
        guard !positions.isEmpty, !candidates.isEmpty else { return [:] }
        // What is asked of an item and of an entry once, not once per pair.
        var entryDetail: [EntryDetail?] = []
        for index in candidates { entryDetail.append(details?(index)) }
        let rendered: [[KeePassImport.Pair]] = positions.map { details != nil ? KeePassImport.render(plan.items[$0], protected: []).pairs : [] }
        var first: [String: String] = [:]
        var differs = Set<String>()
        for pairs in rendered {
            let keys = Set(pairs.map(\.key))
            for pair in pairs { if let seen = first[pair.key] { if seen != pair.value { differs.insert(pair.key) } } else { first[pair.key] = pair.value } }
            for key in first.keys where !keys.contains(key) { differs.insert(key) }
        }
        if positions.count * candidates.count * differs.count > fieldBound { return nil }
        let compared: [[KeePassImport.Pair]] = rendered.map { $0.filter { differs.contains($0.key) } }
        var weight = [[Int]](repeating: [Int](repeating: 0, count: candidates.count), count: positions.count)
        for (row, position) in positions.enumerated() {
            let item = plan.items[position]
            let password = ImportText.clean(item.password)
            let fingerprint = item.fingerprint
            for (column, index) in candidates.enumerated() {
                if existing[index].holds(fingerprint) { weight[row][column] = exactWeight; continue }
                var score = 0
                if let detail = entryDetail[column] {
                    // An empty password says nothing about which entry it was.
                    if !password.isEmpty {
                        if existing[index].password == password { score += 2000 } else if detail.history.contains(password) { score += 1000 }
                    }
                    for pair in compared[row] {
                        guard let stored = detail.fieldHashes[pair.key] else { continue }
                        if stored == KeePassImport.fieldHash(existing[index].entryID, pair.key, pair.value) { score += 1 }
                    }
                }
                weight[row][column] = score
            }
        }
        var out: [Int: Int] = [:]
        for (row, column) in assign(weight) where weight[row][column] > 0 { out[positions[row]] = candidates[column] }
        // Whatever shows no sign of belonging anywhere takes the entries that are left, in order.
        let taken = Set(out.values)
        var free = candidates.filter { !taken.contains($0) }[...]
        for position in positions where out[position] == nil {
            guard let entry = free.popFirst() else { break }
            out[position] = entry
        }
        return out
    }

    /// The pairs (row, column) of the assignment with the greatest total weight, every row of the smaller side placed. Rows and
    /// columns are tried in order, so equal totals resolve the same way every time.
    static func assign(_ weight: [[Int]]) -> [(Int, Int)] {
        let rows = weight.count, columns = weight.first?.count ?? 0
        guard rows > 0, columns > 0 else { return [] }
        // The method places every row, so the smaller side is the rows.
        let transposed = rows > columns
        let n = transposed ? columns : rows, m = transposed ? rows : columns
        func cost(_ i: Int, _ j: Int) -> Int { -(transposed ? weight[j - 1][i - 1] : weight[i - 1][j - 1]) }
        var u = [Int](repeating: 0, count: n + 1), v = [Int](repeating: 0, count: m + 1)
        var p = [Int](repeating: 0, count: m + 1), way = [Int](repeating: 0, count: m + 1)
        for i in 1...n {
            p[0] = i
            var j0 = 0
            var minimum = [Int](repeating: Int.max, count: m + 1)
            var used = [Bool](repeating: false, count: m + 1)
            repeat {
                used[j0] = true
                let i0 = p[j0]
                var delta = Int.max, j1 = 0
                for j in 1...m where !used[j] {
                    let current = cost(i0, j) - u[i0] - v[j]
                    if current < minimum[j] { minimum[j] = current; way[j] = j0 }
                    if minimum[j] < delta { delta = minimum[j]; j1 = j }
                }
                for j in 0...m {
                    if used[j] { u[p[j]] += delta; v[j] -= delta } else if minimum[j] != Int.max { minimum[j] -= delta }
                }
                j0 = j1
            } while p[j0] != 0
            repeat {
                let j1 = way[j0]
                p[j0] = p[j1]
                j0 = j1
            } while j0 != 0
        }
        var out: [(Int, Int)] = []
        for j in 1...m where p[j] != 0 { out.append(transposed ? (j - 1, p[j] - 1) : (p[j] - 1, j - 1)) }
        return out.sorted { $0.0 < $1.0 }
    }

    /// The pairing for a group too large to weigh: an item takes the entry that carries its own identifier, and the rest take the
    /// remaining entries in the order of the vault. Linear in the size of the group.
    static func orderedPairing(_ plan: ImportPlan, _ positions: [Int], _ candidates: [Int], _ existing: [Existing],
                               _ byID: [String: Int]) -> [Int: Int] {
        var out: [Int: Int] = [:]
        var taken = Set<Int>()
        let open = Set(candidates)
        for position in positions {
            if let id = plan.items[position].sourceID, let index = byID[id], open.contains(index), taken.insert(index).inserted { out[position] = index }
        }
        var next = 0
        for position in positions where out[position] == nil {
            while next < candidates.count, taken.contains(candidates[next]) { next += 1 }
            guard next < candidates.count else { break }
            out[position] = candidates[next]
            taken.insert(candidates[next])
        }
        return out
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
        // One megabyte at a time, and each buffer is released at once, so a large file is never in memory whole.
        while true {
            let more: Bool = autoreleasepool {
                guard let chunk = try? handle.read(upToCount: 1 << 20), !chunk.isEmpty else { return false }
                hasher.update(data: chunk)
                return true
            }
            if !more { break }
        }
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
        if let passkey { put("passkey"); put(passkey.credentialID.base64EncodedString()); put(passkey.rpID) }
        return Hex.string(hasher.finalize().prefix(16))
    }

    /// Eight hex digits of what an item is, not what it holds: kind, title, first site and user name. They rarely change, so they
    /// tell apart items that share an identifier.
    var identityDigest: String { identityHash(4) }

    /// The same, as many bytes of the digest as asked for.
    func identityHash(_ bytes: Int) -> String {
        var hasher = SHA256()
        for part in [kind.rawValue, ImportText.clean(title), ImportText.clean(websites.first ?? ""), ImportText.clean(username)] {
            hasher.update(data: Data(part.utf8))
            hasher.update(data: Data([0]))
        }
        return Hex.string(hasher.finalize().prefix(bytes))
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
