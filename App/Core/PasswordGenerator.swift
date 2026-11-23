import Foundation

/// A password and how it was made.
///
/// Printing one, in a log or in a failed test, shows no characters: `description` is redacted on purpose.
struct GeneratedPassword: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    /// The system's three kinds (`ASGeneratedPassword.Kind`): `strong` has special characters, `alphanumeric` has none, `passphrase` is words.
    enum Kind: String, Sendable { case strong, alphanumeric, passphrase }

    /// Why the password is not the type the person chose. Wording: `GeneratorText.message(for:)`.
    enum Adjustment: Equatable, Sendable {
        /// The site allows fewer than 18 characters, so random characters instead of a password like Safari makes.
        case tooLongForApple(max: Int)
        /// No word count of at least 5 fits the site's maximum, so random characters.
        case tooLongForWords(max: Int)
        /// Fewer words than chosen, to fit the site's maximum.
        case fewerWords(from: Int, to: Int, max: Int)
        /// The site allows no lowercase letters, so no words.
        case noWordsAllowed
        /// Another rule, not a length, made the chosen type impossible (not in the approved copy table).
        case rulesNeedRandom
        /// The word list is not in this build (not in the approved copy table).
        case wordListUnavailable
        /// No password can satisfy the rules. `value` is empty; the person types their own.
        case cannotSatisfy
    }

    let value: String
    let kind: Kind
    /// The type that was actually made, which differs from the chosen one only when `adjustment` says why.
    let type: GeneratorSettings.Kind
    /// Strength from how the password was drawn: the log2 of the number of passwords the draw could have made, less what
    /// redrawing for the rules cost.
    let bits: Double
    let adjustment: Adjustment?
    /// What the default (a password like Safari makes) carries with the offensive-word list this password was made with.
    let defaultBits: Double
    /// The site's maximum length, when its rules gave one.
    let siteMaximum: Int?

    init(value: String, kind: Kind, type: GeneratorSettings.Kind, bits: Double, adjustment: Adjustment?,
         defaultBits: Double = PasswordStrength.recommendedBits, siteMaximum: Int? = nil) {
        self.value = value; self.kind = kind; self.type = type; self.bits = bits; self.adjustment = adjustment
        self.defaultBits = defaultBits; self.siteMaximum = siteMaximum
    }

    func annotated(defaultBits: Double, siteMaximum: Int?) -> GeneratedPassword {
        GeneratedPassword(value: value, kind: kind, type: type, bits: bits, adjustment: adjustment, defaultBits: defaultBits, siteMaximum: siteMaximum)
    }

    /// Weaker than the default made with the same list. A password like Safari makes is the default's own shape, so it never is,
    /// and a password nobody could make is not a weak one.
    var isWeakerThanDefault: Bool { !value.isEmpty && type != .apple && PasswordStrength.isWeakerThanDefault(bits: bits, defaultBits: defaultBits) }

    /// The line beside the control that made this weaker, or nil.
    func hint(control: GeneratorText.Control = .length) -> String? {
        isWeakerThanDefault ? GeneratorText.hint(bits: bits, control: control, defaultBits: defaultBits, siteMaximum: siteMaximum) : nil
    }

    /// `dump` and `Mirror` show the kind, the length and the strength, never the characters.
    var customMirror: Mirror {
        Mirror(self, children: ["kind": kind.rawValue, "length": value.count, "bits": bits], displayStyle: .struct)
    }

    var description: String { "GeneratedPassword(\(kind.rawValue), \(value.count) characters, \(String(format: "%.1f", bits)) bits)" }
    var debugDescription: String { description }
}

/// Picks without bias. A random 64-bit number is reduced modulo the bound only after the numbers that would make some answers
/// likelier than others are thrown away (rejection sampling), so every index is exactly as likely as every other.
enum RandomPick {
    #if HOSTLESS_TESTS
    /// The largest bound asked for since the test last set this to 0.
    nonisolated(unsafe) static var largestBound = 0
    #endif

    static func index<G: RandomNumberGenerator>(below bound: Int, using generator: inout G) -> Int {
        precondition(bound > 0, "an empty set has nothing to pick")
        #if HOSTLESS_TESTS
        largestBound = max(largestBound, bound)
        #endif
        let limit = UInt64(bound)
        let threshold = (0 &- limit) % limit  // 2^64 mod bound: the numbers below it are the uneven remainder
        var value = generator.next()
        var redraws = 0
        // A real generator all but never redraws. The cap only stops a broken one (all zeros) from hanging.
        while value < threshold, redraws < 64 { value = generator.next(); redraws += 1 }
        return Int(value % limit)
    }
}

