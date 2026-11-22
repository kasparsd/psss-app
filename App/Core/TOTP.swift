import CryptoKit
import Foundation

/// The parameters an authenticator seed carries besides the secret. Most sites use the defaults.
struct TOTPSettings: Equatable, Sendable, Codable {
    enum Algorithm: String, Sendable, Codable { case sha1 = "SHA1", sha256 = "SHA256", sha512 = "SHA512" }

    var digits = 6
    var period = 30
    var algorithm = Algorithm.sha1

    static let standard = TOTPSettings()
}

/// A secret with the parameters and labels that came with it.
struct TOTPSetup: Equatable, Sendable {
    var secret: String
    var settings = TOTPSettings.standard
    var issuer = ""
    var account = ""
}

/// What a pasted text or a decoded QR code turned out to be.
enum TOTPParse: Equatable, Sendable {
    case setup(TOTPSetup)
    /// Nothing to read.
    case empty
    /// A web address: the QR code on the site's page, not its setup code.
    case webLink
    /// Google Authenticator's export of several accounts.
    case migration
    /// An `otpauth://` link for a type that cannot make a correct code here (counter-based, odd digits, unknown algorithm).
    case unsupported
    /// Not a usable Base32 secret.
    case invalidKey
}

/// RFC 6238 time-based one-time passwords.
enum TOTP {
    static func code(secret: String, settings: TOTPSettings = .standard, at date: Date = .now) -> String? {
        guard let key = base32Decode(secret), !key.isEmpty, settings.period > 0, (6...8).contains(settings.digits) else { return nil }
        var counter = UInt64(max(0, date.timeIntervalSince1970) / Double(settings.period)).bigEndian
        let message = Data(bytes: &counter, count: MemoryLayout<UInt64>.size)
        let symmetric = SymmetricKey(data: key)
        let mac: [UInt8]
        switch settings.algorithm {
        case .sha1: mac = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: symmetric))
        case .sha256: mac = Array(HMAC<SHA256>.authenticationCode(for: message, using: symmetric))
        case .sha512: mac = Array(HMAC<SHA512>.authenticationCode(for: message, using: symmetric))
        }
        let offset = Int(mac[mac.count - 1] & 0x0f)
        let truncated = mac[offset...offset + 3].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } & 0x7fff_ffff
        var modulus: UInt32 = 1
        for _ in 0..<settings.digits { modulus *= 10 }
        let number = String(truncated % modulus)
        return String(repeating: "0", count: settings.digits - number.count) + number
    }

    /// Accepts what people actually paste: a bare Base32 secret (spaces and dashes allowed) or an `otpauth://totp/...`
    /// link. Returns the clean upper-case secret, or nil when it is not a usable TOTP secret.
    static func normalizedSecret(_ input: String) -> String? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.lowercased().hasPrefix("otpauth://") {
            guard let components = URLComponents(string: text),
                  components.host?.lowercased() == "totp",
                  let value = components.queryItems?.first(where: { $0.name.lowercased() == "secret" })?.value
            else { return nil }
            text = value
        }
        let cleaned = text.uppercased().filter { !" -=".contains($0) }
        guard !cleaned.isEmpty, let key = base32Decode(cleaned), key.count >= 10 else { return nil }
        return cleaned
    }

    /// Reads a pasted setup key, an `otpauth://totp/...` link or the text of a decoded QR code, with its parameters.
    static func parse(_ input: String) -> TOTPParse {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = text.lowercased()
        if text.isEmpty { return .empty }
        if lower.hasPrefix("otpauth-migration://") { return .migration }
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") { return .webLink }
        guard lower.hasPrefix("otpauth://") else {
            return normalizedSecret(text).map { .setup(TOTPSetup(secret: $0)) } ?? .invalidKey
        }
        guard let components = URLComponents(string: text), components.host?.lowercased() == "totp" else { return .unsupported }
        func query(_ name: String) -> String? {
            components.queryItems?.first { $0.name.lowercased() == name }?.value
        }
        guard let secret = query("secret").flatMap(normalizedSecret) else { return .invalidKey }
        var settings = TOTPSettings.standard
        if let value = query("digits") {
            guard let digits = Int(value), (6...8).contains(digits) else { return .unsupported }
            settings.digits = digits
        }
        if let value = query("period") {
            guard let period = Int(value), (1...3600).contains(period) else { return .unsupported }
            settings.period = period
        }
        if let value = query("algorithm") {
            guard let algorithm = TOTPSettings.Algorithm(rawValue: value.uppercased().replacingOccurrences(of: "-", with: "")) else { return .unsupported }
            settings.algorithm = algorithm
        }
        // The label is "Issuer:account" (the path, already decoded); the issuer parameter wins when both exist.
        let label = String(components.path.drop(while: { $0 == "/" }))
        var issuer = ""
        var account = label
        if let colon = label.firstIndex(of: ":") {
            issuer = String(label[..<colon]).trimmingCharacters(in: .whitespaces)
            account = String(label[label.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        }
        if let named = query("issuer"), !named.isEmpty { issuer = named.replacingOccurrences(of: "+", with: " ") }
        return .setup(TOTPSetup(secret: secret, settings: settings, issuer: issuer, account: account))
    }

    /// The `otpauth://` link authenticator apps scan or import. Every parameter is spelled out.
    static func setupURL(secret: String, issuer: String, account: String, settings: TOTPSettings = .standard) -> String {
        var components = URLComponents()
        components.scheme = "otpauth"
        components.host = "totp"
        let label = account.isEmpty ? issuer : "\(issuer):\(account)"
        components.path = "/" + label
        components.queryItems = [
            URLQueryItem(name: "secret", value: secret),
            URLQueryItem(name: "issuer", value: issuer),
            URLQueryItem(name: "algorithm", value: settings.algorithm.rawValue),
            URLQueryItem(name: "digits", value: String(settings.digits)),
            URLQueryItem(name: "period", value: String(settings.period))
        ]
        return components.string ?? ""
    }

    /// A code split in the middle for reading aloud and typing: 482 913, 1234 5678.
    static func grouped(_ code: String) -> String {
        guard code.count == 6 || code.count == 8 else { return code }
        let half = code.count / 2
        return code.prefix(half) + " " + code.suffix(half)
    }

    static func secondsRemaining(period: Int = 30, at date: Date = .now) -> Int {
        let length = Double(max(1, period))
        return Int(length - date.timeIntervalSince1970.truncatingRemainder(dividingBy: length))
    }

    static func base32Decode(_ text: String) -> Data? {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var buffer: UInt32 = 0
        var bits = 0
        var output = Data()
        for character in text.uppercased() where character != " " && character != "=" && character != "-" {
            guard let value = alphabet.firstIndex(of: character) else { return nil }
            buffer = (buffer << 5) | UInt32(value)
            bits += 5
            if bits >= 8 {
                bits -= 8
                output.append(UInt8((buffer >> UInt32(bits)) & 0xff))
            }
        }
        return output
    }
}
