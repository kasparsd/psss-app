import Foundation

// The short-lived permission that lets the Safari extension on iPhone and iPad fill cards and addresses (design C of
// `docs/plans/ios-safari-fill.md`). The grant is the data itself: the cards and addresses of one vault, nothing else, written by
// the app after an unlock and refused by both processes 120 seconds later. The folder `App/SafariFill` is compiled into the
// extension, so it uses Foundation (and Security for the Keychain) only and knows nothing about vaults or their files.

/// What went wrong with a grant. No case carries a value, so no error can put a card, a name or an address in a message or a log.
enum SafariFillError: Error, Equatable, Sendable {
    /// The Keychain could not be read, for example while the device is locked. Nothing was deleted.
    case storeUnavailable
    case saveFailed
    case deleteFailed
    /// More bytes, entries or characters than a grant may hold.
    case overCap
    /// Not a grant this code can read: damaged, cut off, a wrong shape or a wrong identifier.
    case unreadable
    case unknownVersion
    case expired
    /// The clocks went backwards or disagree: a restart or a changed wall clock.
    case clockChanged
    case vaultNotListed
    /// A revoke was unfinished, or began while this grant waited to be written, so it was not stored.
    case revoked
}

/// The two clocks a grant is judged by, in milliseconds. A test passes its own.
protocol SafariFillClock: Sendable {
    /// Since 1970. The person and the network can change it.
    func wallMilliseconds() -> Int64
    /// Counts on through sleep, cannot be set, and restarts when the device does.
    func continuousMilliseconds() -> Int64
}

struct SystemSafariFillClock: SafariFillClock {
    func wallMilliseconds() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    /// `CLOCK_MONOTONIC_RAW` includes the time asleep and, unlike `mach_continuous_time`, needs no required-reason declaration.
    /// A failed read gives 0, which `validate` refuses for any grant issued later than that.
    func continuousMilliseconds() -> Int64 { Int64(clamping: clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) / 1_000_000) }
}

/// Keeps a value out of `print`, string interpolation, `dump` and the debugger's summary.
protocol SafariFillRedacted: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {}

extension SafariFillRedacted {
    var description: String { "\(Self.self)(redacted)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: [:]) }
}

/// The stored permission. Two things whoever reads one must know:
///
/// - Titles, labels, cardholder and full names and the vault's name are the person's own text and can hold a full card number (or
///   anything else). Whatever shows them before a release, `status` above all, must mask card numbers in them.
/// - Limit: a restart is noticed only through the two clocks. A device restarted within the two minutes, whose new uptime then
///   falls within 120 s after the old uptime at issue and whose wall clock is set by hand to within 5 s of matching, would accept
///   the grant. A boot session identifier would close this, but none is confirmed readable by an iOS app and extension without
///   entitlements. The restart needs the passcode afterwards, and the app deletes any grant at launch.
struct SafariFillGrant: Codable, Equatable, Sendable, SafariFillRedacted {
    static let currentVersion = 1
    /// Constants of the code, never read from the stored item.
    static let lifetimeMilliseconds: Int64 = 120_000
    static let wallLimitMilliseconds: Int64 = 125_000
    static let clockToleranceMilliseconds: Int64 = 5_000
    static let maxBytes = 64 * 1024
    static let maxCards = 100
    static let maxAddresses = 100
    /// Counted in Unicode scalars, so a run of combining marks cannot pass as one character.
    static let maxCharacters = 512
    static let idBytes = 16
    static let numberDigits = 12...19
    static let securityCodeDigits = 3...4

    struct Vault: Codable, Equatable, Sendable, SafariFillRedacted {
        var id: UUID
        var name: String
    }

    struct Card: Codable, Equatable, Sendable, SafariFillRedacted {
        var id: UUID
        var title: String
        var brand: String
        var cardholder: String
        /// ASCII digits only.
        var number: String
        /// `yyyy-mm`.
        var expiry: String?
        var securityCode: String?

        var strings: [String] { [title, brand, cardholder, number, expiry ?? "", securityCode ?? ""] }

        var isWithinCaps: Bool {
            strings.allSatisfy(SafariFillGrant.fits)
                && SafariFillGrant.isDigits(number, count: SafariFillGrant.numberDigits)
                && securityCode.map { SafariFillGrant.isDigits($0, count: SafariFillGrant.securityCodeDigits) } != false
                && expiry.map(SafariFillGrant.isMonth) != false
        }
    }

    struct Address: Codable, Equatable, Sendable, SafariFillRedacted {
        var id: UUID
        var label: String
        var fullName: String
        var organization: String
        var street: String
        var city: String
        var region: String
        var postalCode: String
        var country: String
        var email: String
        var phone: String

        var strings: [String] { [label, fullName, organization, street, city, region, postalCode, country, email, phone] }

