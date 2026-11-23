import Foundation

/// What the AutoFill provider knows about the page that asked for a password, kept pure so it can be tested without a device.
/// It decides whether saved logins for the page may be offered automatically.
enum FillSite: Equatable, Sendable {
    /// A site that can be read. Logins saved for it are listed first.
    case secure(host: String)
    /// A plain `http` page that is not on this machine. Anything filled there can be read on the network, so no login is
    /// offered automatically.
    case plainHTTP(host: String)
    /// No service identifier, or one that has no host (a bare path, `javascript:`, an address with user info, ...).
    case unknown

    /// Hosts that are this machine: an `http` page there never leaves it.
    private static let thisMachine: Set<String> = ["localhost", "127.0.0.1", "::1"]

    /// Reads the first service identifier the system gave. A URL with the scheme `http` (any letter case) on a host that is not
    /// this machine is `plainHTTP`. Every other identifier is judged by its host alone: a domain name, an `https` URL or a URL
    /// with another scheme.
    init(serviceIdentifier: String?) {
        let text = serviceIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let host = SiteMatch.normalizedHost(text)
        guard !host.isEmpty else { self = .unknown; return }
        let isHTTP = text.lowercased().hasPrefix("http://")
        self = isHTTP && !Self.thisMachine.contains(host) ? .plainHTTP(host: host) : .secure(host: host)
    }

    /// The normalized host, nil for an unknown site.
    var host: String? {
        switch self {
        case .secure(let host), .plainHTTP(let host): host
        case .unknown: nil
        }
    }
}
