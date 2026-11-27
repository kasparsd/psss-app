import CryptoKit
import Foundation

/// The rules for what comes from Apple Passwords, by the direct move or by its file. Nothing already saved is ever replaced:
///
/// 1. An item that an entry already holds in full is skipped. An entry in the recycle bin that holds it is left there and the
///    person is told, and one the person deleted for good (`PSSS_DELETED_SOURCES`) is not brought back.
/// 2. A login that matches an entry (same site and user name, no different password, code or passkey) and brings something the
///    entry lacks, adds only that to the entry. The version before is kept in history.
/// 3. Everything else is added. A login whose site and user name the vault already has is listed as similar.
enum AppleImport {
    /// Identifies an item, so the same one is recognised when it comes again. Nothing in it can be read back.
    ///
    /// A login is identified by what signs in. Its passkey and verification code count only when there is no password, because
    /// the CSV file carries no passkeys and a login must be the same one by either way. Anything else is identified by all it says.
    static func identifier(_ item: ImportItem) -> String {
        identifier(item, password: item.password, passkey: item.passkey?.credentialID, code: item.first(.code) ?? "")
    }

    /// The identifier of the item, and those it would have had without its password: an entry that began as a passkey or a code
    /// alone and was filled later keeps that first one.
    private static func identifiers(_ item: ImportItem) -> [String] {
        let passkey = item.passkey?.credentialID, code = item.first(.code) ?? ""
        var all = [item.sourceID ?? identifier(item)]
        guard item.kind == .login else { return all }
        if passkey != nil { all.append(identifier(item, password: "", passkey: passkey, code: "")) }
        if !code.isEmpty { all.append(identifier(item, password: "", passkey: nil, code: code)) }
        if passkey != nil, !code.isEmpty { all.append(identifier(item, password: "", passkey: passkey, code: code)) }
        return all
    }

    private static func identifier(_ item: ImportItem, password: String, passkey: Data?, code: String) -> String {
        var hasher = SHA256()
        var parts = [item.kind.rawValue, ImportText.clean(item.title), ImportText.clean(item.websites.first ?? ""),
                     ImportText.clean(item.username), ImportText.clean(password)]
        if item.kind != .login {
            parts += item.fields.filter { $0.role != .website }.map { ImportText.clean($0.value) }
        } else if password.isEmpty {
            parts += [passkey?.base64EncodedString() ?? "", codeSecret(ImportText.clean(code))]
        }
        for part in parts {
            hasher.update(data: Data(part.utf8))
            hasher.update(data: Data([0]))
        }
        return "apple:" + Hex.string(hasher.finalize().prefix(12))
    }

    /// What one entry, or one item accepted earlier in the same import, holds.
    private struct Held {
        var index: Int?
        var inRecycleBin: Bool
        var type: String
        var title: String
        var hosts: Set<String>
        var username: String
        var password: String
        var notes: String
        var code: String
        var passkey: Data?
        /// Every other value, by what it says, with how often it is there, so custom fields are compared without their names.
        var values: [String: Int]
    }

    private static let standard: Set<String> = ["Title", "UserName", "Password", "URL", "Notes", "otp"]
    private static let passkeyPrefix = "KPEX_PASSKEY_"

    /// A field that is neither one of KeePass's own, a website, nor the app's bookkeeping.
    private static func isOwnValue(_ key: String) -> Bool {
        !standard.contains(key) && !key.hasPrefix("KP2A_URL") && !key.hasPrefix("KPEX_") && !key.hasPrefix("PSSS_")
    }

    private static func isWebsite(_ key: String) -> Bool { key == "URL" || key.hasPrefix("KP2A_URL") }