/// Makes passwords: like Safari makes them (the default), random characters, or words, for a site's rules when they are known.
///
/// The only source of randomness is the generator passed in (`SystemRandomNumberGenerator` in the app). Nothing here logs, prints or
/// stores a password.
enum PasswordGenerator {
    private static let alphanumerics = PasswordRules.upper.union(PasswordRules.lower).union(PasswordRules.digit)
    /// Never drawn for random characters or for a digit, unless the rules leave fewer than 20 characters to draw from.
    private static let lookalikes: Set<Character> = ["I", "l", "O", "0", "1", "o"]
    private static let fixedSymbols = Set("!@#$%&*?")
    /// Words: drafts drawn for each word count, to learn how often the rules let one through.
    private static let wordTrials = 100
    private static let draftLimit = 100
    private static let randomLimit = 50

    private static let impossible = GeneratedPassword(value: "", kind: .alphanumeric, type: .characters, bits: 0, adjustment: .cannotSatisfy)

    // MARK: Entry points

    /// One password for these settings and rules, drawn from the system's random generator.
    static func make(_ settings: GeneratorSettings = .recommended, rules: PasswordRules = PasswordRules(),
                     words: WordList? = WordList.bundled, filter: OffensiveFilter = OffensiveFilter.bundled) -> GeneratedPassword {
        var system = SystemRandomNumberGenerator()
        return make(settings, rules: rules, words: words, filter: filter, using: &system)
    }

    /// One password for these settings and rules.
    ///
    /// The result always satisfies `rules`, or has the adjustment `cannotSatisfy` and an empty value. It leaves the type in
    /// `settings` only when a rule forces it, and then `adjustment` says which rule.
    static func make<G: RandomNumberGenerator>(_ settings: GeneratorSettings = .recommended, rules: PasswordRules = PasswordRules(),
                                               words: WordList? = WordList.bundled, filter: OffensiveFilter = OffensiveFilter.bundled,
                                               using generator: inout G) -> GeneratedPassword {
        let result = produce(settings, rules: rules, words: words, filter: filter, using: &generator)
        return result.annotated(defaultBits: PasswordStrength.defaultBits(filter: filter), siteMaximum: rules.maxLength)
    }

    private static func produce<G: RandomNumberGenerator>(_ settings: GeneratorSettings, rules: PasswordRules, words: WordList?,
                                                          filter: OffensiveFilter, using generator: inout G) -> GeneratedPassword {
        let settings = settings.clamped
        let cap = rules.effectiveMaxLength
        guard !rules.isUnsatisfiable, rules.minLength <= cap, cap >= 1 else { return impossible }
        let checker = PasswordRules.Checker(rules)
        var reason: GeneratedPassword.Adjustment?
        switch settings.kind {
        case .apple:
            switch makeApple(rules: rules, cap: cap, checker: checker, filter: filter, using: &generator) {
            case .made(let result): return result
            case .fallback(let adjustment): reason = adjustment
            }
        case .words:
            switch makeWords(settings, rules: rules, cap: cap, checker: checker, list: words, using: &generator) {
            case .made(let result): return result
            case .fallback(let adjustment): reason = adjustment
            }
        case .characters:
            break
        }
        return makeRandom(settings, rules: rules, cap: cap, checker: checker, adjustment: reason, using: &generator)
    }

    /// What the system's no-interface request returns: the person's type first, then the other types, each satisfying the rules,
    /// at most one for each of the system's kinds, never an empty one.
    static func offers<G: RandomNumberGenerator>(_ settings: GeneratorSettings, rules: PasswordRules, words: WordList? = WordList.bundled,
                                                 filter: OffensiveFilter = OffensiveFilter.bundled, using generator: inout G) -> [GeneratedPassword] {
        let others = [GeneratorSettings.Kind.apple, .characters, .words].filter { $0 != settings.kind }
        var results: [GeneratedPassword] = []
        for kind in [settings.kind] + others {
            var variant = settings
            variant.kind = kind
            let result = make(variant, rules: rules, words: words, filter: filter, using: &generator)
            if !result.value.isEmpty, !results.contains(where: { $0.kind == result.kind }) { results.append(result) }
        }
        return results
    }

