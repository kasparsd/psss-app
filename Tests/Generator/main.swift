import Foundation

// Hostless checks for the password generator engine (docs/plans/password-generator.md, tests 1 to 12 and 14). Run with
// scripts/test-generator.sh. Test 13 (the event table) belongs to package 3 and is not here.
//
// Generated passwords are never printed except the deterministic golden vectors of test 1. A failure names the case and counts.

nonisolated(unsafe) var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
    if ok { print("ok   \(name)") } else { failures += 1; print("FAIL \(name) \(detail())") }
}
func same<T: Equatable>(_ name: String, _ got: T, _ want: T) {
    if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)\n  got  \(got)\n  want \(want)") }
}

/// A seeded generator, so a run is the same every time.
struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// Returns a fixed list of numbers over and over, and counts how many were taken.
struct Scripted: RandomNumberGenerator {
    var values: [UInt64]
    var taken = 0
    mutating func next() -> UInt64 { defer { taken += 1 }; return values[taken % values.count] }
}

func isDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }
func isUpper(_ c: Character) -> Bool { c.isASCII && c.isUppercase }
func isLower(_ c: Character) -> Bool { c.isASCII && c.isLowercase }
func isSymbol(_ c: Character) -> Bool { c.isASCII && !c.isLetter && !c.isNumber }

/// Is a count within `sigmas` standard deviations of what `n` fair draws of probability `p` give?
func plausible(_ count: Int, n: Int, p: Double, sigmas: Double = 6) -> Bool {
    let mean = Double(n) * p
    return abs(Double(count) - mean) <= sigmas * (Double(n) * p * (1 - p)).squareRoot()
}

func gen<G: RandomNumberGenerator>(_ settings: GeneratorSettings, rules: PasswordRules = PasswordRules(),
                                   words: WordList? = Fixture.words, filter: OffensiveFilter = .none, _ generator: inout G) -> GeneratedPassword {
    PasswordGenerator.make(settings, rules: rules, words: words, filter: filter, using: &generator)
}

struct Row {
    let rule: String
    let minLength: Int
    let maxLength: Int?
    let need: [String]      // "upper", "lower", "digit" or "special", once for each character required
    let only: String?       // every character must come from here
    let maxRun: Int?
}
func row(_ rule: String, min: Int = 0, max: Int? = nil, need: [String] = [], only: String? = nil, run: Int? = nil) -> Row {
    Row(rule: rule, minLength: min, maxLength: max, need: need, only: only, maxRun: run)
}

enum Fixture {
    static let letters = "abcdefghijklmnopqrstuvwxyz"
    static let capitals = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    static let digits = "0123456789"

    /// A tiny word list: the loader and every Words test run against it, not against the EFF list.
    static let words = WordList(text: [
        "alpha", "bravo", "cedar", "delta", "ember", "fable", "gamma", "harbor", "island", "jungle", "kettle", "lemon", "meadow",
        "nectar", "orchid", "pebble", "quartz", "ribbon", "sunset", "timber", "umber", "velvet", "walnut", "yarrow", "zephyr",
        "anchor", "basket", "candle", "dragon", "engine", "forest", "garden", "hammer", "ignite", "jacket", "kitten", "ladder",
        "magnet", "nutmeg", "oyster", "pepper", "quiver", "rocket", "saddle", "tablet", "unique", "vessel", "window", "yellow",
        "zigzag", "apricot", "bridge", "copper", "dolphin", "falcon", "goblet", "hollow", "indigo", "jasper", "kernel",
    ].joined(separator: "\n"))!

    /// Nine letters each, so five words with a number and four separators come to exactly 50 characters.
    static let longWords: WordList = {
        var lines: [String] = []
        for index in 0..<40 {
            let first = Character(Unicode.Scalar(UInt8(97 + index % 26)))
            let second = Character(Unicode.Scalar(UInt8(97 + index / 26)))
            lines.append("longwor" + String(first) + String(second))
        }
        return WordList(text: lines.joined(separator: "\n"))!
    }()

    /// Neutral stand-ins, not real terms: the mechanism is what is tested.
    static let blocked = OffensiveFilter(terms: ["tab", "mud", "bam", "dud", "kag"])

    static let rows: [Row] = [
        row(""),
        row("minlength: 8;", min: 8),
        row("minlength: 8; maxlength: 64; required: lower; required: upper; required: digit;", min: 8, max: 64, need: ["lower", "upper", "digit"]),
        row("minlength: 8; required: lower; required: upper; required: digit; required: [!#$%&*?@];", min: 8, need: ["lower", "upper", "digit", "special"]),
        row("minlength: 8; maxlength: 16; required: digit; required: upper,lower;", min: 8, max: 16, need: ["digit"]),
        row("required: upper; required: lower; required: special; minlength: 20;", min: 20, need: ["upper", "lower", "special"]),
        row("minlength: 8; max-consecutive: 2; required: lower; required: upper; required: digit;", min: 8, need: ["lower", "upper", "digit"], run: 2),
        row("minlength: 8; maxlength: 32; allowed: lower, upper, digit;", min: 8, max: 32, only: letters + capitals + digits),
        row("maxlength: 18;", max: 18),
        row("maxlength: 19;", max: 19),
        row("maxlength: 17;", max: 17),
        row("required: digit; minlength: 6; maxlength: 6; allowed: digit;", min: 6, max: 6, need: ["digit"], only: digits),
        row("minlength: 25;", min: 25),
        row("required: ; minlength: abc; foo: bar; maxlength 8"),
        row("minlength: 10; maxlength: 20; required: lower; required: upper; required: digit; required: [-_.~!@#$%^&*()+=];",
            min: 10, max: 20, need: ["lower", "upper", "digit", "special"]),
        row("minlength: 8; maxlength: 20; required: upper; required: lower; required: digit; allowed: [!@#$%^&*()];",
            min: 8, max: 20, need: ["upper", "lower", "digit"], only: letters + capitals + digits + "!@#$%^&*()"),
        row("minlength: 8; maxlength: 16; required: lower; required: upper; required: digit; required: special; allowed: ascii-printable;",
            min: 8, max: 16, need: ["lower", "upper", "digit", "special"]),
        row("minlength: 12; required: lower, upper; required: digit;", min: 12, need: ["digit"]),
        row("minlength: 6; maxlength: 12; allowed: lower, digit;", min: 6, max: 12, only: letters + digits),
        row("required: upper; required: lower; required: digit; maxlength: 12;", max: 12, need: ["upper", "lower", "digit"]),
        row("minlength: 8; maxlength: 10; required: lower; required: upper; required: digit; required: [!@#];",
            min: 8, max: 10, need: ["lower", "upper", "digit", "special"]),
        row("minlength: 8; maxlength: 14; allowed: upper, lower, digit, [@#$];", min: 8, max: 14, only: letters + capitals + digits + "@#$"),
        row("minlength: 8; maxlength: 128; required: lower; required: upper; required: digit;", min: 8, max: 128, need: ["lower", "upper", "digit"]),
        row("minlength: 16;", min: 16),
        row("minlength: 8; maxlength: 8; required: lower; required: upper; required: digit;", min: 8, max: 8, need: ["lower", "upper", "digit"]),
        row("minlength: 7; maxlength: 7; allowed: digit;", min: 7, max: 7, only: digits),
        row("minlength: 8; maxlength: 20; required: lower; required: upper; required: digit; max-consecutive: 1;",
            min: 8, max: 20, need: ["lower", "upper", "digit"], run: 1),
        row("required: special; minlength: 10;", min: 10, need: ["special"]),
        row("minlength: 8; maxlength: 12; required: upper; required: lower; required: digit; required: [!];",
            min: 8, max: 12, need: ["upper", "lower", "digit", "special"]),
        row("minlength: 10; allowed: lower;", min: 10, only: letters),
        row("minlength: 10; allowed: upper, digit;", min: 10, only: capitals + digits),
        row("minlength: 8; maxlength: 24; required: upper; required: lower; required: digit; required: [_];",
            min: 8, max: 24, need: ["upper", "lower", "digit", "special"]),
        row("minlength: 8; maxlength: 100; required: digit; required: upper; required: lower; allowed: ascii-printable;",
            min: 8, max: 100, need: ["digit", "upper", "lower"]),
        row("maxlength: 30; required: digit;", max: 30, need: ["digit"]),
        row("minlength: 8; maxlength: 15; required: lower; required: upper; required: digit; required: special;",
            min: 8, max: 15, need: ["lower", "upper", "digit", "special"]),
        row("minlength: 9; maxlength: 9;", min: 9, max: 9),
        row("minlength: 8; required: lower; required: digit; required: special; max-consecutive: 3;", min: 8, need: ["lower", "digit", "special"], run: 3),
        row("minlength: 8; maxlength: 14; required: lower; required: upper; required: digit; required: [-];",
            min: 8, max: 14, need: ["lower", "upper", "digit", "special"]),
        row("required: upper; required: upper; required: digit; required: digit; required: special; required: special; minlength: 12; maxlength: 24;",
            min: 12, max: 24, need: ["upper", "upper", "digit", "digit", "special", "special"]),
        row("unknown: yes; minlength: 8; required: lower;", min: 8, need: ["lower"]),
        row("MINLENGTH: 8; REQUIRED: LOWER; Required: Upper;", min: 8, need: ["lower", "upper"]),
        row("minlength: 6; maxlength: 6; required: digit; allowed: digit;", min: 6, max: 6, need: ["digit"], only: digits),
        row("allowed: lower, upper, digit; required: upper; required: lower; required: digit; minlength: 20; maxlength: 20;",
            min: 20, max: 20, only: letters + capitals + digits),
        row("minlength: 32;", min: 32),
        row("maxlength: 40; required: special;", max: 40, need: ["special"]),
        row("minlength: 8; maxlength: 20; required: upper; required: lower; required: digit; allowed: lower, upper, digit;",
            min: 8, max: 20, need: ["upper", "lower", "digit"], only: letters + capitals + digits),
    ]
}

