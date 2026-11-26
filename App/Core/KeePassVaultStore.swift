import AuthenticationServices
import CryptoKit
import Foundation
import Synchronization

/// Where a new vault is kept. iCloud Drive is Psss's own public folder there, so the file survives deleting the app; the device
/// location is the app's own storage and goes with the app.
enum VaultLocation: Sendable { case iCloudDrive, thisDevice }

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
    /// Whether the last unlock, creation or password change used a key file, and a password. Two non-secret flags, so Setup can
    /// say what the vault is encrypted with. Nothing about the key file itself is kept. A password is assumed until an unlock says
    /// otherwise.
    var usesKeyFile = false
    var usesPassword = true

    /// What Setup says the vault file is encrypted with.
    var encryptionDescription: String {
        switch (usesPassword, usesKeyFile) {
        case (true, true): String(localized: "A KeePass file, encrypted with your vault password and a key file.")
        case (false, true): String(localized: "A KeePass file, encrypted with a key file.")
        default: String(localized: "A KeePass file, encrypted with your vault password.")
        }
    }

    /// Notes which credentials opened or created the vault.
    mutating func record(_ credentials: KDBXCredentials) {
        usesKeyFile = credentials.keyFile != nil
        usesPassword = credentials.password != nil
    }

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
        usesKeyFile = try c.decodeIfPresent(Bool.self, forKey: .usesKeyFile) ?? false
        usesPassword = try c.decodeIfPresent(Bool.self, forKey: .usesPassword) ?? true
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
        if VaultFiles.isInPsssFolder(url) { return "\(url.lastPathComponent) · \(VaultFiles.psssFolderLabel)" }
        let folder = VaultFiles.folderWords(of: url) ?? url.deletingLastPathComponent().pathComponents
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
        // The vault that was active until now is remembered, not dropped, so opening or creating another one keeps it.
        if let active = Self.load(), active.id != id { Self.park(active) }
        Self.setRemembered(Self.remembered.filter { $0.id != id })
        Self.write(data, Self.defaultsKey, file: "vault-reference.json")
        Self.appendToOrder(id)
    }

    /// Changes fields of the stored reference of vault `id` (the active one or a remembered one): reads the stored reference again,
    /// applies `change` to it and writes that, so a setting another process changed since this process last read stays. Does
    /// nothing, and returns nil, when no stored reference has that id (the vault was forgotten) or the vault was forgotten.
    @discardableResult
    static func update(_ id: UUID, _ change: (inout VaultReference) -> Void) -> VaultReference? {
        guard !forgottenIDs.contains(id) else { return nil }
        if var stored = load(), stored.id == id {
            change(&stored)
            guard let data = try? JSONEncoder().encode(stored) else { return nil }
            write(data, defaultsKey, file: "vault-reference.json")
            return stored
        }
        var list = remembered
        guard let index = list.firstIndex(where: { $0.id == id }) else { return nil }
        change(&list[index])
        setRemembered(list)
        return list[index]
    }

    /// Removes the vault's reference (the active one, or a remembered one) and remembers the vault as forgotten, for good: nothing
    /// writes it again.
    static func forget(_ id: UUID) {
        let forgotten = (forgottenIDs.filter { $0 != id } + [id]).suffix(32).map(\.uuidString)
        if let data = try? JSONEncoder().encode(Array(forgotten)) { write(data, forgottenKey, file: "vault-reference-forgotten.json") }
        setRemembered(remembered.filter { $0.id != id })
        if load()?.id == id { remove(defaultsKey, file: "vault-reference.json") }
        setOrder(order.filter { $0 != id })
    }

    // MARK: Fixed order

    private static let orderKey = "vaultOrder"

    /// The one order every list of vaults uses (sidebar, menus, lock screen, Settings, the browser popup): the order the vaults
    /// were added in. Opening, locking or switching never moves a vault; removing one only drops it.
    private static var order: [UUID] {
        read(orderKey, file: "vault-order.json").flatMap { try? JSONDecoder().decode([String].self, from: $0) }?
            .compactMap(UUID.init(uuidString:)) ?? []
    }

    private static func setOrder(_ list: [UUID]) {
        if list.isEmpty { remove(orderKey, file: "vault-order.json"); return }
        if let data = try? JSONEncoder().encode(list.map(\.uuidString)) { write(data, orderKey, file: "vault-order.json") }
    }

    private static func appendToOrder(_ id: UUID) {
        let current = order
        if !current.contains(id) { setOrder(current + [id]) }
    }

    /// `references` in the fixed order. A vault the order does not know yet (stored before the order existed) goes after the
    /// known ones, in the order given, and is added to the order, so it keeps its place from then on.
    static func inFixedOrder(_ references: [VaultReference]) -> [VaultReference] {
        let current = order
        let known = references.filter { current.contains($0.id) }.sorted { current.firstIndex(of: $0.id)! < current.firstIndex(of: $1.id)! }
        let unknown = references.filter { !current.contains($0.id) }
        if !unknown.isEmpty { setOrder(current + unknown.map(\.id)) }
        return known + unknown
    }

    /// Every vault Psss knows, the active one and the remembered ones, in the fixed order.
    static var all: [VaultReference] { inFixedOrder([load()].compactMap { $0 } + remembered) }

    // MARK: Remembered vaults

    private static let rememberedKey = "rememberedVaults"

    /// The vaults the person has used besides the active one, most recently left first. The lock screen's vault selector lists
    /// them after the active vault. The AutoFill extension reads only the active reference, so it is not affected.
    static var remembered: [VaultReference] {
        let forgotten = forgottenIDs
        return (read(rememberedKey, file: "vault-references-remembered.json")
            .flatMap { try? JSONDecoder().decode([VaultReference].self, from: $0) } ?? [])
            .filter { !forgotten.contains($0.id) }
    }

    private static func setRemembered(_ list: [VaultReference]) {
        if list.isEmpty { remove(rememberedKey, file: "vault-references-remembered.json"); return }
        if let data = try? JSONEncoder().encode(list) { write(data, rememberedKey, file: "vault-references-remembered.json") }
    }

    private static func park(_ reference: VaultReference) {
        setRemembered([reference] + remembered.filter { $0.id != reference.id })
    }

    /// Makes a remembered vault the active one. The active vault is remembered in its place, so nothing is forgotten.
    @discardableResult
    static func activate(_ id: UUID) -> VaultReference? {
        guard let chosen = remembered.first(where: { $0.id == id }) else { return load()?.id == id ? load() : nil }
        guard let data = try? JSONEncoder().encode(chosen) else { return nil }
        if let active = load() { park(active) }
        setRemembered(remembered.filter { $0.id != id })
        write(data, defaultsKey, file: "vault-reference.json")
        return chosen
    }

    /// The remembered or active vault that is the file at `url`, if there is one. Opening a file again reuses it.
    static func known(at url: URL) -> VaultReference? {
        let path = url.resolvingSymlinksInPath().path
        return ([load()].compactMap { $0 } + remembered).first { reference in
            guard !reference.managed, let bookmark = reference.bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { return false }
            return resolved.url.resolvingSymlinksInPath().path == path
        }
    }

    /// Whether the vault's file can be found now. A vault Psss created lives in its own folder; any other is found by its bookmark.
    var isReachable: Bool {
        if managed { return FileManager.default.fileExists(atPath: VaultFiles.managedURL(fileName: fileName).path) }
        guard let bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { return false }
        return FileManager.default.fileExists(atPath: resolved.url.path)
    }

    /// The vault file, when it can be found: Psss's own folder for a vault it created, otherwise the opened file's bookmark.
    var fileURL: URL? {
        if managed { return VaultFiles.managedURL(fileName: fileName) }
        guard let bookmark, let url = try? VaultFiles.resolve(bookmark).url else { return nil }
        return url
    }

    /// Where the vault lives, for the lock screen's selector: "On this device" for a vault Psss created, otherwise the folder.
    var menuLocation: String {
        if managed { return String(localized: "On this device") }
        guard let bookmark, let url = try? VaultFiles.resolve(bookmark).url else { return fileName }
        if VaultFiles.isInPsssFolder(url) { return VaultFiles.psssFolderLabel }
        if let words = VaultFiles.folderWords(of: url) { return words }
        // Sandbox plumbing (identifier folders, the File Provider copy) tells a person nothing.
        let parts = url.deletingLastPathComponent().pathComponents.filter { part in
            part != "/" && part != "File Provider Storage" && UUID(uuidString: part) == nil
        }
        let folder = parts.suffix(2).joined(separator: " › ")
        return folder.isEmpty ? String(localized: "In the Files app") : folder
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
        // A test build never falls back to the real app data: without a root it stops.
        guard let path = ProcessInfo.processInfo.environment["PSSS_TEST_ROOT"], !path.isEmpty else {
            fatalError("PSSS_TEST_ROOT is not set. Run the tests through scripts/, which point them at a folder under build/.")
        }
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

    /// How a vault in Psss's iCloud Drive folder is located in words: the folder is shown as "Psss" in Files and Finder.
    static var psssFolderLabel: String { String(localized: "iCloud Drive › Psss") }

    static let iCloudContainerID = "iCloud.app.psss"

    /// "iCloud Drive" or "iCloud Drive › Downloads" for a file in the user's iCloud Drive (the `com~apple~CloudDocs` container,
    /// whose name tells a person nothing), at most the two folders nearest the file. Nil for a file elsewhere. Psss's own
    /// container is `psssFolderLabel`.
    static func folderWords(of url: URL) -> String? {
        let parts = url.deletingLastPathComponent().pathComponents
        guard let index = parts.firstIndex(of: "com~apple~CloudDocs") else { return nil }
        let folders = Array(parts[(index + 1)...]).suffix(2)
        return (["iCloud Drive"] + folders).joined(separator: " › ")
    }

    /// Whether `url` is inside Psss's own iCloud Drive container, on this device or as another device's copy of it.
    static func isInPsssFolder(_ url: URL) -> Bool {
        url.path.contains("/Mobile Documents/iCloud~app~psss/")
    }

    /// Psss's folder in iCloud Drive (the container's Documents folder, shown as "Psss" in Files and Finder), created when it is
    /// missing. Nil when iCloud Drive is off for Psss, the person is signed out of iCloud, or this build carries no iCloud
    /// entitlement (an unsigned local Mac build). It can take a moment, so call it off the main thread.
    static func iCloudFolder() -> URL? {
        #if HOSTLESS_TESTS
        // The test scripts stand in for iCloud Drive with a folder under the test root; unset means iCloud Drive is off.
        guard let path = ProcessInfo.processInfo.environment["PSSS_TEST_ICLOUD_ROOT"], !path.isEmpty else { return nil }
        let folder = URL(fileURLWithPath: path, isDirectory: true)
        return (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil ? folder : nil
        #else
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: iCloudContainerID) else { return nil }
        let folder = container.appendingPathComponent("Documents", isDirectory: true)
        return (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil ? folder : nil
        #endif
    }

    /// The file name without its extension that a vault called `name` gets: characters a file name cannot hold become dashes.
    static func fileNameStem(_ name: String) -> String {
        let cleaned = String(name.map { "/:\\".contains($0) ? "-" : $0 }).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? String(localized: "Passwords") : cleaned
    }

    /// "Name.kdbx", or "Name 2.kdbx" and so on when that file is already in the folder.
    static func newFileName(for name: String, in folder: URL) -> String {
        let base = fileNameStem(name)
        var candidate = "\(base).kdbx"
        var number = 2
        while FileManager.default.fileExists(atPath: folder.appendingPathComponent(candidate).path) {
            candidate = "\(base) \(number).kdbx"
            number += 1
        }
        return candidate
    }

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

    /// The vault's name made safe for display (`VaultName.short`); the reference keeps the name as typed.
    var title: String { VaultName.short(reference.name) }
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
        try transact {
            try document.validateOtherFieldEdits(items)
            if document.upsert(items) { try commit() }
        }
    }

    func mapFields(_ mapping: ItemFieldMapping, of id: UUID) throws {
        try transact { if try document.mapFields(mapping, of: id) { try commit() } }
    }

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
        var used = reference
        used.record(credentials)
        reference = VaultReference.update(reference.id) { $0.usesKeyFile = used.usesKeyFile; $0.usesPassword = used.usesPassword } ?? used
        return lastCommitLeftOldBackups ? .changedBackupsRemain : .changed
    }
}

