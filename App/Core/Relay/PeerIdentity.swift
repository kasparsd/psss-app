#if os(macOS)
import Darwin
import Foundation
import Security

/// Who is on the other end of a connected local socket, from the kernel's audit token and the code-signing system, never from
/// anything the peer says. The audit token names one process run, so it cannot be reused by a later process with the same number
/// (`Packages/cli-agent-prototype/probe/peer.swift` shows both sides).
///
/// A peer counts when its signature satisfies `anchor apple generic and certificate leaf[subject.OU] = "<TEAM>" and identifier "<id>"`.
/// `anchor apple generic` accepts Apple Development, Apple Distribution and Developer ID certificates, so one requirement covers
/// development, store and direct builds. The team is the one this process itself is signed with: an ad hoc build has none, and
/// then no peer is ever accepted (there is no "accept anything" in shipping code).
enum PeerIdentity {
    /// The native host's signing identifier (`build.py host` signs with `-i`).
    static let hostIdentifier = "app.psss.native-host"
    /// The Mac app's bundle identifier.
    static let appIdentifier = "app.psss.Psss"
    /// The Safari app extension's bundle identifier (the signing identifier of the embedded `.appex`).
    static let safariIdentifier = "app.psss.Psss.Safari"

    private static let solLocal: Int32 = 0  // SOL_LOCAL
    private static let localPeerToken: Int32 = 0x006  // LOCAL_PEERTOKEN

    /// A team identifier is ten upper-case letters and digits. Anything else never goes into a requirement.
    static func isTeamID(_ text: String) -> Bool {
        text.utf8.count == 10 && text.utf8.allSatisfy { ($0 >= 65 && $0 <= 90) || ($0 >= 48 && $0 <= 57) }
    }

    /// An identifier is what `codesign -i` wrote: letters, digits, dots and dashes.
    static func isIdentifier(_ text: String) -> Bool {
        !text.isEmpty && text.utf8.count <= 128 && text.utf8.allSatisfy { ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 46 || $0 == 45 }
    }

    static func requirement(team: String, identifier: String) -> String? {
        guard isTeamID(team), isIdentifier(identifier) else { return nil }
        return "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and identifier \"\(identifier)\""
    }

    /// The team this process is signed with, or nil (ad hoc, unsigned).
    static func ownTeam() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let team = (info as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String, isTeamID(team) else { return nil }
        return team
    }

    /// The code of the process on the other end of `fd`, by its audit token.
    static func peerCode(_ fd: Int32) -> SecCode? {
        var token = audit_token_t()
        var size = socklen_t(MemoryLayout<audit_token_t>.size)
        guard getsockopt(fd, solLocal, localPeerToken, &token, &size) == 0 else { return nil }
        let data = withUnsafeBytes(of: &token) { Data($0) }
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: data] as CFDictionary, [], &code) == errSecSuccess else { return nil }
        return code
    }

    /// Whether the peer's valid signature satisfies the requirement.
    static func peerSatisfies(_ fd: Int32, requirement text: String) -> Bool {
        guard let code = peerCode(fd) else { return false }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess, let requirement else { return false }
        return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
    }

    /// The code directory hash of the peer. Only the tests compare it (see `PeerPolicy.testing`).
    static func peerCDHash(_ fd: Int32) -> Data? {
        guard let code = peerCode(fd) else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess else { return nil }
        return (info as? [String: Any])?[kSecCodeInfoUnique as String] as? Data
    }
}

/// Which kind of caller a verified peer is. It comes only from the peer's signature, never from the message: each kind gets its own
/// rules for what the envelope's `caller` may say (`BrowserRelayServer`).
enum PeerKind: Sendable, Equatable {
    /// The native messaging host that Chrome and Firefox start. The envelope names the extension that started it.
    case nativeHost
    /// The Safari app extension of the Mac app. Its one possible `caller` is `RelayLimits.safariCaller`.
    case safari
}

/// What the relay server asks of each connection before it reads a byte.
struct PeerPolicy: Sendable {
    /// Which kind of caller the process on the other end of the connected socket is, or nil when it may not talk to the relay.
    let identify: @Sendable (Int32) -> PeerKind?

    /// The shipping policy: the native host or the Safari extension, signed with this process's own team. An ad hoc build has no
    /// team and gets no policy.
    static func signed() -> PeerPolicy? {
        guard let team = PeerIdentity.ownTeam(),
              let host = PeerIdentity.requirement(team: team, identifier: PeerIdentity.hostIdentifier),
              let safari = PeerIdentity.requirement(team: team, identifier: PeerIdentity.safariIdentifier) else { return nil }
        return PeerPolicy { fd in
            if PeerIdentity.peerSatisfies(fd, requirement: host) { return .nativeHost }
            if PeerIdentity.peerSatisfies(fd, requirement: safari) { return .safari }
            return nil
        }
    }

    #if HOSTLESS_TESTS || PSSS_RELAY_TESTING
    /// For hostless tests only (the release app has none of this). `accept` (a native host), `safari` (a Safari extension), `refuse`,
    /// or `cdhash:<hex>` / `safari-cdhash:<hex>`: accept only the peer whose code directory hash is this one, as that kind, which
    /// exercises the real audit-token path with an ad hoc signed client.
    static func testing(_ mode: String) -> PeerPolicy {
        if mode == "accept" { return PeerPolicy { _ in .nativeHost } }
        if mode == "safari" { return PeerPolicy { _ in .safari } }
        for (prefix, kind) in [("cdhash:", PeerKind.nativeHost), ("safari-cdhash:", PeerKind.safari)] where mode.hasPrefix(prefix) {
            let wanted = String(mode.dropFirst(prefix.count))
            return PeerPolicy { fd in PeerIdentity.peerCDHash(fd).map { $0.map { String(format: "%02x", $0) }.joined() } == wanted ? kind : nil }
        }
        return PeerPolicy { _ in nil }
    }
    #endif
}
#endif
