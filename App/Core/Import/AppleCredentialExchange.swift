import AuthenticationServices
import CryptoKit
import Foundation

/// What Apple Passwords hands over in a direct move (Credential Exchange), read into an import plan. Nothing is written to disk:
/// the data arrives in memory from the system and goes into the vault when the person chooses Import. Every item that arrives
/// becomes an item of the plan or is listed with the reason, and no message holds a field value.
enum AppleCredentialExchange {
    /// More than a person has. A larger hand-over is refused whole, so nothing is read in part.
    static let maxItems = 100_000
    /// The longest value kept. A longer one is left out and the item says so.
    static let maxValueBytes = 1 << 20
    /// The most one item turns into logins, one for each further password or passkey it carries.
    static let maxLoginsPerItem = 50

    static func plan(from data: ASExportedCredentialData, now: Date = .now) throws -> ImportPlan {
        var plan = ImportPlan(source: .applePasswords)
        plan.importedAt = now
        guard data.accounts.reduce(0, { $0 + $1.items.count }) <= maxItems else { throw ImportError.tooLarge }
        for account in data.accounts {
            for item in account.items {
                plan.recordCount += 1
                read(item, into: &plan, now: now)
            }
        }
        guard plan.recordCount > 0 else { throw ImportError.empty }
        return plan
    }

    private typealias Field = ASImportableEditableField

