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
                                           detail: String(localized: "The file was not UTF-8 and was read as Windows text, so some characters may differ")))
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
            let rowTitle = value(title), account = value(user), secret = value(pass), site = value(url)
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
                                              detail: String(localized: "the one-time code could not be read and was kept as a hidden field")))
                }
            }
            if !value(notes).isEmpty { fields.append(ImportField(.notes, value: value(notes))) }
            plan.items.append(ImportItem(sourceID: nil, kind: .login, title: rowTitle, fields: fields, created: now, modified: now, issues: issues))
            plan.missingDates += 1
        }
        guard plan.recordCount > 0 else { throw ImportError.empty }
        return plan
    }
}