/// Owns the open vaults for the app: creating, adding, unlocking, showing and locking. Several vaults can be open at once (owner,
/// 2026-11-25): the session holds one open store per unlocked vault, and `reference` names the vault that is shown (the one the
/// window, the AutoFill extension and the browser popup treat as current). A vault the person has not unlocked has no store: only
/// its reference, which holds nothing secret.
///
/// - Order: `knownVaults` is the fixed order (the order the vaults were added in). Unlocking, locking and showing never move a vault.
/// - One writer per vault: a vault has at most one store in this session. `unlock` of an open vault does nothing, and adding a file
///   that is already a known vault (the same file, links resolved) reuses that vault, so the same file is never open twice.
/// - Locking one vault writes its pending changes and drops its keys and decrypted data only; the others stay open.
@MainActor
@Observable
final class VaultSession {
    /// Whether unlocking deletes what has been in Recently Deleted for more than 30 days. Only the app sets it, once at launch
    /// (`PsssApp`). The AutoFill extension runs the same unlock code and leaves it off, so it never writes to purge.
    static var purgesRecentlyDeletedOnUnlock = false

    /// The open stores, by vault. A vault is open exactly while it has one.
    private(set) var stores: [UUID: KeePassVaultStore] = [:]
    /// The vault that is shown: open, or locked with its unlock form on screen. It is also the stored current vault.
    private(set) var reference: VaultReference? = VaultReference.load()
    /// The other vaults the person has added. Their order here is not the order shown: use `knownVaults`.
    private(set) var remembered: [VaultReference] = VaultReference.remembered
    /// The vault that was shown and open most recently, so the window keeps its sidebar while a locked vault's form is shown.
    private var lastShownOpen: UUID?