    private static func read(_ source: ASImportableItem, into plan: inout ImportPlan, now: Date) {
        let title = short(source.title)
        let shown: String? = title.isEmpty ? nil : title
        var issues: [ImportIssue] = []
        func tell(_ kind: ImportIssue.Kind, _ detail: String) { issues.append(ImportIssue(kind: kind, item: shown, detail: detail)) }

        var tooLong = false
        func text(_ value: String) -> String {
            if value.utf8.count > maxValueBytes { tooLong = true; return "" }
            return value
        }
        func value(_ field: Field?) -> String { field.map { text($0.value) } ?? "" }
        /// User names and notes lose the spaces around them, as the CSV file's do, so the two ways give the same item.
        func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

        var sites: [String] = []
        for url in source.scope?.urls ?? [] {
            let site = text(url.absoluteString)
            if !site.isEmpty, !sites.contains(site) { sites.append(site) }
        }

        var passwords: [(user: String, password: String)] = []
        var passkeys: [(record: PasskeyRecord, user: String)] = []
        var codes: [ImportField] = []
        var notes: [String] = []
        var extras: [ImportField] = []
        var generated: [String] = []
        /// Credentials that are items of their own: a card, an address, a Wi-Fi network, a document.
        var others: [(kind: ImportItemKind, suffix: String, fields: [ImportField])] = []

        func custom(_ label: String, _ field: Field?, secret: Bool = false) -> ImportField? {
            let content = value(field)
            guard !content.isEmpty else { return nil }
            let own = field?.label.map(short) ?? ""
            return ImportField(.custom, label: own.isEmpty ? label : own, value: content, concealed: secret || field?.fieldType == .concealedString)
        }
        func document(_ name: String, _ fields: [ImportField?]) {
            let kept = fields.compactMap(\.self)
            if !kept.isEmpty { others.append((.custom, name, kept)) }
        }

        for credential in source.credentials {
            switch credential {
            case .basicAuthentication(let basic):
                let user = trimmed(value(basic.userName)), password = value(basic.password)
                if !user.isEmpty || !password.isEmpty { passwords.append((user, password)) }
            case .passkey(let passkey):
                let relyingParty = text(passkey.relyingPartyIdentifier)
                guard !relyingParty.isEmpty, !passkey.credentialID.isEmpty, passkey.credentialID.count <= 1023,
                      passkey.userHandle.count <= 1023, passkey.key.count <= maxValueBytes,
                      let key = try? P256.Signing.PrivateKey(derRepresentation: passkey.key) else {
                    tell(.passkeyNotImported, String(localized: "a passkey could not be imported because Psss cannot use its key. It stays in Apple Passwords."))
                    continue
                }
                if #available(iOS 26.4, macOS 26.4, *), passkey.fido2Extensions != nil {
                    tell(.passkeyReduced, String(localized: "the passkey comes without its extra data. If the site no longer accepts it, use the one in Apple Passwords."))
                }
                passkeys.append((PasskeyRecord(credentialID: passkey.credentialID, userHandle: passkey.userHandle, rpID: relyingParty,
                                               privateKey: key.rawRepresentation, created: source.created ?? now),
                                 trimmed(text(passkey.userName))))
            case .totp(let totp):
                var settings = TOTPSettings()
                settings.digits = Int(totp.digits)
                settings.period = Int(totp.period)
                let algorithm: TOTPSettings.Algorithm?
                switch totp.algorithm {
                case .sha1: algorithm = .sha1
                case .sha256: algorithm = .sha256
                case .sha512: algorithm = .sha512
                @unknown default: algorithm = nil
                }
                guard !totp.secret.isEmpty, totp.secret.count <= 1024 else {
                    tell(.unreadableCode, String(localized: "a verification code setup was empty or too long and was not imported. Set the code up again from the site."))
                    continue
                }
                let secret = base32(totp.secret)
                if let algorithm, (6...8).contains(settings.digits), (1...3600).contains(settings.period), TOTP.normalizedSecret(secret) != nil {
                    settings.algorithm = algorithm
                    let issuer = short(totp.issuer ?? "")
                    codes.append(ImportField(.code, value: TOTP.setupURL(secret: secret, issuer: issuer.isEmpty ? title : issuer,
                                                                          account: short(totp.userName ?? ""), settings: settings), concealed: true))
                } else {
                    extras.append(ImportField(.custom, label: "One-time code", value: secret, concealed: true))
                    tell(.unreadableCode, String(localized: "Psss cannot make this verification code. It kept the setup key as text; set the code up again from the site."))
                }
            case .note(let note):
                let content = trimmed(value(note.content))
                if !content.isEmpty { notes.append(content) }
            case .customFields(let group):
                extras += group.fields.compactMap { custom(group.label.map(short) ?? "Field", $0) }
            case .generatedPassword(let one):
                let password = text(one.password)
                if !password.isEmpty { generated.append(password) }
            case .creditCard(let card):
                var fields: [ImportField] = []
                func add(_ role: ImportFieldRole, _ field: Field?, label: String = "", secret: Bool = false) {
                    let content = value(field)
                    if !content.isEmpty { fields.append(ImportField(role, label: label, value: content, concealed: secret)) }
                }
                add(.cardholder, card.fullName)
                add(.cardNumber, card.number, secret: true)
                let expiry = value(card.expiryDate)
                if !expiry.isEmpty { fields.append(ImportField(.expiry, value: cardExpiry(expiry))) }
                add(.securityCode, card.verificationNumber, label: "Security code", secret: true)
                add(.pin, card.pin, label: "PIN", secret: true)
                fields += [custom("Card type", card.cardType), custom("Valid from", card.validFrom)].compactMap(\.self)
                if !fields.isEmpty { others.append((.card, "", fields)) }
            case .address(let address):
                let fields = [custom("Street", address.streetAddress), custom("City", address.city), custom("Region", address.territory),
                              custom("Postal code", address.postalCode), custom("Country", address.country), custom("Phone", address.telephone)]
                    .compactMap(\.self)
                if !fields.isEmpty { others.append((.address, "", fields)) }
            case .wifi(let wifi):
                document("Wi-Fi", [custom("Network name", wifi.ssid), custom("Password", wifi.passphrase, secret: true),
                                   custom("Security", wifi.networkSecurityType), custom("Hidden network", wifi.hidden)])
            case .apiKey(let key):
                document("API key", [custom("Key", key.key, secret: true), custom("Username", key.userName), custom("Key type", key.keyType),
                                     custom("Website", key.url), custom("Valid from", key.validFrom), custom("Expiry date", key.expiryDate)])
            case .driversLicense(let license):
                document("Driver’s license", [custom("Full name", license.fullName), custom("License number", license.licenseNumber),
                    custom("License class", license.licenseClass), custom("Birth date", license.birthDate), custom("Issue date", license.issueDate),
                    custom("Expiry date", license.expiryDate), custom("Issuing authority", license.issuingAuthority),
                    custom("Region", license.territory), custom("Country", license.country)])
            case .identityDocument(let id):
                document("Identity document", [custom("Full name", id.fullName), custom("Document number", id.documentNumber, secret: true),
                    custom("Identification number", id.identificationNumber, secret: true), custom("Issuing country", id.issuingCountry),
                    custom("Nationality", id.nationality), custom("Birth date", id.birthDate), custom("Birth place", id.birthPlace),
                    custom("Sex", id.sex), custom("Issue date", id.issueDate), custom("Expiry date", id.expiryDate),
                    custom("Issuing authority", id.issuingAuthority)])
            case .passport(let passport):
                document("Passport", [custom("Full name", passport.fullName), custom("Passport number", passport.passportNumber, secret: true),
                    custom("National identification number", passport.nationalIdentificationNumber, secret: true),
                    custom("Passport type", passport.passportType), custom("Issuing country", passport.issuingCountry),
                    custom("Nationality", passport.nationality), custom("Birth date", passport.birthDate), custom("Birth place", passport.birthPlace),
                    custom("Sex", passport.sex), custom("Issue date", passport.issueDate), custom("Expiry date", passport.expiryDate),
                    custom("Issuing authority", passport.issuingAuthority)])
            case .personName(let name):
                document("Name", [custom("Title", name.title), custom("Given name", name.given), custom("Informal name", name.givenInformal),
                    custom("Middle name", name.given2), custom("Surname prefix", name.surnamePrefix), custom("Surname", name.surname),
                    custom("Second surname", name.surname2), custom("Generation", name.generation), custom("Credentials", name.credentials)])
            case .sshKey(let ssh):
                let data = ssh.privateKey.count <= maxValueBytes / 2 ? ssh.privateKey.base64EncodedString() : ""
                if data.isEmpty, !ssh.privateKey.isEmpty { tooLong = true }
                var fields = [custom("Creation date", ssh.creationDate), custom("Expiry date", ssh.expiryDate),
                              custom("Source", ssh.keyGenerationSource)].compactMap(\.self)
                if !data.isEmpty { fields.insert(ImportField(.custom, label: "Private key", value: data, concealed: true), at: 0) }
                if !ssh.keyType.isEmpty { fields.append(ImportField(.custom, label: "Key type", value: short(ssh.keyType))) }
                if let comment = ssh.keyComment, !comment.isEmpty { fields.append(ImportField(.custom, label: "Comment", value: text(comment))) }
                if !fields.isEmpty { others.append((.custom, "SSH key", fields)) }
            case .itemReference:
                // A link to another item, which arrives on its own.
                continue
            @unknown default:
                tell(.unknownKind, String(localized: "part of this item is of a type Psss does not know and was not imported. It stays in Apple Passwords."))
            }
        }

