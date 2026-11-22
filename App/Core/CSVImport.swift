import Foundation

/// Reads the CSV that Apple Passwords exports (Title, URL, Username, Password, Notes, OTPAuth). Chrome and
/// most browsers use near-identical headers, so the same reader takes those files too.
enum CSVImport {
    struct Result {
        var items: [VaultItem]
        var skipped: Int
    }

    enum Failure: Error {
        case notPasswordsFile
        var message: String { String(localized: "This does not look like a passwords export. Expected columns such as Title, URL, Username and Password.") }
    }

    static func items(from text: String) throws -> Result {
        let rows = parse(text)
        guard let header = rows.first else { throw Failure.notPasswordsFile }
        let names = header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        func column(_ options: [String]) -> Int? { names.firstIndex { options.contains($0) } }
        let title = column(["title", "name"]), url = column(["url", "website"])
        let user = column(["username", "login"]), pass = column(["password"])
        let notes = column(["notes", "note"]), otp = column(["otpauth", "totp"])
        guard pass != nil, user != nil || url != nil else { throw Failure.notPasswordsFile }

        var items: [VaultItem] = [], skipped = 0
        for row in rows.dropFirst() where !row.allSatisfy(\.isEmpty) {
            func value(_ index: Int?) -> String {
                guard let index, index < row.count else { return "" }
                return row[index].trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let item = VaultItem(kind: .login, title: value(title), account: value(user), website: value(url),
                                 secret: value(pass), notes: value(notes),
                                 otpSecret: TOTP.normalizedSecret(value(otp)) ?? "")
            if item.secret.isEmpty, item.account.isEmpty, item.website.isEmpty { skipped += 1 } else { items.append(item) }
        }
        return Result(items: items, skipped: skipped)
    }

    /// RFC 4180: quoted fields, doubled quotes, newlines inside quotes.
    static func parse(_ text: String) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], field = "", quoted = false
        var chars = Array(text.replacingOccurrences(of: "\u{FEFF}", with: ""))[...]
        while let c = chars.popFirst() {
            if quoted {
                if c == "\"" {
                    if chars.first == "\"" { field.append("\""); chars.removeFirst() } else { quoted = false }
                } else { field.append(c) }
            } else {
                switch c {
                case "\"": quoted = true
                case ",": row.append(field); field = ""
                case "\n", "\r\n", "\r":
                    row.append(field); field = ""
                    rows.append(row); row = []
                default: field.append(c)
                }
            }
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }
}