/// Checks a password against a row without using the engine's own rule checker.
func satisfies(_ password: String, _ row: Row) -> Bool {
    let chars = Array(password)
    if chars.count < row.minLength || chars.contains(" ") { return false }
    if let max = row.maxLength, chars.count > max { return false }
    for (name, wanted) in Dictionary(grouping: row.need, by: { $0 }).mapValues(\.count) {
        let have = chars.filter { c in
            switch name {
            case "upper": isUpper(c)
            case "lower": isLower(c)
            case "digit": isDigit(c)
            default: isSymbol(c)
            }
        }.count
        if have < wanted { return false }
    }
    if let only = row.only { let allowed = Set(only); if chars.contains(where: { !allowed.contains($0) }) { return false } }
    if let limit = row.maxRun {
        var run = 0
        var previous: Character?
        for c in chars { run = c == previous ? run + 1 : 1; previous = c; if run > limit { return false } }
    }
    return true
}

// MARK: 1. Determinism

func testDeterminism() {
    let configs: [(String, GeneratorSettings, String)] = [
        ("apple", .recommended, ""),
        ("apple, no hyphens", .recommended, "allowed: lower, upper, digit;"),
        ("characters 20", GeneratorSettings(kind: .characters), ""),
        ("characters 16 with symbol", GeneratorSettings(kind: .characters, length: 16, includeSymbol: true), ""),
        ("words 6 and number", GeneratorSettings(kind: .words), ""),
        ("words 5, number and symbol", GeneratorSettings(kind: .words, words: 5, includeSymbol: true), ""),
    ]
    // Vectors recorded from the first clean run. Any change to how a password is
    // drawn from the same numbers shows up here.
    let goldens: [String: String] = [
        "apple": "bojfov-jihcY5-xyzwur",
        "apple, no hyphens": "bojfovjihcY5xyzwur",
        "characters 20": "DCwHuhFGEFSGeQAvj8wZ",
        "characters 16 with symbol": "dHhFG&E4FSGeQYAv",
        "words 6 and number": "Tablet-Indigo-Unique4-Forest-Delta-Vessel",
        "words 5, number and symbol": "Tablet-Indigo8-Unique-Forest&-Delta",
    ]
    for (name, settings, rules) in configs {
        var first = SplitMix64(seed: 12345), second = SplitMix64(seed: 12345)
        let parsed = PasswordRules(parsing: rules)
        let a = gen(settings, rules: parsed, &first), b = gen(settings, rules: parsed, &second)
        check("determinism: \(name) draws the same from the same numbers", a == b && !a.value.isEmpty)
        if let golden = goldens[name] { same("golden: \(name)", a.value, golden) } else { print("GOLDEN \(name) = \(a.value)") }
    }
    var one = SplitMix64(seed: 1), two = SplitMix64(seed: 2)
    check("determinism: another seed gives another password", gen(.recommended, &one).value != gen(.recommended, &two).value)
}

// MARK: 2. Apple-style shape

