import Foundation

/// What the app talks to. The interface and the importers never see KeePass structures, so KDBX stays one
/// implementation behind this boundary (roadmap M0 gate).
@MainActor
protocol VaultStore: AnyObject {
    /// Heading for the vault in the sidebar.
    var title: String { get }
    var isSample: Bool { get }
    func items() -> [VaultItem]
    /// Adds or updates items, then persists once.
    func save(_ items: [VaultItem]) throws
    /// Deletes for good. The interface's confirmation says it cannot be undone, so this stays permanent for now.
    func delete(_ id: UUID) throws
    /// Moves a login, card or note to Recently Deleted (the Recycle Bin of a KeePass vault) instead of deleting it.
    func moveToRecentlyDeleted(_ id: UUID) throws
    /// What is in Recently Deleted, newest deletion first, with when each was deleted. Never part of `items()`.
    func recentlyDeleted() -> [(item: VaultItem, deleted: Date)]
    /// Puts an item back where it was deleted from (or at the top level when that is gone).
    func restore(_ id: UUID) throws
    /// Deletes an item for good, from Recently Deleted or from the vault.
    func deletePermanently(_ id: UUID) throws
    func emptyRecentlyDeleted() throws
    /// Earlier passwords of an item, newest first, each with when it was replaced. Empty when there are none.
    func previousPasswords(of id: UUID) -> [(password: String, replaced: Date)]
    /// When the item's current password was set, from its history. Nil when unknown.
    func passwordChanged(of id: UUID) -> Date?
    /// Makes an earlier password the current one. It is itself a revision, so the password it replaces joins the list.
    func restorePassword(of id: UUID, replacedAt: Date) throws
    /// Removes the item's earlier passwords from the vault. Backup copies elsewhere may still hold them.
    func clearPreviousPasswords(of id: UUID) throws
    /// Records a copy or fill in this device's usage log. Never writes the vault file.
    func markUsed(_ id: UUID)
    /// Writes anything still pending. Edits are written as they are made, so a KDBX vault has nothing pending; kept for stores that batch.
    func flush() throws
    /// Adds an import plan in one write. All or nothing: when it throws, nothing was added.
    func apply(_ plan: ImportPlan) throws -> ImportSummary
}

enum VaultStoreError: Error, Equatable {
    /// The file changed on disk since it was opened, for example through iCloud or another app.
    case changedOnDisk
    case fileMissing
    case writeFailed(String)
    /// The vault file exists but could not be read, so the check for changes cannot be made and nothing was written.
    case unreadable
}

/// The compiled-in sample vault. It lives in memory only: what the person adds or edits while trying it is gone when the
/// store is dropped (the app does that when it locks or quits). Nothing is written to disk and no AutoFill identity is
/// registered for it, so a sample login can never become a real one the system offers or the extension reads.
@MainActor
final class SampleVaultStore: VaultStore {
    let title = String(localized: "Sample vault")
    let isSample = true
    private var current = SampleVault.items
    private var deleted: [(item: VaultItem, deleted: Date)] = []

    func items() -> [VaultItem] { current }

    func save(_ items: [VaultItem]) throws {
        for item in items {
            if let index = current.firstIndex(where: { $0.id == item.id }) { current[index] = item } else { current.append(item) }
        }
    }

    func delete(_ id: UUID) throws { try deletePermanently(id) }

    func moveToRecentlyDeleted(_ id: UUID) throws {
        guard let index = current.firstIndex(where: { $0.id == id }) else { return }
        deleted.insert((current.remove(at: index), Date()), at: 0)
    }

    func recentlyDeleted() -> [(item: VaultItem, deleted: Date)] { deleted }

    func restore(_ id: UUID) throws {
        guard let index = deleted.firstIndex(where: { $0.item.id == id }), !current.contains(where: { $0.id == id }) else { return }
        current.append(deleted.remove(at: index).item)
    }

    func deletePermanently(_ id: UUID) throws {
        current.removeAll { $0.id == id }
        deleted.removeAll { $0.item.id == id }
    }

    func emptyRecentlyDeleted() throws { deleted.removeAll() }

    func previousPasswords(of id: UUID) -> [(password: String, replaced: Date)] { [] }
    func passwordChanged(of id: UUID) -> Date? { nil }
    func restorePassword(of id: UUID, replacedAt: Date) throws {}
    func clearPreviousPasswords(of id: UUID) throws {}

    func markUsed(_ id: UUID) {}
    func flush() throws {}

    /// The sample vault is not encrypted, so no imported secret may reach it.
    func apply(_ plan: ImportPlan) throws -> ImportSummary { throw ImportError.sampleVault }
}