    /// Where the person was in each vault, kept in memory across a lock (see `ReturnPlaces`).
    let returnPlaces = ReturnPlaces()
    /// Vaults whose lock screen must not start Face ID or Touch ID by itself, because the person has just locked them. Memory only.
    private var heldPrompts: Set<UUID> = []

    /// Called whenever a vault stops being open, by a lock, Lock All or a removal (not by quitting: the process ends). The browser
    /// relay empties its offer ledger here (`SessionVaultService`).
    @ObservationIgnored var onVaultClosed: (@MainActor (UUID) -> Void)?

    /// Vaults whose file was found but could not be read (damaged, not a vault, a format Psss does not open), as learned by the
    /// last attempt to open them in this process. Shown as "Can't be read"; cleared when the vault opens.
    private(set) var unreadable: Set<UUID> = []

    /// Every vault in the fixed order (the order they were added in): what every list shows. No vault ever moves.
    var knownVaults: [VaultReference] { VaultReference.inFixedOrder((reference.map { [$0] } ?? []) + remembered) }

    // MARK: Open vaults

    /// The shown vault's store; nil while the shown vault is locked.
    var store: KeePassVaultStore? { reference.flatMap { stores[$0.id] } }

    /// The shown vault is open.
    var isOpen: Bool { store != nil }

    func isOpen(_ id: UUID) -> Bool { stores[id] != nil }

    func store(for id: UUID) -> KeePassVaultStore? { stores[id] }

    /// Whether any vault is open.
    var isAnyOpen: Bool { !stores.isEmpty }

    /// The open vaults in the fixed order.
    var openVaults: [VaultReference] { knownVaults.filter { stores[$0.id] != nil } }