        var isWithinCaps: Bool { strings.allSatisfy(SafariFillGrant.fits) }
    }

    var version = SafariFillGrant.currentVersion
    /// Random, new for every grant. Also stored beside the item, so a reader deletes only the grant it judged.
    var grantID: Data
    var issuedWall: Int64
    var issuedContinuous: Int64
    var vault: Vault
    var cards: [Card]
    var addresses: [Address]

    /// A grant that starts now.
    init(vault: Vault, cards: [Card] = [], addresses: [Address] = [], clock: some SafariFillClock = SystemSafariFillClock()) {
        var random = SystemRandomNumberGenerator()
        grantID = Data((0..<Self.idBytes).map { _ in UInt8.random(in: .min ... .max, using: &random) })
        issuedWall = clock.wallMilliseconds()
        issuedContinuous = clock.continuousMilliseconds()
        self.vault = vault
        self.cards = cards
        self.addresses = addresses
    }

    static func fits(_ text: String) -> Bool { text.unicodeScalars.count <= maxCharacters }

    static func isDigits(_ text: String, count: ClosedRange<Int>) -> Bool {
        count.contains(text.utf8.count) && text.utf8.allSatisfy(isDigit)
    }

    private static func isDigit(_ byte: UInt8) -> Bool { (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) }

    private static func isMonth(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard bytes.count == 7, bytes[4] == UInt8(ascii: "-"), (bytes[0..<4] + bytes[5...]).allSatisfy(isDigit) else { return false }
        return (1...12).contains(Int(bytes[5] - 48) * 10 + Int(bytes[6] - 48))
    }

    private var isWithinCaps: Bool {
        Self.fits(vault.name) && cards.count <= Self.maxCards && addresses.count <= Self.maxAddresses
            && cards.allSatisfy(\.isWithinCaps) && addresses.allSatisfy(\.isWithinCaps)
    }

    /// A card or an address is named by its identifier alone, so no two entries may share one.
    private var hasUniqueIDs: Bool {
        let ids = cards.map(\.id) + addresses.map(\.id)
        return Set(ids).count == ids.count
    }

    /// The one way a grant or a part of it becomes bytes, so sizes measured part by part add up to the whole.
    static func bytes(of value: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do { return try encoder.encode(value) } catch { throw SafariFillError.unreadable }
    }

    /// The bytes to store. Refuses a grant that `decode` would refuse.
    func encoded() throws -> Data {
        guard grantID.count == Self.idBytes, isWithinCaps else { throw SafariFillError.overCap }
        guard hasUniqueIDs else { throw SafariFillError.unreadable }
        let data = try Self.bytes(of: self)
        guard data.count <= Self.maxBytes else { throw SafariFillError.overCap }
        return data
    }

    /// Reads stored bytes. The size is checked before parsing and the version before the rest of the shape. The decoder's own
    /// errors are dropped, as they can quote what they read.
    static func decode(_ data: Data) throws -> SafariFillGrant {
        struct Header: Decodable { let version: Int }
        guard data.count <= maxBytes else { throw SafariFillError.overCap }
        guard let header = try? JSONDecoder().decode(Header.self, from: data) else { throw SafariFillError.unreadable }
        guard header.version == currentVersion else { throw SafariFillError.unknownVersion }
        guard let grant = try? JSONDecoder().decode(SafariFillGrant.self, from: data), grant.grantID.count == idBytes,
              grant.hasUniqueIDs else {
            throw SafariFillError.unreadable
        }
        guard grant.isWithinCaps else { throw SafariFillError.overCap }
        return grant
    }

    /// Whether the grant may be used now. Fails closed: both clocks must have moved forward, by nearly the same amount, and by
    /// less than the lifetime, and the vault must still be one the app lists.
    func validate(clock: some SafariFillClock, listedVaults: Set<UUID>) throws {
        guard version == Self.currentVersion else { throw SafariFillError.unknownVersion }
        let wallNow = clock.wallMilliseconds(), continuousNow = clock.continuousMilliseconds()
        // With all four at zero or above, no subtraction below can overflow.
        guard issuedWall >= 0, issuedContinuous >= 0, wallNow >= 0, continuousNow >= 0 else { throw SafariFillError.clockChanged }
        let wall = wallNow - issuedWall, continuous = continuousNow - issuedContinuous
        guard wall >= 0, continuous >= 0, abs(wall - continuous) <= Self.clockToleranceMilliseconds else {
            throw SafariFillError.clockChanged
        }
        guard continuous < Self.lifetimeMilliseconds, wall < Self.wallLimitMilliseconds else { throw SafariFillError.expired }
        guard listedVaults.contains(vault.id) else { throw SafariFillError.vaultNotListed }
    }
}
