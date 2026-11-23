import Foundation

/// A site's password rules, read from Apple's Password Rules language (`required: upper; minlength: 8;`, the format of the
/// `passwordrules` attribute and of `ASGeneratePasswordsRequest`).
///
/// Parsing never fails: an unknown property, an unreadable number or a malformed class is ignored. When in doubt a reading
/// is chosen so that a password made for it also satisfies the other reading:
/// - `required: upper, lower` is one requirement that either class can meet (a union).
/// - `required: digit; required: digit` asks for two digits, so a repeated requirement raises its count.
/// - A custom class `[...]` lists characters literally. A hyphen is just a hyphen (there are no ranges), and a `]` straight
///   after the `[` is a member. Anything that is not printable ASCII is dropped.
/// - `unicode` is read as `ascii-printable`: only ASCII is ever generated.
/// - An unknown class inside `required` or `allowed` is skipped and the rest of the property is kept (skipping only narrows
///   what may be generated).
struct PasswordRules: Equatable, Sendable {
    /// At least `count` characters from `characters`.
    struct Requirement: Equatable, Hashable, Sendable {
        var characters: Set<Character>
        var count: Int
    }

    /// What the person says when a site rejects a password (see `applying(_:)`).
    enum Recovery: Sendable { case tooLong, needsSymbol, charactersNotAllowed }

    var minLength = 0
    var maxLength: Int?
    var required: [Requirement] = []
    /// Nil means the rules do not restrict the characters (printable ASCII).
    var allowed: Set<Character>?
    var maxConsecutive: Int?
    /// True when the text said something that cannot be read or met: a required or allowed class with no printable ASCII member
    /// (`[é]`), or text too long to read whole. Nothing is dropped silently: no password is made for such rules.
    var isUnsatisfiable = false

    /// The longest rule text that is read, after runs of white space and `;` are collapsed. Longer text is unsatisfiable, not cut.
    static let maximumTextLength = 4096

    /// Passwords Psss makes are never longer than this unless `minLength` demands more (bcrypt reads 72 bytes).
    static let generatedMaxLength = 64
    /// Never generated, whatever a rule asks.
    static let hardMaxLength = 128

    static let upper = characters(0x41...0x5A)
    static let lower = characters(0x61...0x7A)
    static let digit = characters(0x30...0x39)
    /// Apple's `special`: every printable ASCII character that is not a letter or a digit, 33 of them, space and hyphen included.
    static let special = characters(0x20...0x2F, 0x3A...0x40, 0x5B...0x60, 0x7B...0x7E)
    static let asciiPrintable = characters(0x20...0x7E)
    static let space: Character = " "

    private static func characters(_ ranges: ClosedRange<UInt8>...) -> Set<Character> {
        var set = Set<Character>()
        for range in ranges { for byte in range { set.insert(Character(Unicode.Scalar(byte))) } }
        return set
    }

    init(minLength: Int = 0, maxLength: Int? = nil, required: [Requirement] = [], allowed: Set<Character>? = nil,
         maxConsecutive: Int? = nil) {
        self.minLength = minLength; self.maxLength = maxLength; self.required = required
        self.allowed = allowed; self.maxConsecutive = maxConsecutive
    }

    // MARK: Parsing

    /// Never throws and never crashes, whatever the text.
    init(parsing text: String?) {
        self.init()
        guard let text, !text.isEmpty else { return }
        let characters = Self.collapsed(text)
        if characters.count > Self.maximumTextLength { isUnsatisfiable = true; return }
        var index = 0
        while index < characters.count {
            while index < characters.count, characters[index] == ";" || characters[index].isWhitespace { index += 1 }
            guard index < characters.count else { break }
            var key = ""
            while index < characters.count, characters[index] != ":", characters[index] != ";" { key.append(characters[index]); index += 1 }
            guard index < characters.count, characters[index] == ":" else { continue }
            index += 1
            let (value, next) = Self.scanValue(characters, from: index)
            index = next
            apply(key: key.trimmingCharacters(in: .whitespaces).lowercased(), value: value)
        }
    }