    /// The store the window is built around: the shown vault's, or while a locked vault's unlock form is shown, the one that was
    /// shown last (or, failing that, the first open vault in the fixed order). Nil when nothing is open.
    var windowStore: KeePassVaultStore? {
        if let store { return store }
        if let lastShownOpen, let kept = stores[lastShownOpen] { return kept }
        return openVaults.first.flatMap { stores[$0.id] }
    }

    private func noteShown() {
        if let id = reference?.id, stores[id] != nil { lastShownOpen = id }
    }

    /// Shows vault `id`: it becomes the current vault of the app, AutoFill and the browser. Nothing is locked or unlocked, and the
    /// order does not change.
    func show(_ id: UUID) {
        guard id != reference?.id, let chosen = VaultReference.activate(id) else { return }
        // Choosing a vault is asking to open it.
        heldPrompts.remove(id)
        reference = chosen
        remembered = VaultReference.remembered
        noteShown()
    }

    // MARK: Creating and adding

    /// Creates the vault with the recommended KDF and cipher, then opens and shows it. In iCloud Drive it is a file in Psss's own
    /// folder there, found again by a bookmark like any file opened in place, so Forget never deletes it and deleting the app keeps it.
    /// On the device it goes in the app's own storage and is deleted with the app. Throws `iCloudUnavailable` when iCloud Drive
    /// was asked for and is off; nothing is written then. The vaults that were open stay open.
    func create(name: String, credentials: KDBXCredentials, items: [VaultItem] = [], location: VaultLocation = .thisDevice) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? String(localized: "Passwords") : name
        let folder: URL?
        switch location {
        case .iCloudDrive:
            folder = await Task.detached { VaultFiles.iCloudFolder() }.value
            if folder == nil { throw VaultStoreError.iCloudUnavailable }
        case .thisDevice:
            folder = nil
        }
        let document = try await Task.detached { try KDBX.create(name: name, credentials: credentials) }.value
        document.upsert(items)
        let data = try KDBX.save(document)
        var reference: VaultReference
        let url: URL
        if let folder {
            let fileName = VaultFiles.newFileName(for: name, in: folder)
            url = folder.appendingPathComponent(fileName)
            try VaultFiles.write(data, to: url)
            reference = VaultReference(name: name, managed: false, bookmark: try VaultFiles.bookmark(for: url), fileName: fileName)
        } else {
            reference = VaultReference(name: name, managed: true, bookmark: nil, fileName: "\(UUID().uuidString).kdbx")
            try FileManager.default.createDirectory(at: VaultFiles.managedDirectory, withIntermediateDirectories: true)
            url = VaultFiles.managedURL(fileName: reference.fileName)
            try VaultFiles.write(data, to: url)
        }
        reference.record(credentials)
        reference.persist()
        self.reference = reference
        remembered = VaultReference.remembered
        stores[reference.id] = KeePassVaultStore(reference: reference, url: url, scoped: false, document: document, fileData: data)
        noteShown()
    }

    /// Adds a `.kdbx` file the person chose, in place (it is never copied) and shows it, locked: the vault goes to the end of the
    /// fixed order and its unlock form follows. No password is asked here, so nothing is decrypted and the other open vaults are
    /// untouched. A file that is already a known vault is not listed twice: that vault is shown instead.
    ///
    /// Throws `KDBXError.notAVault` for a file that is not a KeePass file, and the read error for one that cannot be read; nothing
    /// is added then. The file is read only as far as its header.
    @discardableResult
    func add(fileAt picked: URL) throws -> VaultReference {
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let data = try VaultFiles.read(picked)
        guard KDBX.keyDerivationMemory(of: data) != nil else { throw KDBXError.notAVault }
        let bookmark = try VaultFiles.bookmark(for: picked)
        if var known = VaultReference.known(at: picked) {
            // The same file again keeps its identifier and settings (Face ID, key file); the bookmark is made fresh.
            let fileName = picked.lastPathComponent
            known = VaultReference.update(known.id) { $0.bookmark = bookmark; $0.fileName = fileName } ?? known
            if known.id == reference?.id { reference = known; remembered = VaultReference.remembered } else { show(known.id) }
            return known
        }
        let name = picked.deletingPathExtension().lastPathComponent
        let added = VaultReference(name: name.isEmpty ? String(localized: "Vault") : name, managed: false, bookmark: bookmark,
                                   fileName: picked.lastPathComponent)
        added.persist()
        reference = added
        remembered = VaultReference.remembered
        noteShown()
        return added
    }

    // MARK: Unlocking

    /// Unlocks the shown vault after a lock or relaunch (or the one just added). It joins the vaults that are already open.
    /// Does nothing when the vault is open already: a vault has one store.
    ///
    /// The AutoFill extension passes `savingQuickUnlockKey: false`: it never saves or replaces a Face ID key (that is the app's
    /// job, after its own unlock) and `beforeKeyDerivation` to refuse a vault whose key derivation would not fit its memory
    /// (`ExtensionUnlockBudget`). The closure gets the file's bytes before anything is derived, and runs off the main actor.
    func unlock(credentials: KDBXCredentials, savingQuickUnlockKey: Bool = true,
                beforeKeyDerivation: (@Sendable (Data) throws -> Void)? = nil) async throws {
        biometricNotice = nil
        try await unlock(recording: credentials) { data in
            try beforeKeyDerivation?(data)
            return try KDBX.open(data, credentials: credentials)
        }
        syncReference()  // the AutoFill extension may have marked the saved key stale while the vault was opening
        guard savingQuickUnlockKey else { return }
        // After every password unlock the saved key is replaced with the key just derived from the file as it is now. A key saved
        // earlier may be stale in ways nothing has noticed yet (the password was changed elsewhere, then this unlock used the new
        // one); waiting for a failed Face ID attempt to set a flag would leave the next attempt to fail first, in any ordering.
        // Saving asks for no Face ID, and `BiometricKey.save` keeps the biometric access control.
        // Biometric unlock may also be off because its key went stale, not because the person turned it off: that turns it back on.
        guard let current = reference, current.biometricUnlock || current.biometricStale else { return }
        do { try enableBiometric() } catch { dropBiometricKey() }
    }

    /// Set when a saved Face ID or Touch ID key could not be replaced and biometric unlock was switched off because of it, so
    /// the person is told once instead of finding it off. The vault screen shows it and clears it.
    var biometricNotice: String?

    /// Switches biometric unlock off after its key could not be saved again, and records the notice.
    private func dropBiometricKey(of id: UUID? = nil) {
        setBiometric(false, for: id)
        biometricNotice = String(localized: "\(BiometryKind.nameForMessages) could not be turned on again for this vault. You can turn it on in Settings.")
    }

    /// Adopts the persisted reference when it is the same vault. Every change is persisted as it is made, so what is stored is
    /// the newest, including a mark another process (the AutoFill extension) wrote since this session read it.
    private func syncReference() {
        guard let stored = VaultReference.load(), stored.id == reference?.id else { return }
        reference = stored
    }

    /// Changes fields of vault `id`'s reference (default: the shown vault). Each change re-reads the stored reference and writes
    /// only what it changes, so a copy this session read earlier cannot undo what the AutoFill extension (or another session) wrote
    /// since. When the stored reference is gone because the vault was forgotten, nothing is written and the change only shows in
    /// this session.
    private func change(_ id: UUID? = nil, _ change: @escaping (inout VaultReference) -> Void) {
        guard let id = id ?? reference?.id else { return }
        if let stored = VaultReference.update(id, change) { adopt(stored); return }
        if var current = reference, current.id == id { change(&current); reference = current }
        else if let index = remembered.firstIndex(where: { $0.id == id }) { change(&remembered[index]) }
    }

    /// Takes a freshly written reference in place of the one this session holds for that vault.
    private func adopt(_ stored: VaultReference) {
        if stored.id == reference?.id { reference = stored }
        else if let index = remembered.firstIndex(where: { $0.id == stored.id }) { remembered[index] = stored }
    }

    /// Unlocks with Face ID or Touch ID. Never throws for a cancelled prompt; the lock screen just stays.
    /// If the saved key no longer fits (Face ID re-enrolled, or the vault password was changed elsewhere), biometric unlock is
    /// switched off and the error says to use the password once.
    ///
    /// `evaluated` is a context that already passed the biometric check (the Mac lock screen's embedded Touch ID view), so the
    /// key is read without a second prompt.
    ///
    /// `accepted` runs once the person has been accepted and the saved key is in hand, just before the vault is opened with
    /// it, so the lock screen can show that the vault is opening. It does not run for a cancelled or failed prompt.
    func unlockWithBiometrics(evaluated: EvaluatedContext? = nil, accepted: () -> Void = {}) async throws {
        syncReference()
        guard let reference, reference.biometricUnlock else { throw BiometricKeyError.invalidated }
        let key: Data
        do {
            key = try await BiometricKey.load(for: reference.id, reason: String(localized: "Unlock \(VaultName.sentence(reference.name))."), evaluated: evaluated)
        } catch BiometricKeyError.invalidated {
            setBiometric(false)
            throw BiometricKeyError.invalidated
        }
        // Any other error from `load` (lockout, biometry unavailable, a failed read) leaves the key and the setting alone.
        accepted()
        do {
            try await unlock { data in try KDBX.open(data, transformedKey: key) }
        } catch KDBXError.wrongCredentials {
            // The key really is stale. Off for now; the next password unlock saves a fresh one and turns it back on.
            setBiometric(false, stale: true)
            throw BiometricKeyError.invalidated
        }
    }

    /// The memory the shown vault's key derivation will ask for, read from the file's header without deriving anything.
    /// Nil when the file cannot be reached or read as a vault (opening it then fails with its own error), 0 for AES-KDF.
    func keyDerivationMemory() -> UInt64? {
        guard let reference else { return nil }
        let url: URL, scoped: Bool
        if reference.managed {
            url = VaultFiles.managedURL(fileName: reference.fileName)
            scoped = false
        } else {
            guard let bookmark = reference.bookmark, let resolved = try? VaultFiles.resolve(bookmark) else { return nil }
            url = resolved.url
            scoped = url.startAccessingSecurityScopedResource()
        }
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? VaultFiles.read(url) else { return nil }
        return KDBX.keyDerivationMemory(of: data)
    }

    /// `credentials` is what a password unlock used: once the vault has opened with them, the reference says whether a key file
    /// was part of that, before the store (and Setup) read it. A Face ID unlock passes none and changes nothing.
    private func unlock(recording credentials: KDBXCredentials? = nil,
                        opening open: @escaping @Sendable (Data) throws -> KDBXDocument) async throws {
        syncReference()
        guard var reference else { throw VaultStoreError.fileMissing }
        // A vault has one store. Two would be two writers of one file, each with its own idea of what the file holds.
        guard stores[reference.id] == nil else { return }
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
            // The vault may have been removed, or opened some other way, while the key derivation ran.
            let id = reference.id
            guard stores[id] == nil, knownVaults.contains(where: { $0.id == id }) else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                return
            }
            if let credentials, reference.usesKeyFile != (credentials.keyFile != nil) || reference.usesPassword != (credentials.password != nil) {
                reference.record(credentials)
                let used = reference
                VaultReference.update(id) { $0.usesKeyFile = used.usesKeyFile; $0.usesPassword = used.usesPassword }
            }
            // A vault added from a file is first named after the file; the name inside it is known now.
            let inside = document.databaseName
            if !inside.isEmpty, inside != reference.name {
                reference.name = inside
                VaultReference.update(id) { $0.name = inside }
            }
            adopt(reference)
            unreadable.remove(id)
            let opened = KeePassVaultStore(reference: reference, url: url, scoped: scoped, document: document, fileData: data)
            stores[id] = opened
            heldPrompts.remove(id)
            noteShown()
            // The 30-day purge of Recently Deleted. Off unless the app switched it on, so the AutoFill extension, which opens the
            // vault through this same path, never writes because of it. A failed write is retried the next time the app unlocks.
            if Self.purgesRecentlyDeletedOnUnlock { _ = try? opened.purgeRecentlyDeleted() }
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            switch error {
            case KDBXError.notAVault, KDBXError.corrupted, KDBXError.unsupported: unreadable.insert(reference.id)
            default: break
            }
            throw error
        }
    }

    /// Points the shown vault at a file the person found, after the original moved.
    func relink(to picked: URL) throws {
        guard var reference else { return }
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let bookmark = try VaultFiles.bookmark(for: picked), fileName = picked.lastPathComponent
        reference.bookmark = bookmark
        reference.fileName = fileName
        self.reference = VaultReference.update(reference.id) { $0.bookmark = bookmark; $0.fileName = fileName } ?? reference
    }

    // MARK: Saved key (Face ID, Touch ID)

    /// Whether the device can offer biometric unlock at all.
    var biometry: BiometryKind? { BiometryKind.current }

    /// True when vault `id` (default: the shown one) is open, has no saved key and the person has not turned the setting off. The
    /// key is saved without asking (owner decision 2026-11-24): the system checks Face ID, Touch ID or the passcode when AutoFill
    /// reads it, not when it is saved.
    func shouldOfferBiometric(for id: UUID? = nil) -> Bool {
        guard let target = knownVaults.first(where: { $0.id == (id ?? reference?.id) }), isOpen(target.id) else { return false }
        return !target.biometricUnlock && !target.biometricDeclined
    }

    /// Turns the setting off for good: deletes the saved key, and Psss does not save it again until the person turns it on.
    /// Per vault: `id` defaults to the shown vault.
    func turnOffSavedKey(for id: UUID? = nil) {
        setBiometric(false, for: id)
        change(id) { $0.biometricDeclined = true }
    }

    /// Saves an open vault's key behind biometrics (default: the shown vault). Asks nothing now; the prompt comes at the next unlock.
    func enableBiometric(for id: UUID? = nil) throws {
        guard let id = id ?? reference?.id, let store = stores[id] else { return }
        try BiometricKey.save(store.transformedKey, for: id)
        change(id) { $0.biometricUnlock = true; $0.biometricDeclined = false; $0.biometricStale = false }
    }

    func disableBiometric() { setBiometric(false) }

    func declineBiometricOffer() { change { $0.biometricDeclined = true } }

    /// After a vault password changed, the saved key is stale. Replace it, or drop it if that fails. Default: the shown vault.
    func refreshBiometricKey(for id: UUID? = nil) {
        guard let target = knownVaults.first(where: { $0.id == (id ?? reference?.id) }), target.biometricUnlock else { return }
        do { try enableBiometric(for: target.id) } catch { dropBiometricKey(of: target.id) }
    }

    private func setBiometric(_ on: Bool, stale: Bool = false, for id: UUID? = nil) {
        guard let id = id ?? reference?.id else { return }
        if !on { BiometricKey.delete(for: id) }
        change(id) { $0.biometricUnlock = on; $0.biometricStale = !on && stale }
    }

    // MARK: Locking

    /// Writes pending changes and drops the keys and the decrypted data of one vault. The other open vaults stay open. When it was
    /// the shown vault and another is open, that one is shown instead (the next in the fixed order, else the one before).
    func lock(_ id: UUID) {
        guard stores[id] != nil else { return }
        drop(id)
        heldPrompts.insert(id)
        // With none left open the whole window locks, onto the shown vault's unlock form.
        if !isAnyOpen, let shown = reference?.id { heldPrompts.insert(shown) }
        guard id == reference?.id else { return }
        let open = openVaults.map(\.id)
        let order = knownVaults.map(\.id)
        let here = order.firstIndex(of: id) ?? 0
        let next = open.first { (order.firstIndex(of: $0) ?? 0) > here } ?? open.last
        if let next { show(next) }
    }

    /// Locks the shown vault (the AutoFill extension's lock: it holds one vault).
    func lock() {
        if let id = reference?.id { lock(id) }
    }

    /// Locks every vault: the app-wide lock (auto-lock, sleep, quit, Lock All Vaults). Which vault is shown does not change.
    func lockAll() {
        for id in Array(stores.keys) { drop(id) }
    }

    /// Writes what is pending in every open vault, for the scene leaving the foreground.
    func flushAll() {
        for store in stores.values { try? store.flush() }
    }

    /// Lock All Vaults, chosen by the person: they put everything away, so no place is kept to return to.
    func lockAllByChoice() {
        returnPlaces.forgetAll()
        holdBiometricPrompts()
        lockAll()
    }

    // MARK: The automatic prompt after a lock

    /// True while vault `id`'s lock screen waits for the person: they locked it and have not left the app, unlocked it or chosen
    /// it since. The Use Face ID or Touch ID button always asks.
    func holdsBiometricPrompt(for id: UUID?) -> Bool { id.map(heldPrompts.contains) ?? false }

    /// The person is locking every vault (Lock All Vaults, Lock Now).
    func holdBiometricPrompts() { heldPrompts.formUnion(knownVaults.map(\.id)) }

    /// The person left the app: the next return asks as usual.
    func releaseBiometricPrompts() { heldPrompts = [] }

    private func drop(_ id: UUID) {
        try? stores[id]?.flush()
        stores[id] = nil
        returnPlaces.didLock(id)
        onVaultClosed?(id)
    }

    // MARK: Removing

    /// Removes vault `id` from the app, open or locked, without touching the other vaults. A file the person opened is never
    /// touched. A vault Psss created is deleted when `deletingFile` (its backups always go); the Mac's Remove Vault keeps it in
    /// Psss's folder, where Finder can still reach it. When it was the shown vault, the first open vault (else the first in the
    /// fixed order) is shown; with none left, the welcome screen shows (`reference` is nil).
    func remove(_ id: UUID, deletingFile: Bool = true) {
        guard let gone = knownVaults.first(where: { $0.id == id }) else { return }
        let wasShown = id == reference?.id
        let wasOpen = stores[id] != nil
        stores[id] = nil
        if wasOpen { onVaultClosed?(id) }
        returnPlaces.forget(id)
        if lastShownOpen == id { lastShownOpen = nil }
        if gone.managed, deletingFile { try? FileManager.default.removeItem(at: VaultFiles.managedURL(fileName: gone.fileName)) }
        VaultFiles.removeBackups(for: gone.id)
        UsageLog.erase(for: gone.id)
        BiometricKey.delete(for: gone.id)
        VaultIdentities.remove(vault: id)
        unreadable.remove(id)
        // Final: a copy of this reference that another process still holds cannot write it back.
        VaultReference.forget(id)
        if wasShown {
            reference = nil
            let rest = VaultReference.inFixedOrder(VaultReference.remembered)
            if let next = rest.first(where: { stores[$0.id] != nil }) ?? rest.first { reference = VaultReference.activate(next.id) }
            if reference == nil { VaultReference.clear() }
        }
        remembered = VaultReference.remembered
        noteShown()
    }

    /// Removes the shown vault (see `remove`).
    func forget(deletingFile: Bool = true) {
        if let id = reference?.id { remove(id, deletingFile: deletingFile) } else { VaultReference.clear() }
    }
}

