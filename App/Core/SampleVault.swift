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

    static let items: [VaultItem] =
        [
            VaultItem(kind: .login, account: "alex@example.net", website: "localhost",
                      secret: "Demo-only-Sample1!", lastUsed: .now.addingTimeInterval(-60), useCount: 20),
            VaultItem(kind: .login, account: "alex@example.net",
                      website: "studio.example", secret: "Demo-only-Maple7!",
                      otpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", lastUsed: .now.addingTimeInterval(-300), useCount: 14),
            VaultItem(kind: .login, title: "Studio North (work)", account: "alex@studio.example",
                      website: "studio.example", secret: "Demo-only-River3!", notes: "Shared with the design team."),
            samplePasskeyLogin,
            VaultItem(kind: .creditCard, title: "Everyday card", account: "Alex Example",
                      secret: "4242424242424242", expiry: "08/30"),
            VaultItem(kind: .secureNote, title: "Travel checklist", notes: "Sample locker instructions."),
            VaultItem(kind: .keePassEntry, title: "Design software license", secret: "DEMO-LICENSE")
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
                             otpSecret: index % 5 == 0 ? "JBSWY3DPEHPK3PXP" : "",
                             lastUsed: index <= 4 ? .now.addingTimeInterval(-Double(index) * 3600) : nil,
                             useCount: index <= 12 ? 13 - index : 0)
        } + (1...9).map { index in
            VaultItem(kind: .creditCard, title: "Sample card \(index)", account: "Alex Example",
                      secret: "4242424242424242", expiry: "08/30")
        } + (1...19).map { index in
            VaultItem(kind: .secureNote, title: "Sample note \(index)", notes: "Fictional note \(index).")
        } + (1...29).map { index in
            VaultItem(kind: .keePassEntry, title: "Sample license \(index)", secret: "DEMO-\(index)")
        }
}
