import Foundation

/// What an importer produces and the writer consumes. The types know nothing about 1Password, CSV or KDBX, so another
/// source (1PUX, Apple Passwords) can fill the same plan. Nothing here is written anywhere until `VaultStore.apply`.

enum ImportSourceKind: String, Sendable { case onePasswordPIF, csv }

/// The template an item opens with in Psss.
enum ImportItemKind: String, Sendable { case login, card, note, custom }

/// What a field is for. Everything that is not a standard field is `custom` and carries its own label.
enum ImportFieldRole: String, Sendable {
    case username, password, website, code, cardholder, cardNumber, expiry, securityCode, pin, notes, custom
}

struct ImportField: Sendable, Equatable {
    var role: ImportFieldRole
    /// The name of a custom field, or of a named card field such as "Security code". Empty for standard fields.
    var label: String
    var value: String
    /// Written as a protected value.
    var concealed: Bool

    init(_ role: ImportFieldRole, label: String = "", value: String, concealed: Bool = false) {
        self.role = role
        self.label = label
        self.value = value
        self.concealed = concealed
    }
}

/// An earlier password. `date` is when it stopped being the current one.
struct ImportRevision: Sendable, Equatable {
    var password: String
    var date: Date
}

/// A file to attach. The bytes stay on disk until the plan is applied.
struct ImportAttachment: Sendable, Equatable {
    var name: String
    var size: Int
    var url: URL
}

struct ImportItem: Sendable {
    /// Where the item came from, such as `1password:<uuid>`. Nil when the source has no identifier (CSV).
    var sourceID: String?
    var kind: ImportItemKind
    var title: String
    var fields: [ImportField]
    var tags: [String] = []
    /// Folder names from the top down. Empty for the root.
    var folder: [String] = []
    var created: Date
    var modified: Date
    /// Oldest first.
    var history: [ImportRevision] = []
    var attachments: [ImportAttachment] = []
    /// What is worth telling about this item. They count only when the item is added, so a duplicate stays quiet.
    var issues: [ImportIssue] = []

    func first(_ role: ImportFieldRole) -> String? { fields.first { $0.role == role }?.value }
    var username: String { first(.username) ?? "" }
    var password: String { first(.password) ?? "" }
    var websites: [String] { fields.filter { $0.role == .website }.map(\.value) }
}

/// Something worth telling the person. `detail` is a plain sentence and never holds a secret or a field value.
struct ImportIssue: Sendable, Equatable {
    enum Kind: String, Sendable {
        case unreadableRecord, lineTooLong, textEncoding, unknownKind, unreadableCode, extraCode
        case attachmentTooLarge, attachmentsTotalLimit, attachmentLimitPerItem, attachmentRejected, attachmentMissingFolder
        case historyTrimmed, similarLogin, skippedRow, unsafeIdentifier, windowsExport
    }

    var kind: Kind
    /// The item's title, never a value.
    var item: String?
    var detail: String
}

/// Why records or rows were left out, for the one-line report.
struct ImportSkipped: Sendable, Equatable {
    var trashed = 0
    /// Saved web-form entries (checkboxes, hidden inputs, extra text boxes) that are not credentials.
    var webFormFields = 0
    var unreadable = 0
    /// CSV rows that are not logins.
    var rows = 0
}

/// Counts without secrets: what a plan holds, or what an apply added.
struct ImportSummary: Sendable, Equatable {
    var logins = 0
    var cards = 0
    var notes = 0
    var others = 0
    var attachments = 0
    var historyEntries = 0
    var duplicatesSkipped = 0
    /// Logins with the same site and username as one already in the vault but another password, added anyway.
    var similarAdded = 0
    var trashedSkipped = 0
    var unreadable = 0
    var webFormFieldsSkipped = 0
    var rowsSkipped = 0
    var missingDates = 0
    var issues: [ImportIssue] = []

    var itemCount: Int { logins + cards + notes + others }
}