    private static func tidy(_ notes: String) -> String {
        notes.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether `notes` already say `part`: all of them, or a block of their own between blank lines.
    private static func notes(_ notes: String, hold part: String) -> Bool {
        let all = "\n\n" + tidy(notes) + "\n\n"
        let block = tidy(part)
        return block.isEmpty || all.contains("\n\n" + block + "\n\n")
    }

    private static func held(strings: [String: String], passkey: Data?, index: Int?, inRecycleBin: Bool) -> Held {
        var hosts = Set<String>()
        var values: [String: Int] = [:]
        for (key, value) in strings {
            if isWebsite(key) {
                let host = ImportDuplicates.host(value)
                if !host.isEmpty { hosts.insert(host) }
            } else if isOwnValue(key), !value.isEmpty {
                values[value, default: 0] += 1
            }
        }
        return Held(index: index, inRecycleBin: inRecycleBin, type: strings[EntryMapping.typeKey] ?? "login", title: strings["Title"] ?? "",
                    hosts: hosts, username: strings["UserName"] ?? "", password: strings["Password"] ?? "", notes: strings["Notes"] ?? "",
                    code: codeSecret(strings["otp"] ?? strings["TimeOtp-Secret-Base32"] ?? strings["TOTP Seed"] ?? ""),
                    // A passkey this app cannot read still counts, so another one is never written over it.
                    passkey: passkey ?? (strings.keys.contains { $0.hasPrefix(passkeyPrefix) } ? Data() : nil), values: values)
    }

    private static func codeSecret(_ text: String) -> String {
        if case .setup(let setup) = TOTP.parse(text) { return setup.secret }
        return text
    }

    static func resolve(_ plan: ImportPlan, known: [KeePassImport.Known], document: KDBXDocument) -> KeePassImport.Resolved {
        var vault: [Held] = known.enumerated().map { index, entry in
            var strings: [String: String] = [:]
            for node in entry.node.children where node.name == "String" {
                if let key = node.child("Key")?.text { strings[key] = node.child("Value")?.text ?? "" }
            }
            return held(strings: strings, passkey: EntryMapping.passkey(entry.node)?.credentialID, index: index,
                        inRecycleBin: entry.existing.inRecycleBin)
        }
        // Looked up by user name and site, or by user name and title, so a large vault is not walked once for every item, and
        // neither are the many logins that share one email address.
        var buckets: [String: [Int]] = [:]
        func siteKeys(_ one: Held) -> [String] { one.hosts.map { "s\u{0}" + one.username + "\u{0}" + $0 } }
        func titleKey(_ one: Held) -> String { "t\u{0}" + one.username + "\u{0}" + one.title }
        func file(_ one: Held, at position: Int) { for key in siteKeys(one) + [titleKey(one)] { buckets[key, default: []].append(position) } }
        for (position, one) in vault.enumerated() { file(one, at: position) }
        var consumed = Set<Int>()
        let deleted = DeletedSources.read(from: document.root)

        var resolutions: [KeePassImport.Resolution] = []
        var similar: [Int: ImportDuplicates.SimilarReason] = [:]
        for (position, item) in plan.items.enumerated() {
            let rendered = KeePassImport.render(item, protected: [])
            var strings: [String: String] = [:]
            for pair in rendered.pairs { strings[pair.key] = pair.value }
            let new = held(strings: strings, passkey: item.passkey?.credentialID, index: nil, inRecycleBin: false)
            let isLogin = item.kind == .login
            let lookups = isLogin && !new.hosts.isEmpty ? siteKeys(new) : [titleKey(new)]
            let candidates = lookups.count == 1 ? buckets[lookups[0]] ?? [] : Set(lookups.flatMap { buckets[$0] ?? [] }).sorted()

            /// Whether this entry is the same account or thing.
            func same(_ old: Held) -> Bool {
                guard old.type == new.type else { return false }
                if isLogin, !new.hosts.isEmpty { return old.username == new.username && !old.hosts.isDisjoint(with: new.hosts) }
                return old.title == new.title && old.username == new.username && old.hosts == new.hosts
            }
            /// Nothing the item carries differs from what the entry has.
            func compatible(_ old: Held) -> Bool {
                (new.password.isEmpty || old.password.isEmpty || old.password == new.password)
                    && (new.code.isEmpty || old.code.isEmpty || old.code == new.code)
                    && (new.passkey == nil || old.passkey == nil || old.passkey == new.passkey)
                    && (isLogin || old.password == new.password)
            }
            func holdsAll(_ old: Held) -> Bool {
                (new.password.isEmpty || old.password == new.password) && (new.code.isEmpty || old.code == new.code)
                    && (new.passkey == nil || old.passkey == new.passkey)
                    // A login's notes may have gained others under them. Anything else is its notes, so they must be the same.
                    && (isLogin ? Self.notes(old.notes, hold: new.notes) : Self.tidy(old.notes) == Self.tidy(new.notes))
                    && new.values.allSatisfy { old.values[$0.key, default: 0] >= $0.value } && new.hosts.isSubset(of: old.hosts)
            }
            /// A secret both have, which says the arriving login is the one that is there.
            func shares(_ old: Held) -> Bool {
                (!new.password.isEmpty && old.password == new.password) || (new.passkey != nil && old.passkey == new.passkey)
                    || (!new.code.isEmpty && old.code == new.code)
            }

            let matches = candidates.filter { same(vault[$0]) }
            if matches.contains(where: { !vault[$0].inRecycleBin && holdsAll(vault[$0]) }) {
                resolutions.append(.skip)
                continue
            }
            if matches.contains(where: { vault[$0].inRecycleBin && holdsAll(vault[$0]) }) {
                resolutions.append(.inRecycleBin)
                continue
            }
            if !plan.includeDeleted, identifiers(item).contains(where: { deleted.contains($0) }) {
                resolutions.append(.deletedByPerson)
                continue
            }
            // Fill an entry of the vault. A login with a password only fills one that has the same password or none, and a login
            // without a site is never matched to another by its user name alone.
            let target = isLogin && !new.hosts.isEmpty ? matches.first {
                guard let index = vault[$0].index else { return false }
                return !vault[$0].inRecycleBin && !consumed.contains(index) && compatible(vault[$0])
                    && (!new.password.isEmpty || new.passkey != nil || !new.code.isEmpty)
            } : nil
            // The login is in the recycle bin and arrives with more than it had there: it still stays deleted.
            if target == nil, isLogin, !new.hosts.isEmpty, matches.contains(where: { vault[$0].inRecycleBin && compatible(vault[$0]) && shares(vault[$0]) }) {
                resolutions.append(.inRecycleBin)
                continue
            }
            if let target, let index = vault[target].index {
                consumed.insert(index)
                resolutions.append(.merge(fill(item, rendered: rendered, entry: known[index])))
                vault[target].password = vault[target].password.isEmpty ? new.password : vault[target].password
                vault[target].code = vault[target].code.isEmpty ? new.code : vault[target].code
                vault[target].passkey = vault[target].passkey ?? new.passkey
                vault[target].notes += "\n\n" + new.notes
                vault[target].values.merge(new.values, uniquingKeysWith: max)
                vault[target].hosts.formUnion(new.hosts)
                for key in siteKeys(new) where !(buckets[key]?.contains(target) ?? false) { buckets[key, default: []].append(target); buckets[key]?.sort() }
                continue
            }
            if isLogin, !new.hosts.isEmpty, matches.contains(where: { !vault[$0].inRecycleBin }) {
                similar[position] = matches.contains { !vault[$0].password.isEmpty && !new.password.isEmpty && vault[$0].password != new.password }
                    ? .password : .otherDetails
                resolutions.append(.addSimilar)
            } else {
                resolutions.append(.add)
            }
            vault.append(new)
            file(new, at: vault.count - 1)
        }
        return KeePassImport.Resolved(items: resolutions, issues: [], similar: similar)
    }

    /// Only what the entry lacks. Nothing it holds is changed, apart from notes the new ones are added under.
    private static func fill(_ item: ImportItem, rendered: KeePassImport.Rendered, entry: KeePassImport.Known) -> KeePassImport.Change {
        var current: [String: String] = [:]
        for node in entry.node.children where node.name == "String" {
            if let key = node.child("Key")?.text { current[key] = node.child("Value")?.text ?? "" }
        }
        var change = KeePassImport.Change(entry: entry.node, rendered: rendered, isMerge: true,
                                          baseline: KeePassImport.Baseline(content: "", fields: [:], tags: []))
        change.parent = entry.parent
        // What an earlier import left about where this entry came from stays as it is.
        change.keepSource = true
        change.keepBaseline = true
        let hasPasskey = current.keys.contains { $0.hasPrefix(passkeyPrefix) }
        var used = Set(current.keys)
        // Each value the entry has stands for one arriving field that says the same.
        var values = current.filter { isOwnValue($0.key) }.values.reduce(into: [String: Int]()) { $0[$1, default: 0] += 1 }
        var hosts = Set(current.filter { isWebsite($0.key) }.map { ImportDuplicates.host($0.value) })
        for pair in rendered.pairs {
            let key = pair.key
            if key == EntryMapping.typeKey || key == "Title" { continue }
            if isWebsite(key) {
                let host = ImportDuplicates.host(pair.value)
                if host.isEmpty || hosts.contains(host) { continue }
                hosts.insert(host)
                var name = "URL"
                if !(current["URL"] ?? "").isEmpty || change.sets.contains(where: { $0.key == "URL" }) {
                    name = "KP2A_URL"
                    var slot = 0
                    while used.contains(name) { slot += 1; name = "KP2A_URL_\(slot)" }
                }
                used.insert(name)
                change.sets.append(KeePassImport.Pair(key: name, value: pair.value, protected: pair.protected))
                continue
            }
            if key.hasPrefix("KPEX_") || key == EntryMapping.passkeyCreated {
                if !hasPasskey { change.sets.append(pair); used.insert(key) }
                continue
            }
            if pair.value.isEmpty { continue }
            let now = current[key] ?? ""
            if key == "Notes" {
                if !Self.notes(now, hold: pair.value) {
                    change.sets.append(KeePassImport.Pair(key: key, value: now.isEmpty ? pair.value : now + "\n\n" + pair.value, protected: pair.protected))
                }
            } else if standard.contains(key) {
                if now.isEmpty { change.sets.append(pair); used.insert(key) }
            } else if values[pair.value, default: 0] > 0 {
                values[pair.value, default: 0] -= 1
            } else {
                var name = key
                var n = 2
                while used.contains(name) { name = "\(key) (\(n))"; n += 1 }
                used.insert(name)
                change.sets.append(KeePassImport.Pair(key: name, value: pair.value, protected: pair.protected))
            }
        }
        return change
    }
}
