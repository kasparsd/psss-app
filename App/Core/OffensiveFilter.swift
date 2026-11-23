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
