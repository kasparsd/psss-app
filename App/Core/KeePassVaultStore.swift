import CryptoKit
import Foundation

/// Where a vault lives and how to find it again after a relaunch.
struct VaultReference: Codable, Equatable, Sendable {
    var id = UUID()
    var name: String
    /// A vault Psss created in its own storage, as opposed to a file the person opened from Files or Finder.
    var managed: Bool
    /// Security-scoped bookmark of a file opened in place.
    var bookmark: Data?
    var fileName: String
    /// The vault's key is saved in the Keychain behind Face ID or Touch ID.
    var biometricUnlock = false
    /// The person said "Not Now" to the offer, so it is not repeated. Setup still has the switch.
    var biometricDeclined = false
    /// Biometric unlock was switched off because the saved key no longer opened the vault, not because the person chose to.
    /// The next password unlock saves a fresh key and switches it back on.
    var biometricStale = false

    init(id: UUID = UUID(), name: String, managed: Bool, bookmark: Data?, fileName: String) {
        self.id = id; self.name = name; self.managed = managed; self.bookmark = bookmark; self.fileName = fileName
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        managed = try c.decode(Bool.self, forKey: .managed)
        bookmark = try c.decodeIfPresent(Data.self, forKey: .bookmark)
        fileName = try c.decode(String.self, forKey: .fileName)
        biometricUnlock = try c.decodeIfPresent(Bool.self, forKey: .biometricUnlock) ?? false
        biometricDeclined = try c.decodeIfPresent(Bool.self, forKey: .biometricDeclined) ?? false
        biometricStale = try c.decodeIfPresent(Bool.self, forKey: .biometricStale) ?? false
    }

    private static let defaultsKey = "vaultReference"
    private static let forgottenKey = "forgottenVaultIDs"

    /// Shared with the AutoFill extension through the App Group. Nil when the group cannot be opened.
    private static var defaults: UserDefaults? {
        #if HOSTLESS_TESTS
        if VaultFiles.testRoot != nil { return nil }  // the reference lives in a file under the test root
        #endif
        return UserDefaults(suiteName: SharedVault.groupID)
    }

    /// Where the reference lives when the App Group defaults cannot be opened: the app's own Application Support, which the
    /// same process reads back after a relaunch and the AutoFill extension (a different container) never sees, so the
    /// extension shows its not-ready screen instead of opening anything.
    private static var fallbackURL: URL { fallbackURL(named: "vault-reference.json") }

    private static func fallbackURL(named name: String) -> URL {
        #if HOSTLESS_TESTS
        if let root = VaultFiles.testRoot { return root.appendingPathComponent(name) }
        #endif
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
    }

    private static func read(_ key: String, file: String) -> Data? {
        defaults.map { $0.data(forKey: key) } ?? (try? Data(contentsOf: fallbackURL(named: file)))
    }

    private static func write(_ data: Data, _ key: String, file: String) {
        if let defaults { defaults.set(data, forKey: key); return }
        try? FileManager.default.createDirectory(at: fallbackURL(named: file).deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: fallbackURL(named: file), options: VaultFiles.writeOptions)
    }

    private static func remove(_ key: String, file: String) {
        if let defaults { defaults.removeObject(forKey: key) } else { try? FileManager.default.removeItem(at: fallbackURL(named: file)) }
    }

    static func load() -> VaultReference? {
        read(defaultsKey, file: "vault-reference.json").flatMap { try? JSONDecoder().decode(Self.self, from: $0) }
    }

    /// The vaults that were forgotten most recently (identifiers only, the last 32), kept in the same storage as the reference. A
    /// copy of such a vault's reference that another process still holds cannot write it back, and a new vault does not lift that.
    private static var forgottenIDs: [UUID] {
        read(forgottenKey, file: "vault-reference-forgotten.json")
            .flatMap { try? JSONDecoder().decode([String].self, from: $0) }?.compactMap(UUID.init(uuidString:)) ?? []
    }

