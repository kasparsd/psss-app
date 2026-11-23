import Foundation
import CryptoKit

// HPKE with the X-Wing KEM (spec section 1) and wrapped group keys (section 7.1).

enum XWingHPKE {
    /// KEM 0x647a (X-Wing), KDF 0x0001 (HKDF-SHA256), AEAD 0x0002 (AES-256-GCM), base mode, single shot.
    static let suite = HPKE.Ciphersuite.XWingMLKEM768X25519_SHA256_AES_GCM_256
    static let encapsulatedKeyLength = 1120
    static let tagLength = 16

    /// enc (1120 bytes) || ciphertext. `aad` may be empty.
    static func seal(to publicKey: Data, info: Data, aad: Data, plaintext: Data) throws -> Data {
        let key = try XWingMLKEM768X25519.PublicKey(rawRepresentation: publicKey)
        var sender = try HPKE.Sender(recipientKey: key, ciphersuite: suite, info: info)
        let ciphertext = try sender.seal(plaintext, authenticating: aad)
        return sender.encapsulatedKey + ciphertext
    }

    /// Opens enc || ciphertext with the private key given as its 32-byte seed. Any failure is `bad_hpke`.
    static func open(seed: Data, info: Data, aad: Data, blob: Data) throws -> Data {
        let failure = FormatError("bad_hpke", .reject)
        guard blob.count >= encapsulatedKeyLength + tagLength else { throw failure }
        do {
            let key = try XWingMLKEM768X25519.PrivateKey(seedRepresentation: seed, publicKey: nil)
            let base = blob.startIndex
            var recipient = try HPKE.Recipient(privateKey: key, ciphersuite: suite, info: info,
                                               encapsulatedKey: Data(blob[base..<(base + encapsulatedKeyLength)]))
            return try recipient.open(Data(blob[(base + encapsulatedKeyLength)...]), authenticating: aad)
        } catch {
            throw failure
        }
    }
}

enum GroupKeyWrap {
    /// enc (1120 bytes) || ciphertext (48 bytes).
    static let length = 1168

    /// info = "psss/v1/group-key" || gid || u32(e) || recipient_pid
    static func info(gid: Data, epoch: UInt32, recipientPID: Data) -> Data {
        FormatCrypto.label("psss/v1/group-key") + gid + FormatCrypto.u32(epoch) + recipientPID
    }

    /// HPKE.SealBase(recipient kem_pk, info, aad = empty, plaintext = K_e)
    static func wrap(groupKey: Data, gid: Data, epoch: UInt32, recipientPID: Data, recipientKemPublicKey: Data) throws -> Data {
        try XWingHPKE.seal(to: recipientKemPublicKey, info: info(gid: gid, epoch: epoch, recipientPID: recipientPID), aad: Data(),
                           plaintext: groupKey)
    }

    /// Opens one wrap. A wrap is not signed: the caller trusts the key only after the commitment checks (`select`).
    static func unwrap(_ wrap: Data, gid: Data, epoch: UInt32, recipientPID: Data, kemSeed: Data) throws -> Data {
        let failure = FormatError("bad_wrap", .reject)
        guard wrap.count == length else { throw failure }
        guard let key = try? XWingHPKE.open(seed: kemSeed, info: info(gid: gid, epoch: epoch, recipientPID: recipientPID), aad: Data(),
                                            blob: wrap), key.count == 32 else { throw failure }
        return key
    }

    /// Tries each wrap and returns the first key whose commitment commit(e) matches; nil when none does.
    static func select(wraps: [Data], gid: Data, epoch: UInt32, recipientPID: Data, kemSeed: Data, commit: Data) -> Data? {
        for wrap in wraps {
            if let key = try? unwrap(wrap, gid: gid, epoch: epoch, recipientPID: recipientPID, kemSeed: kemSeed),
               GroupIdentity.commit(gid: gid, epoch: epoch, key: key) == commit { return key }
        }
        return nil
    }
}
