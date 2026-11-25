import Foundation

/// What the app has just shown the browser popup, and so may release when the popup asks (docs/browser-extension.md, "Host and
/// app"; docs/plans/browser-relay.md, section 3). A bare `credential` request with a known record id is worth nothing: the login
/// must be in this ledger for that vault and that page's host, put there by a `candidates` or `search` the app answered for the
/// same page in the last five minutes. A login in "Other Matches" (`manual`, saved for another site) is released only when it
/// was in the results of a `search` made on this page, so the person's own typing is what offered it.
///
/// In memory only, never written anywhere, and holding references only: no title, account, password or vault name. It is emptied
/// when any vault locks, when the Mac sleeps or the screen locks, and when the app quits (`clear`). The clock is injected so the
/// expiry can be tested without waiting.
final class OfferLedger: @unchecked Sendable {
    /// How long an offer stands.
    static let lifetime: TimeInterval = 5 * 60
    /// The most offers kept at once. A search gives out at most 20 and a list a few, so this is never reached by one person; it
    /// only bounds memory when the relay is hammered.
    static let capacity = 1000

    private struct Key: Hashable {
        var vault: String
        var ref: String
        var host: String
    }

    private struct Offer {
        var expires: Date
        /// The login was in the results of a `search` for this host.
        var searched: Bool
    }

    private let now: @Sendable () -> Date
    private let lock = NSLock()
    private var offers: [Key: Offer] = [:]

    init(now: @escaping @Sendable () -> Date = { Date() }) { self.now = now }

    /// Records that `refs` of `vault` were shown for the page at `host` (the normalized host, `SharedVault.host`). `searched`: they
    /// are the results of a `search`, not a list of the page's own matches.
    func offer(_ refs: [String], vault: String, host: String, searched: Bool) {
        guard !refs.isEmpty, !vault.isEmpty, !host.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        let current = now()
        offers = offers.filter { $0.value.expires > current }
        for ref in refs {
            let key = Key(vault: vault, ref: ref, host: host)
            // A login that was searched stays searched when a later list offers it again.
            offers[key] = Offer(expires: current.addingTimeInterval(Self.lifetime), searched: searched || offers[key]?.searched == true)
        }
        if offers.count > Self.capacity {
            for key in offers.sorted(by: { $0.value.expires < $1.value.expires }).prefix(offers.count - Self.capacity).map(\.key) { offers[key] = nil }
        }
    }

    /// Whether `ref` of `vault` may be released to the page at `host`: it was offered there, the offer has not expired, and (for a
    /// `manual` fill) it came out of a search.
    func allows(ref: String, vault: String, host: String, manual: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let offer = offers[Key(vault: vault, ref: ref, host: host)], offer.expires > now() else { return false }
        return !manual || offer.searched
    }

    /// Forgets everything: a vault locked, the Mac slept, the screen locked, the app is quitting.
    func clear() {
        lock.lock(); defer { lock.unlock() }
        offers.removeAll()
    }

    /// How many offers stand (tests).
    var count: Int { lock.lock(); defer { lock.unlock() }; return offers.count }
}