    /// "Personal.kdbx · iCloud Drive › Documents" for a file opened in place. Nothing for a vault Psss created: its location says nothing useful.
    var locationDescription: String? {
        guard !managed else { return nil }
        guard let bookmark, let url = try? VaultFiles.resolve(bookmark).url else { return fileName }
        let folder = url.deletingLastPathComponent().pathComponents
            .filter { $0 != "/" }
            .suffix(2)
            .joined(separator: " › ")
        return folder.isEmpty ? url.lastPathComponent : "\(url.lastPathComponent) · \(folder)"
    }

    /// Writes the reference of a vault that was just created or opened, which has a new identifier. Refuses a reference whose
    /// vault was forgotten, so a copy held by another process cannot bring it back. Changes to a vault that exists go through
    /// `update`, which writes only the fields it changes.
    func persist() {
        if Self.forgottenIDs.contains(id) { return }
        guard let data = try? JSONEncoder().encode(self) else { return }
        Self.write(data, Self.defaultsKey, file: "vault-reference.json")
    }

    /// Changes fields of the stored reference of vault `id`: reads the stored reference again, applies `change` to it and writes
    /// that, so a setting another process changed since this process last read stays. Does nothing, and returns nil, when the
    /// stored reference is another vault, none (the vault was forgotten) or the vault was forgotten.
    @discardableResult
    static func update(_ id: UUID, _ change: (inout VaultReference) -> Void) -> VaultReference? {
        guard !forgottenIDs.contains(id), var stored = load(), stored.id == id else { return nil }
        change(&stored)
        guard let data = try? JSONEncoder().encode(stored) else { return nil }
        write(data, defaultsKey, file: "vault-reference.json")
        return stored
    }

    /// Removes the stored reference and remembers the vault as forgotten, for good: nothing writes it again.
    static func forget(_ id: UUID) {
        let remembered = (forgottenIDs.filter { $0 != id } + [id]).suffix(32).map(\.uuidString)
        if let data = try? JSONEncoder().encode(Array(remembered)) { write(data, forgottenKey, file: "vault-reference-forgotten.json") }
        remove(defaultsKey, file: "vault-reference.json")
    }

    static func clear() { remove(defaultsKey, file: "vault-reference.json") }
}

