import Foundation

/// The duplicate rule: an item is skipped when its source identifier is already in the vault, or when a login has the same
/// site, username and password as one already there. The same site and username with another password is added and
/// reported, since it may be an account the person really has twice.
enum ImportDuplicates {
    /// What the vault already holds, reduced to what the rule compares.
    struct Existing: Sendable {
        var sourceID: String?
        var hosts: [String]
        var username: String
        var password: String
    }

    enum Decision: Sendable, Equatable {
        case add
        case duplicate
        /// Added, but a login with the same site and username and another password exists.
        case addSimilar
    }

    /// One decision per plan item, in order. Items accepted earlier in the same plan count as existing for the later ones.
    static func classify(_ plan: ImportPlan, against existing: [Existing]) -> [Decision] {
        var sources = Set<String>()
        var passwords: [String: Set<String>] = [:]
        func register(_ e: Existing) {
            if let id = e.sourceID { sources.insert(id) }
            for host in e.hosts { passwords[key(host, e.username), default: []].insert(e.password) }
        }
        existing.forEach(register)

        var decisions: [Decision] = []
        decisions.reserveCapacity(plan.items.count)
        for item in plan.items {
            if let id = item.sourceID, sources.contains(id) { decisions.append(.duplicate); continue }
            let hosts = item.kind == .login ? item.websites.map(host).filter { !$0.isEmpty } : []
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
                register(Existing(sourceID: item.sourceID, hosts: hosts, username: item.username, password: item.password))
            }
        }
        return decisions
    }

    static func host(_ website: String) -> String { SiteMatch.normalizedHost(website) }

    private static func key(_ host: String, _ username: String) -> String { host + "\u{0}" + username }
}
