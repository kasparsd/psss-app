import Foundation

enum SampleVault {
    /// A login that holds only a passkey, so the Passkeys filter and badge have something to show.
    private static var samplePasskeyLogin: VaultItem {
        var item = VaultItem(kind: .login, account: "alex@example.net", website: "passkeys.example",
                             lastUsed: .now.addingTimeInterval(-900), useCount: 3)
        item.passkey = Passkeys.register(rpID: "passkeys.example", userHandle: Data("alex".utf8),
                                         clientDataHash: Data(repeating: 0, count: 32)).record
        return item
    }

    /// A fictional 32-character code seed for the login at `index`, the same every launch and different for every index.
    private static func seed(_ index: Int) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var state = UInt64(index) &* 0x9E37_79B9_7F4A_7C15 &+ 0x1234_5678_9ABC_DEF1
        return String((0..<32).map { _ in
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return alphabet[Int((state >> 33) % 32)]
        })
    }

    /// The cards: with and without a security code, and one that has expired. Test numbers only.
    private static var sampleCards: [VaultItem] {
        [
            VaultItem(kind: .creditCard, title: "Everyday Visa", account: "Alex Example", secret: "4242424242424242",
                      expiry: "08/30", securityCode: "123", validFrom: "08/25", pin: "4821", issuer: "Northbank", lastUsed: .now.addingTimeInterval(-7200), useCount: 6),
            VaultItem(kind: .creditCard, title: "Travel Mastercard", account: "Alex Example", secret: "5555555555554444",
                      expiry: "11/29", lastUsed: .now.addingTimeInterval(-86400), useCount: 2),
            VaultItem(kind: .creditCard, title: "Business Amex", account: "Alex Example", secret: "378282246310005",
                      expiry: "02/31", securityCode: "1234"),
            VaultItem(kind: .creditCard, title: "Old Visa", account: "Alex Example", secret: "4111111111111111",
                      expiry: "03/25", securityCode: "987")
        ]
    }

    static let items: [VaultItem] =
        [
            VaultItem(kind: .login, account: "alex@example.net", website: "localhost",
                      secret: "Demo-only-Sample1!", lastUsed: .now.addingTimeInterval(-60), useCount: 20),
            VaultItem(kind: .login, account: "alex@example.net",
                      website: "studio.example", secret: "Demo-only-Maple7!",
                      otpSecret: seed(1001), lastUsed: .now.addingTimeInterval(-300), useCount: 14),
            VaultItem(kind: .login, title: "Studio North (work)", account: "alex@studio.example",
                      website: "studio.example", secret: "Demo-only-River3!", notes: "Shared with the design team."),
            samplePasskeyLogin,
            VaultItem(kind: .login, account: "alex@example.net", website: "google.com", secret: "Demo-only-Sample2!",
                      lastUsed: .now.addingTimeInterval(-1200), useCount: 9),
            VaultItem(kind: .login, account: "alex", website: "github.com", secret: "Demo-only-Sample3!",
                      lastUsed: .now.addingTimeInterval(-1500), useCount: 8),
            VaultItem(kind: .login, account: "alex_e", website: "ebay.com", secret: "Demo-only-Sample4!",
                      lastUsed: .now.addingTimeInterval(-1800), useCount: 7),
            // A 60-second, eight-digit code, and a setup key that cannot make a code (0, 1, 8, 9 and ! are not Base32): "Can't make a code" on Codes.
            VaultItem(kind: .login, title: "Harbor Vault (8 digits)", account: "alex@example.net", website: "harborvault.example",
                      secret: "Demo-only-Harbor8!", otpSecret: seed(1002), otpSettings: TOTPSettings(digits: 8, period: 60)),
            VaultItem(kind: .login, title: "Broken Seed Co", account: "alex@example.net", website: "brokenseed.example",
                      secret: "Demo-only-Broken9!", otpSecret: "0189!"),
            VaultItem(kind: .secureNote, title: "Travel checklist", notes: "Sample locker instructions."),
            VaultItem(kind: .keePassEntry, title: "Design software license", secret: "DEMO-LICENSE"),
            // Fictional networks: a named one, one without a name of its own, and an open one.
            VaultItem(kind: .wifi, title: "Home", account: "Harbor-5G", secret: "demo-harbor-light-4821", lastUsed: .now.addingTimeInterval(-3000), useCount: 4),
            VaultItem(kind: .wifi, account: "studio-guest", secret: "demo-studio-guest-77"),
            VaultItem(kind: .wifi, title: "Cabin", account: "Cabin Net", secret: "", wifiSecurity: .none)
        ] + (1...298).map { index in
            let services = ["Atlas Mail", "Cedar Bank", "Daybreak Studio", "Elm Hosting",
                            "Fern Market", "Harbor Books", "Maple Transit", "Northstar Journal",
                            "Postbox", "River Cinema", "Summit Travel", "Willow Works",
                            "Acorn Fitness", "Bluebird Music", "Clover Dental", "Copper Cloud",
                            "Dawn Library", "Estuary Credit Union", "Forest Gallery", "Greenway Parking",
                            "Juniper School", "Lakeview Insurance", "Lime Mobile", "Marsh Telecom",
                            "Meadow Publishing", "Nightjar Games", "Oakline Hardware", "Orchard Health",
                            "Papertrail News", "Pine Shipping", "Quartz Design", "Redwood Energy",
                            "Silverline Audio", "Skyway Flights", "Sparrow Calendar", "Spruce Journal",
                            "Stonebridge Rentals", "Suncrest Photos", "Thistle Community", "Timber Market",
                            "Valley Pharmacy", "Violet Café", "Wren Crafts", "Yarrow Coffee"]
            let service = services[(index - 1) % services.count]
            let account = (index - 1) / services.count + 1
            let domain = service.lowercased().replacingOccurrences(of: " ", with: "") + ".example"
            return VaultItem(kind: .login, title: index % 9 == 0 ? service : "", account: "alex\(account)@example.net",
                             website: domain, secret: "Demo-only-\(index)",
                             otpSecret: index % 5 == 0 ? seed(index) : "",
                             lastUsed: index <= 4 ? .now.addingTimeInterval(-Double(index) * 3600) : nil,
                             useCount: index <= 12 ? 13 - index : 0)
        } + sampleCards + (1...6).map { index in
            VaultItem(kind: .creditCard, title: "Sample card \(index)", account: "Alex Example",
                      secret: ["4242424242424242", "5555555555554444", "6011111111111117"][index % 3],
                      expiry: "0\(index)/3\(index % 3)", securityCode: index % 2 == 0 ? "\(100 + index)" : "")
        } + (1...19).map { index in
            VaultItem(kind: .secureNote, title: "Sample note \(index)", notes: "Fictional note \(index).")
        } + (1...29).map { index in
            VaultItem(kind: .keePassEntry, title: "Sample license \(index)", secret: "DEMO-\(index)")
        }
}