        let created = source.created ?? source.lastModified ?? now
        let modified = source.lastModified ?? created
        var tags = source.tags.prefix(100).map(short).filter { !$0.isEmpty }
        if source.favorite { tags.append("Favorite") }
        let noteText = notes.joined(separator: "\n\n")

        var built: [ImportItem] = []
        func make(_ kind: ImportItemKind, _ name: String, _ fields: [ImportField], passkey: PasskeyRecord? = nil) {
            built.append(ImportItem(sourceID: nil, kind: kind, title: name, fields: fields, tags: tags, created: created, modified: modified,
                                    passkey: passkey))
        }

        // Logins: each password and each passkey. A passkey joins the password of the same user name, else the first password
        // without one when the names do not say, else it is a login of its own.
        var logins: [(user: String, password: String, passkey: PasskeyRecord?)] = passwords.map { ($0.user, $0.password, nil) }
        for passkey in passkeys {
            let free = logins.indices.filter { logins[$0].passkey == nil }
            let match = free.first { logins[$0].user.caseInsensitiveCompare(passkey.user) == .orderedSame }
                ?? (passkeys.count == 1 && passwords.count == 1 ? free.first : nil)
            if let match {
                logins[match].passkey = passkey.record
                if logins[match].user.isEmpty { logins[match].user = passkey.user }
            } else {
                logins.append((passkey.user, "", passkey.record))
            }
        }
        if logins.isEmpty, !codes.isEmpty { logins.append(("", "", nil)) }
        // Only a code says nothing about who signs in, so the code's own account stands in.
        if logins.count > maxLoginsPerItem {
            tell(.skippedRow, String(localized: "this item holds more sign-ins than Psss imports from one item. The rest stay in Apple Passwords."))
            logins = Array(logins.prefix(maxLoginsPerItem))
        }
        for (index, login) in logins.enumerated() {
            var fields: [ImportField] = []
            if !login.user.isEmpty { fields.append(ImportField(.username, value: login.user)) }
            if !login.password.isEmpty { fields.append(ImportField(.password, value: login.password, concealed: true)) }
            var places = sites
            if places.isEmpty, let rp = login.passkey?.rpID { places = ["https://" + rp] }
            fields += places.map { ImportField(.website, value: $0) }
            if index == 0 {
                if let first = codes.first { fields.append(first) }
                for (n, code) in codes.dropFirst().enumerated() {
                    fields.append(ImportField(.custom, label: "One-time code \(n + 2)", value: code.value, concealed: true))
                    tell(.extraCode, String(localized: "it has a second verification code setup. Psss kept it, but it is not used for signing in."))
                }
                if !noteText.isEmpty { fields.append(ImportField(.notes, value: noteText)) }
                fields += extras
                for password in generated where !passwords.contains(where: { $0.password == password }) {
                    fields.append(ImportField(.custom, label: "Generated password", value: password, concealed: true))
                }
            }
            make(.login, title, fields, passkey: login.passkey)
        }

