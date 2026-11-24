#if os(iOS)
import NetworkExtension

/// Joins a saved Wi-Fi network through the system (`NEHotspotConfiguration`, the Hotspot Configuration entitlement). The system asks the
/// person before it joins; nothing is joined without that prompt. iPhone and iPad only: the Mac shows the QR code instead.
enum WiFiJoin {
    enum Result: Equatable {
        case joined
        /// The person said no in the system's prompt: nothing to report.
        case declined
        case failed
    }

    static func join(_ item: VaultItem) async -> Result {
        let name = item.account.trimmingCharacters(in: .whitespacesAndNewlines)
        guard item.kind == .wifi, !name.isEmpty else { return .failed }
        let configuration: NEHotspotConfiguration
        if item.wifiSecurity == .none {
            configuration = NEHotspotConfiguration(ssid: name)
        } else {
            configuration = NEHotspotConfiguration(ssid: name, passphrase: item.secret, isWEP: item.wifiSecurity == .wep)
        }
        configuration.hidden = item.wifiHidden
        do {
            try await NEHotspotConfigurationManager.shared.apply(configuration)
            return .joined
        } catch let error as NSError {
            guard error.domain == NEHotspotConfigurationErrorDomain, let code = NEHotspotConfigurationError(rawValue: error.code) else { return .failed }
            switch code {
            case .alreadyAssociated: return .joined
            case .userDenied: return .declined
            default: return .failed
            }
        }
    }
}
#endif