extension KDBXError {
    /// Plain-language text for the interface. It never shows the codec's internal detail, which names a feature, not a fix.
    var message: String {
        switch self {
        case .notAVault: String(localized: "This file is not a KeePass vault. Choose a KeePass file (.kdbx).")
        case .unsupported: String(localized: "This vault uses settings Psss cannot open. Open it in the app that made it, save it again as KDBX 4 with AES-256 or ChaCha20 and Argon2, then try again.")
        case .wrongCredentials: String(localized: "The vault password or key file is not right.")
        case .corrupted: String(localized: "The vault file is damaged or was changed by something else. Nothing was modified.")
        case .invalidKeyFile: String(localized: "This key file cannot be used. Choose the key file that was used when the vault was made.")
        case .tooMuchMemory: String(localized: "This vault asks for more memory than Psss allows (256 MiB is the most). Open it in the app that made it, lower the memory in its encryption settings, save it, then try again.")
        case .tooLarge: String(localized: "This vault is larger than Psss allows to open safely. Nothing was modified.")
        case .invalidParameters: String(localized: "This vault's protection settings cannot be opened by Psss, usually because they ask for more memory or time than Psss allows. Open it in the app that made it, save it again with the default settings, then try again.")
        }
    }

    /// For choosing a key file while creating a vault or changing its key: there is no earlier key file to find.
    var messageForNewKey: String {
        switch self {
        case .invalidKeyFile: String(localized: "This key file cannot be used. Choose a different file.")
        default: message
        }
    }
}