    /// The text without leading white space and with each run of white space and `;` outside a custom class cut to one `;` (when
    /// the run holds one) or one space. This happens before any length limit, so padding cannot push a rule out of view.
    private static func collapsed(_ text: String) -> [Character] {
        let input = Array(text)
        var output: [Character] = []
        var index = 0
        var hasSemicolon = false, hasSpace = false
        while index < input.count {
            let character = input[index]
            if character == ";" || character.isWhitespace {
                if character == ";" { hasSemicolon = true } else { hasSpace = true }
                index += 1
                continue
            }
            if !output.isEmpty, hasSemicolon || hasSpace { output.append(hasSemicolon ? ";" : " ") }
            hasSemicolon = false; hasSpace = false
            output.append(character)
            index += 1
            if character == "[" {
                var body = ""
                index = copyClassBody(input, from: index, into: &body)
                output.append(contentsOf: body)
            }
        }
        return output
    }

    /// The text up to the next `;` that is not inside a custom class, and where to carry on.
    private static func scanValue(_ text: [Character], from start: Int) -> (String, Int) {
        var index = start
        var value = ""
        while index < text.count {
            let character = text[index]
            if character == ";" { return (value, index + 1) }
            value.append(character)
            index += 1
            if character == "[" { index = copyClassBody(text, from: index, into: &value) }
        }
        return (value, index)
    }

    /// Copies a custom class's members and its closing bracket. A `]` straight after the opening bracket is a member.
    private static func copyClassBody(_ text: [Character], from start: Int, into value: inout String) -> Int {
        var index = start
        if index < text.count, text[index] == "]" { value.append("]"); index += 1 }
        while index < text.count, text[index] != "]" { value.append(text[index]); index += 1 }
        if index < text.count { value.append("]"); index += 1 }
        return index
    }

    private mutating func apply(key: String, value: String) {
        switch key {
        case "minlength":
            if let number = Self.number(value) { minLength = max(minLength, number) }
        case "maxlength":
            if let number = Self.number(value), number >= 1 { maxLength = min(maxLength ?? number, number) }
        case "max-consecutive":
            if let number = Self.number(value), number >= 1 { maxConsecutive = min(maxConsecutive ?? number, number) }
        case "required":
            let (set, unreadable) = Self.parseClasses(value)
            if !set.isEmpty { require(set) } else if unreadable { isUnsatisfiable = true }
        case "allowed":
            let (set, unreadable) = Self.parseClasses(value)
            if !set.isEmpty { allowed = (allowed ?? []).union(set) } else if unreadable { isUnsatisfiable = true }
        case "impossible":
            if value.trimmingCharacters(in: .whitespaces).lowercased() == "yes" { isUnsatisfiable = true }
        default:
            break
        }
    }

