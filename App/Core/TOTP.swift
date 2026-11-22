import CryptoKit
import Foundation

/// RFC 6238 time-based one-time passwords (HMAC-SHA1, the format authenticator seeds use).
enum TOTP {
    static let period: TimeInterval = 30

    static func code(secret: String, at date: Date = .now, digits: Int = 6) -> String? {
        guard let key = base32Decode(secret), !key.isEmpty else { return nil }
        var counter = UInt64(max(0, date.timeIntervalSince1970) / period).bigEndian
        let message = Data(bytes: &counter, count: MemoryLayout<UInt64>.size)
        let mac = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: SymmetricKey(data: key)))
        let offset = Int(mac[mac.count - 1] & 0x0f)
        let truncated = mac[offset...offset + 3].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } & 0x7fff_ffff
        var modulus: UInt32 = 1
        for _ in 0..<digits { modulus *= 10 }
        let number = String(truncated % modulus)
        return String(repeating: "0", count: digits - number.count) + number
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

    /// The `otpauth://` link authenticator apps scan or import. Defaults (SHA-1, 6 digits, 30 s) are spelled out.
    static func setupURL(secret: String, issuer: String, account: String) -> String {
        var components = URLComponents()
        components.scheme = "otpauth"
        components.host = "totp"
        let label = account.isEmpty ? issuer : "\(issuer):\(account)"
        components.path = "/" + label
        components.queryItems = [
            URLQueryItem(name: "secret", value: secret),
            URLQueryItem(name: "issuer", value: issuer),
            URLQueryItem(name: "algorithm", value: "SHA1"),
            URLQueryItem(name: "digits", value: "6"),
            URLQueryItem(name: "period", value: "30")
        ]
        return components.string ?? ""
    }

    static func secondsRemaining(at date: Date = .now) -> Int {
        Int(period - date.timeIntervalSince1970.truncatingRemainder(dividingBy: period))
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
