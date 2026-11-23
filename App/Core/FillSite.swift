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

    /// Reads one service identifier. A URL with the scheme `http` (any letter case) on a host that is not this machine is
    /// `plainHTTP`. Every other identifier is judged by its host alone: a domain name, an `https` URL or a URL with another
    /// scheme. Whether the host is this machine is decided on the host as written: `www.127.0.0.1` is not loopback.
    init(serviceIdentifier: String?) {
        let text = serviceIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let host = SiteMatch.normalizedHost(text)
        guard !host.isEmpty else { self = .unknown; return }
        let isHTTP = text.lowercased().hasPrefix("http://")
        self = isHTTP && !Self.thisMachine.contains(Self.hostAsWritten(text)) ? .plainHTTP(host: host) : .secure(host: host)
    }

    /// Reads every service identifier the system gave, most specific first. The page counts as plain `http` when ANY identifier
    /// is an `http` URL for a host that is not this machine, so a secure first identifier cannot hide an insecure one behind it.
    /// Then the host is the first such unencrypted host, the one the warning names and the one logins are listed for.
    /// Otherwise the site is the first identifier that has a host.
    init(serviceIdentifiers: [String]) {
        let sites = serviceIdentifiers.map { FillSite(serviceIdentifier: $0) }
        if let insecure = sites.first(where: { if case .plainHTTP = $0 { true } else { false } }) { self = insecure; return }
        guard let host = sites.lazy.compactMap(\.host).first else { self = .unknown; return }
        self = .secure(host: host)
    }

    /// The host of an `http://` URL exactly as written, lowercased, without port, brackets or trailing dot, and without
    /// stripping `www.`.
    private static func hostAsWritten(_ text: String) -> String {
        var rest = Substring(text.lowercased().dropFirst("http://".count))
        if let end = rest.firstIndex(where: { "/?#".contains($0) }) { rest = rest[..<end] }
        if rest.hasPrefix("["), let close = rest.firstIndex(of: "]") { return String(rest[rest.index(after: rest.startIndex)..<close]) }
        if rest.filter({ $0 == ":" }).count == 1, let colon = rest.firstIndex(of: ":") { rest = rest[..<colon] }
        if rest.hasSuffix(".") { rest = rest.dropLast() }
        return String(rest)
    }

    /// The normalized host, nil for an unknown site.
    var host: String? {
        switch self {
        case .secure(let host), .plainHTTP(let host): host
        case .unknown: nil
        }
    }
}
