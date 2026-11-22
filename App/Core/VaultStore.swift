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
    func delete(_ id: UUID) throws
    /// Records a copy or fill in this device's usage log. Never writes the vault file.
    func markUsed(_ id: UUID)
    /// Writes anything still pending. Edits are written as they are made, so a KDBX vault has nothing pending; kept for stores that batch.
    func flush() throws
}

enum VaultStoreError: Error, Equatable {
    /// The file changed on disk since it was opened, for example through iCloud or another app.
    case changedOnDisk
    case fileMissing
    case writeFailed(String)
}

/// The compiled-in sample vault, plus whatever the person added during the demo, kept in the App Group prototype store
/// so the AutoFill extension can still be tried against it. Never encrypted.
@MainActor
final class SampleVaultStore: VaultStore {
    let title = String(localized: "Sample vault")
    let isSample = true

    func items() -> [VaultItem] { SharedVault.allItems }

    func save(_ items: [VaultItem]) throws {
        for item in items where !SampleVault.items.contains(where: { $0.id == item.id }) { SharedVault.save(item) }
    }

    func delete(_ id: UUID) throws {
        SharedVault.delete(id)
        SharedVault.registerIdentities(for: SharedVault.allItems)
    }

    func markUsed(_ id: UUID) {}
    func flush() throws {}
}
