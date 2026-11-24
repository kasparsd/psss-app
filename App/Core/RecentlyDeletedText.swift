import Foundation

/// An item waiting in Recently Deleted, with when it was deleted.
struct DeletedItem: Identifiable, Sendable {
    let item: VaultItem
    let deleted: Date
    var id: VaultItem.ID { item.id }

    init(item: VaultItem, deleted: Date) {
        self.item = item
        self.deleted = deleted
    }

    init(_ entry: (item: VaultItem, deleted: Date)) { self.init(item: entry.item, deleted: entry.deleted) }
}

extension ItemKind {
    /// The kind in words, for places that cannot take a `LocalizedStringKey` (VoiceOver labels).
    var name: String { unnamedTitle }
}

/// The words and dates of Recently Deleted, in one place so every platform says the same thing and the tests can check them.
/// Every date function takes `now`, a calendar and a locale, so a test is deterministic and a deletion across midnight counts
/// calendar days, not blocks of 24 hours.
enum RecentlyDeletedText {
    /// How many days an item stays, as the codec's retention says it.
    static var retentionDays: Int { Int(RecycleBinKeys.retention / 86_400) }

    /// The day Psss removes the item for good: the deletion time plus the retention, the same instant the purge uses.
    static func removalDate(deleted: Date) -> Date { deleted.addingTimeInterval(RecycleBinKeys.retention) }

    /// Whole calendar days from the day of the deletion to today. A deletion dated in the future counts as today.
    static func daysAgo(deleted: Date, now: Date, calendar: Calendar = .current) -> Int {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: deleted), to: calendar.startOfDay(for: now)).day ?? 0
        return max(0, days)
    }

    /// "23 Dec": day and abbreviated month, no year, in the person's language.
    static func shortDate(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        date.formatted(Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone).day().month(.abbreviated))
    }

    /// "23 December", for VoiceOver.
    static func longDate(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        date.formatted(Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone).day().month(.wide))
    }

    /// "Deleted today", "Deleted yesterday", "Deleted 3 days ago". Nil when the deletion time is not known: just "Deleted".
    static func deletedPhrase(deleted: Date?, now: Date, calendar: Calendar = .current) -> String {
        guard let deleted else { return String(localized: "Deleted") }
        switch daysAgo(deleted: deleted, now: now, calendar: calendar) {
        case 0: return String(localized: "Deleted today")
        case 1: return String(localized: "Deleted yesterday")
        case let days: return String(localized: "Deleted \(days) days ago")
        }
    }

    /// The second line of a row: "Deleted 3 days ago · removed for good on 20 Dec". With no known deletion time there is no date
    /// to promise, so the line is only "Deleted".
    static func rowLine(deleted: Date?, now: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        let phrase = deletedPhrase(deleted: deleted, now: now, calendar: calendar)
        guard let deleted else { return phrase }
        return String(localized: "\(phrase) · removed for good on \(shortDate(removalDate(deleted: deleted), calendar: calendar, locale: locale))")
    }

    /// Under the name in the read-only detail: "Deleted today. Psss removes it for good on 23 Dec."
    static func detailLine(deleted: Date?, now: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        let phrase = deletedPhrase(deleted: deleted, now: now, calendar: calendar)
        guard let deleted else { return String(localized: "\(phrase).") }
        return String(localized: "\(phrase). Psss removes it for good on \(shortDate(removalDate(deleted: deleted), calendar: calendar, locale: locale)).")
    }

    /// What VoiceOver reads for a row, with the removal date in the long form.
    static func rowSpokenLabel(title: String, kind: ItemKind, deleted: Date?, now: Date, calendar: Calendar = .current,
                               locale: Locale = .current) -> String {
        let phrase = deletedPhrase(deleted: deleted, now: now, calendar: calendar)
        guard let deleted else { return String(localized: "\(title), \(kind.name), \(phrase)") }
        let removal = longDate(removalDate(deleted: deleted), calendar: calendar, locale: locale)
        return String(localized: "\(title), \(kind.name), \(phrase), removed for good on \(removal)")
    }

    // MARK: Counts and confirmations

    /// "4 items", "1 item", "0 items".
    static func itemCount(_ count: Int) -> String {
        count == 1 ? String(localized: "1 item") : String(localized: "\(count) items")
    }

    static func deleteOneQuestion(name: String) -> String { String(localized: "Delete “\(name)” for good?") }
    static var deleteOneConsequence: String {
        String(localized: "It is removed from this vault and cannot be recovered. Backup copies of the vault may still hold it.")
    }
    /// The iPhone sheet shows the question and the consequence as one message.
    static func deleteOneSheetMessage(name: String) -> String { "\(deleteOneQuestion(name: name)) \(deleteOneConsequence)" }
    static var deleteOneButton: String { String(localized: "Delete Now") }

    static func deleteAllQuestion(count: Int) -> String {
        count == 1 ? String(localized: "Delete 1 item for good?") : String(localized: "Delete all \(count) items for good?")
    }
    static func deleteAllConsequence(count: Int) -> String {
        count == 1
            ? deleteOneConsequence
            : String(localized: "They are removed from this vault and cannot be recovered. Backup copies of the vault may still hold them.")
    }
    static func deleteAllSheetMessage(count: Int) -> String { "\(deleteAllQuestion(count: count)) \(deleteAllConsequence(count: count))" }
    static func deleteAllButton(count: Int) -> String {
        count == 1 ? String(localized: "Delete 1 Item Now") : String(localized: "Delete \(count) Items Now")
    }

    // MARK: Fixed lines

    static var listFooter: String {
        String(localized: "Items stay here for 30 days, then Psss removes them for good. Other KeePass apps show these items in their Recycle Bin and do not remove them.")
    }
    static var emptyTitle: String { String(localized: "Nothing deleted recently") }
    static var emptyBody: String {
        String(localized: "Items you delete stay here for 30 days, so you can bring them back. Other KeePass apps show them in their Recycle Bin and do not remove them.")
    }
    static var detailFooter: String { String(localized: "To change this item, restore it first.") }
    /// The button at the bottom of edit mode, the Mac's Edit menu item and the name of its Undo (owner, 2026-11-24): the item is not
    /// gone, so the words say where it goes and nothing is red.
    static var moveButton: String { String(localized: "Move to Recently Deleted") }
    /// The line under that button.
    static var editorDeleteLine: String { String(localized: "You can bring it back for 30 days.") }

    /// The Undo capsule's sentence, also read by VoiceOver.
    static func movedMessage(title: String) -> String { String(localized: "“\(title)” moved to Recently Deleted") }
}

extension ItemSearch {
    /// The entries of Recently Deleted that match, in the order given (newest deletion first).
    static func matching(_ entries: [DeletedItem], query: String) -> [DeletedItem] {
        entries.filter { matches($0.item, query: query) }
    }
}
