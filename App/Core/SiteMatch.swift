import Foundation

/// Decides which saved logins belong to a site. Pure and hostless: Foundation only.
///
/// A saved login is offered when its host equals the requested host, or the requested host is a subdomain of it and the
/// saved host is not a public suffix. In detail:
/// - Equal hosts always match.
/// - A stored host is offered on its own subdomains, never on its parent, and never on a sibling.
/// - A stored host that is a public suffix, the parent of a wildcard rule (`kawasaki.jp`, `compute.amazonaws.com`), a
///   single label (`localhost`, `intranet`, `com`), an IPv4-like host or an IPv6 literal matches only itself.
/// - Malformed input normalizes to the empty string, which never matches anything.
/// Public suffixes come from `PublicSuffixList`.
enum SiteMatch {
    /// Names that are not in the Public Suffix List but are never one party's to own. Treated as public suffixes.
    private static let localNames: Set<String> = ["local", "localhost", "lan", "internal", "home", "corp", "intranet", "test", "example", "invalid"]
    /// Schemes that carry no network host.
    private static let hostlessSchemes: Set<String> = ["javascript", "data", "about", "file", "mailto", "blob", "vbscript", "tel", "sms"]
    /// The most labels any rule has: the suffix walk never looks further than this from the right.
    private static let maxRuleLabels: Int = {
        let rules = PublicSuffixList.rules
        let longest = [rules.normal, rules.wildcard, rules.exception].map { $0.reduce(1) { max($0, $1.utf8.reduce(1) { $1 == 46 ? $0 + 1 : $0 }) } }
        return longest.max() ?? 1
    }()

    /// The host of a URL or bare host, lowercased, without port, trailing dot or leading `www.` labels, in ASCII (punycode)
    /// form. Empty for anything that is not a plain host: user info, backslashes, percent signs, whitespace or control
    /// characters, empty labels, over-long names, and URLs without a network host (`javascript:`, `file:`, ...).
    /// Idempotent: normalizing a result returns it unchanged.
    static func normalizedHost(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let authority = authority(of: trimmed) else { return "" }
        return normalize(authority: authority)
    }

    /// The registrable domain (public suffix plus one label), or nil for a bare public suffix, an IP address or an empty or
    /// malformed host. A single-label host that is not a listed suffix, such as `localhost`, is its own registrable domain.
    static func registrableDomain(_ host: String) -> String? {
        let host = normalizedHost(host)
        guard !host.isEmpty, !isIPLike(host) else { return nil }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.count == 1 {
            let rules = PublicSuffixList.rules
            return rules.normal.contains(host) || rules.wildcard.contains(host) ? nil : host
        }
        let length = suffixLength(labels[...])
        guard labels.count > length else { return nil }
        return labels[(labels.count - length - 1)...].joined(separator: ".")
    }

    /// True when `stored` is a saved host that should be offered on `requested`.
    static func matches(stored: String, requested: String) -> Bool {
        let stored = normalizedHost(stored), requested = normalizedHost(requested)
        guard !stored.isEmpty, !requested.isEmpty else { return false }
        if stored == requested { return true }  // always, even for a public suffix, an IP literal or `localhost`
        if isIPLike(stored) || isIPLike(requested) { return false }
        let labels = stored.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.count < 2 || isPublicSuffix(labels[...]) { return false }
        return requested.hasSuffix("." + stored)
    }

    /// Same registrable domain, but not a match: a candidate for a "related logins" hint.
    static func related(stored: String, requested: String) -> Bool {
        guard let a = registrableDomain(stored), let b = registrableDomain(requested), a == b else { return false }
        return !matches(stored: stored, requested: requested)
    }

    // MARK: Parsing

    /// The authority part (host, optional port, no path) of a URL or bare host, or nil when the input has no network host.
    /// The whole input is still trimmed, copied and scanned once (linear in its length); what is bounded is the authority
    /// handed on (4096 bytes) and so everything after this step.
    private static func authority(of text: String) -> String? {
        let bytes = Array(text.utf8)
        guard !bytes.isEmpty else { return nil }
        func isDelimiter(_ b: UInt8) -> Bool { b == 47 || b == 63 || b == 35 }  // / ? #
        func isLetter(_ b: UInt8) -> Bool { (b | 0x20) >= 97 && (b | 0x20) <= 122 }
        func isDigit(_ b: UInt8) -> Bool { b >= 48 && b <= 57 }
        func end(from start: Int) -> Int { var i = start; while i < bytes.count, !isDelimiter(bytes[i]) { i += 1 }; return i }
        func slice(_ from: Int, _ to: Int) -> String? {
            to - from <= 4096 ? String(decoding: bytes[from..<to], as: UTF8.self) : nil
        }

        if looksLikeIPv6(bytes) { return bytes.count <= 64 ? text : nil }
        guard isLetter(bytes[0]) else { return slice(0, end(from: 0)) }
        var i = 0
        while i < bytes.count, isLetter(bytes[i]) || isDigit(bytes[i]) || bytes[i] == 43 || bytes[i] == 45 || bytes[i] == 46 { i += 1 }
        guard i < bytes.count, bytes[i] == 58 else { return slice(0, end(from: 0)) }  // no scheme
        let scheme = String(decoding: bytes[0..<i], as: UTF8.self).lowercased()
        if hostlessSchemes.contains(scheme) { return nil }
        let rest = i + 1
        if rest + 1 < bytes.count, bytes[rest] == 47, bytes[rest + 1] == 47 {
            return slice(rest + 2, end(from: rest + 2))
        }
        // `host:port` without a scheme reads as a scheme followed by digits.
        var j = rest
        while j < bytes.count, isDigit(bytes[j]) { j += 1 }
        guard j > rest, j == bytes.count || isDelimiter(bytes[j]) else { return nil }
        return slice(0, j)
    }

