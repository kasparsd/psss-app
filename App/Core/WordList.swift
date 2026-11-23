import Foundation

/// The words of the Words type: one lowercase ASCII word per line, `#` for comments, loaded from a bundled text file.
///
/// The bundled file is `EFFLongWordList.txt`, made by `scripts/build-word-list.mjs` from the EFF long list (7,776 words, the four
/// hyphenated ones removed, 7,772 left, 12.924 bits a word). The list is credited to the Electronic Frontier Foundation under
/// Creative Commons Attribution; the file's header carries the credit and the changes. A word list is never read from
/// anywhere else, and a list that does not read cleanly is refused whole rather than used in part.
struct WordList: Sendable {
    let words: [String]
    /// Every letter any word uses, so a rule can be checked once.
    let letters: Set<Character>

    /// Words each need 2 to 12 letters a to z. Duplicates are dropped, so the bits a word carries are never overstated.
    /// Nil when a line is not a clean word or when fewer than `minimumCount` words remain.
    init?(text: String, minimumCount: Int = 2) {
        var seen = Set<String>()
        var words: [String] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let word = line.trimmingCharacters(in: .whitespaces)
            if word.isEmpty || word.hasPrefix("#") { continue }
            guard (2...12).contains(word.count), word.utf8.allSatisfy({ $0 >= 97 && $0 <= 122 }) else { return nil }
            if seen.insert(word).inserted { words.append(word) }
        }
        guard words.count >= max(minimumCount, 2) else { return nil }
        self.words = words
        letters = Set(words.joined())
    }

    var bitsPerWord: Double { log2(Double(words.count)) }

    /// The EFF list in the bundle (the app's or the extension's own). Nil when the file is not there or is damaged: a list
    /// of fewer than 7,000 words is a truncated one, and Words then falls back to random characters instead of getting weaker.
    static let bundled: WordList? = {
        guard let url = Bundle.main.url(forResource: "EFFLongWordList", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return WordList(text: text, minimumCount: 7000)
    }()
}