    /// A password like Safari makes, for callers that have no settings yet (the Safari extension's handler, until it passes
    /// the page's rules: package 4 of the plan). Not for new code.
    static func strong() -> String { make().value }

    /// Twenty random letters and digits, for the same callers.
    static func alphanumeric() -> String {
        make(GeneratorSettings(kind: .characters, length: 20, includeNumber: true, includeSymbol: false)).value
    }

    /// The hidden form of a password: one bullet (U+2022) for each character and nothing else, so the length shows and the characters never do.
    static func mask(_ value: String) -> String { String(repeating: "\u{2022}", count: value.count) }

    /// The line beside the control that made a password weaker than the default, or nil at the default's strength and above
    /// (71 bits unless the default's own figure for the offensive-word list is given).
    static func hint(bits: Double, control: GeneratorText.Control = .length, defaultBits: Double = PasswordStrength.recommendedBits,
                     siteMaximum: Int? = nil) -> String? {
        GeneratorText.hint(bits: bits, control: control, defaultBits: defaultBits, siteMaximum: siteMaximum)
    }

    // MARK: Like Safari makes

    private enum Attempt {
        case made(GeneratedPassword)
        case fallback(GeneratedPassword.Adjustment)
    }

    private static func makeApple<G: RandomNumberGenerator>(rules: PasswordRules, cap: Int, checker: PasswordRules.Checker,
                                                            filter: OffensiveFilter, using generator: inout G) -> Attempt {
        if cap < 18 { return .fallback(.tooLongForApple(max: cap)) }
        for groups in [3, 4] {
            // 20 characters with two separators, 18 without. A site that allows 18 or 19 gets no separators.
            let withSeparators = cap >= groups * AppleStyle.groupLength + groups - 1
            let candidates = withSeparators ? separatorCandidates(rules: rules, alphabet: checker.alphabet, count: groups - 1) : []
            let length = groups * AppleStyle.groupLength + (candidates.isEmpty ? 0 : groups - 1)
            if length < rules.minLength { continue }  // a fourth group, when the minimum is longer than three
            if length > cap { break }
            var attempts = 0
            while attempts < draftLimit {
                attempts += 1
                let password = appleCandidate(groups: groups, candidates: candidates, using: &generator)
                guard password.count <= cap, checker.accepts(password), !filter.rejects(password) else { continue }
                // Redrawing removes a fixed share of the passwords this draw could make: what the offensive-word list throws
                // away, and what the rules throw away. Both are estimated once from fixed samples, not from how many
                // redraws this password happened to need, so every password made the same way reports the same bits.
                var bits = AppleStyle.bits(groups: groups)
                if candidates.count > 1 { bits += Double(groups - 1) * log2(Double(candidates.count)) }
                bits += log2(filter.acceptanceRate(groups: groups))
                bits += log2(ruleAcceptance(rules: rules, groups: groups, candidates: candidates, cap: cap, checker: checker))
                return .made(GeneratedPassword(value: String(password), kind: .strong, type: .apple, bits: bits, adjustment: nil))
            }
            return .fallback(.rulesNeedRandom)
        }
        return .fallback(.rulesNeedRandom)
    }

    /// One Apple-style draft, with separators drawn from `candidates`.
    private static func appleCandidate<G: RandomNumberGenerator>(groups: Int, candidates: [Character], using generator: inout G) -> [Character] {
        let draft = AppleStyle.draft(groups: groups, using: &generator)
        var separators: [Character] = []
        if !candidates.isEmpty {
            for _ in 0..<(groups - 1) { separators.append(candidates[RandomPick.index(below: candidates.count, using: &generator)]) }
        }
        return AppleStyle.assemble(draft, separators: separators)
    }