/// Vault files on disk: coordinated reads, atomic writes and a few encrypted rollback copies.
enum VaultFiles {
    /// The App Group container, so the AutoFill extension reads and writes the same files as the app. Falls back to the app's
    /// own Application Support where the group is unavailable (unsigned builds and tests).
    static var storageRoot: URL {
        #if HOSTLESS_TESTS
        // The test scripts point the tests at a folder under build/, so they never touch real app data.
        if let root = testRoot { return root }
        #endif
        let own = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedVault.groupID) else { return own }
        // macOS reports a group path even when this build may not write there.
        return (try? FileManager.default.createDirectory(at: group, withIntermediateDirectories: true)) != nil ? group : own
    }

    #if HOSTLESS_TESTS
    static var testRoot: URL? {
        guard let path = ProcessInfo.processInfo.environment["PSSS_TEST_ROOT"], !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: path, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    #endif

    /// Every file Psss writes is replaced in one step and unreadable while the device is locked. The hostless test scripts
    /// compile with `HOSTLESS_TESTS`, which drops the protection class so they can run on a Mac whose screen is locked.
    #if HOSTLESS_TESTS
    static let writeOptions: Data.WritingOptions = [.atomic]
    #else
    static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtection]
    #endif

    static var managedDirectory: URL { storageRoot.appendingPathComponent("Vaults", isDirectory: true) }

    private static func backupDirectory(for id: UUID) -> URL {
        storageRoot.appendingPathComponent("Backups", isDirectory: true).appendingPathComponent(id.uuidString, isDirectory: true)
    }

    static func managedURL(fileName: String) -> URL { managedDirectory.appendingPathComponent(fileName) }

    static func bookmark(for url: URL) throws -> Data {
        #if os(macOS)
        try url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
    }

    static func resolve(_ bookmark: Data) throws -> (url: URL, stale: Bool) {
        var stale = false
        #if os(macOS)
        let url = try URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
        #else
        let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        #endif
        return (url, stale)
    }

    static func read(_ url: URL) throws -> Data {
        var result: Result<Data, Error> = .failure(VaultStoreError.fileMissing)
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
            result = Result { try Data(contentsOf: readURL) }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    /// Replaces the file in one step, so a crash or a full disk leaves the previous version intact.
    static func write(_ data: Data, to url: URL) throws {
        var result: Result<Void, Error> = .success(())
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writeURL in
            result = Result { try data.write(to: writeURL, options: VaultFiles.writeOptions) }
        }
        if let coordinationError { throw VaultStoreError.writeFailed(coordinationError.localizedDescription) }
        do { try result.get() } catch { throw VaultStoreError.writeFailed(error.localizedDescription) }
    }

    /// The conflict-checked write, in one coordinated block so the app and the AutoFill extension cannot interleave between the
    /// read, the comparison and the write. Reads the current bytes through the URL the coordinator hands over; refuses with
    /// `unreadable` when the file exists but cannot be read (not downloaded, no permission, a folder in its place) and writes
    /// nothing. Refuses with `changedOnDisk` when the bytes differ from the ones the caller based its edit on, unless
    /// `overwrite`, which skips only that comparison. `baseDigest` is nil only for a new vault that was never read from disk:
    /// its first write may create the file. For any other store a missing file is `fileMissing` and nothing is written, with or
    /// without `overwrite`. Returns the bytes that were replaced, for the rollback copy.
    static func replace(at url: URL, with data: Data, basedOn baseDigest: Data?, overwrite: Bool) throws -> Data? {
        var result: Result<Data?, Error> = .failure(VaultStoreError.unreadable)
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writeURL in
            result = Result {
                var previous: Data?
                if FileManager.default.fileExists(atPath: writeURL.path) {
                    do { previous = try Data(contentsOf: writeURL) } catch { throw VaultStoreError.unreadable }
                } else if baseDigest != nil {
                    throw VaultStoreError.fileMissing
                }
                if let previous, !overwrite {
                    guard let baseDigest, KDBXCrypto.equal(KDBXCrypto.sha256(previous), baseDigest) else { throw VaultStoreError.changedOnDisk }
                }
                do { try data.write(to: writeURL, options: VaultFiles.writeOptions) }
                catch { throw VaultStoreError.writeFailed(error.localizedDescription) }
                return previous
            }
        }
        if let coordinationError { throw VaultStoreError.writeFailed(coordinationError.localizedDescription) }
        return try result.get()
    }

    /// Keeps the file as it was before this write. The copy is as encrypted as the vault itself. The newest five stay.
    static func keepBackup(of previous: Data, id: UUID) {
        let directory = backupDirectory(for: id)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Milliseconds, so two writes within one second keep two copies.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        let stamp = formatter.string(from: .now).replacingOccurrences(of: ":", with: "-")
        try? previous.write(to: directory.appendingPathComponent("\(stamp).kdbx"), options: VaultFiles.writeOptions)
        let all = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).sorted()
        for old in all.dropLast(5) { try? FileManager.default.removeItem(at: directory.appendingPathComponent(old)) }
    }

    /// Deletes every rollback copy of the vault. Returns false when some could not be removed, so the caller can say so: the
    /// copies still hold whatever password they were made with. A vault with no copies is a success.
    @discardableResult
    static func removeBackups(for id: UUID) -> Bool {
        let directory = backupDirectory(for: id)
        guard FileManager.default.fileExists(atPath: directory.path) else { return true }
        do { try FileManager.default.removeItem(at: directory) } catch { return false }
        return !FileManager.default.fileExists(atPath: directory.path)
    }
}

/// An open KDBX vault. Edits change the decrypted document and are written to the file straight away.
@MainActor
final class KeePassVaultStore: VaultStore {
    private(set) var reference: VaultReference
    let url: URL
    private var document: KDBXDocument
    /// Digest of the file as last read or written. Nil only for a new vault whose file does not exist yet.
    private var baseDigest: Data?
    private let scoped: Bool
    /// Set by `changeCredentials` until the file with the new credentials is written, even if that first attempt is refused and
    /// the person overwrites afterwards.
    private var credentialsChangePending = false
    /// Rollback copies made before the last password change that could not be deleted. Each later write tries again.
    private var oldBackupsRemain = false
    /// Whether the last `commit` left rollback copies that were made with an older password.
    private(set) var lastCommitLeftOldBackups = false