    private static func number(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }), let value = Int(trimmed) else { return nil }
        return min(value, 1000)
    }

    /// The union of the classes in a comma separated list. Unknown classes add nothing.
    /// `unreadable` is true when a custom class named members but none of them is printable ASCII (`[é]`).
    private static func parseClasses(_ value: String) -> (set: Set<Character>, unreadable: Bool) {
        var result = Set<Character>()
        var unreadable = false
        let text = Array(value)
        var item = ""
        var index = 0
        func flush() {
            let name = item.trimmingCharacters(in: .whitespaces)
            item = ""
            switch name.lowercased() {
            case "upper": result.formUnion(upper)
            case "lower": result.formUnion(lower)
            case "digit": result.formUnion(digit)
            case "special": result.formUnion(special)
            case "ascii-printable", "unicode": result.formUnion(asciiPrintable)
            default:
                guard name.hasPrefix("["), name.hasSuffix("]"), name.count >= 3 else { return }
                var kept = 0
                for member in name.dropFirst().dropLast() where member.isASCII && asciiPrintable.contains(member) { result.insert(member); kept += 1 }
                if kept == 0 { unreadable = true }
            }
        }
        while index < text.count {
            let character = text[index]
            index += 1
            if character == "," { flush(); continue }
            item.append(character)
            if character == "[" { index = copyClassBody(text, from: index, into: &item) }
        }
        flush()
        return (result, unreadable)
    }

    // MARK: Building

    /// Adds a requirement. The same set again raises its count.
    mutating func require(_ set: Set<Character>, count: Int = 1) {
        if let index = required.firstIndex(where: { $0.characters == set }) {
            required[index].count += count
        } else {
            required.append(Requirement(characters: set, count: count))
        }
    }

    /// The smallest `maxlength`, the largest `minlength`, the union of the requirements (the larger count for the same
    /// set), the intersection of the `allowed` sets and the smallest `max-consecutive`.
    func merged(with other: PasswordRules) -> PasswordRules {
        var result = PasswordRules()
        result.minLength = max(minLength, other.minLength)
        result.maxLength = [maxLength, other.maxLength].compactMap { $0 }.min()
        result.required = required
        for requirement in other.required {
            if let index = result.required.firstIndex(where: { $0.characters == requirement.characters }) {
                result.required[index].count = max(result.required[index].count, requirement.count)
            } else {
                result.required.append(requirement)
            }
        }
        switch (allowed, other.allowed) {
        case let (first?, second?): result.allowed = first.intersection(second)
        case let (first?, nil): result.allowed = first
        case let (nil, second?): result.allowed = second
        case (nil, nil): result.allowed = nil
        }
        result.maxConsecutive = [maxConsecutive, other.maxConsecutive].compactMap { $0 }.min()
        result.isUnsatisfiable = isUnsatisfiable || other.isUnsatisfiable
        return result
    }

    /// The rules of one request: the page's own, its confirm field's, the system's list of known sites and the rules
    /// remembered with the login, merged into one.
    static func merged(parsing texts: [String?]) -> PasswordRules {
        texts.reduce(PasswordRules()) { $0.merged(with: PasswordRules(parsing: $1)) }
    }

    /// What the person's answer to "What did the site say?" adds.
    ///
    /// - It's too long: at most 16 characters, then 12, 10 and 8. A minimum above the new maximum comes down with it.
    /// - It needs a symbol: `required: special`.
    /// - Some characters aren't allowed: letters and digits only, and nothing that asked for a symbol.
    func applying(_ answer: Recovery) -> PasswordRules {
        var result = self
        switch answer {
        case .tooLong:
            let next: Int
            if let current = maxLength, current <= 16 { next = current > 12 ? 12 : max(8, current - 2) } else { next = 16 }
            result.maxLength = next
            result.minLength = min(minLength, next)
        case .needsSymbol:
            if !required.contains(where: { $0.characters.isSubset(of: Self.special) }) { result.require(Self.special) }
        case .charactersNotAllowed:
            let letters = Self.lower.union(Self.upper).union(Self.digit)
            let narrowed = allowed.map { $0.intersection(letters) } ?? letters
            result.allowed = narrowed
            result.required = required.compactMap { requirement in
                var kept = requirement
                kept.characters.formIntersection(narrowed)
                return kept.characters.isEmpty ? nil : kept
            }
        }
        return result
    }

    // MARK: Reading

    /// Every character a password may use: the allowed set plus every required class, or printable ASCII when nothing is allowed.
    var alphabet: Set<Character> {
        var set = allowed ?? Self.asciiPrintable
        for requirement in required { set.formUnion(requirement.characters) }
        return set
    }

    /// The longest password Psss will make for these rules: the site's maximum, at most 64, or more only when the minimum asks.
    var effectiveMaxLength: Int {
        let limit = minLength > Self.generatedMaxLength ? Self.hardMaxLength : Self.generatedMaxLength
        return min(maxLength ?? limit, limit)
    }

    var minimumDigits: Int { required.filter { $0.characters.isSubset(of: Self.digit) }.reduce(0) { $0 + $1.count } }
    var minimumSymbols: Int { required.filter { $0.characters.isSubset(of: Self.special) }.reduce(0) { $0 + $1.count } }

    func accepts(_ password: String) -> Bool { Checker(self).accepts(Array(password)) }

    /// The rules prepared for many checks.
    struct Checker: Sendable {
        let rules: PasswordRules
        let alphabet: Set<Character>
        init(_ rules: PasswordRules) { self.rules = rules; alphabet = rules.alphabet }

        func accepts(_ password: [Character]) -> Bool {
            guard !rules.isUnsatisfiable, password.count >= rules.minLength, password.count <= (rules.maxLength ?? Int.max) else { return false }
            for character in password where !alphabet.contains(character) { return false }
            for requirement in rules.required {
                var found = 0
                for character in password where requirement.characters.contains(character) { found += 1 }
                if found < requirement.count { return false }
            }
            if let limit = rules.maxConsecutive {
                var run = 0
                var previous: Character?
                for character in password {
                    run = character == previous ? run + 1 : 1
                    previous = character
                    if run > limit { return false }
                }
            }
            return true
        }
    }

    // MARK: Text form

    /// The stored form: `minlength: 8; maxlength: 16; required: upper; allowed: upper, lower, digit;`. Reading it back gives the
    /// same rules, requirements in the order they were first read.
    var canonical: String {
        var parts: [String] = []
        if isUnsatisfiable { parts.append("impossible: yes") }
        if minLength > 0 { parts.append("minlength: \(minLength)") }
        if let maxLength { parts.append("maxlength: \(maxLength)") }
        if let maxConsecutive { parts.append("max-consecutive: \(maxConsecutive)") }
        for requirement in required {
            for _ in 0..<requirement.count { parts.append("required: \(Self.classText(requirement.characters))") }
        }
        if let allowed {
            // An empty set cannot be written as a class, and leaving it out would mean "anything goes". A lone space is never
            // generated, so it keeps the meaning "nothing can be made".
            parts.append("allowed: \(allowed.isEmpty ? "[ ]" : Self.classText(allowed))")
        }
        return parts.isEmpty ? "" : parts.joined(separator: "; ") + ";"
    }

    private static func classText(_ set: Set<Character>) -> String {
        if set == asciiPrintable { return "ascii-printable" }
        var rest = set
        var names: [String] = []
        for (name, group) in [("upper", upper), ("lower", lower), ("digit", digit), ("special", special)] where group.isSubset(of: rest) {
            names.append(name)
            rest.subtract(group)
        }
        if !rest.isEmpty { names.append(customClass(rest)) }
        return names.joined(separator: ", ")
    }

    /// `]` first and `-` last, so that reading it back finds the same members.
    private static func customClass(_ set: Set<Character>) -> String {
        var members = set.subtracting(["]", "-"]).sorted()
        if set.contains("]") { members.insert("]", at: 0) }
        if set.contains("-") { members.append("-") }
        return "[" + String(members) + "]"
    }
}

/// The rules remembered with one login, as a plain value the caller keeps next to the login. Stored as text in Apple's Password
/// Rules language (`PasswordRules.canonical`), empty when nothing is remembered. Not a secret. Nothing here touches the vault.
struct RememberedRules: Equatable, Sendable {
    private(set) var stored: String

    init() { stored = "" }

    /// Reads a stored value. Whatever it holds is normalised, so an unreadable text becomes "nothing remembered".
    init(stored text: String?) { stored = PasswordRules(parsing: text).canonical }

    var rules: PasswordRules { PasswordRules(parsing: stored) }
    var isEmpty: Bool { stored.isEmpty }

    /// Remembers what a request's rules said, on top of what is already remembered.
    mutating func remember(_ requestRules: PasswordRules) { stored = rules.merged(with: requestRules).canonical }

    mutating func remember(_ answer: PasswordRules.Recovery) { stored = rules.applying(answer).canonical }

    mutating func forget() { stored = "" }
}