extension VaultStoreError {
    /// For a place with no vault to lock, such as the AutoFill screen that says a save did not happen.
    var messageInProvider: String {
        switch self {
        case .changedOnDisk: String(localized: "The vault file was changed by another app or device just now, so this was not saved. Try again.")
        default: message
        }
    }

    var message: String {
        switch self {
        case .changedOnDisk: String(localized: "The vault file was changed by another app or device since Psss last read it. Nothing was changed. Lock and unlock the vault to see the current version, then try again.")
        case .fileMissing: String(localized: "Psss cannot find the vault file. It may have moved or be unavailable, so nothing was changed. Check where the file is, then try again.")
        case .writeFailed(let reason): String(localized: "The vault could not be saved, so nothing was changed. \(reason) Check that the file can be written and the disk has room, then try again.")
        case .unreadable: String(localized: "Psss cannot read the vault file right now, so nothing was saved. It may still be downloading from iCloud. Try again in a moment.")
        case .itemUnavailable: String(localized: "This item is no longer available. Close the mapping and open the item again.")
        case .invalidFieldMapping(let message): message
        case .editedFieldsChanged: String(localized: "One or more fields changed since you started editing. Cancel and open Edit again to see their latest values.")
        case .iCloudUnavailable: String(localized: "iCloud Drive is off for Psss, so the vault was not created there. Turn it on in Settings, or keep the vault on this device only.")
        }
    }
}