func testAppleShape() {
    var rng = SplitMix64(seed: 2)
    let n = 100_000
    let consonants = Set(AppleStyle.consonants), vowels = Set(AppleStyle.vowels)
    let digitIndexes = Set([5, 7, 12, 14, 19])  // either side of either hyphen, and the end
    var bad = 0, wrongBits = 0
    var digitAt: [Int: Int] = [:], upperAt: [Int: Int] = [:], digitValue: [Int: Int] = [:]
    for _ in 0..<n {
        let result = gen(.recommended, &rng)
        let chars = Array(result.value)
        if abs(result.bits - 71.97) >= 0.05 { wrongBits += 1 }
        guard chars.count == 20, result.type == .apple, result.kind == .strong, result.adjustment == nil,
              chars[6] == "-", chars[13] == "-" else { bad += 1; continue }
        let digitPositions = chars.indices.filter { isDigit(chars[$0]) }
        let upperPositions = chars.indices.filter { isUpper(chars[$0]) }
        guard digitPositions.count == 1, upperPositions.count == 1, digitIndexes.contains(digitPositions[0]),
              upperPositions[0] != digitPositions[0] else { bad += 1; continue }
        var shaped = chars.filter { $0 == "-" }.count == 2
        for index in chars.indices where chars[index] != "-" && index != digitPositions[0] {
            let isVowelSlot = index % 7 == 1 || index % 7 == 4
            let letter = Character(chars[index].lowercased())
            if !(isVowelSlot ? vowels : consonants).contains(letter) { shaped = false }
        }
        if !shaped { bad += 1; continue }
        digitAt[digitPositions[0], default: 0] += 1
        upperAt[upperPositions[0], default: 0] += 1
        digitValue[Int(String(chars[digitPositions[0]]))!, default: 0] += 1
    }
    check("apple shape: \(n) draws, 20 characters, 3 groups of 6, one digit in a legal place, one capital, syllables", bad == 0, "\(bad) wrong")
    check("apple shape: reported bits are 71.97 within 0.05", wrongBits == 0, "\(wrongBits) wrong")
    check("apple shape: the five digit positions are each within 5% of uniform",
          digitIndexes.allSatisfy { abs(Double(digitAt[$0, default: 0]) - Double(n) / 5) <= Double(n) / 5 * 0.05 }, "\(digitAt.sorted { $0.key < $1.key })")
    // The capital cannot sit where the digit is, so a place that can hold the digit holds the capital a little less often.
    let upperOK = (0..<20).filter { $0 != 6 && $0 != 13 }.allSatisfy { index in
        plausible(upperAt[index, default: 0], n: n, p: digitIndexes.contains(index) ? 0.8 / 17 : 1.0 / 17)
    }
    check("apple shape: the capital is uniform over the 17 letters that are not the digit", upperOK, "\(upperAt.sorted { $0.key < $1.key })")
    check("apple shape: each digit 0 to 9 is as likely as another", (0...9).allSatisfy { plausible(digitValue[$0, default: 0], n: n, p: 0.1) })
    check("apple shape: the default is the apple type and the strong kind", {
        var g = SplitMix64(seed: 3); let r = gen(.recommended, &g); return r.type == .apple && r.kind == .strong && !r.isWeakerThanDefault
    }())
}

// MARK: 3. Distribution (system random source)

func testWordsDistribution() {
    var rng = SystemRandomNumberGenerator()
    let list = Fixture.words
    let known = Set(list.words)
    let settings = GeneratorSettings(kind: .words, words: 6, includeNumber: true, includeSymbol: true)
    let n = 20_000
    let symbols = Set("!@#$%&*?")
    var wordCounts: [String: Int] = [:], digitCounts: [Character: Int] = [:], symbolCounts: [Character: Int] = [:]
    var digitPosition: [Int: Int] = [:], symbolPosition: [Int: Int] = [:]
    var structure = 0
    for _ in 0..<n {
        let result = gen(settings, &rng)
        let tokens = result.value.split(separator: "-", omittingEmptySubsequences: false)
        guard result.type == .words, result.kind == .passphrase, tokens.count == 6, tokens.allSatisfy({ $0.first?.isUppercase == true }) else {
            structure += 1; continue
        }
        var digitsSeen = 0, symbolsSeen = 0
        for (index, token) in tokens.enumerated() {
            let word = token.prefix(while: { $0.isLetter }).lowercased()
            if !known.contains(word) { structure += 1 }
            wordCounts[word, default: 0] += 1
            for c in token.dropFirst(word.count) {
                if isDigit(c) { digitCounts[c, default: 0] += 1; digitPosition[index, default: 0] += 1; digitsSeen += 1 }
                else if symbols.contains(c) { symbolCounts[c, default: 0] += 1; symbolPosition[index, default: 0] += 1; symbolsSeen += 1 }
                else { structure += 1 }
            }
        }
        if digitsSeen != 1 || symbolsSeen != 1 { structure += 1 }
    }
    check("words: every word is in the list, capitalised, six of them, one number and one symbol", structure == 0, "\(structure) wrong")
    let expected = Double(6 * n) / Double(list.words.count)
    let chi = list.words.reduce(0.0) { $0 + pow(Double(wordCounts[$1, default: 0]) - expected, 2) / expected }
    let df = Double(list.words.count - 1)
    check("words: chi-square of word counts is plausible for a uniform pick", chi < df + 6 * (2 * df).squareRoot(), "chi \(chi) df \(df)")
    check("words: the number is a digit 2 to 9, each as likely as another",
          Set(digitCounts.keys) == Set("23456789") && digitCounts.values.allSatisfy { plausible($0, n: n, p: 1.0 / 8) })
    check("words: the symbol is one of eight, each as likely as another",
          Set(symbolCounts.keys) == symbols && symbolCounts.values.allSatisfy { plausible($0, n: n, p: 1.0 / 8) })
    check("words: the number and the symbol sit after any of the six words equally often",
          (0..<6).allSatisfy { plausible(digitPosition[$0, default: 0], n: n, p: 1.0 / 6) && plausible(symbolPosition[$0, default: 0], n: n, p: 1.0 / 6) })
}

func testCharactersDistribution() {
    var rng = SystemRandomNumberGenerator()
    let settings = GeneratorSettings(kind: .characters, length: 20, includeNumber: true, includeSymbol: true)
    let n = 20_000
    let symbols = Set("!@#$%&*?")
    var digitCounts: [Character: Int] = [:], symbolCounts: [Character: Int] = [:], positions: [Int: Int] = [:], letterCounts: [Character: Int] = [:]
    var bad = 0, letterTotal = 0
    for _ in 0..<n {
        let result = gen(settings, &rng)
        let chars = Array(result.value)
        let digitIndexes = chars.indices.filter { isDigit(chars[$0]) }
        let symbolIndexes = chars.indices.filter { isSymbol(chars[$0]) }
        guard chars.count == 20, digitIndexes.count == 1, symbolIndexes.count == 1, chars.contains(where: isUpper), chars.contains(where: isLower),
              result.type == .characters, result.kind == .strong, !chars.contains(where: { "IlOo01".contains($0) }),
              symbols.contains(chars[symbolIndexes[0]]) else { bad += 1; continue }
        digitCounts[chars[digitIndexes[0]], default: 0] += 1
        symbolCounts[chars[symbolIndexes[0]], default: 0] += 1
        positions[digitIndexes[0], default: 0] += 1
        for c in chars where c.isLetter { letterCounts[c, default: 0] += 1; letterTotal += 1 }
    }
    check("characters: 20 long, exactly one digit and one symbol, a capital and a lowercase letter, no look-alikes", bad == 0, "\(bad) wrong")
    check("characters: the digit is 2 to 9 and each is as likely as another", Set(digitCounts.keys) == Set("23456789") && digitCounts.values.allSatisfy { plausible($0, n: n, p: 1.0 / 8) })
    check("characters: the symbol is one of eight, each as likely as another", Set(symbolCounts.keys) == symbols && symbolCounts.values.allSatisfy { plausible($0, n: n, p: 1.0 / 8) })
    check("characters: the digit sits in any of the 20 places equally often", (0..<20).allSatisfy { plausible(positions[$0, default: 0], n: n, p: 1.0 / 20) })
    // 48 letters, one of them the forced capital and one the forced lowercase: lowercase letters overall are about as common as capitals.
    let lowerTotal = letterCounts.filter { isLower($0.key) }.values.reduce(0, +)
    check("characters: lowercase and capitals are about equally common", abs(Double(lowerTotal) / Double(letterTotal) - 0.5) < 0.01)
}

// MARK: 4. Bounds and rejection sampling