    var title: String { reference.name }
    var isSample: Bool { false }
    var formatLabel: String { document.sourceVersion.map { "\($0), saved as \(document.header.versionLabel)" } ?? document.header.versionLabel }
    var kdfSummary: String { document.header.kdf.summary }
    var lastModified: Date? { document.lastModified }
    var isLegacyFormat: Bool { document.sourceVersion != nil }

    init(reference: VaultReference, url: URL, scoped: Bool, document: KDBXDocument, fileData: Data?) {
        self.reference = reference
        self.url = url
        self.scoped = scoped
        self.document = document
        baseDigest = fileData.map(KDBXCrypto.sha256)
    }

    deinit { if scoped { url.stopAccessingSecurityScopedResource() } }

    /// The key after the KDF, which Face ID or Touch ID releases. It opens this vault without running Argon2, so the AutoFill
    /// extension can stay inside its memory limit. Kept in memory only while the vault is open.
    var transformedKey: Data { document.transformedKey }

    /// The items, with last-used dates and counts from this device's usage log. The vault file's own usage fields are ignored.
    func items() -> [VaultItem] {
        let usage = UsageLog.load(for: reference.id)
        return document.items().map { item in
            var item = item
            if let used = usage[item.id] { item.lastUsed = used.lastUsed; item.useCount = used.useCount }
            return item
        }
    }

    /// Runs a change to the document and the write that follows it as one step. When the write fails for any reason, the
    /// document is exactly what it was before, so the store never holds a change that is not in the file: what `items()`
    /// shows, what AutoFill is told and what a later save writes are always what the file holds. The copy is a deep copy of the
    /// XML tree (the tree is shared by every copy of the document), made before the change.
    private func transact<T>(_ body: () throws -> T) throws -> T {
        var snapshot = document
        snapshot.root = document.root.deepCopy()
        let wasPending = credentialsChangePending
        do { return try body() } catch {
            document = snapshot
            credentialsChangePending = wasPending
            throw error
        }
    }

    /// Whether writes skip the comparison with what is on disk, set by `overwriting`.
    private var skipsConflictCheck = false

    /// Runs store calls with the check for a changed file skipped: each applies its change to the document in memory now and
    /// writes the whole vault over the file, keeping the file it replaces as a rollback copy. For the person's explicit choice
    /// after a refused write, which repeats what it was doing. An unreadable or missing file is still refused.
    func overwriting<T>(_ body: () throws -> T) rethrows -> T {
        let was = skipsConflictCheck
        skipsConflictCheck = true
        defer { skipsConflictCheck = was }
        return try body()
    }

    #if HOSTLESS_TESTS
    /// The document's XML as it would be stored, for tests that compare the state before and after a failed write.
    var documentDump: Data { XMLTree.serialize(document.root) }
    #endif

    func save(_ items: [VaultItem]) throws {
        try transact { if document.upsert(items) { try commit() } }
    }

    /// Deletes for good, like `deletePermanently`. The interface's confirmation says "cannot be undone", so this stays permanent
    /// until Recently Deleted has its own screen.
    func delete(_ id: UUID) throws { try deletePermanently(id) }

    // MARK: Recently Deleted

    func moveToRecentlyDeleted(_ id: UUID) throws { try moveToRecentlyDeleted([id]) }

    /// Moves items to Recently Deleted in one pass and one write.
    func moveToRecentlyDeleted(_ ids: [UUID]) throws {
        try transact { if document.moveToRecycleBin(ids) > 0 { try commit() } }
    }

    func recentlyDeleted() -> [(item: VaultItem, deleted: Date)] { document.recycledItems() }

    func restore(_ id: UUID) throws { try restore([id]) }

    /// Restores items in one pass and one write.
    func restore(_ ids: [UUID]) throws {
        try transact { if document.restoreFromRecycleBin(ids) > 0 { try commit() } }
    }

    func deletePermanently(_ id: UUID) throws { try deletePermanently([id]) }

    /// Deletes items for good in one pass and one write.
    func deletePermanently(_ ids: [UUID]) throws {
        try transact { if document.deletePermanently(ids) > 0 { try commit() } }
        UsageLog.remove(ids, in: reference.id)
    }