/// What the system's identity store should hold, kept per vault: replacing one vault's suggestions leaves the others', and the
/// whole is what the system is given. Pure, so the rules are tested.
struct IdentityRegistry<Entry> {
    private(set) var byVault: [UUID: [Entry]] = [:]

    mutating func set(_ entries: [Entry], for vault: UUID) { byVault[vault] = entries }

    /// Whether the vault had suggestions.
    @discardableResult mutating func remove(_ vault: UUID) -> Bool { byVault.removeValue(forKey: vault) != nil }

    mutating func removeAll() { byVault = [:] }

    /// Every vault's suggestions, one vault after the other in a fixed order.
    var merged: [Entry] { byVault.keys.sorted { $0.uuidString < $1.uuidString }.flatMap { byVault[$0] ?? [] } }

    var isEmpty: Bool { byVault.values.allSatisfy(\.isEmpty) }
}

/// The app's way to tell the system's AutoFill suggestions about its vaults. Every open vault's suggestions are sent together (the
/// system's store is replaced as a whole), each tied to its vault (`IdentityRecord`), so another vault opening, a vault being
/// removed or a vault's own change never drops what the others offer. Locking a vault removes nothing: the system's store belongs
/// to the system and suggestions stay while a vault is locked, so choosing one asks to unlock it. Hostless tests never touch the real
/// credential identity store: they get a recorder instead, so a test can say what would have been sent.
enum VaultIdentities {
    #if HOSTLESS_TESTS
    typealias Entry = String
    #else
    typealias Entry = any ASCredentialIdentity
    #endif

