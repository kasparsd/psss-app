import Foundation
import CryptoKit

// Identities and keys (spec section 3): the person secret and what it derives, person cards, the group identifier and
// the key commitment.

struct Person {
    static let secretLength = 32
    static let kemPublicKeyLength = 1216

    let secret: Data
    /// Ed25519 private seed: HKDF(PS, empty salt, "psss/v1/person/sign").
    let signSeed: Data
    /// X-Wing private key (the 32-byte seed): HKDF(PS, empty salt, "psss/v1/person/kem").
    let kemSeed: Data
    /// The Ed25519 public key.
    let pid: Data
    /// The X-Wing public key, 1216 bytes.
    let kemPublicKey: Data
    let signingKey: Curve25519.Signing.PrivateKey
    let kemKey: XWingMLKEM768X25519.PrivateKey

    init(secret: Data) throws {
        guard secret.count == Person.secretLength else { throw FormatError("bad_person_secret", .reject) }
        self.secret = secret
        signSeed = FormatCrypto.hkdf(ikm: secret, salt: Data(), info: FormatCrypto.label("psss/v1/person/sign"))
        kemSeed = FormatCrypto.hkdf(ikm: secret, salt: Data(), info: FormatCrypto.label("psss/v1/person/kem"))
        signingKey = try Curve25519.Signing.PrivateKey(rawRepresentation: signSeed)
        kemKey = try XWingMLKEM768X25519.PrivateKey(seedRepresentation: kemSeed, publicKey: nil)
        pid = signingKey.publicKey.rawRepresentation
        kemPublicKey = kemKey.publicKey.rawRepresentation
    }

    /// A new person with a random secret.
    static func generate() throws -> Person { try Person(secret: FormatCrypto.randomBytes(secretLength)) }

    /// The pid a secret derives, or nil when it is not a 32-byte secret.
    static func pid(forSecret secret: Data) -> Data? { try? Person(secret: secret).pid }

    /// Ed25519 signature by the person's key. CryptoKit's Ed25519 is randomized, so two calls differ (see the findings).
    func sign(_ message: Data) throws -> Data { try signingKey.signature(for: message) }

    /// The bytes the card signature covers: "psss/v1/card" || pid || kem_pk.
    static func cardMessage(pid: Data, kemPublicKey: Data) -> Data {
        FormatCrypto.label("psss/v1/card") + pid + kemPublicKey
    }

    /// The person card, `{ 1: pid, 2: kem_pk, 3: sig }`. `signer` replaces the signature step (the vector tests pass the
    /// reference signature to check the rest byte for byte).
    func card(signer: ((Data) throws -> Data)? = nil) throws -> Data {
        let message = Person.cardMessage(pid: pid, kemPublicKey: kemPublicKey)
        let signature = try signer?(message) ?? sign(message)
        return try PersonCard.encode(pid: pid, kemPublicKey: kemPublicKey, signature: signature)
    }
}

enum PersonCard {
    static func encode(pid: Data, kemPublicKey: Data, signature: Data) throws -> Data {
        try FormatCBOR.encode(.uintMap([(1, .bytes(pid)), (2, .bytes(kemPublicKey)), (3, .bytes(signature))]))
    }

    /// Checks the shape and the self-signature of a card and returns what it carries. No keys other than 1, 2 and 3.
    static func verify(_ data: Data) throws -> (pid: Data, kemPublicKey: Data) {
        let value: CBORValue
        do { value = try FormatCBOR.decode(data) } catch { throw FormatError("bad_card") }
        guard let entries = value.mapEntries else { throw FormatError("bad_card") }
        var fields: [UInt64: CBORValue] = [:]
        for entry in entries {
            guard let key = entry.key.uintValue else { throw FormatError("bad_card") }
            guard (1...3).contains(key) else { throw FormatError("unknown_key") }
            fields[key] = entry.value
        }
        guard let pidValue = fields[1], let kemValue = fields[2], let sigValue = fields[3] else { throw FormatError("missing_key") }
        guard let pid = pidValue.bytesValue, pid.count == 32, let kem = kemValue.bytesValue, kem.count == Person.kemPublicKeyLength,
              let sig = sigValue.bytesValue, sig.count == 64 else { throw FormatError("bad_card") }
        let result = Ed25519Strict.verify(publicKey: pid, message: Person.cardMessage(pid: pid, kemPublicKey: kem), signature: sig)
        guard result == .ok else { throw FormatError("bad_card_signature", .reject) }
        return (pid, kem)
    }
}

enum GroupIdentity {
    /// gid = SHA-256("psss/v1/gid" || creator_pid || genesis_nonce || SHA-256("psss/v1/gid-key" || K_0) || u32(min_reader)).
    static func gid(creatorPID: Data, genesisNonce: Data, k0: Data, minReader: UInt32) -> Data {
        FormatCrypto.sha256(FormatCrypto.label("psss/v1/gid"), creatorPID, genesisNonce,
                            FormatCrypto.sha256(FormatCrypto.label("psss/v1/gid-key"), k0), FormatCrypto.u32(minReader))
    }

    /// commit(e) = SHA-256("psss/v1/key-commit" || gid || u32(e) || K_e).
    static func commit(gid: Data, epoch: UInt32, key: Data) -> Data {
        FormatCrypto.sha256(FormatCrypto.label("psss/v1/key-commit"), gid, FormatCrypto.u32(epoch), key)
    }
}
