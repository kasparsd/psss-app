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
    /// The identifier the source gave several items of one export, when `sourceID` carries a suffix that tells them apart.
    var sharedBase: String?

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
        case dateMissing, unreadableValue, attachmentSkipped, tagsChanged, updatedOverwrote, mergeConflict
        case secretChanged, secretSpaces, textEmptied, foldersFlattened, sharedIdentifier, deletedNotImported, inRecycleBin, trashedInSource, notesCombined, codeNotInUse
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
    /// Passwords and other secrets whose characters the vault file cannot hold, stored without them. The interface should say so loudly.
    var secretsChanged = 0
    /// Items with the same identifier and the same content as an earlier item of the same export.
    var duplicatesInExport = 0
    /// Items the person deleted in Psss that were not imported again.
    var deletedNotImported = 0
    /// Which ones, for a screen that offers to bring them back (`ImportPlan.includeDeleted`). Titles and kinds only.
    var deletedItems: [SkippedItem] = []
    /// Attachments an update removed because the source dropped them, by item title and file name.
    var removedAttachments: [RemovedAttachment] = []
    /// Entries whose stored import hashes were upgraded to the current form without any other change. It is a write, but not an
    /// import of anything: `needsWrite` is true when only these are left.
    var refreshed = 0

    /// Entries changed in place because the same source identifier came back with other content.
    var updated = 0
    /// Entries that gained the fields of a richer item with the same site, user name and password.
    var merged = 0

    /// Items added.
    var addedCount: Int { logins + cards + notes + others }
    /// Items that changed the vault: added, updated or merged. Zero means nothing needs writing.
    var itemCount: Int { addedCount + updated + merged }
    /// Whether applying this changes the vault file at all.
    var needsWrite: Bool { itemCount > 0 || refreshed > 0 }
}

struct SkippedItem: Sendable, Equatable {
    var title: String
    var kind: ImportItemKind
}

struct RemovedAttachment: Sendable, Equatable {
    var item: String
    var file: String
}