func testBounds() {
    RandomPick.largestBound = 0
    var rng = SplitMix64(seed: 4)
    for kind in [GeneratorSettings.Kind.apple, .characters, .words] {
        for symbol in [false, true] {
            for _ in 0..<200 { _ = gen(GeneratorSettings(kind: kind, length: 64, includeSymbol: symbol), &rng) }
        }
    }
    check("bounds: no pick asks for more than the largest alphabet, the word list or the length", RandomPick.largestBound <= max(Fixture.words.words.count, 64),
          "largest \(RandomPick.largestBound)")

    // 2^64 mod 3 is 1, so a 0 is thrown away and the next number is used. Reducing 0 modulo 3 would give 0 and bias the pick.
    var skip = Scripted(values: [0, 5])
    same("rejection: below 3 throws away 0 and uses 5, which is 2", RandomPick.index(below: 3, using: &skip), 2)
    same("rejection: two numbers were taken", skip.taken, 2)
    // 2^64 mod 10 is 6: 0 to 5 are thrown away, 6 is kept.
    var six = Scripted(values: [5, 6])
    same("rejection: below 10 throws away 5 and keeps 6", RandomPick.index(below: 10, using: &six), 6)
    var top = Scripted(values: [UInt64.max])
    same("rejection: the largest number is kept", RandomPick.index(below: 10, using: &top), Int(UInt64.max % 10))
    var single = Scripted(values: [7])
    same("rejection: a pick below 1 is 0", RandomPick.index(below: 1, using: &single), 0)
    var stuck = Scripted(values: [0])
    same("rejection: a generator stuck at 0 does not hang", RandomPick.index(below: 3, using: &stuck), 0)

    var system = SystemRandomNumberGenerator()
    var counts = [Int](repeating: 0, count: 7)
    for _ in 0..<700_000 { counts[RandomPick.index(below: 7, using: &system)] += 1 }
    check("rejection: seven answers are equally likely", counts.allSatisfy { plausible($0, n: 700_000, p: 1.0 / 7) })
}

// MARK: 5. Rule table, 6. length caps

func testRuleTable() {
    var rng = SplitMix64(seed: 5)
    check("rule table: at least 40 strings", Fixture.rows.count >= 40, "\(Fixture.rows.count)")
    var stayedApple = 0
    for (index, row) in Fixture.rows.enumerated() {
        let rules = PasswordRules(parsing: row.rule)
        for kind in [GeneratorSettings.Kind.apple, .words, .characters] {
            for symbol in [false, true] {
                var wrong = 0, notAccepted = 0, empty = 0, apple = 0
                let draws = symbol ? 40 : 200
                for _ in 0..<draws {
                    let result = gen(GeneratorSettings(kind: kind, includeSymbol: symbol), rules: rules, &rng)
                    if result.value.isEmpty { empty += 1; continue }
                    if !satisfies(result.value, row) { wrong += 1 }
                    if !rules.accepts(result.value) { notAccepted += 1 }
                    if result.type == .apple { apple += 1 }
                }
                if kind == .apple, !symbol { stayedApple += apple == draws ? 1 : 0 }
                check("rule \(index) (\(kind.rawValue), symbol \(symbol)): \(draws) passwords all satisfy it",
                      wrong == 0 && notAccepted == 0 && empty == 0, "rule \"\(row.rule)\": \(wrong) wrong, \(notAccepted) refused by the parser's check, \(empty) empty")
            }
        }
    }
    print("note: \(stayedApple) of \(Fixture.rows.count) rules stayed Apple-style in every draw")
}

func testLengthCaps() {
    var rng = SplitMix64(seed: 6)
    var wrong = 0, tooLong = 0, wordsOver = 0
    for cap in 8...128 {
        let rules = PasswordRules(parsing: "maxlength: \(cap);")
        for kind in [GeneratorSettings.Kind.apple, .words, .characters] {
            for symbol in [false, true] {
                for _ in 0..<20 {
                    let result = gen(GeneratorSettings(kind: kind, length: 64, includeSymbol: symbol), rules: rules, &rng)
                    if result.value.isEmpty || !rules.accepts(result.value) { wrong += 1 }
                    if result.value.count > min(cap, 64) { tooLong += 1 }
                    if result.type == .words && result.value.count > 64 { wordsOver += 1 }
                }
            }
        }
    }
    check("length caps: every maximum from 8 to 128 is kept, for every type", wrong == 0 && tooLong == 0, "\(wrong) wrong, \(tooLong) too long")
    check("length caps: words never exceed 64", wordsOver == 0)
    let tiny = PasswordRules(parsing: "minlength: 6; maxlength: 6;")
    var small = SplitMix64(seed: 66)
    check("length caps: a cap of 6 gives 6", (0..<200).allSatisfy { _ in gen(.recommended, rules: tiny, &small).value.count == 6 })
    let long = PasswordRules(parsing: "minlength: 100;")
    check("length caps: a minimum of 100 is met and the cap yields to it", (0..<50).allSatisfy { _ in
        let r = gen(GeneratorSettings(kind: .characters), rules: long, &small); return r.value.count == 100
    })
}

// MARK: 7. Adjustments and their wording

