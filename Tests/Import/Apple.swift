import AuthenticationServices
import CryptoKit
import Foundation

// Import from Apple Passwords: the direct move (`AppleCredentialExchange`), its CSV file, the rules that never replace what is
// saved (`AppleImport`), the words (`AppleImportText`) and `VaultSession.create(plan:)`. Called from main.swift before the
// check that every issue kind has a fixture. Every value here is made up.

private typealias Credential = ASImportableCredential

private func text(_ value: String, _ label: String? = nil, _ type: ASImportableEditableField.FieldType = .string) -> ASImportableEditableField {
    ASImportableEditableField(id: nil, fieldType: type, value: value, label: label)
}
private func hidden(_ value: String, _ label: String? = nil) -> ASImportableEditableField { text(value, label, .concealedString) }
private func basic(_ user: String, _ password: String) -> Credential {
    .basicAuthentication(.init(userName: text(user), password: hidden(password)))
}
private func note(_ content: String) -> Credential { .note(.init(content: text(content))) }
private func totp(_ secret: Data, period: UInt16 = 30, digits: UInt16 = 6, algorithm: Credential.TOTP.Algorithm = .sha1,
                  user: String? = nil, issuer: String? = nil) -> Credential {
    .totp(.init(secret: secret, period: period, digits: digits, userName: user, algorithm: algorithm, issuer: issuer))
}
private func passkey(_ key: P256.Signing.PrivateKey, id: Data, rp: String = "example.com", user: String = "alice",
                     handle: Data = Data("handle-alice".utf8)) -> Credential {
    .passkey(.init(credentialID: id, relyingPartyIdentifier: rp, userName: user, userDisplayName: user, userHandle: handle, key: key.derRepresentation))
}
private func rawPasskey(_ keyData: Data, id: Data = Data("bad-cred".utf8), rp: String = "bad.example.com", handle: Data = Data("h".utf8)) -> Credential {
    .passkey(.init(credentialID: id, relyingPartyIdentifier: rp, userName: "bob", userDisplayName: "bob", userHandle: handle, key: keyData))
}
private func credentialItem(_ title: String, _ sites: [String] = [], _ credentials: [Credential], favorite: Bool = false, tags: [String] = [],
                            created: Date? = Date(timeIntervalSince1970: 1_700_000_000)) -> ASImportableItem {
    ASImportableItem(id: Data(UUID().uuidString.utf8), created: created, lastModified: created, title: title, favorite: favorite,
                     scope: sites.isEmpty ? nil : ASImportableCredentialScope(urls: sites.compactMap { URL(string: $0) }),
                     credentials: credentials, tags: tags)
}
private func export(_ items: [ASImportableItem]) -> ASExportedCredentialData {
    ASExportedCredentialData(accounts: [ASImportableAccount(id: Data("acct".utf8), userName: "u", email: "u@example.com", collections: [], items: items)],
                             formatVersion: .v1, exporterRelyingPartyIdentifier: "apple.com", exporterDisplayName: "Passwords", timestamp: now)
}
private func direct(_ items: [ASImportableItem]) throws -> ImportPlan { try AppleCredentialExchange.plan(from: export(items), now: now) }
private func appleCSV(_ rows: [[String]]) throws -> ImportPlan {
    func quote(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
    let lines = [["Title", "URL", "Username", "Password", "Notes", "OTPAuth"]] + rows
    return try CSVSource.plan(from: lines.map { $0.map(quote).joined(separator: ",") }.joined(separator: "\n") + "\n", source: .applePasswords, now: now)
}

/// Where every item of a plan ended up. With nothing updated, the parts must add up to the plan.
private func fate(_ s: ImportSummary) -> Int {
    s.addedCount + s.updated + s.merged + s.duplicatesSkipped + issueCount(s.issues, .inRecycleBin) + s.deletedNotImported + s.refreshed
}
private func counts(_ s: ImportSummary) -> String {
    "added \(s.addedCount) merged \(s.merged) skipped \(s.duplicatesSkipped) similar \(s.similarAdded) bin \(issueCount(s.issues, .inRecycleBin)) deleted \(s.deletedNotImported)"
}
private func xml(_ d: KDBXDocument) -> String { String(decoding: XMLTree.serialize(d.root), as: UTF8.self) }

/// Preview, apply, and the two agree and add up. Returns the summary of the apply.
@discardableResult
private func importing(_ name: String, _ plan: ImportPlan, into vault: inout KDBXDocument) throws -> ImportSummary {
    let before = xml(vault)
    let preview = vault.preview(plan)
    expect("\(name): preview changes nothing", xml(vault) == before)
    let applied = try vault.apply(plan)
    expect("\(name): preview equals apply", preview == applied)
    if preview != applied { print("  preview \(preview)\n  applied \(applied)") }
    check("\(name): every plan item is accounted for", "\(fate(applied))", "\(plan.items.count)")
    return applied
}

/// A second import against the saved and reopened vault: it must neither say it adds anything nor change a byte of the tree.
private func addsNothing(_ name: String, _ plan: ImportPlan, _ vault: KDBXDocument) throws {
    var back = try reopen(vault)
    let before = xml(back)
    let s = try back.apply(plan)
    check("\(name): adds nothing", "added \(s.addedCount) merged \(s.merged) write \(s.needsWrite)", "added 0 merged 0 write false")
    expect("\(name): the vault is untouched", xml(back) == before)
}

/// The stored passkey signs and the signature verifies with the public key the site holds.
private func signs(_ name: String, _ node: XNode?, _ publicKey: P256.Signing.PublicKey, rp: String, id: Data) {
    guard let node, let record = EntryMapping.passkey(node) else { failures += 1; print("FAIL \(name): no passkey in the entry"); return }
    check("\(name): credential and relying party", "\(record.credentialID == id) \(record.rpID)", "true \(rp)")
    let hash = Data(SHA256.hash(data: Data("challenge".utf8)))
    guard let assertion = try? Passkeys.assert(record, relyingParty: rp, clientDataHash: hash),
          let signature = try? P256.Signing.ECDSASignature(derRepresentation: assertion.signature) else { failures += 1; print("FAIL \(name): could not sign"); return }
    expect("\(name): the signature verifies with the original public key", publicKey.isValidSignature(signature, for: assertion.authenticatorData + hash))
}

@MainActor
func appleImportChecks(writesWork: Bool) async throws {
    let key = P256.Signing.PrivateKey(), key2 = P256.Signing.PrivateKey()
    let credID = Data("credential-id-alice".utf8), credID2 = Data("credential-id-carol".utf8)
    let secretBytes = Data("12345678901234567890".utf8)
    let b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    let secrets = ["PW-alice-9f3k", "PW-bob-77aa", b32, "4000009999991234", "NOTE-private-text", "CVV-913", "PIN-4821", "WIFI-pass-zz", "SSH-secret-bytes",
                   "GENERATED-pw-31", "CUSTOM-hidden-55", "PASSPORT-X999", "APIKEY-abc123", key.rawRepresentation.base64EncodedString(),
                   key.derRepresentation.base64EncodedString(), key.rawRepresentation.base64URL, "otpauth://"]
    var said: [String] = []
    func hear(_ s: ImportSummary) {
        said += s.issues.flatMap { [$0.detail, $0.item ?? ""] }
        said += AppleImportText.checks(s.issues).shown.flatMap { [$0.title, $0.detail] }
        said.append(String(describing: s))
    }

    // MARK: Apple: base32, expiry

    check("apple base32: RFC 4648 vectors", ["f", "fo", "foo", "foob", "fooba", "foobar"].map { AppleCredentialExchange.base32(Data($0.utf8)) }.joined(separator: " "),
          "MY MZXQ MZXW6 MZXW6YQ MZXW6YTB MZXW6YTBOI")
    check("apple base32: the RFC 6238 seed", AppleCredentialExchange.base32(secretBytes), b32)
    expect("apple base32: random bytes of every length come back", (1...80).allSatisfy { let d = randomData($0); return TOTP.base32Decode(AppleCredentialExchange.base32(d)) == d })
    check("apple expiry", ["2027-04", "2027-4", "2027-12-31", "04/27", "1999-04", "2027-13", ""].map(AppleCredentialExchange.cardExpiry).joined(separator: "|"),
          "04/27|04/27|12/27|04/27|1999-04|2027-13|")

    // MARK: Apple: refused whole

    expectThrows("apple: no accounts", .empty) { _ = try AppleCredentialExchange.plan(from: ASExportedCredentialData(accounts: [], formatVersion: .v1, exporterRelyingPartyIdentifier: "a", exporterDisplayName: "b", timestamp: now)) }
    expectThrows("apple: an account without items", .empty) { _ = try direct([]) }
    do {
        let tiny = credentialItem("t", [], [])
        expectThrows("apple limits: 100,001 items are refused whole", .tooLarge) { _ = try direct(Array(repeating: tiny, count: 100_001)) }
        let split = ASExportedCredentialData(accounts: (0..<2).map { ASImportableAccount(id: Data([UInt8($0)]), userName: "u", email: "e", collections: [], items: Array(repeating: tiny, count: 50_001)) },
                                             formatVersion: .v1, exporterRelyingPartyIdentifier: "a", exporterDisplayName: "b", timestamp: now)
        expectThrows("apple limits: the limit counts all accounts together", .tooLarge) { _ = try AppleCredentialExchange.plan(from: split) }
    }

    // MARK: Apple: one of everything

    let all: [ASImportableItem] = [
        credentialItem("Alice site", ["https://example.com/login", "https://second.example.net"],
                       [basic("alice", "PW-alice-9f3k"), passkey(key, id: credID), totp(secretBytes, period: 60, digits: 8, algorithm: .sha256, user: "alice", issuer: "Example"),
                        note("NOTE-private-text"), .customFields(.init(label: "Questions", fields: [hidden("CUSTOM-hidden-55", "Pet")]))], favorite: true, tags: ["work"]),
        credentialItem("Passkey only", [], [passkey(key2, id: credID2, rp: "only.example.org", user: "carol")]),
        credentialItem("Code only", ["https://code.example.org"], [totp(secretBytes)]),
        credentialItem("A note", [], [note("NOTE-private-text two")]),
        credentialItem("Card", [], [.creditCard(.init(number: hidden("4000009999991234"), fullName: text("Alice A"), cardType: text("Visa"), verificationNumber: hidden("CVV-913"),
                                                      pin: hidden("PIN-4821"), expiryDate: text("2027-04", nil, .yearMonth), validFrom: nil))]),
        credentialItem("Home", [], [.address(.init(streetAddress: text("1 Road"), postalCode: text("LV-1000"), city: text("Riga"), territory: nil, country: text("LV"), telephone: nil))]),
        credentialItem("Router", [], [.wifi(.init(ssid: text("net"), networkSecurityType: text("WPA3"), passphrase: hidden("WIFI-pass-zz")))]),
        credentialItem("Key", [], [.apiKey(.init(key: hidden("APIKEY-abc123"), userName: text("svc"), keyType: nil, url: nil, validFrom: nil, expiryDate: nil))]),
        credentialItem("Licence", [], [.driversLicense(.init(fullName: text("Alice"), birthDate: nil, issueDate: nil, expiryDate: nil, issuingAuthority: nil, territory: nil, country: nil, licenseNumber: text("DL1"), licenseClass: nil))]),
        credentialItem("ID", [], [.identityDocument(.init(issuingCountry: text("LV"), documentNumber: hidden("PASSPORT-X999"), identificationNumber: nil, nationality: nil, fullName: nil, birthDate: nil, birthPlace: nil, sex: nil, issueDate: nil, expiryDate: nil, issuingAuthority: nil))]),
        credentialItem("Passport", [], [.passport(.init(issuingCountry: text("LV"), passportType: nil, passportNumber: hidden("PASSPORT-X999"), nationalIdentificationNumber: nil, nationality: nil, fullName: nil, birthDate: nil, birthPlace: nil, sex: nil, issueDate: nil, expiryDate: nil, issuingAuthority: nil))]),
        credentialItem("Name", [], [.personName(.init(title: nil, given: text("Alice"), givenInformal: nil, given2: nil, surnamePrefix: nil, surname: text("Able"), surname2: nil, credentials: nil, generation: nil))]),
        credentialItem("SSH", [], [.sshKey(.init(keyType: "ed25519", privateKey: Data("SSH-secret-bytes".utf8), keyComment: "me", creationDate: nil, expiryDate: nil, keyGenerationSource: nil))]),
        credentialItem("Generated", [], [.generatedPassword(.init(password: "GENERATED-pw-31"))]),
        credentialItem("Nothing", ["https://nothing.example.com"], []),
        credentialItem("Empty basic", [], [basic("", "")]),
        credentialItem("Only a link", [], [.itemReference(.init(reference: ASImportableLinkedItem(item: Data("x".utf8))))]),
        credentialItem("", [], [])
    ]
    let allPlan = try direct(all)
    check("apple: every record is counted", "\(allPlan.recordCount) \(allPlan.source)", "\(all.count) applePasswords")
    for source in all {
        let arrived = allPlan.items.contains { $0.title == source.title } || allPlan.issues.contains { $0.item == (source.title.isEmpty ? nil : source.title) }
        expect("apple: '\(source.title)' is an item or is listed", arrived)
    }
    check("apple: items and skipped", "\(allPlan.items.count) \(allPlan.skipped.rows) \(allPlan.issues.count)", "14 4 4")
    check("apple: kinds", "\(allPlan.summary.logins) \(allPlan.summary.cards) \(allPlan.summary.addresses) \(allPlan.summary.notes) \(allPlan.summary.others)", "3 1 1 1 8")
    hear(allPlan.summary)

    var vault = try emptyVault("Apple")
    let first = try importing("apple all", allPlan, into: &vault)
    hear(first)
    check("apple all: counts", counts(first), "added 14 merged 0 skipped 0 similar 0 bin 0 deleted 0")
    check("apple all: skipped rows are reported", "\(first.rowsSkipped) \(issueCount(first.issues, .skippedRow))", "4 4")
    var back = try reopen(vault)
    signs("apple all: Alice after save and reopen", entry(back, "Alice site"), key.publicKey, rp: "example.com", id: credID)
    signs("apple all: passkey only", entry(back, "Passkey only"), key2.publicKey, rp: "only.example.org", id: credID2)
    if let node = entry(back, "Alice site") {
        let s = strings(node)
        check("apple all: login fields", "\(s["UserName"]?.value ?? "") \(s["Password"]?.value ?? "") \(s["Password"]?.protected ?? false) \(s["URL"]?.value ?? "") \(s["KP2A_URL"]?.value ?? "")",
              "alice PW-alice-9f3k true https://example.com/login https://second.example.net")
        check("apple all: notes, custom field and protection", "\(s["Notes"]?.value ?? "") \(s["Pet"]?.value ?? "") \(s["Pet"]?.protected ?? false)", "NOTE-private-text CUSTOM-hidden-55 true")
        check("apple all: passkey attributes", "\(s["KPEX_PASSKEY_USERNAME"]?.value ?? "") \(s["KPEX_PASSKEY_USER_HANDLE"]?.value == Data("handle-alice".utf8).base64URL) \(s["KPEX_PASSKEY_PRIVATE_KEY_PEM"]?.protected ?? false) \(s["otp"]?.protected ?? false)",
              "alice true true true")
        check("apple all: tags and favourite", node.child("Tags")?.text ?? "", "work;Favorite")
        if case .setup(let setup) = TOTP.parse(s["otp"]?.value ?? "") {
            check("apple all: the code setup", "\(setup.secret) \(setup.settings.digits) \(setup.settings.period) \(setup.settings.algorithm.rawValue) \(setup.issuer) \(setup.account)", "\(b32) 8 60 SHA256 Example alice")
        } else { failures += 1; print("FAIL apple all: the code did not read back") }
    }
    check("apple all: a passkey-only login gets the relying party as its site", EntryMapping.string(entry(back, "Passkey only") ?? XNode("Entry"), "URL") ?? "", "https://only.example.org")
    if let item = vaultItem(back, titled: "Alice site") {
        check("apple all: the app reads the item", "\(item.kind) \(item.passkey != nil) \(item.otpSecret)", "login true \(b32)")
    }
    if let card = entry(back, "Card").map(strings) {
        check("apple all: the card", "\(card["Password"]?.value ?? "") \(card["Expiry"]?.value ?? "") \(card["PIN"]?.value ?? "") \(card["PIN"]?.protected ?? false) \(card["Security code"]?.protected ?? false)",
              "4000009999991234 04/27 PIN-4821 true true")
    }
    check("apple all: secrets of documents are protected", ["Router/Password", "Key/Key", "ID/Document number", "Passport/Passport number", "SSH/Private key", "Generated/Generated password"].map { path in
        let p = path.split(separator: "/").map(String.init)
        return "\(entry(back, p[0]).flatMap { strings($0)[p[1]]?.protected } ?? false)"
    }.joined(separator: " "), "true true true true true true")
    try addsNothing("apple all: the same move again", try direct(all), vault)
    try addsNothing("apple all: the same plan again", allPlan, vault)
    var second = back
    let again = try importing("apple all again", try direct(all), into: &second)
    check("apple all again: everything is already there", counts(again), "added 0 merged 0 skipped 14 similar 0 bin 0 deleted 0")
    hear(again)

    // MARK: Apple: passkeys the vault cannot use, and extensions

    do {
        let p384 = P384.Signing.PrivateKey().derRepresentation
        let ed = Data([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]) + randomData(32)
        let bad: [(String, Credential)] = [("p384", rawPasskey(p384)), ("ed25519", rawPasskey(ed)), ("empty key", rawPasskey(Data())), ("garbage", rawPasskey(randomData(1200))),
            ("truncated", rawPasskey(key.derRepresentation.prefix(40))), ("huge key", rawPasskey(Data(count: (1 << 20) + 1))), ("empty id", rawPasskey(key.derRepresentation, id: Data())),
            ("long id", rawPasskey(key.derRepresentation, id: Data(count: 1024))), ("long handle", rawPasskey(key.derRepresentation, handle: Data(count: 1024))),
            ("no site", rawPasskey(key.derRepresentation, rp: ""))]
        for (name, credential) in bad {
            let p = try direct([credentialItem("Bad \(name)", [], [credential])])
            check("apple passkey \(name): not imported and listed", "\(p.items.count) \(p.skipped.rows) \(issueCount(p.issues, .passkeyNotImported))", "0 1 1")
            let with = try direct([credentialItem("Bad \(name) with password", ["https://bad.example.com"], [basic("bob", "PW-bob-77aa"), credential])])
            check("apple passkey \(name): the password still arrives, and it is listed", "\(with.items.count) \(with.items.first?.passkey == nil) \(issueCount(with.summary.issues, .passkeyNotImported))", "1 true 1")
            hear(p.summary); hear(with.summary)
        }
        let atLimit = try direct([credentialItem("Limit id", [], [rawPasskey(key.derRepresentation, id: Data(count: 1023), handle: Data(count: 1023))])])
        check("apple passkey: 1023 bytes of identifier and handle are accepted", "\(atLimit.items.count)", "1")
        let noHandle = try direct([credentialItem("No handle", [], [rawPasskey(key.derRepresentation, handle: Data())])])
        var v = try emptyVault(); try v.apply(noHandle)
        signs("apple passkey: an empty user handle", entry(try reopen(v), "No handle"), key.publicKey, rp: "bad.example.com", id: Data("bad-cred".utf8))
        try addsNothing("apple passkey: an empty user handle again", noHandle, v)

        if #available(macOS 26.4, *) {
            let extended = Credential.passkey(.init(credentialID: credID, relyingPartyIdentifier: "example.com", userName: "alice", userDisplayName: "alice",
                userHandle: Data("h".utf8), key: key.derRepresentation, fido2Extensions: ASImportableFIDO2Extensions(largeBlob: ASImportableFIDO2LargeBlob(uncompressedSize: 3, data: Data([1, 2, 3])))))
            let p = try direct([credentialItem("Extended", [], [extended])])
            check("apple passkey: extra data is left out and said", "\(p.items.first?.passkey != nil) \(issueCount(p.summary.issues, .passkeyReduced))", "true 1")
            var e = try emptyVault(); let s = try e.apply(p); hear(s)
            check("apple passkey: and said after the apply", "\(issueCount(s.issues, .passkeyReduced))", "1")
        } else { print("SKIP apple passkey extensions: needs macOS 26.4") }

        // Already there by password, but the passkey (or another part) could not come: the person must still be told.
        var held = try emptyVault()
        try held.apply(try appleCSV([["Held", "https://bad.example.com", "bob", "PW-bob-77aa", "", ""]]))
        let move = try direct([credentialItem("Held", ["https://bad.example.com"], [basic("bob", "PW-bob-77aa"), rawPasskey(p384)])])
        let s = try importing("apple: unusable passkey on a login already saved", move, into: &held)
        check("apple: unusable passkey on a login already saved is still listed", "skipped \(s.duplicatesSkipped) told \(issueCount(s.issues, .passkeyNotImported))", "skipped 1 told 1")
        let longMove = try direct([credentialItem("Held", ["https://bad.example.com"], [basic("bob", String(repeating: "L", count: (1 << 20) + 1))])])
        let l = held.preview(longMove)
        check("apple: a password too long to import, on a login already saved, is still listed", "told \(issueCount(l.issues, .unreadableValue))", "told 1")

        // A login that is not added (already there, binned or deleted) lists what could not come, not remarks on how it would be saved.
        let both = try direct([credentialItem("Both", ["https://both.example.com"], [basic("bob", "PW-bob-77aa"), totp(Data("abc".utf8)), rawPasskey(p384)])])
        func told(_ s: ImportSummary) -> String { "code \(issueCount(s.issues, .unreadableCode)) passkey \(issueCount(s.issues, .passkeyNotImported))" }
        var first = try emptyVault()
        let one = try importing("apple second import, first", both, into: &first)
        check("apple second import: the first lists the code and the passkey", told(one), "code 1 passkey 1")
        var back = try reopen(first)
        let two = try importing("apple second import, again", both, into: &back)
        check("apple second import: the unreadable code is not listed, the passkey is", "skipped \(two.duplicatesSkipped) \(told(two))", "skipped 1 code 0 passkey 1")
        var binned = try reopen(first)
        moveToBin(binned, "Both")
        let bin = try importing("apple second import, binned", both, into: &binned)
        check("apple second import: binned, the same", "bin \(issueCount(bin.issues, .inRecycleBin)) \(told(bin))", "bin 1 code 0 passkey 1")
        var gone = try reopen(first)
        gone.deletePermanently(gone.items().map(\.id))
        let del = try importing("apple second import, deleted", both, into: &gone)
        check("apple second import: deleted for good, the same", "deleted \(del.deletedNotImported) \(told(del))", "deleted 1 code 0 passkey 1")
    }

    // MARK: Apple: codes

    do {
        let p = try direct([credentialItem("Short secret", [], [totp(Data("abc".utf8))]), credentialItem("Empty secret", ["https://e.example.com"], [basic("u", "p"), totp(Data())]),
                            credentialItem("Long secret", [], [totp(Data(count: 1025))]), credentialItem("Nine digits", [], [totp(secretBytes, digits: 9)]),
                            credentialItem("Zero period", [], [totp(secretBytes, period: 0)])])
        check("apple codes: every refused or kept code is listed", "\(issueCount(p.summary.issues, .unreadableCode)) \(p.items.count)", "5 4")
        hear(p.summary)
        var v = try emptyVault(); hear(try v.apply(p)); try addsNothing("apple codes: refused codes again", p, v)
        for period: UInt16 in [3600, 3601, 65535] {
            let q = try direct([credentialItem("Period \(period)", ["https://p.example.com"], [basic("u\(period)", "pw"), totp(secretBytes, period: period)])])
            var w = try emptyVault()
            let s = try w.apply(q)
            let strings = entry(w, "Period \(period)").map(strings) ?? [:]
            expect("apple codes: a period of \(period) s is either the entry's code or listed (otp \(strings["otp"] != nil), listed \(issueCount(s.issues, .unreadableCode)))",
                   strings["otp"] != nil || issueCount(s.issues, .unreadableCode) == 1)
        }
        let two = try direct([credentialItem("Two codes", ["https://two.example.com"], [basic("u", "pw"), totp(secretBytes), totp(Data("abcdefghij0123456789".utf8))])])
        var w = try emptyVault(); let s = try w.apply(two); hear(s)
        check("apple codes: a second code is kept hidden and said", "\(issueCount(s.issues, .extraCode)) \(entry(w, "Two codes").map(strings)?["One-time code 2"]?.protected ?? false)", "1 true")
        try addsNothing("apple codes: two codes again", two, w)
    }

    // MARK: Apple: several sign-ins in one item, and parts that must not vanish

    do {
        let many = try direct([credentialItem("Many", ["https://many.example.com"], (0..<51).map { basic("user\($0)", "pw\($0)") })])
        check("apple many: 50 logins, and the rest is listed", "\(many.items.count) \(issueCount(many.summary.issues, .skippedRow))", "50 1")
        hear(many.summary)
        let pair = try direct([credentialItem("Pair", ["https://pair.example.com"], [basic("a", "1"), basic("b", "2"), passkey(key, id: credID, rp: "pair.example.com", user: "B")])])
        check("apple pairing: a passkey joins the password of its user name", pair.items.map { "\($0.username):\($0.passkey != nil)" }.joined(separator: " "), "a:false b:true")
        let loose = try direct([credentialItem("Loose", ["https://l.example.com"], [basic("a", "1"), basic("b", "2"), passkey(key, id: credID, rp: "l.example.com", user: "z")])])
        check("apple pairing: an unknown name is a login of its own", loose.items.map { "\($0.username):\($0.passkey != nil)" }.joined(separator: " "), "a:false b:false z:true")
        let mixed = try direct([credentialItem("Mixed", ["https://m.example.com"], [basic("a", "1"), .wifi(.init(ssid: text("s"), networkSecurityType: nil, passphrase: hidden("w")))])])
        check("apple mixed: a login and a named second item", mixed.items.map(\.title).joined(separator: " | "), "Mixed | Mixed (Wi-Fi)")
        // A note or card with a website: the site is kept or the person is told.
        for (name, credential) in [("note", note("body")), ("Wi-Fi", Credential.wifi(.init(ssid: text("s"), networkSecurityType: nil, passphrase: nil))), ("generated password", .generatedPassword(.init(password: "g")))] {
            let p = try direct([credentialItem("Sited \(name)", ["https://sited.example.com"], [credential])])
            expect("apple: the website of a \(name) item is kept or listed", p.items.contains { $0.websites.contains("https://sited.example.com") } || !p.summary.issues.isEmpty)
        }
    }

    // MARK: Apple: hostile text and sizes

    do {
        let bidi = "\u{202E}gpj.exe\u{2066}../../etc\n\r\nsecond line"
        let long = String(repeating: "T", count: 100_000)
        let hostile = [credentialItem(bidi, ["https://h.example.com"], [basic("h", "pw\u{1}control\u{FFFF}")]),
                       credentialItem(long, ["https://long.example.com"], [basic("l", "pw")]),
                       credentialItem("../../../tmp/x", [], [note("n")]),
                       credentialItem(bidi + " empty", [], []),
                       credentialItem("Hostile labels", ["https://lab.example.com"], [basic("h", "real-password"),
                           .customFields(.init(label: "g", fields: [hidden("v1", "Password"), hidden("v2", "KPEX_PASSKEY_PRIVATE_KEY_PEM"), text("custom", "PSSS_TYPE"), hidden("v4", "otp"),
                                                                    hidden("sec\u{FFFF}ret", "\u{202E}label\u{2066}" + String(repeating: "L", count: 900))]))]),
                       credentialItem("Control user", ["https://ctl.example.com"], [basic("u\u{0}ser\r\nx", "line1\r\nline2\ttab"), note("a\r\nb\u{B}c")])]
        let p = try direct(hostile)
        var v = try emptyVault()
        let s = try importing("apple hostile", p, into: &v)
        hear(s)
        check("apple hostile: all arrive", "\(p.items.count) \(p.skipped.rows)", "5 1")
        expect("apple hostile: titles are one line of at most 1000", p.items.allSatisfy { !$0.title.contains("\n") && !$0.title.contains("\r") && $0.title.count <= 1000 }
               && s.issues.allSatisfy { ($0.item?.count ?? 0) <= 1000 && !($0.item ?? "").contains("\n") })
        check("apple hostile: a changed password is said", "\(s.secretsChanged >= 2)", "true")
        let shown = AppleImportText.checks(s.issues).shown
        let dirty: (String) -> Bool = { $0.unicodeScalars.contains { [0x202E, 0x2066, 0x0A, 0x0D, 0x01, 0xFFFF].contains($0.value) } }
        expect("apple hostile: shown titles are safe and short", shown.allSatisfy { !dirty($0.title) && $0.title.count <= 80 })
        check("apple hostile: no shown detail holds a bidi or control character", shown.filter { dirty($0.detail) }.map { String($0.detail.unicodeScalars.map { $0.isASCII && $0.value >= 32 ? String($0) : "<\(String($0.value, radix: 16))>" }.joined().prefix(60)) }.joined(separator: " | "), "")
        check("apple hostile: no shown detail is longer than 300 characters", "\(shown.map(\.detail.count).max() ?? 0 > 300 ? "longest \(shown.map(\.detail.count).max() ?? 0)" : "ok")", "ok")
        let r = try reopen(v)
        if let node = entry(r, "Hostile labels") {
            let m = strings(node)
            check("apple hostile: custom labels cannot take a standard or passkey name", "\(m["Password"]?.value ?? "") \(m["KPEX_PASSKEY_PRIVATE_KEY_PEM"] == nil) \(m["otp"] == nil) \(m["Password (2)"]?.value ?? "") \(EntryMapping.passkey(node) == nil)", "real-password true true v1 true")
        } else { failures += 1; print("FAIL apple hostile: the labelled entry is missing") }
        try addsNothing("apple hostile: again after save and reopen", p, v)

        let max = String(repeating: "m", count: 1 << 20), over = max + "m"
        let sizes = try direct([credentialItem("Exactly", ["https://x.example.com"], [basic("u", max)]), credentialItem("Over", ["https://o.example.com"], [basic("u", over), note(over)]),
                                credentialItem("Over only", [], [note(over)]), credentialItem("Over ssh", [], [.sshKey(.init(keyType: "rsa", privateKey: Data(count: 600_000), keyComment: nil, creationDate: nil, expiryDate: nil, keyGenerationSource: nil))])])
        check("apple sizes: 1 MiB is kept, more is left out", "\(item(sizes, "Exactly")?.password.utf8.count ?? -1) \(item(sizes, "Over")?.password.utf8.count ?? -1) \(item(sizes, "Over")?.first(.notes) == nil) \(item(sizes, "Over only") == nil)", "1048576 0 true true")
        check("apple sizes: each is listed", "\(issueCount(sizes.summary.issues, .unreadableValue))", "3")
        hear(sizes.summary)
        var big = try emptyVault(); try big.apply(sizes); try addsNothing("apple sizes: again", sizes, big)

        let dates = try direct([credentialItem("Far", ["https://d.example.com"], [basic("u", "p")], created: Date(timeIntervalSince1970: 1e18)), credentialItem("No date", [], [note("n")], created: nil)])
        var dv = try emptyVault(); try dv.apply(dates)
        check("apple dates: odd and missing dates do not trap", "\(try reopen(dv).items().count) \(dates.missingDates)", "2 1")

        // A note that is part of another note under the same title is a different note.
        let notes = try direct([credentialItem("Codes", [], [note("recovery 1234 5678")]), credentialItem("Codes", [], [note("recovery 1234")])])
        var nv = try emptyVault()
        let ns = try nv.apply(notes)
        check("apple notes: two different notes with one title are both added", "\(ns.addedCount)", "2")
    }

    // MARK: Apple: nothing saved is replaced

    do {
        var v = try emptyVault("Saved")
        var typed = VaultItem(kind: .login, title: "My bank", account: "alice", website: "https://example.com", secret: "PW-alice-9f3k")
        typed.notes = "my own note"
        v.upsert([typed])
        let move = try direct([credentialItem("example.com", ["https://example.com"], [basic("alice", "PW-alice-9f3k"), passkey(key, id: credID), totp(secretBytes), note("from apple"),
                                                                                         .customFields(.init(label: "g", fields: [hidden("v", "Pet")]))])])
        let before = strings(entry(v, "My bank")!)
        let s = try importing("apple fill", move, into: &v)
        hear(s)
        check("apple fill: one login gains what it lacks", counts(s), "added 0 merged 1 skipped 0 similar 0 bin 0 deleted 0")
        let r = try reopen(v)
        let node = entry(r, "My bank")!
        let after = strings(node)
        check("apple fill: title, user, password and site are as they were", ["Title", "UserName", "Password", "URL"].map { "\(after[$0]?.value == before[$0]?.value)" }.joined(separator: " "), "true true true true")
        check("apple fill: notes are added under, code and field are added", "\(after["Notes"]?.value ?? "") | \(after["otp"] != nil) \(after["Pet"]?.value ?? "")", "my own note\n\nfrom apple | true v")
        signs("apple fill: the added passkey", node, key.publicKey, rp: "example.com", id: credID)
        let history = node.child("History")?.children ?? []
        check("apple fill: one history record, the version before", "\(history.count) \(history.first.map { EntryMapping.passkey($0) == nil && EntryMapping.string($0, "Notes") == "my own note" && EntryMapping.string($0, "otp") == nil } ?? false)", "1 true")
        try addsNothing("apple fill: again", move, v)

        let other = try direct([credentialItem("example.com", ["https://example.com"], [basic("alice", "PW-bob-77aa")])])
        let o = try importing("apple different password", other, into: &v)
        hear(o)
        check("apple different password: added beside and listed", "\(counts(o)) told \(issueCount(o.issues, .similarLogin))", "added 1 merged 0 skipped 0 similar 1 bin 0 deleted 0 told 1")
        check("apple different password: the saved one is as it was", strings(entry(try reopen(v), "My bank")!)["Password"]?.value ?? "", "PW-alice-9f3k")
        try addsNothing("apple different password: again", other, v)

        let otherKey = try direct([credentialItem("example.com", ["https://example.com"], [basic("alice", "PW-alice-9f3k"), passkey(key2, id: credID2),
                                                                                              totp(Data("abcdefghij0123456789".utf8))])])
        let k = try importing("apple different passkey", otherKey, into: &v)
        check("apple different passkey and code: added beside, listed", "added \(k.addedCount) merged \(k.merged) told \(issueCount(k.issues, .similarLogin))", "added 1 merged 0 told 1")
        signs("apple different passkey: the first still signs", entry(v, "My bank"), key.publicKey, rp: "example.com", id: credID)

        // Another app's passkey this app cannot read is never written over.
        var u = try emptyVault()
        u.upsert([VaultItem(kind: .login, title: "Foreign", account: "alice", website: "https://example.com", secret: "")])
        let foreign = entry(u, "Foreign")!
        foreign.children.append(XNode("String", children: [XNode("Key", text: "KPEX_PASSKEY_PRIVATE_KEY_PEM"), XNode("Value", text: "unreadable")]))
        let f = try u.apply(try direct([credentialItem("Foreign", ["https://example.com"], [passkey(key, id: credID)])]))
        check("apple foreign passkey: kept, the new one is added beside", "\(f.addedCount) \(f.merged) \(strings(entry(u, "Foreign")!)["KPEX_PASSKEY_PRIVATE_KEY_PEM"]?.value ?? "")", "1 0 unreadable")

        // A custom value that equals a standard value of the entry still arrives, and once.
        var d = try emptyVault()
        d.upsert([VaultItem(kind: .login, title: "Mail", account: "alice@example.com", website: "https://mail.example.com", secret: "pw")])
        let mail = try direct([credentialItem("Mail", ["https://mail.example.com"], [basic("alice@example.com", "pw"), .customFields(.init(label: "g", fields: [text("alice@example.com", "Recovery email")]))])])
        let m = try d.apply(mail)
        check("apple fill: a field whose value equals the user name is added", "\(m.merged) \(strings(entry(d, "Mail")!)["Recovery email"]?.value ?? "missing")", "1 alice@example.com")
        try addsNothing("apple fill: that field again", mail, d)

        // A second website on a login already saved.
        var w = try emptyVault()
        w.upsert([VaultItem(kind: .login, title: "Sites", account: "alice", website: "https://a.example.com", secret: "pw")])
        let sites = try direct([credentialItem("Sites", ["https://a.example.com", "https://b.example.net"], [basic("alice", "pw")])])
        let ss = try w.apply(sites)
        expect("apple fill: a further website is added to the saved login, or it is listed (merged \(ss.merged), skipped \(ss.duplicatesSkipped), issues \(ss.issues.count))",
               strings(entry(w, "Sites")!).values.contains { $0.value == "https://b.example.net" } || !ss.issues.isEmpty)
    }

    // MARK: Apple: the file, and mixing the two ways

    do {
        let uri = "otpauth://totp/Example:alice?secret=\(b32)&issuer=Example&algorithm=SHA1&digits=6&period=30"
        let rows = [["example.com (alice)", "https://example.com/", "alice", "PW-alice-9f3k", "NOTE-private-text\nline two", uri],
                    ["shop.example.net (bob)", "https://shop.example.net/", "bob", "PW-bob-77aa", "", ""],
                    ["odd.example.org (c)", "https://odd.example.org/", "c", "pw c ", "", "not-a-code"]]
        let items = [credentialItem("example.com (alice)", ["https://example.com/"], [basic("alice", "PW-alice-9f3k"), passkey(key, id: credID), totp(secretBytes, issuer: "Example"), note("NOTE-private-text\nline two")]),
                     credentialItem("shop.example.net (bob)", ["https://shop.example.net/"], [basic("bob", "PW-bob-77aa")]),
                     credentialItem("odd.example.org (c)", ["https://odd.example.org/"], [basic("c", "pw c ")])]
        let csv = try appleCSV(rows), move = try direct(items)
        check("apple csv: source and rows", "\(csv.source) \(csv.items.count) \(issueCount(csv.summary.issues, .unreadableCode))", "applePasswords 3 1")
        hear(csv.summary)

        var a = try emptyVault()
        hear(try importing("csv first", csv, into: &a))
        try addsNothing("csv then csv", csv, a)
        var av = try reopen(a)
        let m = try importing("csv then direct", move, into: &av)
        check("csv then direct: only the passkey is new", counts(m), "added 0 merged 1 skipped 2 similar 0 bin 0 deleted 0")
        signs("csv then direct: the passkey", entry(av, "example.com (alice)"), key.publicKey, rp: "example.com", id: credID)
        try addsNothing("csv, direct, direct", move, av)
        try addsNothing("csv, direct, csv", csv, av)

        var b = try emptyVault()
        hear(try importing("direct first", move, into: &b))
        try addsNothing("direct then direct", move, b)
        try addsNothing("direct then csv (unreadable code only in the file)", try appleCSV(Array(rows.prefix(2))), b)
        var bv = try reopen(b)
        let c = try bv.apply(csv)
        check("direct then csv: the code text only the file holds is the one thing added", "added \(c.addedCount) merged \(c.merged) skipped \(c.duplicatesSkipped)", "added 0 merged 1 skipped 2")
        try addsNothing("direct, csv, csv", csv, bv)

        let twice = try appleCSV([rows[1], rows[1]])
        var t = try emptyVault(); let ts = try importing("apple csv repeated row", twice, into: &t)
        check("apple csv: a repeated row is added once", counts(ts), "added 1 merged 0 skipped 1 similar 0 bin 0 deleted 0")

        // Real exports can hold a note that ends in a newline, and a user name with a space at the end.
        for (name, user, noteText) in [("a note ending in a newline", "dora", "remember this\n"), ("a user name ending in a space", "dora ", "")] {
            let file = try appleCSV([["d.example.com", "https://d.example.com/", user, "pw", noteText, ""]])
            let moved = try direct([credentialItem("d.example.com", ["https://d.example.com/"], noteText.isEmpty ? [basic(user, "pw")] : [basic(user, "pw"), note(noteText)])])
            var x = try emptyVault(); try x.apply(file)
            try addsNothing("csv then direct with \(name)", moved, x)
            var y = try emptyVault(); try y.apply(moved)
            try addsNothing("direct then csv with \(name)", file, y)
        }
        for (name, text) in [("CRLF in a note", "a\r\nb"), ("CR in a password", "")] {
            let password = text.isEmpty ? "p\rw" : "pw"
            let moved = try direct([credentialItem("crlf.example.com", ["https://crlf.example.com/"], text.isEmpty ? [basic("u", password)] : [basic("u", password), note(text)])])
            var y = try emptyVault(); try y.apply(moved)
            try addsNothing("direct twice with \(name)", moved, y)
        }
        expectThrows("apple csv: not a passwords file", .notAnExport) { _ = try CSVSource.plan(from: "a,b\n1,2\n", source: .applePasswords) }
        let noteRow = try appleCSV([["Secret note", "", "", "", "NOTE-private-text", ""], ["x", "https://x.example.com", "u", "p", "", ""]])
        check("apple csv: a row that is not a login is listed", "\(noteRow.items.count) \(issueCount(noteRow.summary.issues, .skippedRow)) \(noteRow.summary.rowsSkipped)", "1 1 1")
        hear(noteRow.summary)
        let changed = try appleCSV([["c\u{FFFF}", "https://c.example.com", "u", "PW-alice-9f3k\u{FFFF}", "", ""]])
        check("apple csv: the sanitize message names Apple Passwords", changed.summary.issues.map(\.detail).joined(), "the password contained characters that cannot be stored and was changed. Check it in Apple Passwords before you rely on it.")
        hear(changed.summary)
    }

    // MARK: Apple: the recycle bin and what was deleted for good

    do {
        let rows = [["gone.example.com (alice)", "https://gone.example.com/", "alice", "PW-alice-9f3k", "", ""]]
        let csv = try appleCSV(rows)
        let plain = try direct([credentialItem(rows[0][0], [rows[0][1]], [basic("alice", "PW-alice-9f3k")])])
        let rich = try direct([credentialItem(rows[0][0], [rows[0][1]], [basic("alice", "PW-alice-9f3k"), passkey(key, id: credID, rp: "gone.example.com")])])
        func binned(_ plan: ImportPlan) throws -> KDBXDocument { var v = try emptyVault(); try v.apply(plan); moveToBin(v, rows[0][0]); return v }
        func gone(_ plan: ImportPlan) throws -> KDBXDocument {
            var v = try emptyVault(); try v.apply(plan)
            expect("apple deleted: the fixture entry is deleted", v.deletePermanently(EntryMapping.uuid(of: entry(v, rows[0][0])!)!))
            return try reopen(v)
        }
        for (name, from, then) in [("direct, direct", plain, plain), ("csv, csv", csv, csv), ("csv, direct", csv, plain), ("direct, csv", plain, csv), ("with passkey, csv", rich, csv), ("with passkey, same", rich, rich)] {
            var v = try binned(from)
            let s = try importing("apple bin (\(name))", then, into: &v)
            hear(s)
            check("apple bin (\(name)): left in the bin and listed", counts(s), "added 0 merged 0 skipped 0 similar 0 bin 1 deleted 0")
            var g = try gone(from)
            let d = try importing("apple deleted (\(name))", then, into: &g)
            hear(d)
            check("apple deleted (\(name)): not brought back and listed", "\(counts(d)) left \(allEntries(g).count)", "added 0 merged 0 skipped 0 similar 0 bin 0 deleted 1 left 0")
        }
        for (name, from) in [("csv", csv), ("direct without a passkey", plain)] {
            var v = try binned(from)
            let s = try v.apply(rich)
            check("apple bin: deleted after \(name), the move with a passkey does not bring it back", "added \(s.addedCount) merged \(s.merged)", "added 0 merged 0")
            var g = try gone(from)
            let d = try g.apply(rich)
            check("apple deleted: deleted for good after \(name), the move with a passkey does not bring it back", "added \(d.addedCount) merged \(d.merged)", "added 0 merged 0")
        }
        // Filled by a move, then deleted for good: neither way brings it back.
        var f = try emptyVault(); try f.apply(csv); try f.apply(rich)
        f.deletePermanently(EntryMapping.uuid(of: entry(f, rows[0][0])!)!)
        var f1 = f, f2 = f
        check("apple deleted: filled then deleted, the file does not bring it back", "\(try f1.apply(csv).addedCount)", "0")
        check("apple deleted: filled then deleted, the move does not bring it back", "\(try f2.apply(rich).addedCount)", "0")
        var asked = try gone(plain); var include = plain; include.includeDeleted = true
        check("apple deleted: asked for, it comes back", "\(try asked.apply(include).addedCount)", "1")
        // Deleting one secure note must not block a different note with the same title.
        var n = try emptyVault()
        try n.apply(try direct([credentialItem("Note title", [], [note("first body")])]))
        n.deletePermanently(EntryMapping.uuid(of: entry(n, "Note title")!)!)
        let ns = try n.apply(try direct([credentialItem("Note title", [], [note("a completely different body")])]))
        check("apple deleted: a different note with a deleted note's title is added", "added \(ns.addedCount) deleted \(ns.deletedNotImported)", "added 1 deleted 0")
    }

    // MARK: Apple: words

    do {
        let plan = try direct([credentialItem("a", ["https://a.example.com"], [basic("a", "1"), passkey(key, id: credID), totp(secretBytes)]),
                               credentialItem("b", ["https://b.example.com"], [basic("b", "2"), totp(secretBytes)]),
                               credentialItem("c", ["https://c.example.com"], [basic("c", "3")]), credentialItem("n", [], [note("x")]), credentialItem("m", [], [note("y")])])
        check("apple words: found, direct", AppleImportText.found(plan, fromFile: false), "Apple Passwords sent 3 logins and 2 other items: 1 with a passkey, 2 with a verification code.")
        check("apple words: found, file", AppleImportText.found(plan, fromFile: true), "The file holds 3 logins and 2 other items: 1 with a passkey, 2 with a verification code.")
        var one = plan; one.items = [plan.items[2]]
        check("apple words: one login", AppleImportText.found(one, fromFile: false), "Apple Passwords sent 1 login.")
        one.items = [plan.items[2], plan.items[3]]
        check("apple words: one login and one other", AppleImportText.found(one, fromFile: true), "The file holds 1 login and 1 other item.")
        one.items = [plan.items[3], plan.items[4]]
        check("apple words: no logins", AppleImportText.found(one, fromFile: true), "The file holds 2 other items.")
        check("apple words: already there", AppleImportText.alreadyThere(1, vault: "V") + " / " + AppleImportText.alreadyThere(2, vault: "V"), "1 is already in V and will not be added again. / 2 are already in V and will not be added again.")
        check("apple words: gaining", AppleImportText.gaining(1, vault: "V") + " / " + AppleImportText.gaining(3, vault: "V"),
              "1 login in V gets what it is missing, such as a passkey or verification code. Nothing saved there is replaced. / 3 logins in V get what they are missing, such as a passkey or verification code. Nothing saved there is replaced.")
        check("apple words: button and title", [AppleImportText.importButton(1), AppleImportText.importButton(0), AppleImportText.doneTitle(1), AppleImportText.doneTitle(12)].joined(separator: "|"), "Import 1 Item|Import 0 Items|1 item imported|12 items imported")
        var s = ImportSummary()
        check("apple words: nothing new, empty", AppleImportText.nothingNew(s, vault: "V"), "There is nothing to add to V.")
        s.duplicatesSkipped = 1
        check("apple words: nothing new, one", AppleImportText.nothingNew(s, vault: "V"), "1 item is already in V.")
        s.duplicatesSkipped = 5
        check("apple words: nothing new, five", AppleImportText.nothingNew(s, vault: "V"), "5 items are already in V.")
        let issues = (0..<103).map { ImportIssue(kind: .skippedRow, item: $0 == 0 ? nil : ($0 == 1 ? "\u{202E}\u{200B}" : "t\($0)"), detail: $0 == 2 ? "done!" : "it holds nothing") }
        let checks = AppleImportText.checks(issues)
        check("apple words: checks are capped and counted", "\(checks.shown.count) \(checks.more) \(AppleImportText.checks([]).more)", "100 3 0")
        check("apple words: checks sentences and titles", checks.shown.prefix(3).map { "\($0.title): \($0.detail)" }.joined(separator: " | "), "No title: It holds nothing. | No title: It holds nothing. | t2: Done!")
        let problems = [ImportError.notAnExport, .empty, .tooLarge, .unreadable("The file “/Users/someone/x.csv” couldn’t be opened. NSCocoaErrorDomain 257"), .lineTooLong(1)].map { AppleImportText.fileProblem($0) }
            + [AppleImportText.fileProblem(CocoaError(.fileReadNoPermission))]
        check("apple words: file problems are plain, without codes or paths", problems.joined(separator: "|"),
              "This file is not a passwords export. It needs columns such as Title, URL, Username and Password.|This file holds no logins.|This file is too large to import safely.|Psss could not read that file.|Psss could not read that file.|Psss could not read that file.")
        said += problems
        let unreadable = work.appendingPathComponent("locked.csv")
        try Data("Title,URL,Username,Password\na,b,c,PW-alice-9f3k\n".utf8).write(to: unreadable)
        try fm.setAttributes([.posixPermissions: 0], ofItemAtPath: unreadable.path)
        do { _ = try CSVSource.plan(from: unreadable, source: .applePasswords); failures += 1; print("FAIL apple csv: an unreadable file was read") }
        catch { check("apple csv: an unreadable file", AppleImportText.fileProblem(error), "Psss could not read that file.") }
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: unreadable.path)

        let requests = AppleImportRequests()
        requests.receive(NSUserActivity(activityType: "test.none"))
        if case .failed(let message) = requests.pending { check("apple requests: no token is a plain failure", message, "Psss did not receive the items. Start the export again in Passwords.") } else { failures += 1; print("FAIL apple requests: no failure") }
        requests.start(); requests.putAside()
        check("apple requests: put aside keeps what arrived", "\(requests.requested) \(requests.pending != nil) \(requests.arrivals)", "false true 1")
        requests.start(); requests.close()
        check("apple requests: closing forgets it", "\(requests.requested) \(requests.pending != nil)", "false false")
    }

    // MARK: Apple: many items with one user name

    do {
        for count in [2_000, 8_000] {
            let p = try direct((0..<count).map { credentialItem("site\($0)", ["https://site\($0).example.com"], [basic("me@example.com", "pw\($0)")]) })
            var v = try emptyVault()
            let t0 = Date(); let s = try v.apply(p); let t1 = Date(); let again = v.preview(p); let t2 = Date()
            let one = t1.timeIntervalSince(t0), two = t2.timeIntervalSince(t1)
            print("note apple: \(count) logins with one user name: apply \(String(format: "%.2f", one)) s, preview again \(String(format: "%.2f", two)) s")
            check("apple scale \(count): all added, then all already there", "\(s.addedCount) \(again.duplicatesSkipped) \(again.needsWrite)", "\(count) \(count) false")
            expect("apple scale \(count): apply and preview each under 5 s", one < 5 && two < 5)
        }
    }

    // MARK: Apple: the store, a new vault, and what cannot be written

    do {
        let session = VaultSession()
        session.forget()
        let managed = VaultFiles.managedDirectory
        func vaults() -> [String] { ((try? fm.contentsOfDirectory(atPath: managed.path)) ?? []).filter { $0.hasSuffix(".kdbx") }.sorted() }
        try fm.createDirectory(at: managed, withIntermediateDirectories: true)
        let before = vaults()
        if writesWork {
            let added = try await session.create(name: "From Apple", credentials: .init(password: "n3w"), plan: allPlan)
            let new = vaults().filter { !before.contains($0) }
            check("apple new vault: one vault holding the items", "\(added) \(new.count) \(session.store?.items().count ?? -1)", "14 1 14")
            if let file = new.first {
                let onDisk = try KDBX.open(Data(contentsOf: managed.appendingPathComponent(file)), credentials: .init(password: "n3w"))
                check("apple new vault: the file holds them", "\(onDisk.items().count)", "14")
                signs("apple new vault: the passkey", entry(onDisk, "Alice site"), key.publicKey, rp: "example.com", id: credID)
            }
            let store = session.store!
            let url = managed.appendingPathComponent(new.first ?? "missing")
            let bytes = try Data(contentsOf: url)
            let again = try store.apply(allPlan)
            check("apple store: again writes nothing", "\(again.itemCount) \(try Data(contentsOf: url) == bytes)", "0 true")
            // A write that cannot happen, with a fill and an add.
            let more = try direct([credentialItem("A note", [], [note("another")]), credentialItem("Code only", ["https://code.example.org"], [totp(secretBytes), note("added note")])])
            let planned = store.preview(more)
            expect("apple store: the plan would write", planned.needsWrite)
            try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: managed.path)
            try fm.setAttributes([.posixPermissions: 0o444], ofItemAtPath: url.path)
            var message = ""
            do { _ = try store.apply(more) } catch { message = (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? "other error: \(type(of: error))" }
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: managed.path)
            try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
            check("apple store: an unwritable vault changes nothing", "\(!message.isEmpty) \(try Data(contentsOf: url) == bytes) \(store.preview(more) == planned)", "true true true")
            print("note apple store unwritable message: \(message)")
            check("apple store: that message has no full home path and no error code", "\(message.contains(NSHomeDirectory())) \(message.contains("NSCocoaErrorDomain")) \(message.contains("Error Domain"))", "false false false")
            said.append(message)
            session.lockAll()
            expect("apple locked: no store is left to import into", session.openVaults.isEmpty && session.store == nil)

            let count = vaults().count
            let task = Task { @MainActor in try await session.create(name: "Locked meanwhile", credentials: .init(password: "n3w"), plan: allPlan) }
            await Task.yield()
            session.lockAll()
            do { _ = try await task.value; failures += 1; print("FAIL apple new vault: a lock during creation was ignored") }
            catch { check("apple new vault: a lock during creation writes nothing", "\((error as? VaultStoreError) == .lockedMeanwhile) \(vaults().count - count)", "true 0") }

            try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: managed.path)
            var thrown = false
            do { _ = try await session.create(name: "Unwritable", credentials: .init(password: "n3w"), plan: allPlan) } catch { thrown = true }
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: managed.path)
            check("apple new vault: an unwritable place throws and leaves no vault", "\(thrown) \(vaults().count - count) \(session.store == nil)", "true 0 true")
            session.forget()
        } else { print("SKIP apple new vault and store writes: files cannot be written right now") }
    }

    // MARK: Apple: KeePassXC

    if run(["which", "keepassxc-cli"]).status == 0 {
        var v = try KDBX.create(name: "XC Apple", credentials: .init(password: "xc pw"), kdf: light)
        try v.apply(allPlan)
        let path = work.appendingPathComponent("apple.kdbx")
        try KDBX.save(v).write(to: path)
        func cli(_ args: [String]) -> (status: Int32, out: String) { run(["keepassxc-cli"] + args, input: "xc pw\n") }
        check("keepassxc apple: opens", "\(cli(["ls", "-q", path.path]).status)", "0")
        let shown = cli(["show", "-q", "-s", "--all", path.path, "Alice site"]).out
        expect("keepassxc apple: passkey attributes are listed", ["KPEX_PASSKEY_CREDENTIAL_ID", "KPEX_PASSKEY_PRIVATE_KEY_PEM", "KPEX_PASSKEY_RELYING_PARTY", "KPEX_PASSKEY_USERNAME", "KPEX_PASSKEY_USER_HANDLE", credID.base64URL].allSatisfy(shown.contains))
        var settings = TOTPSettings(); settings.digits = 8; settings.period = 60; settings.algorithm = .sha256
        let early = TOTP.code(secret: b32, settings: settings) ?? ""
        let theirs = cli(["show", "-q", "-t", path.path, "Alice site"]).out.trimmingCharacters(in: .whitespacesAndNewlines)
        let late = TOTP.code(secret: b32, settings: settings) ?? ""
        expect("keepassxc apple: the same eight-digit SHA-256 code (\(theirs.count) digits)", theirs == early || theirs == late)
        func exportedPEM(_ title: String) -> XNode? {
            guard let tree = try? XMLTree.parse(Data(cli(["export", "-q", "-f", "xml", path.path]).out.utf8)) else { return nil }
            var found: XNode?
            tree.walk { if $0.name == "Entry", found == nil, EntryMapping.string($0, "Title") == title { found = $0 } }
            return found
        }
        signs("keepassxc apple: the exported passkey", exportedPEM("Alice site"), key.publicKey, rp: "example.com", id: credID)
        check("keepassxc apple: a save by KeePassXC", "\(cli(["edit", "-q", "-u", "dave", path.path, "Passkey only"]).status)", "0")
        let resaved = try KDBX.open(Data(contentsOf: path), credentials: .init(password: "xc pw"))
        signs("keepassxc apple: the passkey after KeePassXC saved", entry(resaved, "Alice site"), key.publicKey, rp: "example.com", id: credID)
        signs("keepassxc apple: the other after KeePassXC saved", entry(resaved, "Passkey only"), key2.publicKey, rp: "only.example.org", id: credID2)
        let after = resaved.preview(try direct(all.filter { $0.title != "Passkey only" }))
        check("keepassxc apple: a move after KeePassXC saved adds nothing", "\(after.itemCount)", "0")
    } else { print("skip keepassxc apple round trip: keepassxc-cli not installed") }

    // MARK: Apple: items deleted for good are listed on the review

    do {
        let titles = ["\u{202E}Bidi gone", "", "Plain gone"]
        let move = try direct(titles.enumerated().map { credentialItem($0.element, ["https://g\($0.offset).example.com"], [basic("u", "PW-bob-77aa")]) })
        var v = try emptyVault(); try v.apply(move)
        v.deletePermanently(v.items().map(\.id))
        let s = try importing("apple listed deleted", move, into: &v)
        check("apple listed deleted: three left out", "\(s.deletedNotImported) \(s.deletedItems.count) \(s.addedCount)", "3 3 0")
        // As the sheet calls it.
        let checks = AppleImportText.checks(s.issues, deleted: s.deletedItems)
        let line = "You deleted it in Psss earlier, so it is not imported again."
        let own = checks.shown.filter { $0.detail == line }
        check("apple listed deleted: each item has its line, with a safe title", own.map(\.title).sorted().joined(separator: "|"), ["Bidi gone", "No title", "Plain gone"].sorted().joined(separator: "|"))
        check("apple listed deleted: identifiers are unique", "\(Set(checks.shown.map(\.id)).count == checks.shown.count) \(checks.more)", "true 0")
        check("apple listed deleted: no line about the whole import is headed \u{201C}No title\u{201D}",
              checks.shown.filter { $0.title == "No title" && $0.detail != line }.map(\.detail).joined(separator: " | "), "")
        said += checks.shown.flatMap { [$0.title, $0.detail] }
        let gone = (0..<5).map { SkippedItem(title: $0 == 0 ? "" : "gone\($0)", kind: .login) }
        let capped = AppleImportText.checks((0..<98).map { ImportIssue(kind: .skippedRow, item: "i\($0)", detail: "it holds nothing") }, deleted: gone)
        check("apple listed deleted: the cap counts them", "\(capped.shown.count) \(capped.more) \(capped.shown[98].title) \(capped.shown[99].title)", "100 3 No title gone1")
        let only = AppleImportText.checks([], deleted: gone)
        check("apple listed deleted: deleted items alone", "\(only.shown.count) \(only.more)", "5 0")
    }

    // MARK: Apple: the identifier rule

    do {
        let site = "https://id.example.com"
        func login(_ password: String, _ credentials: [Credential] = [], title: String = "Id") -> ASImportableItem {
            credentialItem(title, [site], (password.isEmpty ? [] : [basic("u", password)]) + credentials)
        }
        func pk(_ k: P256.Signing.PrivateKey, _ id: Data) -> Credential { passkey(k, id: id, rp: "id.example.com", user: "u") }
        func afterDelete(_ first: ASImportableItem, then second: ASImportableItem) throws -> String {
            var v = try emptyVault()
            try v.apply(try direct([first]))
            v.deletePermanently(v.items().map(\.id))
            var back = try reopen(v)
            let s = try back.apply(try direct([second]))
            return "added \(s.addedCount) deleted \(s.deletedNotImported)"
        }
        let blocked = "added 0 deleted 1", added = "added 1 deleted 0"
        check("apple identifier: password login, another passkey, stays deleted", try afterDelete(login("p", [pk(key, credID)]), then: login("p", [pk(key2, credID2)])), blocked)
        check("apple identifier: password login, new notes and code, stays deleted", try afterDelete(login("p"), then: login("p", [note("n"), totp(secretBytes)])), blocked)
        check("apple identifier: another password is another login", try afterDelete(login("p"), then: login("q")), added)
        check("apple identifier: passkey only, the same one stays deleted", try afterDelete(login("", [pk(key, credID)]), then: login("", [pk(key, credID)])), blocked)
        check("apple identifier: passkey only, another one is added", try afterDelete(login("", [pk(key, credID)]), then: login("", [pk(key2, credID2)])), added)
        check("apple identifier: code only, the same code stays deleted", try afterDelete(login("", [totp(secretBytes)]), then: login("", [totp(secretBytes)])), blocked)
        check("apple identifier: code only, another code is added", try afterDelete(login("", [totp(secretBytes)]), then: login("", [totp(Data("abcdefghij0123456789".utf8))])), added)

        // Every other kind is identified by all it says.
        func card(_ number: String, _ cvv: String) -> ASImportableItem {
            credentialItem("Card", [], [.creditCard(.init(number: hidden(number), fullName: text("A"), cardType: nil, verificationNumber: hidden(cvv), pin: nil, expiryDate: text("2027-04"), validFrom: nil))])
        }
        func wifi(_ pass: String) -> ASImportableItem { credentialItem("Net", [], [.wifi(.init(ssid: text("s"), networkSecurityType: nil, passphrase: hidden(pass)))]) }
        func address(_ street: String) -> ASImportableItem { credentialItem("Home", [], [.address(.init(streetAddress: text(street), postalCode: nil, city: nil, territory: nil, country: nil, telephone: nil))]) }
        func plain(_ body: String) -> ASImportableItem { credentialItem("N", [], [note(body)]) }
        for (name, one, other) in [("card", card("4000009999991234", "1"), card("4000009999991234", "2")), ("Wi-Fi", wifi("a"), wifi("b")),
                                   ("address", address("1 Road"), address("2 Road")), ("note", plain("a"), plain("b"))] {
            check("apple identifier: \(name), the same stays deleted", try afterDelete(one, then: one), blocked)
            check("apple identifier: \(name), another content is added", try afterDelete(one, then: other), added)
        }

        // A login that began as a passkey, got its password from a later move, and was then deleted for good.
        var v = try emptyVault()
        try v.apply(try direct([login("", [pk(key, credID)])]))
        let both = try direct([login("p", [pk(key, credID)])])
        let filled = try v.apply(both)
        check("apple identifier: a passkey login is given its password", "\(filled.merged) \(allEntries(v).count)", "1 1")
        try addsNothing("apple identifier: that again", both, v)
        v.deletePermanently(v.items().map(\.id))
        let s = try v.apply(both)
        check("apple identifier: filled passkey login, deleted for good, the same move does not bring it back", "added \(s.addedCount) deleted \(s.deletedNotImported)", blocked)
    }

    // MARK: Apple: notes held only as a whole

    do {
        func plain(_ body: String) -> ASImportableItem { credentialItem("Codes", [], [note(body)]) }
        for (name, first, second) in [("the first paragraph", "alpha\n\nbeta", "alpha"), ("the last paragraph", "alpha\n\nbeta", "beta"),
                                      ("one line", "alpha\nbeta", "alpha"), ("a longer one", "alpha", "alpha\n\nbeta")] {
            let p = try direct([plain(first), plain(second)])
            var v = try emptyVault()
            let s = try importing("apple notes (\(name))", p, into: &v)
            check("apple notes (\(name)): two different notes with one title are both added", "\(s.addedCount)", "2")
            try addsNothing("apple notes (\(name)) again", p, v)
        }
        // A login's notes added under saved ones, with CRLF and trailing blank lines, are added once.
        var v = try emptyVault()
        var typed = VaultItem(kind: .login, title: "L", account: "u", website: "https://n.example.com", secret: "p")
        typed.notes = "mine\r\nsecond\n\n"
        v.upsert([typed])
        let move = try direct([credentialItem("L", ["https://n.example.com"], [basic("u", "p"), note("theirs\r\n\r\nmore\r\n")])])
        let s = try v.apply(move)
        check("apple notes: added under a login", "\(s.merged)", "1")
        try addsNothing("apple notes: CRLF notes again", move, v)
        try addsNothing("apple notes: the saved notes sent back", try direct([credentialItem("L", ["https://n.example.com"], [basic("u", "p"), note("mine\nsecond")])]), v)
    }

    // MARK: Apple: the recycle bin, further cases

    do {
        let site = "https://bin.example.com"
        func login(_ password: String, _ credentials: [Credential] = [], sites: [String] = ["https://bin.example.com"]) -> ASImportableItem {
            credentialItem("Bin", sites, (password.isEmpty ? [] : [basic("alice", password)]) + credentials)
        }
        let pk = passkey(key, id: credID, rp: "bin.example.com")
        func afterBin(_ saved: ASImportableItem, then arriving: ASImportableItem, _ name: String) throws -> String {
            var v = try emptyVault()
            try v.apply(try direct([saved]))
            moveToBin(v, "Bin")
            let binned = strings(entry(v, "Bin")!).mapValues(\.value)
            let s = try importing(name, try direct([arriving]), into: &v)
            expect("\(name): the binned entry is as it was", entry(v, "Bin").map { strings($0).mapValues(\.value) } == binned)
            return counts(s)
        }
        let stays = "added 0 merged 0 skipped 0 similar 0 bin 1 deleted 0"
        let adds = "added 1 merged 0 skipped 0 similar 0 bin 0 deleted 0"
        check("apple bin: an extra passkey stays deleted", try afterBin(login("p"), then: login("p", [pk]), "bin passkey"), stays)
        check("apple bin: an extra code, note and website stay deleted", try afterBin(login("p"), then: login("p", [totp(secretBytes), note("n")], sites: [site, "https://more.example.net"]), "bin extras"), stays)
        check("apple bin: a different password for the same site and user is added", try afterBin(login("p"), then: login("q"), "bin other password"), adds)
        check("apple bin: a different password with a passkey is added", try afterBin(login("p"), then: login("q", [pk]), "bin other password and passkey"), adds)
        check("apple bin: another user is added", try afterBin(login("p"), then: credentialItem("Bin", [site], [basic("bob", "p")]), "bin other user"), adds)
        check("apple bin: another site is added", try afterBin(login("p"), then: login("p", sites: ["https://elsewhere.example.org"]), "bin other site"), adds)
        check("apple bin: a binned passkey login arriving with a password stays deleted", try afterBin(login("", [pk]), then: login("p", [pk]), "bin passkey then password"), stays)

        // A live login that can be filled is filled, whatever is in the bin.
        var v = try emptyVault()
        try v.apply(try direct([login("p")]))
        moveToBin(v, "Bin")
        v.upsert([VaultItem(kind: .login, title: "Live", account: "alice", website: site, secret: "")])
        let s = try v.apply(try direct([login("p", [pk])]))
        check("apple bin: a live login without a password is filled", "\(s.merged) \(s.addedCount) \(entry(v, "Live").flatMap(EntryMapping.passkey) != nil)", "1 0 true")
    }

    // MARK: Apple: websites on saved logins

    do {
        func sitesOf(_ document: KDBXDocument, _ title: String) -> String {
            guard let node = entry(document, title) else { return "missing" }
            return strings(node).filter { ($0.key == "URL" || $0.key.hasPrefix("KP2A_URL")) && !$0.value.value.isEmpty }.map { "\($0.key)=\($0.value.value)" }.sorted().joined(separator: " ")
        }
        let a = "https://a.example.com", b = "https://b.example.net", c = "https://c.example.org", d = "https://d.example.io"
        func move(_ sites: [String], _ more: [Credential] = []) throws -> ImportPlan { try direct([credentialItem("W", sites, [basic("u", "p")] + more)]) }
        var v = try emptyVault()
        v.upsert([VaultItem(kind: .login, title: "W", account: "u", website: a, secret: "p")])
        let two = try move([a, b])
        let s = try importing("apple websites", two, into: &v)
        check("apple websites: the second goes in the first extra slot", "\(s.merged) \(sitesOf(v, "W"))", "1 KP2A_URL=\(b) URL=\(a)")
        try addsNothing("apple websites: again", two, v)
        try addsNothing("apple websites: one of them alone", try move([b]), v)
        try addsNothing("apple websites: the other order", try move([b, a]), v)
        try addsNothing("apple websites: another path and www", try move(["https://www.a.example.com/signin", b + "/x"]), v)
        let four = try move([c, b, d, a, c + "/again"])
        try importing("apple websites: two more", four, into: &v)
        check("apple websites: the next slots, nothing replaced, no repeats", sitesOf(v, "W"), "KP2A_URL=\(b) KP2A_URL_1=\(c) KP2A_URL_2=\(d) URL=\(a)")
        try addsNothing("apple websites: four again", four, v)
        check("apple websites: after save and reopen", sitesOf(try reopen(v), "W"), "KP2A_URL=\(b) KP2A_URL_1=\(c) KP2A_URL_2=\(d) URL=\(a)")
        check("apple websites: the version before is in history", "\(entry(v, "W")?.child("History")?.children.count ?? 0)", "2")

        // A gap in the slots is used, and a taken one is not written over.
        var g = try emptyVault()
        g.upsert([VaultItem(kind: .login, title: "W", account: "u", website: a, secret: "p")])
        entry(g, "W")!.children.append(XNode("String", children: [XNode("Key", text: "KP2A_URL_1"), XNode("Value", text: c)]))
        let fill = try move([a, b, d])
        try g.apply(fill)
        check("apple websites: free slots only", sitesOf(g, "W"), "KP2A_URL=\(b) KP2A_URL_1=\(c) KP2A_URL_2=\(d) URL=\(a)")
        try addsNothing("apple websites: gaps again", fill, g)

        // An entry whose only website is in an extra slot gets the main one filled.
        var e = try emptyVault()
        e.upsert([VaultItem(kind: .login, title: "W", account: "u", website: "", secret: "p")])
        let node = entry(e, "W")!
        node.children.removeAll { $0.name == "String" && $0.child("Key")?.text == "URL" }
        node.children.append(XNode("String", children: [XNode("Key", text: "KP2A_URL"), XNode("Value", text: a)]))
        let both = try move([b, c, a])
        let es = try e.apply(both)
        check("apple websites: an empty main website is filled first", "\(es.merged) \(sitesOf(e, "W"))", "1 KP2A_URL=\(a) KP2A_URL_1=\(c) URL=\(b)")
        try addsNothing("apple websites: filled main again", both, e)

        // CSV (one website) then the move (two), then the file again.
        let file = try appleCSV([["W", a, "u", "p", "", ""]])
        var m = try emptyVault(); try m.apply(file)
        let ms = try m.apply(two)
        check("apple websites: file then move adds the website", "\(ms.merged) \(sitesOf(m, "W"))", "1 KP2A_URL=\(b) URL=\(a)")
        try addsNothing("apple websites: then the file", file, m)
        try addsNothing("apple websites: then the move", two, m)

        // Two logins of one import that share one saved entry, and one that overlaps through its added website.
        var t = try emptyVault()
        t.upsert([VaultItem(kind: .login, title: "W", account: "u", website: a, secret: "p")])
        let pair = try direct([credentialItem("W", [a, b], [basic("u", "p")]), credentialItem("W2", [b], [basic("u", "p")])])
        let ts = try importing("apple websites: two arriving", pair, into: &t)
        check("apple websites: the second is already there once the first is added", counts(ts), "added 0 merged 1 skipped 1 similar 0 bin 0 deleted 0")
        try addsNothing("apple websites: two arriving again", pair, t)

        // Two equal values under different names both arrive.
        var q = try emptyVault()
        q.upsert([VaultItem(kind: .login, title: "W", account: "u", website: a, secret: "p")])
        let twins = try move([a], [.customFields(.init(label: "g", fields: [hidden("blue", "First answer"), hidden("blue", "Second answer")]))])
        try q.apply(twins)
        check("apple fill: two fields with the same value both arrive", "\(strings(entry(q, "W")!)["First answer"]?.value ?? "-") \(strings(entry(q, "W")!)["Second answer"]?.value ?? "-")", "blue blue")
        try addsNothing("apple fill: twin fields again", twins, q)
    }

    // MARK: Apple: websites on notes and other kinds

    do {
        let site = "https://kept.example.com", other = "https://kept2.example.net"
        let p = try direct([credentialItem("SN", [site, other], [note("body")]),
                            credentialItem("SW", [site], [.wifi(.init(ssid: text("s"), networkSecurityType: nil, passphrase: nil)), note("wifi note")]),
                            credentialItem("SC", [site], [.creditCard(.init(number: hidden("4000009999991234"), fullName: nil, cardType: nil, verificationNumber: nil, pin: nil, expiryDate: nil, validFrom: nil))]),
                            credentialItem("SG", [site], [.generatedPassword(.init(password: "g"))])])
        var v = try emptyVault()
        try importing("apple sited", p, into: &v)
        var back = try reopen(v)
        check("apple sited: the website is stored once on each", ["SN", "SW", "SC", "SG"].map { t in entry(back, t).map { "\(strings($0)["URL"]?.value == site)" } ?? "missing" }.joined(separator: " "), "true true true true")
        check("apple sited: kinds read back", ["SN", "SW", "SC", "SG"].map { vaultItem(back, titled: $0).map { "\($0.kind)" } ?? "?" }.joined(separator: " "), "secureNote keePassEntry creditCard keePassEntry")
        try addsNothing("apple sited: again", p, v)
        for title in ["SN", "SC"] {
            var item = vaultItem(back, titled: title)!
            item.notes = "edited"
            expect("apple sited: \(title) is edited", back.upsert(item))
            check("apple sited: \(title) keeps its website through an edit", strings(entry(back, title)!)["URL"]?.value ?? "gone", site)
        }
    }

    // MARK: Apple: 8000 logins on one site

    do {
        let p = try direct((0..<4_000).map { credentialItem("one\($0)", ["https://one.example.com"], [basic("user\($0)", "pw\($0)")]) })
        var v = try emptyVault()
        let t0 = Date(); try v.apply(p); let t1 = Date(); _ = v.preview(p); let t2 = Date()
        print("note apple: 4000 logins on one site: apply \(String(format: "%.2f", t1.timeIntervalSince(t0))) s, preview again \(String(format: "%.2f", t2.timeIntervalSince(t1))) s")
    }

    // MARK: Apple: no secret in any message

    check("apple secrecy: messages were collected", "\(said.count > 100)", "true")
    for secret in secrets { check("apple secrecy: no message holds \(secret.prefix(14))", said.first { $0.contains(secret) }.map { String($0.prefix(200)) } ?? "", "") }
}