    /// The share of drafts the rules (not the word list) let through: 1 unless the rules can reject a draft by chance, which
    /// only `max-consecutive` and a required symbol drawn from a small set do. Estimated from 1,000 drafts of a fixed seed.
    private static func ruleAcceptance(rules: PasswordRules, groups: Int, candidates: [Character], cap: Int, checker: PasswordRules.Checker) -> Double {
        guard rules.maxConsecutive != nil || rules.required.contains(where: { $0.characters.isDisjoint(with: alphanumerics) }) else { return 1 }
        var source = FixedRandomSource(seed: 0xB0B)
        let sample = 1000
        var accepted = 0
        for _ in 0..<sample {
            let password = appleCandidate(groups: groups, candidates: candidates, using: &source)
            if password.count <= cap, checker.accepts(password) { accepted += 1 }
        }
        return Double(max(accepted, 1)) / Double(sample)
    }

    /// The characters the separators are drawn from: the hyphen, unless the rules need a symbol that the hyphen does not give, or do
    /// not allow it; then a symbol the rules require; failing that `_`, `.` or `+`; failing that none (no separators).
    private static func separatorCandidates(rules: PasswordRules, alphabet: Set<Character>, count: Int) -> [Character] {
        let usable = alphabet.subtracting([PasswordRules.space])
        // A requirement that no letter or digit can meet is a symbol the separators have to supply.
        let symbolRequirements = rules.required.filter { $0.characters.isDisjoint(with: alphanumerics) }
        if symbolRequirements.isEmpty {
            for candidate in ["-", "_", ".", "+"] as [Character] where usable.contains(candidate) { return [candidate] }
            return []
        }
        if usable.contains("-"), symbolRequirements.allSatisfy({ $0.characters.contains("-") && $0.count <= count }) { return ["-"] }
        var pool = usable
        for requirement in symbolRequirements { pool.formIntersection(requirement.characters) }
        if pool.isEmpty { pool = usable.intersection(symbolRequirements[0].characters) }
        return pool.sorted()
    }

    // MARK: Words

    private struct WordPlan {
        let list: WordList
        let capitalize: Bool
        let separator: String
        let digitSets: [[Character]]
        let symbolSets: [[Character]]
        let otherRequirements: [PasswordRules.Requirement]
        let otherDraw: [[Character]]
    }

    private static func makeWords<G: RandomNumberGenerator>(_ settings: GeneratorSettings, rules: PasswordRules, cap: Int,
                                                            checker: PasswordRules.Checker, list: WordList?, using generator: inout G) -> Attempt {
        guard let list else { return .fallback(.wordListUnavailable) }
        let alphabet = checker.alphabet
        guard list.letters.isSubset(of: alphabet) else { return .fallback(.noWordsAllowed) }

        var digitSets: [[Character]] = []
        var symbolSets: [[Character]] = []
        var otherRequirements: [PasswordRules.Requirement] = []
        var otherDraw: [[Character]] = []
        for requirement in rules.required {
            let draw = drawSet(requirement.characters, alphabet: alphabet, restore: false)
            guard !draw.isEmpty else { return .fallback(.rulesNeedRandom) }
            if requirement.characters.isSubset(of: PasswordRules.digit) {
                digitSets += Array(repeating: draw, count: requirement.count)
            } else if requirement.characters.isSubset(of: PasswordRules.special) {
                symbolSets += Array(repeating: draw, count: requirement.count)
            } else {
                otherRequirements.append(requirement)
                otherDraw.append(draw)
            }
        }
        if settings.includeNumber, digitSets.isEmpty {
            let draw = drawSet(PasswordRules.digit, alphabet: alphabet, restore: false)
            if !draw.isEmpty { digitSets.append(draw) }
        }
        if settings.includeSymbol, symbolSets.isEmpty {
            var draw = drawSet(fixedSymbols, alphabet: alphabet, restore: false)
            if draw.isEmpty { draw = drawSet(PasswordRules.special, alphabet: alphabet, restore: false) }
            if !draw.isEmpty { symbolSets.append(draw) }
        }
        let plan = WordPlan(list: list, capitalize: settings.capitalize && PasswordRules.upper.isSubset(of: alphabet),
                            separator: wordSeparator(settings.separator, rules: rules, alphabet: alphabet),
                            digitSets: digitSets, symbolSets: symbolSets, otherRequirements: otherRequirements, otherDraw: otherDraw)

        let chosen = settings.words
        // From the chosen count down to 5; 4 only when 4 was chosen.
        let counts = chosen == 4 ? [4] : Array(stride(from: chosen, through: 5, by: -1))
        for count in counts {
            var firstValid: [Character]?
            var firstBits = 0.0
            var valid = 0
            for _ in 0..<wordTrials {
                let (password, bits) = wordDraft(plan, count: count, using: &generator)
                guard password.count <= cap, checker.accepts(password) else { continue }
                valid += 1
                if firstValid == nil { firstValid = password; firstBits = bits }
            }
            // Accept a count when at least one draft in four fits.
            guard valid * 4 >= wordTrials, let password = firstValid else { continue }
            var bits = firstBits
            if valid < wordTrials { bits -= log2(Double(wordTrials) / Double(valid)) }
            // The reason is only worth saying when the site's own maximum made it: our 64 character limit is not the site's rule.
            let adjustment: GeneratedPassword.Adjustment? = count < chosen && rules.maxLength != nil
                ? .fewerWords(from: chosen, to: count, max: cap) : nil
            return .made(GeneratedPassword(value: String(password), kind: .passphrase, type: .words, bits: bits, adjustment: adjustment))
        }
        return .fallback(rules.maxLength != nil ? .tooLongForWords(max: cap) : .rulesNeedRandom)
    }