func testAdjustments() {
    var rng = SplitMix64(seed: 7)
    let sixteen = gen(.recommended, rules: PasswordRules(parsing: "maxlength: 16;"), &rng)
    check("adjustment: a cap of 16 gives random characters and says so", sixteen.type == .characters && sixteen.adjustment == .tooLongForApple(max: 16))
    let nineteen = gen(.recommended, rules: PasswordRules(parsing: "maxlength: 19;"), &rng)
    check("adjustment: a cap of 19 stays Apple-style, 18 characters, no comment", nineteen.type == .apple && nineteen.adjustment == nil && nineteen.value.count == 18 && !nineteen.value.contains("-"))
    let eighteen = gen(.recommended, rules: PasswordRules(parsing: "maxlength: 18;"), &rng)
    check("adjustment: a cap of 18 stays Apple-style", eighteen.type == .apple && eighteen.value.count == 18)
    let seventeen = gen(.recommended, rules: PasswordRules(parsing: "maxlength: 17;"), &rng)
    check("adjustment: a cap of 17 is random characters", seventeen.type == .characters && seventeen.adjustment == .tooLongForApple(max: 17))
    let free = gen(.recommended, &rng)
    check("adjustment: no rules, no adjustment", free.adjustment == nil && free.type == .apple)
    let long = gen(.recommended, rules: PasswordRules(parsing: "minlength: 25;"), &rng)
    check("adjustment: a longer minimum adds a fourth group and stays Apple-style", long.type == .apple && long.value.count == 27 && long.adjustment == nil)

    let fifty = PasswordRules(parsing: "maxlength: 50;")
    let fewer = gen(GeneratorSettings(kind: .words, words: 6), rules: fifty, words: Fixture.longWords, &rng)
    let fewerWant: GeneratedPassword.Adjustment = .fewerWords(from: 6, to: 5, max: 50)
    check("adjustment: words with a cap of 50 give 5 words and say so",
          fewer.type == GeneratorSettings.Kind.words && fewer.adjustment == fewerWant && fewer.value.count == 50, "\(fewer.adjustment as Any)")
    let tooLong = gen(GeneratorSettings(kind: .words), rules: PasswordRules(parsing: "maxlength: 16;"), &rng)
    check("adjustment: words with a cap of 16 give random characters and say so", tooLong.type == .characters && tooLong.adjustment == .tooLongForWords(max: 16))
    let upperDigit = gen(GeneratorSettings(kind: .words), rules: PasswordRules(parsing: "allowed: upper, digit;"), &rng)
    check("adjustment: no lowercase letters allowed, no words", upperDigit.type == .characters && upperDigit.adjustment == .noWordsAllowed)
    let noList = gen(GeneratorSettings(kind: .words), words: nil, &rng)
    check("adjustment: no word list gives random characters and says so", noList.type == .characters && noList.adjustment == .wordListUnavailable && !noList.value.isEmpty)
    let noDigit = gen(.recommended, rules: PasswordRules(parsing: "allowed: upper, lower;"), &rng)
    check("adjustment: rules that allow no digit make Apple-style impossible", noDigit.type == .characters && noDigit.adjustment == .rulesNeedRandom
          && noDigit.value.allSatisfy { $0.isLetter })
    let impossible = gen(.recommended, rules: PasswordRules(parsing: "minlength: 10; maxlength: 8;"), &rng)
    check("adjustment: a minimum above the maximum cannot be met", impossible.value.isEmpty && impossible.adjustment == .cannotSatisfy)
    let crowded = gen(GeneratorSettings(kind: .characters), rules: PasswordRules(parsing: "maxlength: 3; required: upper; required: lower; required: digit; required: special;"), &rng)
    check("adjustment: four required characters in three places cannot be met", crowded.value.isEmpty && crowded.adjustment == .cannotSatisfy)
    let spaceOnly = gen(.recommended, rules: PasswordRules(parsing: "required: [ ];"), &rng)
    check("adjustment: a rule that only a space meets cannot be met", spaceOnly.value.isEmpty && spaceOnly.adjustment == .cannotSatisfy)

    // A filter that rejects every syllable leaves no Apple-style password.
    var terms: [String] = []
    for c in AppleStyle.consonants { for v in AppleStyle.vowels { for d in AppleStyle.consonants { terms.append(String([c, v, d])) } } }
    let everything = OffensiveFilter(terms: terms)
    let rejected = gen(.recommended, filter: everything, &rng)
    check("adjustment: when the filter rejects every draft, random characters", rejected.type == .characters && rejected.adjustment == .rulesNeedRandom)

    // The approved wording, word for word.
    same("text: too long for Apple-style", GeneratorText.message(for: .tooLongForApple(max: 16)),
         "This site allows at most 16 characters, so Psss made a shorter password with random characters.")
    same("text: too long for words", GeneratorText.message(for: .tooLongForWords(max: 12)),
         "This site allows at most 12 characters, so Psss made a shorter password with random characters.")
    same("text: fewer words", GeneratorText.message(for: .fewerWords(from: 6, to: 5, max: 50)),
         "This site allows at most 50 characters, so this password has 5 words instead of 6.")
    same("text: no lowercase", GeneratorText.message(for: .noWordsAllowed), "This site does not allow lowercase letters, so Psss made a random password.")
    same("text: cannot satisfy", GeneratorText.message(for: .cannotSatisfy), "Psss cannot make a password that fits this site’s rules. Choose your own.")
    check("text: the two lines awaiting approval exist", !GeneratorText.message(for: .rulesNeedRandom).isEmpty && !GeneratorText.message(for: .wordListUnavailable).isEmpty)

    // What the system's no-interface request returns.
    var offerRng = SplitMix64(seed: 77)
    let offers = PasswordGenerator.offers(.recommended, rules: PasswordRules(), words: Fixture.words, filter: .none, using: &offerRng)
    check("offers: no rules give a strong, an alphanumeric and a passphrase, the person's type first",
          offers.map(\.kind) == [.strong, .alphanumeric, .passphrase])
    let narrow = PasswordRules(parsing: "maxlength: 16; required: digit;")
    let narrowOffers = PasswordGenerator.offers(GeneratorSettings(kind: .words), rules: narrow, words: Fixture.words, filter: .none, using: &offerRng)
    check("offers: with rules every offer satisfies them and no kind repeats",
          !narrowOffers.isEmpty && narrowOffers.allSatisfy { narrow.accepts($0.value) } && Set(narrowOffers.map(\.kind)).count == narrowOffers.count)
    let none = PasswordGenerator.offers(.recommended, rules: PasswordRules(parsing: "minlength: 10; maxlength: 8;"), words: Fixture.words, filter: .none, using: &offerRng)
    check("offers: rules that cannot be met give none", none.isEmpty)
}

// MARK: 8. Offensive filter

func testOffensiveFilter() {
    let filter = Fixture.blocked
    check("filter: finds a term anywhere", filter.rejects("xxTABxx") && filter.rejects("mud"))
    check("filter: finds a term across a hyphen", filter.rejects("ba-m") && filter.rejects("zzzb-a-mzz") && filter.rejects("ta-b"))
    check("filter: ignores case", filter.rejects("BaM") && filter.rejects("DUD"))
    check("filter: a digit breaks a match", !filter.rejects("b1am") && !filter.rejects("ta-1-b"))
    check("filter: lets other text through", !filter.rejects("hupvEw-fodne1-qabjyg"))
    check("filter: an empty list rejects nothing", !OffensiveFilter.none.rejects("anything"))
    check("filter: terms under three characters are ignored", !OffensiveFilter(terms: ["ab", "x"]).rejects("abx"))
    check("filter: reads a file's text, skipping comments and blanks",
          OffensiveFilter(text: "# a comment\n\n  Tab  \r\nmud\n#bam\n").terms == ["tab", "mud"])

    var rng = SplitMix64(seed: 8)
    var hits = 0, tooShort = 0
    let n = 200_000
    for _ in 0..<n {
        let result = gen(.recommended, filter: filter, &rng)
        if filter.rejects(result.value) { hits += 1 }
        if result.type != .apple { tooShort += 1 }
    }
    check("filter: \(n) Apple-style draws never contain a blocked term, across the hyphens too", hits == 0, "\(hits) found")
    check("filter: a short list does not push Apple-style out", tooShort == 0)
    // The same draws with no filter do contain them, so the filter is doing the work.
    var plain = SplitMix64(seed: 8)
    var without = 0
    for _ in 0..<20_000 {
        let result = gen(.recommended, &plain)
        if filter.rejects(result.value) { without += 1 }
    }
    check("filter: without it the same terms do turn up", without > 0)
    check("filter: the bundled list is empty in a hostless run (the app's file is read from its bundle)", OffensiveFilter.bundled.terms.isEmpty)
}

// MARK: 9. Strength