    private static func normalize(authority: String) -> String {
        guard !authority.isEmpty, authority.utf8.count <= 4096 else { return "" }
        for scalar in authority.unicodeScalars {
            if scalar.value < 0x21 || (0x7f...0x9f).contains(scalar.value) || scalar.properties.isWhitespace { return "" }
            if scalar == "\\" || scalar == "%" || scalar == "@" { return "" }
        }
        let value = authority.lowercased()
        let bytes = Array(value.utf8)
        if bytes[0] == 91 {  // [ipv6]:port
            guard let close = bytes.firstIndex(of: 93) else { return "" }
            let port = bytes[(close + 1)...]
            guard port.isEmpty || (port.first == 58 && port.count >= 2 && port.dropFirst().allSatisfy { $0 >= 48 && $0 <= 57 }) else { return "" }
            let inner = Array(bytes[1..<close])
            return looksLikeIPv6(inner) && inner.count <= 45 ? String(decoding: inner, as: UTF8.self) : ""
        }
        if looksLikeIPv6(bytes) { return bytes.count <= 45 ? value : "" }

        var host = value
        switch bytes.filter({ $0 == 58 }).count {
        case 0: break
        case 1:
            let parts = value.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, (1...5).contains(parts[1].count), parts[1].allSatisfy({ $0.isASCII && $0.isNumber }) else { return "" }
            host = String(parts[0])
        default: return ""
        }
        if host.hasSuffix(".") { host.removeLast() }
        guard !host.isEmpty else { return "" }
        if !host.allSatisfy(\.isASCII) {
            guard let ascii = URL(string: "https://" + host)?.host else { return "" }
            host = ascii.lowercased()
            if host.hasSuffix(".") { host.removeLast() }
        }
        guard host.utf8.count <= 253, host.utf8.allSatisfy({ ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 || $0 == 95 || $0 == 46 }) else { return "" }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard !labels.contains(where: { $0.isEmpty || $0.utf8.count > 63 }) else { return "" }

        // Drop leading `www.` labels while what remains is not a public suffix (`www.com` and `www.ck` are real hosts).
        var start = 0
        while start + 1 < labels.count, labels[start] == "www", !isPublicSuffix(labels[(start + 1)...]) { start += 1 }
        let result = labels[start...].joined(separator: ".")
        return result == "www" ? "" : result
    }

    // MARK: Suffix rules

    /// Hex digits, colons and dots with at least two colons.
    private static func looksLikeIPv6(_ bytes: [UInt8]) -> Bool {
        var colons = 0
        for b in bytes {
            if b == 58 { colons += 1 }
            else if !((b >= 48 && b <= 57) || (b >= 97 && b <= 102) || (b >= 65 && b <= 70) || b == 46) { return false }
        }
        return colons >= 2
    }

    /// IPv6 literals, and IPv4-like hosts by the WHATWG rule: the last label is all digits or `0x` plus hex digits.
    private static func isIPLike(_ host: String) -> Bool {
        if host.contains(":") { return true }
        guard let last = host.split(separator: ".", omittingEmptySubsequences: false).last, !last.isEmpty else { return false }
        if last.allSatisfy({ $0.isASCII && $0.isNumber }) { return true }
        return last.hasPrefix("0x") && last.dropFirst(2).allSatisfy(\.isHexDigit)
    }

    /// A public suffix, the parent of a wildcard rule (exact-only: other parties register names beneath it) or a local name.
    private static func isPublicSuffix(_ labels: ArraySlice<String>) -> Bool {
        let rules = PublicSuffixList.rules
        if labels.count == 1 {
            let label = labels[labels.startIndex]
            return rules.normal.contains(label) || rules.wildcard.contains(label) || localNames.contains(label)
        }
        if labels.count <= maxRuleLabels, rules.wildcard.contains(labels.joined(separator: ".")) { return true }
        return suffixLength(labels) >= labels.count
    }

    /// Number of labels in the public suffix: exception rules win, then the longest normal or wildcard rule, and an
    /// unlisted top-level name counts as a one-label suffix. Looks at no more than `maxRuleLabels` labels from the right and
    /// builds each candidate once.
    private static func suffixLength(_ labels: ArraySlice<String>) -> Int {
        let rules = PublicSuffixList.rules
        let n = labels.count
        var tail = "", best = 1
        for k in 1...max(1, min(n, maxRuleLabels)) {
            let label = labels[labels.endIndex - k]
            tail = k == 1 ? label : label + "." + tail
            if rules.exception.contains(tail) { return k - 1 }
            if rules.normal.contains(tail) { best = max(best, k) }
            if k < n, rules.wildcard.contains(tail) { best = max(best, k + 1) }
        }
        return best
    }
}