    /// The chosen separator when the rules allow it, else the first of `-`, `_` and `.` that they allow, else none. A space only when
    /// the rules do not restrict characters at all.
    private static func wordSeparator(_ choice: GeneratorSettings.Separator, rules: PasswordRules, alphabet: Set<Character>) -> String {
        let wanted: Character
        switch choice {
        case .none: return ""
        case .hyphen: wanted = "-"
        case .space: wanted = " "
        case .period: wanted = "."
        }
        if wanted == " " {
            if rules.allowed == nil { return " " }
        } else if alphabet.contains(wanted) {
            return String(wanted)
        }
        for fallback in ["-", "_", "."] as [Character] where alphabet.contains(fallback) { return String(fallback) }
        return ""
    }

    /// One draft: the words, a number block and a symbol block each after a random word, and a character for whatever a
    /// requirement still lacks. The bits are those of the draw (before the rules' rejections are counted).
    private static func wordDraft<G: RandomNumberGenerator>(_ plan: WordPlan, count: Int, using generator: inout G) -> ([Character], Double) {
        var words: [String] = []
        for _ in 0..<count { words.append(plan.list.words[RandomPick.index(below: plan.list.words.count, using: &generator)]) }
        var tails = [String](repeating: "", count: count)
        var bits = Double(count) * plan.list.bitsPerWord
        attachBlock(plan.digitSets, tails: &tails, bits: &bits, using: &generator)
        attachBlock(plan.symbolSets, tails: &tails, bits: &bits, using: &generator)
        let base = wordText(words, tails: tails, plan: plan)
        for (requirement, draw) in zip(plan.otherRequirements, plan.otherDraw) {
            var found = 0
            for character in base where requirement.characters.contains(character) { found += 1 }
            if found < requirement.count {
                for _ in 0..<(requirement.count - found) { attachBlock([draw], tails: &tails, bits: &bits, using: &generator) }
            }
        }
        return (wordText(words, tails: tails, plan: plan), bits)
    }

    private static func wordText(_ words: [String], tails: [String], plan: WordPlan) -> [Character] {
        var pieces: [String] = []
        for (word, tail) in zip(words, tails) {
            pieces.append((plan.capitalize ? word.prefix(1).uppercased() + String(word.dropFirst()) : word) + tail)
        }
        return Array(pieces.joined(separator: plan.separator))
    }

    /// One character from each set, together after one random word.
    private static func attachBlock<G: RandomNumberGenerator>(_ sets: [[Character]], tails: inout [String], bits: inout Double,
                                                              using generator: inout G) {
        guard !sets.isEmpty else { return }
        var block = ""
        for set in sets {
            block.append(set[RandomPick.index(below: set.count, using: &generator)])
            bits += log2(Double(set.count))
        }
        tails[RandomPick.index(below: tails.count, using: &generator)] += block
        bits += log2(Double(tails.count))
    }

    // MARK: Random characters

    private typealias Placement = (draw: [Character], count: Int)

