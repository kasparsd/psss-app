import CryptoKit
import Foundation

/// The login-only CSV that 1Password 7, Apple Passwords and browsers export, read into an import plan. `CSVImport` stays for
/// its current caller; this one counts the rows it leaves out and says why.
enum CSVSource {
    static let maxBytes = 64 * 1024 * 1024

    static func plan(from url: URL, now: Date = .now) throws -> ImportPlan {
        // Only a regular file is read, and its size is enforced as it is read.
        let handle = try OnePasswordPIF.openRegularFile(url.path, limit: maxBytes)
        defer { try? handle.close() }
        var data = Data()
        while true {
            let chunk: Data
            do { chunk = try handle.read(upToCount: 1 << 20) ?? Data() } catch { throw ImportError.unreadable(error.localizedDescription) }
            if chunk.isEmpty { break }
            data.append(chunk)
            if data.count > maxBytes { throw ImportError.tooLarge }
        }
        var fellBack = false
        let text: String
        if let utf8 = String(data: data, encoding: .utf8) { text = utf8 } else { text = Windows1252.decode(data).text; fellBack = true }
        var plan = try plan(from: text, now: now)
        if fellBack {
            plan.issues.append(ImportIssue(kind: .textEncoding, item: nil,
                                           detail: String(localized: "the file is not saved as UTF-8, so it was read as Windows text and accented or special characters may look different")))
        }
        return plan
    }

    /// Rows with a username, password or website become logins. Any other row, such as the note or card rows that
    /// 1Password 7 writes with only a title, is skipped and listed by title.
    static func plan(from text: String, now: Date = .now) throws -> ImportPlan {
        let rows = CSVImport.parse(text)
        guard let header = rows.first else { throw ImportError.notAnExport }
        let names = header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        func column(_ options: [String]) -> Int? { names.firstIndex { options.contains($0) } }
        let title = column(["title", "name"]), url = column(["url", "website"])
        let user = column(["username", "login"]), pass = column(["password"])
        let notes = column(["notes", "note"]), otp = column(["otpauth", "totp"])
        guard pass != nil, user != nil || url != nil else { throw ImportError.notAnExport }

        var plan = ImportPlan(source: .csv)
        plan.importedAt = now
        // A row has one empty field more than the header when the line ends in a comma, as 1Password 7 writes it.
        for row in rows.dropFirst() where !row.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            plan.recordCount += 1
            func value(_ index: Int?) -> String {
                guard let index, index < row.count else { return "" }
                return row[index].trimmingCharacters(in: .whitespacesAndNewlines)
            }
            // A password is never trimmed, so a row whose password is only spaces keeps it.
            let secret = pass.flatMap { $0 < row.count ? row[$0] : nil } ?? ""
            let rowTitle = value(title), account = value(user), site = value(url)
            guard !secret.isEmpty || !account.isEmpty || !site.isEmpty else {
                plan.skipped.rows += 1
                let reason = value(notes).isEmpty
                    ? String(localized: "the row has no username, password or website, so it is not a login and was not imported")
                    : String(localized: "the row is a note, which a CSV export cannot carry in full, and it was not imported")
                plan.issues.append(ImportIssue(kind: .skippedRow, item: rowTitle.isEmpty ? nil : rowTitle, detail: reason))
                continue
            }
            var fields: [ImportField] = []
            if !account.isEmpty { fields.append(ImportField(.username, value: account)) }
            if !secret.isEmpty { fields.append(ImportField(.password, value: secret, concealed: true)) }
            if !site.isEmpty { fields.append(ImportField(.website, value: site)) }
            var issues: [ImportIssue] = []
            let code = value(otp)
            if !code.isEmpty {
                if case .setup = TOTP.parse(code) { fields.append(ImportField(.code, value: code, concealed: true)) }
                else {
                    fields.append(ImportField(.custom, label: "One-time code", value: code, concealed: true))
                    issues.append(ImportIssue(kind: .unreadableCode, item: rowTitle.isEmpty ? nil : rowTitle,
                                              detail: String(localized: "the verification code setup could not be read. Psss kept it as written; set the code up again from the site.")))
                }
            }
            if !value(notes).isEmpty { fields.append(ImportField(.notes, value: value(notes))) }
            // The marker is made of what rarely changes (site, user name and title), never of the password, so a changed
            // password is an update of the same entry and an unchanged row is exactly a duplicate.
            var marker = SHA256()
            for part in [ImportText.clean(site), ImportText.clean(account), ImportText.clean(rowTitle)] {
                marker.update(data: Data(part.utf8))
                marker.update(data: Data([0]))
            }
            var item = ImportItem(sourceID: "csv:" + Hex.string(marker.finalize().prefix(8)), kind: .login, title: rowTitle, fields: fields, created: now, modified: now, issues: issues)
            item.sanitize()
            plan.items.append(item)
            plan.missingDates += 1
        }
        guard plan.recordCount > 0 else { throw ImportError.empty }
        plan.separateSharedIdentifiers()
        return plan
    }
}