    func emptyRecentlyDeleted() throws {
        let ids = document.recycledItems().map(\.item.id)
        try transact { if document.emptyRecycleBin() > 0 { try commit() } }
        UsageLog.remove(ids, in: reference.id)
    }

    /// Deletes what has been in the bin longer than `interval` (30 days when the app opens a vault) and writes the vault only
    /// when something went. Returns how many items it deleted. Only the app calls it; see `VaultSession.purgesRecentlyDeletedOnUnlock`.
    /// When the write fails the vault is as it was.
    @discardableResult
    func purgeRecentlyDeleted(olderThan interval: TimeInterval = RecycleBinKeys.retention, now: Date = KeePassTime.now) throws -> Int {
        let before = Set(document.recycledItems().map(\.item.id))
        let count = try transact { () throws -> Int in
            let purged = document.purgeRecycleBinReport(olderThan: interval, now: now)
            if purged.entries + purged.groups > 0 { try commit() }
            return purged.entries
        }
        UsageLog.remove(before.subtracting(document.recycledItems().map(\.item.id)), in: reference.id)
        return count
    }

    // MARK: Previous passwords

    func previousPasswords(of id: UUID) -> [(password: String, replaced: Date)] { document.previousPasswords(of: id) }

    func passwordChanged(of id: UUID) -> Date? { document.passwordChanged(of: id) }

    func restorePassword(of id: UUID, replacedAt replaced: Date) throws {
        try transact { if document.restorePassword(of: id, replacedAt: replaced) { try commit() } }
    }

    func clearPreviousPasswords(of id: UUID) throws {
        try transact { if document.clearPreviousPasswords(of: id) { try commit() } }
    }

    /// What an import would add and skip, without changing the vault. Duplicates are judged against what is in the vault now.
    func preview(_ plan: ImportPlan) -> ImportSummary { document.preview(plan) }

    /// Adds the plan in one write. When the entries cannot be built or the write fails, the open document goes back to what
    /// it was and the file is untouched, so nothing was added.
    func apply(_ plan: ImportPlan) throws -> ImportSummary {
        try transact {
            let summary = try document.apply(plan)
            if summary.needsWrite { try commit() }
            return summary
        }
    }

    /// Records the use in the device-local usage log. The vault file is never written for it.
    func markUsed(_ id: UUID) { UsageLog.record(id, in: reference.id) }

    /// Nothing is held back: edits are written as they are made and use goes straight to the usage log.
    func flush() throws {}

    /// Writes the vault. Refuses when the file changed since it was read, unless inside `overwriting`, and always refuses when the
    /// file exists but cannot be read (so Overwrite cannot write blind either). Read, check and write are one coordinated step.
    private func commit() throws {
        document.touchModified()
        document.prepareForSave()
        let data = try KDBX.write(document)
        let previous = try VaultFiles.replace(at: url, with: data, basedOn: baseDigest, overwrite: skipsConflictCheck)
        baseDigest = KDBXCrypto.sha256(data)
        if credentialsChangePending {
            // Copies made before a password change are encrypted with the old password, so none is kept, including this one.
            oldBackupsRemain = !VaultFiles.removeBackups(for: reference.id)
            credentialsChangePending = false
        } else if let previous {
            // Older copies that could not be deleted before are tried again. Whatever the outcome, this write's own copy, made
            // with the current password, is kept, so a failed write never pushes good older copies out.
            if oldBackupsRemain { oldBackupsRemain = !VaultFiles.removeBackups(for: reference.id) }
            VaultFiles.keepBackup(of: previous, id: reference.id)
        } else if oldBackupsRemain {
            oldBackupsRemain = !VaultFiles.removeBackups(for: reference.id)
        }
        lastCommitLeftOldBackups = oldBackupsRemain
    }

    /// Replaces the open document with what is on disk now. Pending edits are lost. Runs the KDF, so it is async.
    func reload() async throws {
        let seen = baseDigest
        let data = try VaultFiles.read(url)
        let key = document.transformedKey
        let fresh = try await Task.detached { try KDBX.open(data, transformedKey: key) }.value
        // Our own write finished while the file was being opened: what we hold is newer than what was read, so keep it.
        guard baseDigest == seen else { return }
        document = fresh
        baseDigest = KDBXCrypto.sha256(data)
        credentialsChangePending = false  // the document is what is on disk now, so no password change is pending
    }

