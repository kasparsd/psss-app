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
    private static var fallbackURL: URL {
        #if HOSTLESS_TESTS
        if let root = VaultFiles.testRoot { return root.appendingPathComponent("vault-reference.json") }
        #endif
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("vault-reference.json")
    }

    static func load() -> VaultReference? {
        let data = defaults.map { $0.data(forKey: defaultsKey) } ?? (try? Data(contentsOf: fallbackURL))
        return data.flatMap { try? JSONDecoder().decode(Self.self, from: $0) }
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

    func persist() {
        let data = try? JSONEncoder().encode(self)
        if let defaults = Self.defaults { defaults.set(data, forKey: Self.defaultsKey) }
        else if let data {
            try? FileManager.default.createDirectory(at: Self.fallbackURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: Self.fallbackURL, options: VaultFiles.writeOptions)
        }
    }

    static func clear() {
        if let defaults { defaults.removeObject(forKey: defaultsKey) } else { try? FileManager.default.removeItem(at: fallbackURL) }
    }
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

    static func removeBackups(for id: UUID) { try? FileManager.default.removeItem(at: backupDirectory(for: id)) }
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

    func save(_ items: [VaultItem]) throws {
        var changed = false
        for item in items where document.upsert(item) { changed = true }
        if changed { try commit() }
    }

    func delete(_ id: UUID) throws {
        document.remove(id)
        try commit()
        UsageLog.remove(id, in: reference.id)
    }

    /// What an import would add and skip, without changing the vault. Duplicates are judged against what is in the vault now.
    func preview(_ plan: ImportPlan) -> ImportSummary { document.preview(plan) }

    /// Adds the plan in one write. When the entries cannot be built or the write fails, the open document goes back to what
    /// it was and the file is untouched, so nothing was added.
    func apply(_ plan: ImportPlan) throws -> ImportSummary {
        let before = document
        do {
            let summary = try document.apply(plan)
            if summary.itemCount > 0 { try commit() }
            return summary
        } catch {
            document = before
            throw error
        }
    }

    /// Records the use in the device-local usage log. The vault file is never written for it.
    func markUsed(_ id: UUID) { UsageLog.record(id, in: reference.id) }

    /// Nothing is held back: edits are written as they are made and use goes straight to the usage log.
    func flush() throws {}

    /// Writes the vault. Refuses when the file changed since it was read, unless told to overwrite, and always refuses when the
    /// file exists but cannot be read (so Overwrite cannot write blind either). Read, check and write are one coordinated step.
    func commit(overwrite: Bool = false) throws {
        document.touchModified()
        let data = try KDBX.save(document)
        let previous = try VaultFiles.replace(at: url, with: data, basedOn: baseDigest, overwrite: overwrite)
        baseDigest = KDBXCrypto.sha256(data)
        if credentialsChangePending {
            // Copies made before a password change are encrypted with the old password, so none is kept, including this one.
            VaultFiles.removeBackups(for: reference.id)
            credentialsChangePending = false
        } else if let previous {
            // A rollback copy is kept only for a write that succeeded, so a failed write never pushes good older copies out.
            VaultFiles.keepBackup(of: previous, id: reference.id)
        }
    }

    /// Replaces the open document with what is on disk now. Pending edits are lost. Runs the KDF, so it is async.
    func reload() async throws {
        let data = try VaultFiles.read(url)
        let key = document.transformedKey
        document = try await Task.detached { try KDBX.open(data, transformedKey: key) }.value
        baseDigest = KDBXCrypto.sha256(data)
        credentialsChangePending = false  // the document is what is on disk now, so no password change is pending
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
        document.databaseName = name
        reference.name = name
        reference.persist()
        try commit()
    }

    /// Changes the vault password or key file. Runs the KDF again, so it is async.
    func changeCredentials(to credentials: KDBXCredentials) async throws {
        // All or nothing, like `apply`: when the write is refused or fails, the store goes back to the old credentials.
        let source = document
        let wasPending = credentialsChangePending
        let changed = try await Task.detached { try source.withCredentials(credentials) }.value
        document = changed
        credentialsChangePending = true
        do { try commit() } catch {
            document = source
            credentialsChangePending = wasPending
            throw error
        }
    }
}

private extension KDBXDocument {
    func withCredentials(_ credentials: KDBXCredentials) throws -> KDBXDocument {
        var copy = self
        try copy.changeCredentials(to: credentials)
        return copy
    }
}

/// Owns the open vault for the app: creating, opening, unlocking and locking. One vault today; the shape is one
/// store per vault so the multiple-vault registry in docs/vaults.md can be added without changing callers.
@MainActor
@Observable
final class VaultSession {
    private(set) var store: KeePassVaultStore?
    private(set) var reference: VaultReference? = VaultReference.load()

    var isOpen: Bool { store != nil }

    /// Creates the vault in the app's own storage with the recommended KDF and cipher, then opens it.
    func create(name: String, credentials: KDBXCredentials, items: [VaultItem] = []) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? String(localized: "Passwords") : name
        let document = try await Task.detached { try KDBX.create(name: name, credentials: credentials) }.value
        for item in items { document.upsert(item) }
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

    private func clearStale() {
        guard var reference else { return }
        reference.biometricStale = false
        reference.persist()
        self.reference = reference
    }

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
            if resolved.stale, let fresh = try? VaultFiles.bookmark(for: url) { reference.bookmark = fresh; reference.persist() }
        }
        do {
            guard FileManager.default.fileExists(atPath: url.path) || (try? VaultFiles.read(url)) != nil else { throw VaultStoreError.fileMissing }
            let data = try VaultFiles.read(url)
            let document = try await Task.detached { try open(data) }.value
            self.reference = reference
            store = KeePassVaultStore(reference: reference, url: url, scoped: scoped, document: document, fileData: data)
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
        reference.bookmark = try VaultFiles.bookmark(for: picked)
        reference.fileName = picked.lastPathComponent
        reference.persist()
        self.reference = reference
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
        guard var reference, let store else { return }
        try BiometricKey.save(store.transformedKey, for: reference.id)
        reference.biometricUnlock = true
        reference.biometricDeclined = false
        reference.biometricStale = false
        reference.persist()
        self.reference = reference
    }

    func disableBiometric() { setBiometric(false) }

    func declineBiometricOffer() {
        guard var reference else { return }
        reference.biometricDeclined = true
        reference.persist()
        self.reference = reference
    }

    /// After the vault password changed, the saved key is stale. Replace it, or drop it if that fails.
    func refreshBiometricKey() {
        guard let reference, reference.biometricUnlock else { return }
        do { try enableBiometric() } catch { setBiometric(false) }
    }

    private func setBiometric(_ on: Bool, stale: Bool = false) {
        guard var reference else { return }
        if !on { BiometricKey.delete(for: reference.id) }
        reference.biometricUnlock = on
        reference.biometricStale = !on && stale
        reference.persist()
        self.reference = reference
    }

    /// Writes pending changes and drops the keys and the decrypted vault from memory.
    func lock() {
        try? store?.flush()
        store = nil
    }

    /// Forgets the vault. A vault Psss created is deleted with its backups; a file the person opened is never touched.
    func forget() {
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
        VaultReference.clear()
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
        case .changedOnDisk: String(localized: "The vault file was changed by another app or device since you opened it.")
        case .fileMissing: String(localized: "Psss cannot find the vault file. It may have moved or be unavailable.")
        case .writeFailed(let reason): String(localized: "The vault could not be saved. \(reason)")
        case .unreadable: String(localized: "Psss cannot read the vault file right now, so nothing was saved. It may still be downloading from iCloud. Try again in a moment.")
        }
    }
}
