import Foundation

/// Rejects Apple-style passwords that spell something offensive. Consonant-vowel-consonant syllables form short words, and a
/// family includes children, so Apple filters its own the same way.
///
/// The terms are not in code. They are a reviewable text file, `OffensiveTerms.txt`, one lowercase term per line, `#` for
/// comments. A candidate is lowercased and stripped of everything but letters and digits before it is searched, so a term is
/// found across a hyphen or any other separator ("ba-m" holds "bam"), and a digit breaks a match.
///
/// An empty list rejects nothing. Terms shorter than three characters are ignored, because they would throw away too many drafts.
struct OffensiveFilter: Sendable {
    let terms: [String]
    private let cache = AcceptanceCache()

    /// Estimates are kept here, once for each word count, so they are the same for every draw.
    private final class AcceptanceCache: @unchecked Sendable {
        let lock = NSLock()
        var rates: [Int: Double] = [:]
    }

    /// Drafts the estimate looks at. The error is about 0.0015 in the rate, 0.002 bit.
    static let acceptanceSample = 10_000

    /// The share of Apple-style drafts of this many groups that this list lets through. Redrawing a rejected draft removes
    /// exactly this share of the possible passwords, so `log2` of it is what the list costs in bits, the same for every
    /// password. Estimated once for each list from a fixed sample (a fixed seed, never the caller's generator) and kept.
    /// 1 for an empty list.
    func acceptanceRate(groups: Int) -> Double {
        guard !terms.isEmpty else { return 1 }
        cache.lock.lock(); defer { cache.lock.unlock() }
        if let known = cache.rates[groups] { return known }
        var source = FixedRandomSource(seed: 0xA11CE)
        var accepted = 0
        for _ in 0..<Self.acceptanceSample {
            let draft = AppleStyle.draft(groups: groups, using: &source)
            if !rejects(AppleStyle.assemble(draft, separators: [])) { accepted += 1 }
        }
        let rate = Double(max(accepted, 1)) / Double(Self.acceptanceSample)
        cache.rates[groups] = rate
        return rate
    }

    static let minimumTermLength = 3

    init(terms: [String]) {
        var seen = Set<String>()
        var kept: [String] = []
        for term in terms {
            let normalized = Self.normalized(term)
            if normalized.count >= Self.minimumTermLength, seen.insert(normalized).inserted { kept.append(normalized) }
        }
        self.terms = kept
    }

    /// Reads the file's text: one term per line, blank lines and lines starting with `#` skipped.
    init(text: String) {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        self.init(terms: lines.filter { !$0.hasPrefix("#") })
    }

    static let none = OffensiveFilter(terms: [])

    /// The list bundled with the app. Empty when the file is missing, which `rejects` treats as "nothing to reject".
    static let bundled: OffensiveFilter = {
        guard let url = Bundle.main.url(forResource: "OffensiveTerms", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return .none }
        return OffensiveFilter(text: text)
    }()

    func rejects(_ candidate: String) -> Bool {
        guard !terms.isEmpty else { return false }
        let text = Self.normalized(candidate)
        return terms.contains { text.contains($0) }
    }

    func rejects(_ candidate: [Character]) -> Bool { rejects(String(candidate)) }

    private static func normalized(_ text: String) -> String {
        String(text.lowercased().unicodeScalars.filter { ($0.value >= 97 && $0.value <= 122) || ($0.value >= 48 && $0.value <= 57) }
            .map { Character($0) })
    }
}

/// A fixed, seeded source (SplitMix64) for estimates that must come out the same every time. Never used to make a password.
struct FixedRandomSource: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