    /// What `changeCredentials` reports once the new password is in the file.
    enum CredentialsChange: Equatable, Sendable {
        case changed
        /// The password did change and the file is written, but some rollback copies from before could not be deleted. They are
        /// encrypted with the old password.
        case changedBackupsRemain
    }

    /// Reloads when another app, the AutoFill extension or a sync wrote the file since this store last read or wrote it.
    /// Returns whether it did. Uses the key held in memory, so it never asks for the password; throws
    /// `KDBXError.wrongCredentials` when the password or KDF seed was changed elsewhere.
    func reloadIfChanged() async throws -> Bool {
        let data = try VaultFiles.read(url)
        let seen = baseDigest
        guard let seen, !KDBXCrypto.equal(KDBXCrypto.sha256(data), seen) else { return false }
        let key = document.transformedKey
        let fresh = try await Task.detached { try KDBX.open(data, transformedKey: key) }.value
        // Our own write finished while the file was being opened: what we hold is newer, so keep it.
        guard let current = baseDigest, KDBXCrypto.equal(current, seen) else { return false }
        document = fresh
        baseDigest = KDBXCrypto.sha256(data)
        return true
    }

    func rename(_ name: String) throws {
        try transact { document.databaseName = name; try commit() }
        reference.name = name
        reference = VaultReference.update(reference.id) { $0.name = name } ?? reference
    }

    /// Changes the vault password or key file. Runs the KDF again, so it is async. Throws when the change was refused or failed, and
    /// then nothing changed. When it returns, the new password is in the file: `.changedBackupsRemain` says that some rollback
    /// copies from before could not be deleted and still open with the old password.
    @discardableResult
    func changeCredentials(to credentials: KDBXCredentials) async throws -> CredentialsChange {
        // All or nothing: when the write is refused or fails, the store goes back to the old credentials. The key derivation runs
        // off the main actor on a copy that shares the tree but never touches it.
        let source = document
        let derived = try await Task.detached { () throws -> KDBXDocument in
            var copy = source
            try copy.replaceKey(to: credentials)
            return copy
        }.value
        try transact {
            document.adoptKey(from: derived)
            document.stampMasterKeyChanged()
            credentialsChangePending = true
            try commit()
        }
        return lastCommitLeftOldBackups ? .changedBackupsRemain : .changed
    }
}

/// Owns the open vault for the app: creating, opening, unlocking and locking. One vault today; the shape is one
/// store per vault so the multiple-vault registry in docs/vaults.md can be added without changing callers.
@MainActor
@Observable
final class VaultSession {
    /// Whether unlocking deletes what has been in Recently Deleted for more than 30 days. Only the app sets it, once at launch
    /// (`KDBOXApp`). The AutoFill extension runs the same unlock code and leaves it off, so it never writes to purge.
    static var purgesRecentlyDeletedOnUnlock = false

    private(set) var store: KeePassVaultStore?
    private(set) var reference: VaultReference? = VaultReference.load()

    var isOpen: Bool { store != nil }