func testStrength() {
    var rng = SplitMix64(seed: 9)
    let m = Double(Fixture.words.words.count)
    let apple = gen(.recommended, &rng)
    check("strength: Apple-style is 71.97 bits and not weaker than the default", abs(apple.bits - 71.97) < 0.05 && !apple.isWeakerThanDefault)
    let twelve = gen(GeneratorSettings(kind: .characters, length: 12), &rng)
    // A lowercase and a capital letter (24 each), a digit (8), nine more from the 48 letters.
    let want12 = 2 * log2(24.0) + log2(8.0) + 9 * log2(48.0)
    check("strength: 12 random characters with a number follow the formula", abs(twelve.bits - want12) < 0.01, "\(twelve.bits) against \(want12)")
    check("strength: 12 random characters are weaker than the default", twelve.isWeakerThanDefault)
    let twenty = gen(GeneratorSettings(kind: .characters, length: 20, includeSymbol: true), &rng)
    let want20 = 2 * log2(24.0) + log2(8.0) + log2(8.0) + 16 * log2(48.0)
    check("strength: 20 random characters with a number and a symbol follow the formula", abs(twenty.bits - want20) < 0.01 && !twenty.isWeakerThanDefault)
    let words = gen(GeneratorSettings(kind: .words, words: 6), &rng)
    check("strength: 6 words and a number follow the formula", abs(words.bits - (6 * log2(m) + log2(6) + log2(8))) < 0.01)
    let four = gen(GeneratorSettings(kind: .words, words: 4, includeNumber: false), &rng)
    check("strength: 4 words alone follow the formula", abs(four.bits - 4 * log2(m)) < 0.01)
    let rich = gen(GeneratorSettings(kind: .words, words: 5, includeSymbol: true), &rng)
    check("strength: 5 words, a number and a symbol follow the formula", abs(rich.bits - (5 * log2(m) + 2 * (log2(5) + log2(8)))) < 0.01)
    let hyphens = gen(.recommended, rules: PasswordRules(parsing: "required: [!#$%&*?@]; minlength: 8;"), &rng)
    check("strength: separators drawn from eight symbols add 3 bits each", abs(hyphens.bits - (71.97 + 2 * 3)) < 0.05, "\(hyphens.bits)")

    check("hint: none at the default", PasswordGenerator.hint(bits: 71.97) == nil && PasswordGenerator.hint(bits: 71.0) == nil)
    check("hint: shown just below 71 bits", PasswordGenerator.hint(bits: 70.99) != nil)
    check("hint: points at Length", PasswordGenerator.hint(bits: 60, control: .length)?.hasSuffix("Make it longer.") == true)
    check("hint: points at the words", PasswordGenerator.hint(bits: 60, control: .words)?.hasSuffix("Add a word.") == true)
    let prefix = "Weaker than the recommended password. A machine trying a trillion guesses a second would need about "
    check("hint: the approved opening", PasswordGenerator.hint(bits: 60)?.hasPrefix(prefix) == true)
    func bits(forSeconds seconds: Double) -> Double { 1 + log2(seconds * PasswordStrength.guessesPerSecond) }
    same("time: 30 minutes", PasswordStrength.timeText(bits: bits(forSeconds: 1800)), "30 minutes")
    same("time: 37 years", PasswordStrength.timeText(bits: bits(forSeconds: 37 * 31_557_600)), "37 years")
    same("time: 1 year", PasswordStrength.timeText(bits: bits(forSeconds: 1.02 * 31_557_600)), "1 year")
    same("time: 3 hours", PasswordStrength.timeText(bits: bits(forSeconds: 3 * 3600)), "3 hours")
    same("time: 12 days", PasswordStrength.timeText(bits: bits(forSeconds: 12 * 86400)), "12 days")
    same("time: more than a million years", PasswordStrength.timeText(bits: 90), "more than a million years")
    same("time: two significant figures", PasswordStrength.twoSignificantFigures(18.7), 19.0)
}

// MARK: 10. Forced classes are never overwritten

func testForcedClasses() {
    var rng = SplitMix64(seed: 10)
    let n = 100_000
    let tight = PasswordRules(parsing: "required: upper; required: lower; required: digit; required: special; minlength: 4; maxlength: 4;")
    var missing = 0
    for _ in 0..<n {
        let chars = Array(gen(GeneratorSettings(kind: .characters), rules: tight, &rng).value)
        if chars.count != 4 || !chars.contains(where: isUpper) || !chars.contains(where: isLower) || !chars.contains(where: isDigit) || !chars.contains(where: isSymbol) { missing += 1 }
    }
    // The old generator forced a capital and then a lowercase letter into random places that could be the same one, and lost the
    // capital about once in 18 draws: some 5,500 failures here.
    check("forced classes: 4 places, four required classes, \(n) passwords lose none", missing == 0, "\(missing) lost one")

    let two = PasswordRules(parsing: "required: digit; required: digit; required: special; required: special;")
    var fewer = 0
    for _ in 0..<n {
        let chars = Array(gen(GeneratorSettings(kind: .characters, length: 12, includeNumber: false), rules: two, &rng).value)
        if chars.filter(isDigit).count < 2 || chars.filter(isSymbol).count < 2 || chars.count != 12 { fewer += 1 }
    }
    check("forced classes: two digits and two symbols asked for, \(n) passwords have at least that", fewer == 0, "\(fewer) short")

    var off = 0
    for _ in 0..<n {
        let chars = Array(gen(GeneratorSettings(kind: .characters, includeNumber: false, includeSymbol: false), &rng).value)
        if chars.contains(where: isDigit) || chars.contains(where: isSymbol) || !chars.contains(where: isUpper) || !chars.contains(where: isLower) { off += 1 }
    }
    check("forced classes: switches off and no rules give letters only, with a capital and a lowercase letter", off == 0, "\(off) wrong")

    var on = 0
    for _ in 0..<n {
        let chars = Array(gen(GeneratorSettings(kind: .characters, includeNumber: true, includeSymbol: true), &rng).value)
        if chars.filter(isDigit).count != 1 || chars.filter(isSymbol).count != 1 || !chars.contains(where: isUpper) || !chars.contains(where: isLower) { on += 1 }
    }
    check("forced classes: switches on and no rules give exactly one digit and one symbol", on == 0, "\(on) wrong")

    // The convenience the Safari extension still calls: the old strong() could lose its capital, lowercase letter or digit.
    var weak = 0
    for _ in 0..<20_000 {
        let chars = Array(PasswordGenerator.strong())
        if chars.count != 20 || !chars.contains(where: isUpper) || !chars.contains(where: isLower) || !chars.contains(where: isDigit) { weak += 1 }
    }
    check("forced classes: strong() always has a capital, a lowercase letter and a digit", weak == 0, "\(weak) lost one")
    var plain = 0
    for _ in 0..<20_000 {
        let chars = Array(PasswordGenerator.alphanumeric())
        if chars.count != 20 || chars.contains(where: isSymbol) || !chars.contains(where: isDigit) { plain += 1 }
    }
    check("forced classes: alphanumeric() is 20 letters and digits", plain == 0, "\(plain) wrong")
}

// MARK: 11. Rules parser