    private nonisolated(unsafe) static var registry = IdentityRegistry<Entry>()
    private static let lock = NSLock()

    /// Replaces vault `id`'s suggestions with those of `items` and sends every vault's to the system. `knownEnabled` is for the moment
    /// AutoFill was just found on: send at once.
    static func register(vault id: UUID, items: [VaultItem], knownEnabled: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        #if HOSTLESS_TESTS
        registry.set(items.map { IdentityRecord.make(vault: id, item: $0.id) }, for: id)
        recorder.withLock { $0.append(.registered(vault: id, ids: items.map(\.id))) }
        _ = knownEnabled
        #else
        registry.set(SharedVault.identities(for: items, vault: id), for: id)
        SharedVault.registerIdentities(registry.merged, knownEnabled: knownEnabled)
        #endif
    }

    /// Notes vault `id`'s suggestions and returns every vault's, without sending anything: for the AutoFill extension, which waits for
    /// the system itself (`SharedVault.registerSavedAndWait`).
    static func record(vault id: UUID, items: [VaultItem]) -> [Entry] {
        lock.lock(); defer { lock.unlock() }
        #if HOSTLESS_TESTS
        registry.set(items.map { IdentityRecord.make(vault: id, item: $0.id) }, for: id)
        #else
        registry.set(SharedVault.identities(for: items, vault: id), for: id)
        #endif
        return registry.merged
    }

    /// Removes vault `id`'s suggestions; the other vaults' stay (and are sent again). With none known, the store is cleared: this
    /// process may not know what an earlier run registered, and a removed vault's sites and usernames must not stay in the system.
    static func remove(vault id: UUID) {
        lock.lock(); defer { lock.unlock() }
        registry.remove(id)
        #if HOSTLESS_TESTS
        recorder.withLock { $0.append(.removed(vault: id)) }
        #else
        if registry.isEmpty { SharedVault.removeIdentities() } else { SharedVault.registerIdentities(registry.merged) }
        #endif
    }

    /// Clears every suggestion: the sample vault (it never offers any) or leaving everything.
    static func removeAll() {
        lock.lock(); defer { lock.unlock() }
        registry.removeAll()
        #if HOSTLESS_TESTS
        recorder.withLock { $0.append(.removedAll) }
        #else
        SharedVault.removeIdentities()
        #endif
    }

    #if HOSTLESS_TESTS
    enum Call: Equatable { case removedAll, registered(vault: UUID, ids: [VaultItem.ID]), removed(vault: UUID) }
    private static let recorder = Mutex<[Call]>([])
    /// Everything asked of the identity store since the last call, oldest first.
    static func takeCalls() -> [Call] { recorder.withLock { let calls = $0; $0 = []; return calls } }
    /// What the system would hold now: every registered vault's record identifiers.
    static var held: [String] { lock.lock(); defer { lock.unlock() }; return registry.merged }
    #endif
}