    /// Creates the vault in the app's own storage with the recommended KDF and cipher, then opens it.
    func create(name: String, credentials: KDBXCredentials, items: [VaultItem] = []) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? String(localized: "Passwords") : name
        let document = try await Task.detached { try KDBX.create(name: name, credentials: credentials) }.value
        document.upsert(items)
        let reference = VaultReference(name: name, managed: true, bookmark: nil, fileName: "\(UUID().uuidString).kdbx")
        try FileManager.default.createDirectory(at: VaultFiles.managedDirectory, withIntermediateDirectories: true)
        let url = VaultFiles.managedURL(fileName: reference.fileName)
        let data = try KDBX.save(document)
        try VaultFiles.write(data, to: url)
        reference.persist()
        self.reference = reference
        store = KeePassVaultStore(reference: reference, url: url, scoped: false, document: document, fileData: data)
    }

    /// Opens a `.kdbx` file in place. The file is edited where it is, never copied.
    func open(fileAt picked: URL, credentials: KDBXCredentials) async throws {
        let scoped = picked.startAccessingSecurityScopedResource()
        do {
            let data = try VaultFiles.read(picked)
            let document = try await Task.detached { try KDBX.open(data, credentials: credentials) }.value
            let name = document.databaseName.isEmpty ? picked.deletingPathExtension().lastPathComponent : document.databaseName
            let reference = VaultReference(name: name, managed: false, bookmark: try VaultFiles.bookmark(for: picked),
                                           fileName: picked.lastPathComponent)
            reference.persist()
            self.reference = reference
            store = KeePassVaultStore(reference: reference, url: picked, scoped: scoped, document: document, fileData: data)
        } catch {
            if scoped { picked.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    /// Opens the remembered vault after a lock or relaunch.
    func unlock(credentials: KDBXCredentials) async throws {
        try await unlock { data in try KDBX.open(data, credentials: credentials) }
        syncReference()  // the AutoFill extension may have marked the saved key stale while the vault was opening
        // Biometric unlock went off because its key went stale, not because the person turned it off: save a fresh key.
        if reference?.biometricStale == true {
            do { try enableBiometric() } catch { clearStale() }
        }
    }

    /// Adopts the persisted reference when it is the same vault. Every change is persisted as it is made, so what is stored is
    /// the newest, including a mark another process (the AutoFill extension) wrote since this session read it.
    private func syncReference() {
        guard let stored = VaultReference.load(), stored.id == reference?.id else { return }
        reference = stored
    }

    /// Changes fields of the vault's reference. Each change re-reads the stored reference and writes only what it changes, so a
    /// copy this session read earlier cannot undo what the AutoFill extension (or another session) wrote since. When the stored
    /// reference is gone because the vault was forgotten, nothing is written and the change only shows in this session.
    private func change(_ change: @escaping (inout VaultReference) -> Void) {
        guard var current = reference else { return }
        if let stored = VaultReference.update(current.id, change) { reference = stored } else { change(&current); reference = current }
    }

    private func clearStale() { change { $0.biometricStale = false } }

    /// Unlocks with Face ID or Touch ID. Never throws for a cancelled prompt; the lock screen just stays.
    /// If the saved key no longer fits (Face ID re-enrolled, or the vault password was changed elsewhere), biometric unlock is
    /// switched off and the error says to use the password once.
    func unlockWithBiometrics() async throws {
        syncReference()
        guard let reference, reference.biometricUnlock else { throw BiometricKeyError.invalidated }
        let key: Data
        do {
            key = try await BiometricKey.load(for: reference.id, reason: String(localized: "Unlock \(reference.name)."))
        } catch BiometricKeyError.invalidated {
            setBiometric(false)
            throw BiometricKeyError.invalidated
        }
        // Any other error from `load` (lockout, biometry unavailable, a failed read) leaves the key and the setting alone.
        do {
            try await unlock { data in try KDBX.open(data, transformedKey: key) }
        } catch KDBXError.wrongCredentials {
            // The key really is stale. Off for now; the next password unlock saves a fresh one and turns it back on.
            setBiometric(false, stale: true)
            throw BiometricKeyError.invalidated
        }
    }

    private func unlock(opening open: @escaping @Sendable (Data) throws -> KDBXDocument) async throws {
        syncReference()
        guard var reference else { throw VaultStoreError.fileMissing }
        let url: URL, scoped: Bool
        if reference.managed {
            url = VaultFiles.managedURL(fileName: reference.fileName)
            scoped = false
        } else {
            guard let bookmark = reference.bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { throw VaultStoreError.fileMissing }
            url = resolved.url
            scoped = url.startAccessingSecurityScopedResource()
            if resolved.stale, let fresh = try? VaultFiles.bookmark(for: url) {
                reference.bookmark = fresh
                VaultReference.update(reference.id) { $0.bookmark = fresh }
            }
        }
        do {
            guard FileManager.default.fileExists(atPath: url.path) || (try? VaultFiles.read(url)) != nil else { throw VaultStoreError.fileMissing }
            let data = try VaultFiles.read(url)
            let document = try await Task.detached { try open(data) }.value
            self.reference = reference
            store = KeePassVaultStore(reference: reference, url: url, scoped: scoped, document: document, fileData: data)
            // The 30-day purge of Recently Deleted. Off unless the app switched it on, so the AutoFill extension, which opens the
            // vault through this same path, never writes because of it. A failed write is retried the next time the app unlocks.
            if Self.purgesRecentlyDeletedOnUnlock { _ = try? store?.purgeRecentlyDeleted() }
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    /// Points the remembered vault at a file the person found, after the original moved.
    func relink(to picked: URL) throws {
        guard var reference else { return }
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let bookmark = try VaultFiles.bookmark(for: picked), fileName = picked.lastPathComponent
        reference.bookmark = bookmark
        reference.fileName = fileName
        self.reference = VaultReference.update(reference.id) { $0.bookmark = bookmark; $0.fileName = fileName } ?? reference
    }

    /// Whether the device can offer biometric unlock at all.
    var biometry: BiometryKind? { BiometryKind.current }

    /// True when the open vault could use Face ID or Touch ID and the person has not decided yet.
    var shouldOfferBiometric: Bool {
        guard let reference, isOpen, biometry != nil else { return false }
        return !reference.biometricUnlock && !reference.biometricDeclined
    }

    /// Saves the open vault's key behind biometrics. Asks nothing now; the prompt comes at the next unlock.
    func enableBiometric() throws {
        guard let reference, let store else { return }
        try BiometricKey.save(store.transformedKey, for: reference.id)
        change { $0.biometricUnlock = true; $0.biometricDeclined = false; $0.biometricStale = false }
    }

    func disableBiometric() { setBiometric(false) }

    func declineBiometricOffer() { change { $0.biometricDeclined = true } }

    /// After the vault password changed, the saved key is stale. Replace it, or drop it if that fails.
    func refreshBiometricKey() {
        guard let reference, reference.biometricUnlock else { return }
        do { try enableBiometric() } catch { setBiometric(false) }
    }

    private func setBiometric(_ on: Bool, stale: Bool = false) {
        guard let reference else { return }
        if !on { BiometricKey.delete(for: reference.id) }
        change { $0.biometricUnlock = on; $0.biometricStale = !on && stale }
    }

    /// Writes pending changes and drops the keys and the decrypted vault from memory.
    func lock() {
        try? store?.flush()
        store = nil
    }

    /// Forgets the vault. A vault Psss created is deleted with its backups; a file the person opened is never touched.
    func forget() {
        let forgotten = reference
        if let reference, reference.managed {
            try? FileManager.default.removeItem(at: VaultFiles.managedURL(fileName: reference.fileName))
        }
        if let reference {
            VaultFiles.removeBackups(for: reference.id)
            UsageLog.erase(for: reference.id)
            BiometricKey.delete(for: reference.id)
            SharedVault.removeIdentities()
        }
        store = nil
        reference = nil
        // Final: a copy of this reference that another process still holds cannot write it back.
        if let forgotten { VaultReference.forget(forgotten.id) } else { VaultReference.clear() }
    }
}

extension KDBXError {
    /// Plain-language text for the interface.
    var message: String {
        switch self {
        case .notAVault: String(localized: "This file is not a KeePass vault.")
        case .unsupported(let what): String(localized: "Psss cannot open this vault yet: \(what) is not supported.")
        case .wrongCredentials: String(localized: "The vault password or key file is not right.")
        case .corrupted: String(localized: "The vault file is damaged or was changed by something else. Nothing was modified.")
        case .invalidKeyFile: String(localized: "This key file cannot be used.")
        case .invalidParameters: String(localized: "The vault asks for more memory or time than Psss allows.")
        }
    }
}

extension VaultStoreError {
    var message: String {
        switch self {
        case .changedOnDisk: String(localized: "The vault file was changed by another app or device since Psss last read it. Nothing was changed. Lock and unlock the vault to see the current version, then try again.")
        case .fileMissing: String(localized: "Psss cannot find the vault file. It may have moved or be unavailable, so nothing was changed. Check where the file is, then try again.")
        case .writeFailed(let reason): String(localized: "The vault could not be saved, so nothing was changed. \(reason) Check that the file can be written and the disk has room, then try again.")
        case .unreadable: String(localized: "Psss cannot read the vault file right now, so nothing was saved. It may still be downloading from iCloud. Try again in a moment.")
        }
    }
}