    /// Random characters: letters, with a capital and a lowercase letter always, and a digit and a symbol when wanted or required.
    ///
    /// Every character a rule or a switch asks for goes to its own position, picked without replacement, so none can overwrite
    /// another. The rest is drawn from the letters (without `I l O o`), or from digits or symbols when the rules allow no letters.
    private static func makeRandom<G: RandomNumberGenerator>(_ settings: GeneratorSettings, rules: PasswordRules, cap: Int,
                                                             checker: PasswordRules.Checker, adjustment: GeneratedPassword.Adjustment?,
                                                             using generator: inout G) -> GeneratedPassword {
        let alphabet = checker.alphabet.subtracting([PasswordRules.space])
        guard !alphabet.isEmpty else { return impossible }
        var baseSet = PasswordRules.lower.union(PasswordRules.upper).intersection(alphabet)
        if baseSet.isEmpty { baseSet = PasswordRules.digit.intersection(alphabet) }
        if baseSet.isEmpty { baseSet = alphabet }
        let withoutLookalikes = baseSet.subtracting(lookalikes)
        let restore = withoutLookalikes.count < 20
        let base = (restore ? baseSet : withoutLookalikes).sorted()

        var explicit: [Placement] = []
        for requirement in rules.required {
            let draw = drawSet(requirement.characters, alphabet: alphabet, restore: restore)
            guard !draw.isEmpty else { return impossible }
            explicit.append((draw, requirement.count))
        }
        func covered(_ group: Set<Character>) -> Bool { rules.required.contains { $0.characters.isSubset(of: group) } }
        var implicit: [Placement] = []
        for group in [PasswordRules.lower, PasswordRules.upper] where !group.isDisjoint(with: alphabet) && !covered(group) {
            implicit.append((drawSet(group, alphabet: alphabet, restore: restore), 1))
        }
        if settings.includeNumber, !PasswordRules.digit.isDisjoint(with: alphabet), !covered(PasswordRules.digit) {
            implicit.append((drawSet(PasswordRules.digit, alphabet: alphabet, restore: restore), 1))
        }
        let symbols = fixedSymbols.isDisjoint(with: alphabet) ? PasswordRules.special : fixedSymbols
        if settings.includeSymbol, !symbols.isDisjoint(with: alphabet), !covered(PasswordRules.special) {
            implicit.append((drawSet(symbols, alphabet: alphabet, restore: restore), 1))
        }

        // A site's short maximum can leave no room for what only the switches or the capital and lowercase letter asked for.
        var fixed = (explicit + implicit).reduce(0) { $0 + $1.count }
        while fixed > cap, let dropped = implicit.popLast() { fixed -= dropped.count }
        guard fixed <= cap else { return impossible }
        let placements = explicit + implicit
        let length = max(min(max(settings.length, rules.minLength), cap), fixed)

        var attempts = 0
        while attempts < randomLimit {
            attempts += 1
            var characters = [Character](repeating: "a", count: length)
            var positions = Array(0..<length)
            for index in 0..<fixed { positions.swapAt(index, index + RandomPick.index(below: length - index, using: &generator)) }
            var taken = [Bool](repeating: false, count: length)
            var next = 0
            for placement in placements {
                for _ in 0..<placement.count {
                    let position = positions[next]
                    next += 1
                    taken[position] = true
                    characters[position] = placement.draw[RandomPick.index(below: placement.draw.count, using: &generator)]
                }
            }
            for position in 0..<length where !taken[position] {
                characters[position] = base[RandomPick.index(below: base.count, using: &generator)]
            }
            guard checker.accepts(characters) else { continue }
            // Positions are not counted, which understates the strength a little.
            var bits = placements.reduce(0.0) { $0 + Double($1.count) * log2(Double($1.draw.count)) }
            bits += Double(length - fixed) * log2(Double(base.count))
            if attempts > 1 { bits -= log2(Double(attempts)) }
            let hasSymbol = characters.contains { !$0.isLetter && !$0.isNumber }
            return GeneratedPassword(value: String(characters), kind: hasSymbol ? .strong : .alphanumeric, type: .characters,
                                     bits: bits, adjustment: adjustment)
        }
        return impossible
    }

    /// What a requirement may draw from: its characters that the rules allow, never a space, without look-alikes unless they are
    /// all there is (or `restore`).
    private static func drawSet(_ set: Set<Character>, alphabet: Set<Character>, restore: Bool) -> [Character] {
        let usable = set.intersection(alphabet).subtracting([PasswordRules.space])
        let filtered = restore ? usable : usable.subtracting(lookalikes)
        return (filtered.isEmpty ? usable : filtered).sorted()
    }
}
