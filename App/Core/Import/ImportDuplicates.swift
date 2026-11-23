import CryptoKit
import Foundation

/// The rules that decide what an import does with each item, in this order:
///
/// 1. The same source identifier as an entry in the vault. The same content is skipped. Changed content updates that entry in
///    place. An entry in the recycle bin is left alone, so a deleted item does not come back.
/// 2. A 1Password item whose site, username and password match an entry that has no 1Password identifier (typed by hand or
///    imported from a CSV) merges into that entry: the richer source fills in what the plainer one lacks.
/// 3. A login with the same site, username and password as another entry is skipped.
/// 4. The same site and username with another password is added and reported, since it may be an account the person really
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

        /// Typed by hand, or imported from a CSV, which carries no identifier: a source that has less than a 1Password item.
        var isPlain: Bool { sourceID == nil || sourceID?.hasPrefix("csv:") == true }
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
    }

    /// One decision per plan item, in order. Items accepted earlier in the same plan count as existing for the later ones.
    static func classify(_ plan: ImportPlan, against existing: [Existing]) -> [Decision] {
        var byID: [String: Int] = [:]
        var passwords: [String: Set<String>] = [:]
        var mergeable: [String: [Int]] = [:]
        var consumed = Set<Int>()
        for (index, entry) in existing.enumerated() {
            if let id = entry.sourceID, byID[id] == nil { byID[id] = index }
            for host in entry.hosts {
                passwords[key(host, entry.username), default: []].insert(entry.password)
                if entry.isPlain, !entry.inRecycleBin, !entry.password.isEmpty { mergeable[key(host, entry.username, entry.password), default: []].append(index) }
            }
        }
        var planIDs = Set<String>()

        var decisions: [Decision] = []
        decisions.reserveCapacity(plan.items.count)
        for item in plan.items {
            if let id = item.sourceID {
                if planIDs.contains(id) { decisions.append(.duplicate); continue }
                if let index = byID[id] {
                    planIDs.insert(id)
                    if existing[index].inRecycleBin || consumed.contains(index) || existing[index].contentHash == item.fingerprint {
                        decisions.append(.duplicate)
                    } else {
                        consumed.insert(index)
                        decisions.append(.update(index))
                    }
                    continue
                }
            }
            let hosts = item.kind == .login ? item.websites.map(host).filter { !$0.isEmpty } : []
            if item.sourceID != nil, !item.password.isEmpty {
                var target: Int?
                for host in hosts where target == nil {
                    target = mergeable[key(host, item.username, item.password)]?.first { !consumed.contains($0) }
                }
                if let target {
                    consumed.insert(target)
                    planIDs.insert(item.sourceID ?? "")
                    decisions.append(.merge(target))
                    continue
                }
            }
            var decision = Decision.add
            if !hosts.isEmpty {
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
                for host in hosts { passwords[key(host, item.username), default: []].insert(item.password) }
            }
        }
        return decisions
    }

    static func host(_ website: String) -> String { SiteMatch.normalizedHost(website) }

    private static func key(_ parts: String...) -> String { parts.joined(separator: "\u{0}") }
}

extension ImportItem {
    /// A fingerprint of what the source says about the item: kind, title, fields, tags, earlier passwords and the names and sizes
    /// of attachments. Dates, folder and issues are left out, so an item that did not change in the source has the same
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
        put("history")
        for revision in history { put(revision.password) }
        put("files")
        for file in attachments { put(file.name); put(String(file.size)) }
        return Data(hasher.finalize()).prefix(16).map { String(format: "%02x", $0) }.joined()
    }
}
