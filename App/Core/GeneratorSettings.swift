import Foundation

/// What a person chose in the password generator, kept per device in the App Group defaults the app and the AutoFill extension
/// share. Not a secret, not in the vault, not encrypted. Absence means the recommended settings.
///
/// Reading is forgiving on purpose: a stored version newer than this build reads as the recommended settings; a missing key, a wrong type, an unknown `kind` or a value out of range never fails. They become
/// the recommended value or the nearest allowed one.
struct GeneratorSettings: Codable, Equatable, Sendable {
    /// What kind of password. An unknown stored value falls back to `.apple`.
    enum Kind: String, Codable, Sendable { case apple, characters, words }
    enum Separator: String, Codable, Sendable { case hyphen, space, period, none }

    static let currentVersion = 1
    static let wordRange = 4...7
    static let lengthRange = 12...64

    var version = GeneratorSettings.currentVersion
    /// Like Safari makes (recommended), random characters or words.
    var kind = Kind.apple
    /// Words only: the Length slider's value, 4 to 7.
    var words = 6
    /// Random characters only: the Length slider's value, 12 to 64 (the password is never longer than 64).
    var length = 20
    /// Words and random characters: at least one number. A site's rules can ask for more.
    var includeNumber = true
    /// Words and random characters: at least one symbol.
    var includeSymbol = false
    /// Words only, behind More Options.
    var separator = Separator.hyphen
    var capitalize = true

    static let recommended = GeneratorSettings()

    /// Values brought into range.
    var clamped: GeneratorSettings {
        var result = self
        result.words = min(max(words, Self.wordRange.lowerBound), Self.wordRange.upperBound)
        result.length = min(max(length, Self.lengthRange.lowerBound), Self.lengthRange.upperBound)
        return result
    }

    /// True when anything the person can change differs from the recommended settings (Reset to Recommended is shown then).
    var differsFromRecommended: Bool { clamped != Self.recommended }

    /// Back to the recommended settings, in memory. Call `save()` to keep it.
    mutating func reset() { self = Self.recommended }

    // MARK: Coding

    private enum CodingKeys: String, CodingKey {
        case version, kind, words, length, includeNumber, includeSymbol, separator, capitalize
    }

    init(version: Int = GeneratorSettings.currentVersion, kind: Kind = .apple, words: Int = 6, length: Int = 20,
         includeNumber: Bool = true, includeSymbol: Bool = false, separator: Separator = .hyphen, capitalize: Bool = true) {
        self.version = version; self.kind = kind; self.words = words; self.length = length
        self.includeNumber = includeNumber; self.includeSymbol = includeSymbol
        self.separator = separator; self.capitalize = capitalize
        self = clamped
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? container.decode(Int.self, forKey: .version)) ?? Self.currentVersion
        // A newer version may mean something else by the same keys. Do not guess: start from the recommended settings.
        if version > Self.currentVersion { self = .recommended; return }
        kind = (try? container.decode(String.self, forKey: .kind)).flatMap(Kind.init(rawValue:)) ?? .apple
        words = (try? container.decode(Int.self, forKey: .words)) ?? words
        length = (try? container.decode(Int.self, forKey: .length)) ?? length
        includeNumber = (try? container.decode(Bool.self, forKey: .includeNumber)) ?? includeNumber
        includeSymbol = (try? container.decode(Bool.self, forKey: .includeSymbol)) ?? includeSymbol
        separator = (try? container.decode(String.self, forKey: .separator)).flatMap(Separator.init(rawValue:)) ?? .hyphen
        capitalize = (try? container.decode(Bool.self, forKey: .capitalize)) ?? capitalize
        self = clamped
    }

    // MARK: Storage

    static let storageKey = "passwordGenerator"

    /// The stored settings, or the recommended ones when nothing readable is stored.
    static func load() -> GeneratorSettings {
        guard let data = GeneratorSettingsStorage.read(),
              let stored = try? JSONDecoder().decode(GeneratorSettings.self, from: data) else { return .recommended }
        return stored
    }

    func save() {
        GeneratorSettingsStorage.write(try? JSONEncoder().encode(clamped))
    }

    /// Forgets what is stored and returns the recommended settings.
    static func resetStored() -> GeneratorSettings {
        GeneratorSettingsStorage.write(nil)
        return .recommended
    }
}

/// Where the settings are kept: the App Group defaults the app and the AutoFill extension share (the same suite as the biometric
/// key's remembered choice). Nil defaults, such as a Mac build without the group, read as nothing stored and write nothing.
///
/// Hostless tests (`HOSTLESS_TESTS`) replace the defaults with a stand-in in memory, so no test touches the real ones.
enum GeneratorSettingsStorage {
    #if HOSTLESS_TESTS
    nonisolated(unsafe) static var memory: Data?
    static func read() -> Data? { memory }
    static func write(_ data: Data?) { memory = data }
    #else
    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedVault.groupID) }
    static func read() -> Data? { defaults?.data(forKey: GeneratorSettings.storageKey) }
    static func write(_ data: Data?) {
        if let data { defaults?.set(data, forKey: GeneratorSettings.storageKey) } else { defaults?.removeObject(forKey: GeneratorSettings.storageKey) }
    }
    #endif
}