func testParser() {
    for (index, row) in Fixture.rows.enumerated() {
        let parsed = PasswordRules(parsing: row.rule)
        check("parser: rule \(index) reads back from its canonical form", PasswordRules(parsing: parsed.canonical) == parsed, "\(row.rule) became \(parsed.canonical)")
    }
    let canonical = PasswordRules(parsing: "Required: UPPER ;  required:lower,digit; allowed: [ab-]; minlength: 8 ; maxlength:16;max-consecutive: 2;").canonical
    same("parser: the canonical form", canonical, "minlength: 8; maxlength: 16; max-consecutive: 2; required: upper; required: lower, digit; allowed: [ab-];")

    let union = PasswordRules(parsing: "required: upper, lower;")
    check("parser: a union is one requirement either class can meet", union.required.count == 1 && union.required[0].characters == PasswordRules.upper.union(PasswordRules.lower) && union.required[0].count == 1)
    check("parser: a union is met by one letter of either class", union.accepts("a12") && union.accepts("A12") && !union.accepts("123"))
    let twice = PasswordRules(parsing: "required: digit; required: digit;")
    check("parser: a repeated requirement raises its count", twice.required.count == 1 && twice.required[0].count == 2 && twice.minimumDigits == 2)

    check("parser: special is 33 characters, space and hyphen included", PasswordRules.special.count == 33 && PasswordRules.special.contains(" ") && PasswordRules.special.contains("-"))
    check("parser: special holds no letter or digit", PasswordRules.special.allSatisfy { isSymbol($0) })
    check("parser: required: special reads as that set", PasswordRules(parsing: "required: special;").required.first?.characters == PasswordRules.special)
    check("parser: ascii-printable and unicode are the 95 printable characters",
          PasswordRules(parsing: "allowed: ascii-printable;").allowed?.count == 95 && PasswordRules(parsing: "allowed: unicode;").allowed?.count == 95)

    let bracket = PasswordRules(parsing: "required: []-a]; minlength: 9;")
    check("parser: a ] straight after the [ and a hyphen are members", bracket.required.first?.characters == Set("]-a") && bracket.minLength == 9)
    let separators = PasswordRules(parsing: "required: [,;:]; maxlength: 12;")
    check("parser: ; , and : inside a class do not split it", separators.required.first?.characters == Set(",;:") && separators.maxLength == 12)
    check("parser: a range is read literally, so a-z is three characters", PasswordRules(parsing: "allowed: [a-z];").allowed == Set("a-z"))
    check("parser: an unknown class is skipped and the rest kept", PasswordRules(parsing: "required: upper, wibble;").required.first?.characters == PasswordRules.upper)
    check("parser: nothing readable means no rules", PasswordRules(parsing: "required: wibble; minlength: x; maxlength 9; ;;; :") == PasswordRules() && PasswordRules(parsing: nil) == PasswordRules() && PasswordRules(parsing: "") == PasswordRules())
    check("parser: the smallest maximum and the largest minimum win inside one string", {
        let r = PasswordRules(parsing: "maxlength: 20; maxlength: 12; minlength: 4; minlength: 8;"); return r.maxLength == 12 && r.minLength == 8
    }())

    let first = PasswordRules(parsing: "minlength: 8; maxlength: 20; required: lower; required: digit; required: digit; allowed: lower, upper, digit; max-consecutive: 3;")
    let second = PasswordRules(parsing: "minlength: 10; maxlength: 16; required: digit; required: lower; allowed: lower, digit; max-consecutive: 2;")
    let merged = first.merged(with: second)
    check("merge: smallest maximum, largest minimum, smallest max-consecutive", merged.maxLength == 16 && merged.minLength == 10 && merged.maxConsecutive == 2)
    check("merge: union of requirements, the larger count for the same set",
          merged.required.count == 2 && merged.required.first { $0.characters == PasswordRules.digit }?.count == 2 && merged.required.first { $0.characters == PasswordRules.lower }?.count == 1)
    check("merge: intersection of what is allowed", merged.allowed == PasswordRules.lower.union(PasswordRules.digit))
    check("merge: one side with nothing allowed keeps the other's", first.merged(with: PasswordRules(parsing: "minlength: 3;")).allowed == first.allowed)
    check("merge: a request's three strings in one call", PasswordRules.merged(parsing: ["maxlength: 20;", nil, "maxlength: 16; minlength: 8;"]).maxLength == 16)

    check("accepts: length bounds", PasswordRules(parsing: "minlength: 8;").accepts("12345678") && !PasswordRules(parsing: "minlength: 8;").accepts("1234567")
          && !PasswordRules(parsing: "maxlength: 4;").accepts("12345"))
    check("accepts: max-consecutive", PasswordRules(parsing: "max-consecutive: 2;").accepts("aabaa") && !PasswordRules(parsing: "max-consecutive: 2;").accepts("aaab"))
    check("accepts: allowed", PasswordRules(parsing: "allowed: digit;").accepts("123") && !PasswordRules(parsing: "allowed: digit;").accepts("12a"))

    same("limits: a minimum above 64 lifts the cap to 128", PasswordRules(parsing: "minlength: 100;").effectiveMaxLength, 128)
    same("limits: a maximum above 64 is cut to 64", PasswordRules(parsing: "maxlength: 200;").effectiveMaxLength, 64)
    same("limits: a small maximum is kept", PasswordRules(parsing: "maxlength: 10;").effectiveMaxLength, 10)
    same("limits: a maximum between 64 and the lifted cap is kept", PasswordRules(parsing: "minlength: 70; maxlength: 80;").effectiveMaxLength, 80)
    same("limits: no rules, 64", PasswordRules().effectiveMaxLength, 64)
    var rng = SplitMix64(seed: 11)
    let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789;:[],- ")
    var survived = true
    for _ in 0..<3000 {
        let length = Int(rng.next() % 60)
        var text = ""
        for _ in 0..<length { text.append(alphabet[Int(rng.next() % UInt64(alphabet.count))]) }
        let rules = PasswordRules(parsing: text)
        survived = survived && PasswordRules(parsing: rules.canonical) == rules
        _ = gen(.recommended, rules: rules, &rng)
    }
    check("parser: junk never crashes, still reads back, and still generates", survived)
    check("parser: a huge number is capped, not a crash", PasswordRules(parsing: "minlength: 99999999999999999999999; maxlength: 1000000000000;").minLength == 0)

    var remembered = RememberedRules(stored: "maxlength: 16; required: digit;")
    same("remembered: stored in canonical form", remembered.stored, "maxlength: 16; required: digit;")
    remembered.remember(.tooLong)
    check("remembered: too long at 16 goes to 12", remembered.rules.maxLength == 12)
    remembered.remember(.tooLong)
    check("remembered: and to 10", remembered.rules.maxLength == 10)
    remembered.remember(.tooLong); remembered.remember(.tooLong)
    check("remembered: and stops at 8", remembered.rules.maxLength == 8)
    var fresh = RememberedRules()
    fresh.remember(.tooLong)
    check("remembered: too long with no maximum is 16", fresh.rules.maxLength == 16)
    fresh.remember(.needsSymbol)
    check("remembered: needs a symbol requires one, once", fresh.rules.required.filter { $0.characters == PasswordRules.special }.count == 1)
    fresh.remember(.needsSymbol)
    check("remembered: asking twice does not ask for two", fresh.rules.required.first { $0.characters == PasswordRules.special }?.count == 1)
    fresh.remember(.charactersNotAllowed)
    check("remembered: not allowed leaves letters and digits only and drops the symbol", fresh.rules.allowed == PasswordRules.lower.union(PasswordRules.upper).union(PasswordRules.digit)
          && !fresh.rules.required.contains { $0.characters.isSubset(of: PasswordRules.special) })
    var rngR = SplitMix64(seed: 111)
    check("remembered: what it stores generates a password that satisfies it", (0..<100).allSatisfy { _ in
        let r = gen(.recommended, rules: fresh.rules, &rngR); return !r.value.isEmpty && fresh.rules.accepts(r.value) && !r.value.contains("-")
    })
    fresh.forget()
    check("remembered: forget empties it", fresh.isEmpty && fresh.stored.isEmpty)
    check("remembered: unreadable text means nothing remembered", RememberedRules(stored: "zzz").isEmpty && RememberedRules(stored: nil).isEmpty)
    var request = RememberedRules()
    request.remember(PasswordRules(parsing: "minlength: 8; maxlength: 16;"))
    check("remembered: a request's rules are kept", request.rules.maxLength == 16 && request.rules.minLength == 8)
}