struct TrashedSource: Sendable, Equatable {
    var id: String
    var title: String
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
    /// Bring back items the person deleted in Psss (their identifiers are in the vault's `PSSS_DELETED_SOURCES`). Off unless asked.
    var includeDeleted = false
    /// Identifier and title of the items that are in the trash in the source, so an entry imported earlier can be told about.
    var trashedSources: [TrashedSource] = []
    /// Items that repeated an earlier item of the same export, with the same content.
    var duplicatesInExport = 0

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
        s.secretsChanged = s.issues.filter { $0.kind == .secretChanged }.count
        s.duplicatesInExport = duplicatesInExport
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
    /// A line is longer than the limit and nothing else could be read.
    case lineTooLong(Int)
    /// The entries built from the plan did not survive being written and read back, so nothing was added.
    case unreadableResult

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
        case .lineTooLong(let megabytes): String(localized: "A line in this file is longer than \(megabytes) MB, so it cannot be read safely. It does not look like a normal 1Password export.")
        case .unreadableResult: String(localized: "The imported items could not be written safely, so nothing was added. The vault is unchanged.")
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
        var base = ImportText.clean(label).trimmingCharacters(in: .whitespacesAndNewlines)
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

/// Text as the vault file can hold it. Every text an importer hands to the writer goes through the same function the XML writer
/// uses to decide what is storable, before names are compared, so names that differ only by a dropped character are one name.
enum ImportText {
    static func clean(_ text: String) -> String { XMLTree.storable(text) }
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

extension ImportItem {
    /// Makes every text what the vault file can hold, and says so when that matters. A secret is never changed silently: the
    /// password, a card number, a PIN, a security code, a one-time code, an earlier password and any concealed field that lose
    /// characters get an issue that names the item and the field (and one that is left empty says it could not be stored at all).
    /// Other text (title, notes, labels, values) is cleaned without a word, unless something that had text is now empty, which is
    /// one issue per item.
    mutating func sanitize(emptied alreadyEmptied: Bool = false) {
        let clean = ImportText.clean
        var emptied = alreadyEmptied
        var found: [ImportIssue] = []
        let shown = clean(title)
        func secret(_ name: String, empty: Bool) {
            let detail = empty
                ? String(localized: "the \(name) could not be stored at all. Check it in 1Password before you rely on it.")
                : String(localized: "the \(name) contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it.")
            found.append(ImportIssue(kind: .secretChanged, item: shown.isEmpty ? nil : shown, detail: detail))
        }
        if clean(title) != title, clean(title).isEmpty { emptied = true }
        title = shown
        for index in fields.indices {
            let field = fields[index]
            let value = clean(field.value)
            if value != field.value {
                let isSecret = field.concealed || [.password, .cardNumber, .pin, .securityCode, .code].contains(field.role)
                if isSecret {
                    let name: String
                    switch field.role {
                    case .password: name = "password"
                    case .cardNumber: name = "card number"
                    case .pin: name = "PIN"
                    case .securityCode: name = "security code"
                    case .code: name = "one-time code"
                    default: name = field.label.isEmpty ? "hidden field" : "hidden field \(clean(field.label))"
                    }
                    secret(name, empty: value.isEmpty)
                } else if value.isEmpty {
                    emptied = true
                }
            }
            if value == field.value, !value.isEmpty, value.allSatisfy(\.isWhitespace),
               field.concealed || [.password, .cardNumber, .pin, .securityCode, .code].contains(field.role) {
                let name: String
                switch field.role {
                case .password: name = "password"
                case .cardNumber: name = "card number"
                case .pin: name = "PIN"
                case .securityCode: name = "security code"
                case .code: name = "one-time code"
                default: name = field.label.isEmpty ? "hidden field" : "hidden field \(clean(field.label))"
                }
                found.append(ImportIssue(kind: .secretSpaces, item: shown.isEmpty ? nil : shown,
                                         detail: String(localized: "the \(name) is only spaces. Check it in 1Password.")))
            }
            fields[index].value = value
            let label = clean(field.label)
            if label.isEmpty, !field.label.isEmpty { emptied = true }
            fields[index].label = label
        }
        var historyChanged = false, historyEmptied = false
        var keptHistory: [ImportRevision] = []
        for var revision in history {
            let password = clean(revision.password)
            if password != revision.password {
                if password.isEmpty { historyEmptied = true; continue }
                historyChanged = true
            }
            revision.password = password
            keptHistory.append(revision)
        }
        history = keptHistory
        if historyChanged {
            found.append(ImportIssue(kind: .secretChanged, item: shown.isEmpty ? nil : shown,
                                     detail: String(localized: "an earlier password contained characters that cannot be stored and was changed. Check it in 1Password before you rely on it.")))
        }
        if historyEmptied {
            found.append(ImportIssue(kind: .secretChanged, item: shown.isEmpty ? nil : shown,
                                     detail: String(localized: "an earlier password could not be stored at all and was left out. Check it in 1Password before you rely on it.")))
        }
        if emptied {
            found.append(ImportIssue(kind: .textEmptied, item: shown.isEmpty ? nil : shown,
                                     detail: String(localized: "some text contained only characters that cannot be stored, so it is empty now")))
        }
        tags = tags.map(clean)
        folder = folder.map(clean)
        sourceID = sourceID.map(clean)
        for index in attachments.indices { attachments[index].name = clean(attachments[index].name) }
        issues = issues.map { var i = $0; i.item = i.item.map(clean); return i } + found
    }
}

extension ImportPlan {
    /// Two items of one export can share an identifier (a sync accident). With the same content the later one is a duplicate within
    /// the export and is dropped. With other content they are different items, and every one of the group gets
    /// `<id>#<short digest of its kind, title, first site and user name>`, so reordering the export changes nothing, and the item
    /// says so. Identical digests with other content are told apart by their order as `-2`, `-3`.
    mutating func separateSharedIdentifiers() {
        var indices: [String: [Int]] = [:]
        for (index, item) in items.enumerated() { if let id = item.sourceID { indices[id, default: []].append(index) } }
        var dropped = Set<Int>()
        for (id, list) in indices where list.count > 1 {
            var seen = Set<String>()
            var kept: [Int] = []
            for index in list {
                if !seen.insert(items[index].fingerprint).inserted { duplicatesInExport += 1; dropped.insert(index) } else { kept.append(index) }
            }
            guard kept.count > 1 else { continue }
            var used: [String: Int] = [:]
            for index in kept {
                var digest = items[index].identityDigest
                let n = (used[digest] ?? 0) + 1
                used[digest] = n
                if n > 1 { digest += "-\(n)" }
                items[index].sharedBase = id
                items[index].sourceID = "\(id)#\(digest)"
                items[index].issues.append(ImportIssue(kind: .sharedIdentifier, item: items[index].title.isEmpty ? nil : items[index].title,
                                                       detail: String(localized: "two items in the export share one identifier, so this one was added as a separate entry")))
            }
        }
        if !dropped.isEmpty { items = items.enumerated().filter { !dropped.contains($0.offset) }.map(\.element) }
    }
}
