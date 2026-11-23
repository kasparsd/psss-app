import Foundation
import CryptoKit

// Slots: the person secret wrapped to an unlock secret (spec section 7.2). A slot is the deterministic CBOR map
// { 1: 1, 2: type, 3: pid, 4: slot_id, 5: params, 6: ciphertext }; the AEAD associated data is the same map without key 6.

enum SlotUnlock {
    case password(String)
    case kit(Data)
    /// The device's X-Wing private key as its 32-byte seed.
    case deviceKemSeed(Data)
}

struct PasswordKDFParameters: Equatable, Sendable {
    var memoryKiB: UInt64
    var passes: UInt64
    var lanes: UInt64

    static let standard = PasswordKDFParameters(memoryKiB: 131_072, passes: 3, lanes: 4)

    /// The limits of section 7.2. A slot comes from storage, so these are checked before any Argon2id work. `allowTest`
    /// lifts only the floors on memory and passes (the explicit test-only switch for the published vectors).
    func check(allowTest: Bool) throws {
        let weak = FormatError("argon2_too_weak", .reject)
        if lanes == 0 || memoryKiB / 8 < lanes { throw weak }   // zero lanes, or less than 8 KiB of memory per lane
        if memoryKiB > 1_048_576 || passes > 16 || lanes > 16 { throw FormatError("argon2_too_strong", .reject) }
        if !allowTest && (memoryKiB < 65_536 || passes < 2) { throw weak }
    }
}

enum Slots {
    static let version: UInt64 = 1
    static let typePassword: UInt64 = 1
    static let typeKit: UInt64 = 2
    static let typeDevice: UInt64 = 3

    /// Encodes a slot. With `ciphertext` nil the result is the associated data (the map without key 6).
    static func encode(version: UInt64 = Slots.version, type: UInt64, pid: Data, slotID: Data, params: CBORValue, ciphertext: Data?) throws -> Data {
        var pairs: [(UInt64, CBORValue)] = [(1, .uint(version)), (2, .uint(type)), (3, .bytes(pid)), (4, .bytes(slotID)), (5, params)]
        if let ciphertext { pairs.append((6, .bytes(ciphertext))) }
        return try FormatCBOR.encode(.uintMap(pairs))
    }

    static func passwordParams(salt: Data, _ p: PasswordKDFParameters) -> CBORValue {
        .uintMap([(1, .bytes(salt)), (2, .uint(p.memoryKiB)), (3, .uint(p.passes)), (4, .uint(p.lanes))])
    }

    /// The password is the UTF-8 bytes of what the person typed, normalized to NFC.
    static func passwordBytes(_ password: String) -> Data { Data(password.precomposedStringWithCanonicalMapping.utf8) }

    private static func derivePasswordKey(password: String, salt: Data, _ p: PasswordKDFParameters, slotID: Data) throws -> Data {
        let kek = try Argon2.hash(password: passwordBytes(password),
                                  .init(variant: .id, salt: salt, iterations: UInt32(p.passes), memoryKiB: UInt32(p.memoryKiB), lanes: UInt32(p.lanes)))
        return FormatCrypto.hkdf(ikm: kek, salt: slotID, info: FormatCrypto.label("psss/v1/slot/password"))
    }

    // MARK: Sealing

    /// Type 1. `ps` is not checked against `pid`, so that tests can build a slot that lies; a reader checks.
    static func sealPassword(ps: Data, pid: Data, slotID: Data, salt: Data, parameters: PasswordKDFParameters, password: String,
                             allowTestParameters: Bool = false) throws -> Data {
        try parameters.check(allowTest: allowTestParameters)
        let params = passwordParams(salt: salt, parameters)
        let aad = try encode(type: typePassword, pid: pid, slotID: slotID, params: params, ciphertext: nil)
        let key = try derivePasswordKey(password: password, salt: salt, parameters, slotID: slotID)
        return try encode(type: typePassword, pid: pid, slotID: slotID, params: params,
                          ciphertext: FormatCrypto.chachaSeal(key: key, aad: aad, plaintext: ps))
    }

    /// Type 2.
    static func sealKit(ps: Data, pid: Data, slotID: Data, kit: Data) throws -> Data {
        let params = CBORValue.map([])
        let aad = try encode(type: typeKit, pid: pid, slotID: slotID, params: params, ciphertext: nil)
        let key = FormatCrypto.hkdf(ikm: kit, salt: slotID, info: FormatCrypto.label("psss/v1/slot/kit"))
        return try encode(type: typeKit, pid: pid, slotID: slotID, params: params,
                          ciphertext: FormatCrypto.chachaSeal(key: key, aad: aad, plaintext: ps))
    }