// MARK: 12. Settings

func testSettings() {
    GeneratorSettingsStorage.memory = nil
    let recommended = GeneratorSettings.recommended
    check("settings: recommended is Apple-style", recommended.kind == .apple)
    check("settings: recommended is 6 words and 20 characters", recommended.words == 6 && recommended.length == 20)
    check("settings: recommended has a number and no symbol", recommended.includeNumber && !recommended.includeSymbol)
    check("settings: recommended has hyphens and capitals, version 1", recommended.separator == .hyphen && recommended.capitalize && recommended.version == 1)
    check("settings: the plain initialiser is the recommended settings", GeneratorSettings() == recommended)
    check("settings: nothing stored reads as recommended", GeneratorSettings.load() == recommended)

    let custom = GeneratorSettings(kind: .words, words: 5, length: 30, includeNumber: false, includeSymbol: true, separator: .period, capitalize: false)
    let data = try! JSONEncoder().encode(custom)
    check("settings: encodes and decodes", (try? JSONDecoder().decode(GeneratorSettings.self, from: data)) == custom)
    check("settings: the stored form is versioned", String(decoding: data, as: UTF8.self).contains("\"version\":1"))
    custom.save()
    check("settings: saved settings load back", GeneratorSettings.load() == custom)
    check("settings: stored in the stand-in, not in real defaults", GeneratorSettingsStorage.memory != nil && UserDefaults.standard.data(forKey: GeneratorSettings.storageKey) == nil)

    func decode(_ json: String) -> GeneratorSettings? { try? JSONDecoder().decode(GeneratorSettings.self, from: Data(json.utf8)) }
    check("settings: an empty object gives recommended", decode("{}") == recommended)
    let wild = decode("{\"kind\":\"zebra\",\"words\":99,\"length\":3,\"separator\":\"zig\"}")
    check("settings: an unknown kind falls back to Apple-style", wild?.kind == .apple)
    check("settings: numbers out of range are clamped", wild?.words == 7 && wild?.length == 12)
    check("settings: an unknown separator falls back to hyphen", wild?.separator == .hyphen)
    check("settings: a value of the wrong type becomes the default", decode("{\"words\":\"six\",\"includeNumber\":3}")?.words == 6 && decode("{\"includeNumber\":3}")?.includeNumber == true)
    check("settings: both ends of each range clamp", GeneratorSettings(words: 1, length: 500).words == 4 && GeneratorSettings(words: 1, length: 500).length == 64
          && GeneratorSettings(words: 12, length: 1).words == 7 && GeneratorSettings(words: 12, length: 1).length == 12)
    check("settings: a newer version is still read", decode("{\"version\":9,\"kind\":\"characters\"}")?.kind == .characters)

    GeneratorSettingsStorage.write(Data("not json".utf8))
    check("settings: damaged data reads as recommended", GeneratorSettings.load() == recommended)
    custom.save()
    check("settings: differs from recommended is noticed", custom.differsFromRecommended && !recommended.differsFromRecommended)
    var changed = custom
    changed.reset()
    check("settings: reset returns the recommended settings", changed == recommended && !changed.differsFromRecommended)
    check("settings: resetting the stored value clears it", GeneratorSettings.resetStored() == recommended && GeneratorSettingsStorage.memory == nil && GeneratorSettings.load() == recommended)
    GeneratorSettingsStorage.memory = nil
}

// MARK: Word list loader

func testWordList() {
    check("word list: the fixture loads, deduplicated", Fixture.words.words.count > 40 && Set(Fixture.words.words).count == Fixture.words.words.count)
    check("word list: comments and blank lines are skipped", WordList(text: "# credit\n\nalpha\r\nbravo\n")?.words == ["alpha", "bravo"])
    check("word list: a damaged line refuses the whole list", WordList(text: "alpha\nBravo\n") == nil && WordList(text: "alpha\nbra-vo\n") == nil && WordList(text: "alpha\n11111\tbravo\n") == nil && WordList(text: "alpha\nx\n") == nil)
    check("word list: duplicates are dropped so strength is not overstated", WordList(text: "alpha\nbravo\nalpha\n")?.words.count == 2)
    check("word list: too few words refuses the list", WordList(text: "alpha\n") == nil && WordList(text: "alpha\nbravo\n", minimumCount: 3) == nil)
    check("word list: bits a word", abs((WordList(text: "alpha\nbravo\ncedar\ndelta\n")?.bitsPerWord ?? 0) - 2) < 1e-9)
    check("word list: the bundled list is missing in a hostless run, so Words falls back", WordList.bundled == nil)
    var rng = SplitMix64(seed: 13)
    let fallback = PasswordGenerator.make(GeneratorSettings(kind: .words), using: &rng)
    check("word list: Words without the file gives random characters and says so", fallback.type == .characters && fallback.adjustment == .wordListUnavailable)
}

// MARK: 14. The mask, and no leaks

func testMask() {
    same("mask: one bullet for each character", PasswordGenerator.mask("abc123-XYZ"), String(repeating: "\u{2022}", count: 10))
    same("mask: nothing for nothing", PasswordGenerator.mask(""), "")
    var rng = SplitMix64(seed: 14)
    var wrong = 0, leaked = 0, labelLeaked = 0, printed = 0
    for kind in [GeneratorSettings.Kind.apple, .words, .characters] {
        for _ in 0..<2000 {
            let result = gen(GeneratorSettings(kind: kind, includeSymbol: true), &rng)
            let mask = PasswordGenerator.mask(result.value)
            if mask.count != result.value.count || !mask.unicodeScalars.allSatisfy({ $0.value == 0x2022 }) { wrong += 1 }
            if result.value.contains(where: { mask.contains($0) }) { leaked += 1 }
            let label = GeneratorText.maskedLabel(characters: result.value.count)
            if label.contains(result.value) || result.value.contains(label) { labelLeaked += 1 }
            if "\(result)".contains(result.value) || "\(String(reflecting: result))".contains(result.value) { printed += 1 }
        }
    }
    check("mask: exactly one U+2022 for each character and nothing else", wrong == 0, "\(wrong) wrong")
    check("mask: no character of the password is in the mask", leaked == 0)
    check("mask: the accessibility label never holds the password", labelLeaked == 0)
    same("mask: the accessibility label says hidden and the length", GeneratorText.maskedLabel(characters: 20), "Password, hidden, 20 characters")
    check("mask: printing a generated password shows no characters", printed == 0)
}

testDeterminism()
testAppleShape()
testWordsDistribution()
testCharactersDistribution()
testBounds()
testRuleTable()
testLengthCaps()
testAdjustments()
testOffensiveFilter()
testStrength()
testForcedClasses()
testParser()
testSettings()
testWordList()
testMask()

print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
