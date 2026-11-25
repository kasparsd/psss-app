import Foundation

/// Where the person was in each vault, so that after a lock (the lock time ran out, the Mac slept) and an unlock in the same run
/// the window reopens the place and the item. Leaving and coming back (`docs/experience.md`).
///
/// Memory only, by design: it holds a place, an item's record id and nothing else, never a field value, a title or the search text,
/// and it has no way to write anywhere. It is gone when the app quits.
///
/// - While a vault is open its window reports its place and item here (`note`).
/// - A lock marks the vault (`didLock`); the report stays, and the next unlock of that vault takes it (`take`), once.
/// - The person's own choices forget it: Lock All Vaults and Remove Vault (`forget`, `forgetAll`). Quitting forgets it by ending.
@MainActor
final class ReturnPlaces {
    struct Spot: Equatable, Sendable {
        let destination: VaultDestination
        /// The open item's record id; nil when the list itself was showing.
        let item: UUID?
    }

    private var spots: [UUID: Spot] = [:]
    private var locked: Set<UUID> = []

    /// The window of an open vault reports where it is. A vault that is already locked ignores a late report from a window that
    /// is going away.
    func note(_ spot: Spot?, vault: UUID) {
        guard !locked.contains(vault) else { return }
        spots[vault] = spot
    }

    func didLock(_ vault: UUID) {
        if spots[vault] != nil { locked.insert(vault) }
    }

    /// The place to return to after `vault` was unlocked again; nil unless it was locked in this run with a place noted. Used once.
    func take(vault: UUID) -> Spot? {
        defer { spots[vault] = nil; locked.remove(vault) }
        return locked.contains(vault) ? spots[vault] : nil
    }

    func holds(vault: UUID) -> Bool { locked.contains(vault) && spots[vault] != nil }

    func forget(_ vault: UUID) {
        spots[vault] = nil
        locked.remove(vault)
    }

    func forgetAll() {
        spots = [:]
        locked = []
    }
}