    /// Type 3: HPKE.SealBase(device kem_pk, info = "psss/v1/slot/device" || pid || slot_id, aad = the map without key 6, PS).
    static func sealDevice(ps: Data, pid: Data, slotID: Data, deviceKemPublicKey: Data) throws -> Data {
        let params = CBORValue.uintMap([(1, .bytes(deviceKemPublicKey))])
        let aad = try encode(type: typeDevice, pid: pid, slotID: slotID, params: params, ciphertext: nil)
        let blob = try XWingHPKE.seal(to: deviceKemPublicKey, info: deviceInfo(pid: pid, slotID: slotID), aad: aad, plaintext: ps)
        return try encode(type: typeDevice, pid: pid, slotID: slotID, params: params, ciphertext: blob)
    }

    static func deviceInfo(pid: Data, slotID: Data) -> Data { FormatCrypto.label("psss/v1/slot/device") + pid + slotID }

    // MARK: Opening

    private struct Parsed {
        var version: UInt64
        var type: UInt64
        var pid: Data
        var slotID: Data
        var params: CBORValue
        var ciphertext: Data
        var aad: Data
    }

    private static func parse(_ data: Data) throws -> Parsed {
        let bad = FormatError("bad_slot", .reject)
        guard let value = try? FormatCBOR.decode(data), let entries = value.mapEntries else { throw bad }
        var fields: [UInt64: CBORValue] = [:]
        for entry in entries {
            guard let key = entry.key.uintValue, (1...6).contains(key) else { throw bad }
            fields[key] = entry.value
        }
        guard let version = fields[1]?.uintValue, let type = fields[2]?.uintValue else { throw bad }
        if version != Slots.version || ![typePassword, typeKit, typeDevice].contains(type) { throw FormatError("unknown_slot", .ignore) }
        guard let pid = fields[3]?.bytesValue, pid.count == 32, let slotID = fields[4]?.bytesValue, slotID.count == 16,
              let params = fields[5], params.mapEntries != nil, let ciphertext = fields[6]?.bytesValue else { throw bad }
        let aad = try FormatCBOR.encode(.map(entries.filter { $0.key != .uint(6) }))
        return Parsed(version: version, type: type, pid: pid, slotID: slotID, params: params, ciphertext: ciphertext, aad: aad)
    }

    /// Opens a slot and returns the person secret. `allowTestParameters` is the test-only switch of section 7.2.
    /// After opening, the secret must derive the slot's pid (every slot).
    static func open(_ data: Data, unlock: SlotUnlock, allowTestParameters: Bool = false) throws -> Data {
        let slot = try parse(data)
        let bad = FormatError("bad_slot", .reject)
        let unlockFailed = FormatError("bad_unlock", .reject)
        let wrongUnlock = FormatError("wrong_unlock_for_slot_type", .reject)
        let secret: Data
        switch (slot.type, unlock) {
        case (typePassword, .password(let password)):
            guard let entries = slot.params.mapEntries, entries.count == 4,
                  let salt = slot.params.value(forKey: 1)?.bytesValue, salt.count == 16,
                  let memory = slot.params.value(forKey: 2)?.uintValue, let passes = slot.params.value(forKey: 3)?.uintValue,
                  let lanes = slot.params.value(forKey: 4)?.uintValue else { throw bad }
            let parameters = PasswordKDFParameters(memoryKiB: memory, passes: passes, lanes: lanes)
            try parameters.check(allowTest: allowTestParameters)
            let key: Data
            do { key = try derivePasswordKey(password: password, salt: salt, parameters, slotID: slot.slotID) } catch { throw bad }
            guard let opened = FormatCrypto.chachaOpen(key: key, aad: slot.aad, sealed: slot.ciphertext) else { throw unlockFailed }
            secret = opened
        case (typeKit, .kit(let kit)):
            guard slot.params.mapEntries?.isEmpty == true else { throw bad }
            let key = FormatCrypto.hkdf(ikm: kit, salt: slot.slotID, info: FormatCrypto.label("psss/v1/slot/kit"))
            guard let opened = FormatCrypto.chachaOpen(key: key, aad: slot.aad, sealed: slot.ciphertext) else { throw unlockFailed }
            secret = opened
        case (typeDevice, .deviceKemSeed(let seed)):
            guard slot.params.mapEntries?.count == 1, slot.params.value(forKey: 1)?.bytesValue?.count == Person.kemPublicKeyLength else { throw bad }
            guard let opened = try? XWingHPKE.open(seed: seed, info: deviceInfo(pid: slot.pid, slotID: slot.slotID), aad: slot.aad,
                                                   blob: slot.ciphertext) else { throw unlockFailed }
            secret = opened
        default:
            throw wrongUnlock
        }
        guard Person.pid(forSecret: secret) == slot.pid else { throw FormatError("ps_does_not_match_pid", .reject) }
        return secret
    }
}
