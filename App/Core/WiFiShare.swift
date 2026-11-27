import Foundation

/// What a saved Wi-Fi network shares: the text of the QR code another phone's Camera reads to join (the `WIFI:` format that iOS, Android
/// and most routers use), made on this device from the item. Nothing is sent anywhere.
extension VaultItem {
    /// A Wi-Fi network's second line in a list: the name the router shows and its security ("Harbor-5G · WPA"), or the security alone
    /// when the network is called by that name already.
    var wifiSecondLine: String {
        let given = visibleTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let network = visibleAccount.trimmingCharacters(in: .whitespacesAndNewlines)
        let security = wifiSecurity.shortLabel
        let shown = DisplayText.safe(network)
        return given.isEmpty || shown.isEmpty || given == network ? security : "\(shown) \u{00B7} \(security)"
    }
}

enum WiFiShare {
    /// `WIFI:T:WPA;S:name;P:password;H:true;;`. A backslash, semicolon, comma, colon and quote in the name or password are escaped with a
    /// backslash. An open network has no `P`; a hidden one says `H:true`. Nil when the item is not a Wi-Fi network or has no name.
    static func payload(for item: VaultItem) -> String? {
        guard item.kind == .wifi else { return nil }
        let name = item.account.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        let type: String
        switch item.wifiSecurity {
        case .wpa: type = "WPA"
        case .wep: type = "WEP"
        case .none: type = "nopass"
        }
        var text = "WIFI:T:\(type);S:\(escaped(name));"
        if item.wifiSecurity != .none, !item.secret.isEmpty { text += "P:\(escaped(item.secret));" }
        if item.wifiHidden { text += "H:true;" }
        return text + ";"
    }

    private static func escaped(_ text: String) -> String {
        var result = ""
        for character in text {
            if "\\;,:\"".contains(character) { result.append("\\") }
            result.append(character)
        }
        return result
    }
}
