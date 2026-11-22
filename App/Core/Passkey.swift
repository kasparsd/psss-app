import CryptoKit
import Foundation

/// A stored passkey. The private key never leaves the vault. A real vault keeps it inside the encrypted document.
struct PasskeyRecord: Codable, Sendable, Hashable {
    var credentialID: Data
    var userHandle: Data
    var rpID: String
    var privateKey: Data
    var created: Date
    var signCount: UInt32 = 0
}

/// WebAuthn "packed-less" passkeys: ES256 keys, `none` attestation, flags that mark a synced, user-verified credential.
enum Passkeys {
    struct Registration {
        var record: PasskeyRecord
        var attestationObject: Data
    }

    struct Assertion {
        var signature: Data
        var authenticatorData: Data
    }

    /// User present, user verified, backup eligible, backup state.
    private static let assertionFlags: UInt8 = 0x01 | 0x04 | 0x08 | 0x10
    private static let attestedFlag: UInt8 = 0x40

    static func register(rpID: String, userHandle: Data, clientDataHash: Data) -> Registration {
        let key = P256.Signing.PrivateKey()
        var credentialID = Data(count: 16)
        credentialID.withUnsafeMutableBytes { _ = SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let record = PasskeyRecord(credentialID: credentialID, userHandle: userHandle, rpID: rpID,
                                   privateKey: key.rawRepresentation, created: .now)

        let publicKey = key.publicKey.x963Representation // 0x04 || x || y
        let cose = CBOR.map([
            (.int(1), .int(2)),       // key type: EC2
            (.int(3), .int(-7)),      // algorithm: ES256
            (.int(-1), .int(1)),      // curve: P-256
            (.int(-2), .bytes(publicKey.subdata(in: 1..<33))),
            (.int(-3), .bytes(publicKey.subdata(in: 33..<65)))
        ])
        var authData = rpIDHash(rpID)
        authData.append(assertionFlags | attestedFlag)
        authData.append(contentsOf: [0, 0, 0, 0])
        authData.append(Data(count: 16)) // AAGUID: none
        authData.append(contentsOf: [UInt8(credentialID.count >> 8), UInt8(credentialID.count & 0xff)])
        authData.append(credentialID)
        authData.append(cose.encoded)

        let attestation = CBOR.map([
            (.text("fmt"), .text("none")),
            (.text("attStmt"), .map([])),
            (.text("authData"), .bytes(authData))
        ])
        return Registration(record: record, attestationObject: attestation.encoded)
    }

    static func assert(_ record: PasskeyRecord, clientDataHash: Data) throws -> Assertion {
        let key = try P256.Signing.PrivateKey(rawRepresentation: record.privateKey)
        var authData = rpIDHash(record.rpID)
        authData.append(assertionFlags)
        authData.append(contentsOf: [0, 0, 0, 0]) // synced passkeys report a zero counter
        let signature = try key.signature(for: authData + clientDataHash)
        return Assertion(signature: signature.derRepresentation, authenticatorData: authData)
    }

    private static func rpIDHash(_ rpID: String) -> Data {
        Data(SHA256.hash(data: Data(rpID.utf8)))
    }
}

/// The small slice of CBOR that WebAuthn needs.
indirect enum CBOR {
    case int(Int)
    case bytes(Data)
    case text(String)
    case map([(CBOR, CBOR)])

    var encoded: Data {
        switch self {
        case .int(let value):
            return value >= 0 ? Self.head(0, UInt64(value)) : Self.head(1, UInt64(-1 - value))
        case .bytes(let data):
            return Self.head(2, UInt64(data.count)) + data
        case .text(let string):
            let data = Data(string.utf8)
            return Self.head(3, UInt64(data.count)) + data
        case .map(let pairs):
            return pairs.reduce(Self.head(5, UInt64(pairs.count))) { $0 + $1.0.encoded + $1.1.encoded }
        }
    }

    private static func head(_ major: UInt8, _ value: UInt64) -> Data {
        let base = major << 5
        switch value {
        case 0..<24: return Data([base | UInt8(value)])
        case 24..<256: return Data([base | 24, UInt8(value)])
        default: return Data([base | 25, UInt8(value >> 8), UInt8(value & 0xff)])
        }
    }
}
