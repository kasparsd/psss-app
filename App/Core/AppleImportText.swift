import Foundation

/// The words of the Apple Passwords import (mock `#/import-passwords`), shared by every platform. Nothing here holds a value
/// from a vault or an export except titles, made safe to show.
enum AppleImportText {
    /// "412 logins: 38 with a passkey, 21 with a verification code" and what else there is.
    static func found(_ plan: ImportPlan, fromFile: Bool) -> String {
        let logins = plan.items.filter { $0.kind == .login }
        let passkeys = logins.filter { $0.passkey != nil }.count
        let codes = logins.filter { $0.first(.code) != nil }.count
        var parts: [String] = []
        if passkeys > 0 { parts.append(String(localized: "\(passkeys) with a passkey")) }
        if codes > 0 { parts.append(String(localized: "\(codes) with a verification code")) }
        var what = logins.count == 1 ? String(localized: "1 login") : String(localized: "\(logins.count) logins")
        let others = plan.items.count - logins.count
        if others > 0 {
            let more = others == 1 ? String(localized: "1 other item") : String(localized: "\(others) other items")
            what = logins.isEmpty ? more : String(localized: "\(what) and \(more)")
        }
        if !parts.isEmpty { what += ": " + parts.joined(separator: ", ") }
        return fromFile ? String(localized: "The file holds \(what).") : String(localized: "Apple Passwords sent \(what).")
    }

    static func alreadyThere(_ count: Int, vault: String) -> String {
        count == 1 ? String(localized: "1 is already in \(vault) and will not be added again.")
                   : String(localized: "\(count) are already in \(vault) and will not be added again.")
    }

    static func gaining(_ count: Int, vault: String) -> String {
        count == 1 ? String(localized: "1 login in \(vault) gets what it is missing, such as a passkey or verification code. Nothing saved there is replaced.")
                   : String(localized: "\(count) logins in \(vault) get what they are missing, such as a passkey or verification code. Nothing saved there is replaced.")
    }

    static func importButton(_ count: Int) -> String {
        count == 1 ? String(localized: "Import 1 Item") : String(localized: "Import \(count) Items")
    }

    static func nothingNew(_ summary: ImportSummary, vault: String) -> String {
        let count = summary.duplicatesSkipped
        guard count > 0 else { return String(localized: "There is nothing to add to \(vault).") }
        return count == 1 ? String(localized: "1 item is already in \(vault).") : String(localized: "\(count) items are already in \(vault).")
    }

    static func doneTitle(_ count: Int) -> String {
        count == 1 ? String(localized: "1 item imported") : String(localized: "\(count) items imported")
    }

    /// One line to check: the item's title and what to know about it.
    struct Check: Identifiable {
        let id: Int
        var title: String
        var detail: String
    }

    /// More lines than this are counted, not listed.
    static let checkLimit = 100

    /// The issues, then the items that are left out because the person deleted them for good.
    static func checks(_ issues: [ImportIssue], deleted: [SkippedItem] = []) -> (shown: [Check], more: Int) {
        let gone = String(localized: "You deleted it in Psss earlier, so it is not imported again.")
        // With the items named one by one, the line that only counts them says nothing more.
        let told = deleted.isEmpty ? issues : issues.filter { $0.kind != .deletedNotImported }
        let all: [(String, String)] = told.map { ($0.item ?? "", sentence($0.detail)) } + deleted.map { ($0.title, gone) }
        let shown = all.prefix(checkLimit).enumerated().map { index, one in
            Check(id: index, title: DisplayText.safe(one.0, empty: String(localized: "No title")), detail: one.1)
        }
        return (shown, max(0, all.count - checkLimit))
    }

    private static func sentence(_ text: String) -> String {
        var out = text.prefix(1).uppercased() + text.dropFirst()
        if let last = out.last, !".!?".contains(last) { out += "." }
        return out
    }

    static func fileProblem(_ error: any Error) -> String {
        switch error as? ImportError {
        case .notAnExport: String(localized: "This file is not a passwords export. It needs columns such as Title, URL, Username and Password.")
        case .empty: String(localized: "This file holds no logins.")
        case .tooLarge: String(localized: "This file is too large to import safely.")
        default: String(localized: "Psss could not read that file.")
        }
    }
}