struct ImportPlan: Sendable {
    var source: ImportSourceKind
    var items: [ImportItem] = []
    /// Issues that belong to the whole source (an encoding fallback, an unreadable line). Item issues are on the items.
    var issues: [ImportIssue] = []
    var skipped = ImportSkipped()
    /// Records read, including trashed ones and the ones left out.
    var recordCount = 0
    /// Items whose creation or edit date was missing and was replaced.
    var missingDates = 0
    /// The time stamped on anything the source gave no date for.
    var importedAt = Date()
    /// The export folder has an `attachments` folder.
    var attachmentsFolderFound = false
    /// Only `data.1pif` was chosen, so the files beside it cannot be read.
    var pickedDataFileOnly = false
    /// The source shape has only been checked against old samples (1Password for Windows).
    var lowConfidence = false

    /// What the plan holds before it meets a vault: no duplicates are known yet.
    var summary: ImportSummary {
        var s = ImportSummary()
        for item in items { s.count(item) }
        s.trashedSkipped = skipped.trashed
        s.unreadable = skipped.unreadable
        s.webFormFieldsSkipped = skipped.webFormFields
        s.rowsSkipped = skipped.rows
        s.missingDates = missingDates
        s.issues = issues + items.flatMap(\.issues)
        return s
    }
}

extension ImportSummary {
    mutating func count(_ item: ImportItem) {
        switch item.kind {
        case .login: logins += 1
        case .card: cards += 1
        case .note: notes += 1
        case .custom: others += 1
        }
        attachments += item.attachments.count
        historyEntries += item.history.count
    }
}

/// Why an import could not start or finish. Nothing is added to the vault when one is thrown.
enum ImportError: Error, Equatable {
    case notAnExport
    case empty
    case tooLarge
    case unreadable(String)
    case sampleVault
    case vaultStructure
    case attachmentUnreadable(String)
    case attachmentChanged(String)

    var message: String {
        switch self {
        case .notAnExport: String(localized: "This is not a 1Password 7 export. In 1Password 7 choose File > Export > All Items and the 1PIF format.")
        case .empty: String(localized: "No items found. Check that you chose a vault that has items.")
        case .tooLarge: String(localized: "This export is too large to import safely. Export one vault at a time.")
        case .unreadable(let reason): String(localized: "The export could not be read. \(reason)")
        case .sampleVault: String(localized: "The sample vault cannot take imports. Create or open a vault first.")
        case .vaultStructure: String(localized: "The vault has no group to import into. Nothing was changed.")
        case .attachmentUnreadable(let name): String(localized: "The attachment \(name) could not be read. Nothing was added.")
        case .attachmentChanged(let name): String(localized: "The attachment \(name) changed after the export was read. Nothing was added.")
        }
    }
}

/// Field names inside one entry. Reserved names belong to KeePass and to this app, so a label that collides with one,
/// or with an earlier label, gets a suffix: "Notes" becomes "Notes (2)".
struct ImportLabels {
    static let reservedNames: Set<String> = ["Title", "UserName", "Password", "URL", "Notes", "otp", "Expiry", "TOTP Seed", "TOTP Settings"]
    static let reservedPrefixes = ["KPEX_", "KP2A_", "KPH:", "PSSS_", "TimeOtp-"]

    private var used: Set<String> = []

    static func isReserved(_ label: String) -> Bool {
        reservedNames.contains(label) || reservedPrefixes.contains { label.hasPrefix($0) }
    }

    /// Marks a name as taken without changing it.
    mutating func reserve(_ label: String) { used.insert(label) }

    /// A name that is unique here and not reserved. A suffix cannot clear a reserved prefix, so those names start with "Field: ".
    mutating func claim(_ label: String) -> String {
        var base = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty { base = String(localized: "Field") }
        if Self.reservedPrefixes.contains(where: { base.hasPrefix($0) }) { base = "Field: " + base }
        var candidate = base
        var n = 2
        while used.contains(candidate) || Self.reservedNames.contains(candidate) {
            candidate = "\(base) (\(n))"
            n += 1
        }
        used.insert(candidate)
        return candidate
    }
}

/// Picks the reader for what the person chose, from the content and not from a source picker.
enum ImportSources {
    static func plan(from url: URL, now: Date = .now) throws -> ImportPlan {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { throw ImportError.notAnExport }
        if isDirectory.boolValue || url.pathExtension.lowercased() == "1pif" { return try OnePasswordPIF.plan(from: url, now: now) }
        return try CSVSource.plan(from: url, now: now)
    }
}
