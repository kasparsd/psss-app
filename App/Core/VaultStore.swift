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

    func items() -> [VaultItem] { current }

    func save(_ items: [VaultItem]) throws {
        for item in items {
            if let index = current.firstIndex(where: { $0.id == item.id }) { current[index] = item } else { current.append(item) }
        }
    }

    func delete(_ id: UUID) throws { current.removeAll { $0.id == id } }

    func markUsed(_ id: UUID) {}
    func flush() throws {}

    /// The sample vault is not encrypted, so no imported secret may reach it.
    func apply(_ plan: ImportPlan) throws -> ImportSummary { throw ImportError.sampleVault }
}