        // What is not a sign-in becomes its own item. Without a login, notes and extra fields go with the first of them.
        var spareNotes = logins.isEmpty ? noteText : ""
        var spare = logins.isEmpty ? extras + generated.map { ImportField(.custom, label: "Generated password", value: $0, concealed: true) } : []
        var spareSites = logins.isEmpty ? sites.map { ImportField(.website, value: $0) } : []
        for other in others {
            var fields = other.fields
            if !spareNotes.isEmpty { fields.append(ImportField(.notes, value: spareNotes)); spareNotes = "" }
            fields += spare + spareSites
            spare = []
            spareSites = []
            let name = title.isEmpty ? other.suffix : (built.isEmpty || other.suffix.isEmpty ? title : "\(title) (\(other.suffix))")
            make(other.kind, name, fields)
        }
        if logins.isEmpty, others.isEmpty {
            var fields = spare
            if !spareNotes.isEmpty { fields.append(ImportField(.notes, value: spareNotes)) }
            if !fields.isEmpty { make(spare.isEmpty ? .note : .custom, title, fields + spareSites) }
        }

        if tooLong { tell(.unreadableValue, String(localized: "a value is too long to import and is left out. It stays in Apple Passwords.")) }
        guard !built.isEmpty else {
            plan.skipped.rows += 1
            if issues.isEmpty { tell(.skippedRow, String(localized: "it holds nothing Psss can import, so it was not imported")) }
            plan.issues += issues
            return
        }
        if source.created == nil, source.lastModified == nil { plan.missingDates += 1 }
        built[0].issues = issues
        for var item in built {
            item.sanitize(app: "Apple Passwords")
            item.sourceID = AppleImport.identifier(item)
            plan.items.append(item)
        }
    }

    /// A title, label or name: one line of a sensible length.
    private static func short(_ text: String) -> String {
        String(text.prefix(1000)).components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `2027-04` (the exchange format's month) as `04/27`, anything else as written.
    static func cardExpiry(_ text: String) -> String {
        let parts = text.split(separator: "-")
        guard parts.count >= 2, parts[0].count == 4, let year = Int(parts[0]), (2000...2099).contains(year),
              let month = Int(parts[1]), (1...12).contains(month) else { return text }
        return String(format: "%02d/%02d", month, year % 100)
    }

    /// RFC 4648 Base32 without padding, as authenticator setup keys are written.
    static func base32(_ data: Data) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var out = "", buffer = 0, bits = 0
        for byte in data {
            buffer = (buffer << 8) | Int(byte)
            bits += 8
            while bits >= 5 { bits -= 5; out.append(alphabet[(buffer >> bits) & 31]) }
            buffer &= (1 << bits) - 1
        }
        if bits > 0 { out.append(alphabet[(buffer << (5 - bits)) & 31]) }
        return out
    }
}
