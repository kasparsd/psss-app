import Foundation

/// The shape of the password Safari suggests, rebuilt from what Apple has published (Platform Security guide and Ricky Mondello's
/// post of 2024-10-07): 20 characters, three groups of six joined by two hyphens, made of consonant-vowel-consonant
/// syllables, with one digit (one of five positions) and one capital letter. About 71 bits.
///
/// Not published, and guessed here: which 19 consonants (`l` and `y` are left out, `y` is a vowel), where the capital may sit
/// (anywhere a letter is) and Apple's list of offensive words (see `OffensiveFilter`). So this is "like Safari makes", not a copy
/// of Apple's code.
enum AppleStyle {
    static let consonants = Array("bcdfghjkmnpqrstvwxz")
    static let vowels = Array("aeiouy")
    /// Letter positions the digit replaces: the end of group 1, the start and end of group 2, the start and end of group 3.
    static let digitSlots = [5, 6, 11, 12, 17]
    static let groupLength = 6

    struct Draft {
        /// The letters and the digit, without separators: six characters per group.
        var characters: [Character]
        var digitSlot: Int
        var upperSlot: Int
    }

    /// One draw. Every choice is uniform and independent: the letters, which of the five slots holds the digit, the digit,
    /// and which of the remaining letters is the capital.
    static func draft<G: RandomNumberGenerator>(groups: Int, using generator: inout G) -> Draft {
        let count = groups * groupLength
        var characters = [Character](repeating: "a", count: count)
        for index in 0..<count {
            characters[index] = index % 3 == 1 ? vowels[RandomPick.index(below: vowels.count, using: &generator)]
                                               : consonants[RandomPick.index(below: consonants.count, using: &generator)]
        }
        let digitSlot = digitSlots[RandomPick.index(below: digitSlots.count, using: &generator)]
        let digit = RandomPick.index(below: 10, using: &generator)
        characters[digitSlot] = Character(Unicode.Scalar(UInt8(48 + digit)))
        let choice = RandomPick.index(below: count - 1, using: &generator)
        let upperSlot = choice < digitSlot ? choice : choice + 1
        characters[upperSlot] = Character(characters[upperSlot].uppercased())
        return Draft(characters: characters, digitSlot: digitSlot, upperSlot: upperSlot)
    }

    /// The groups joined by `separators` (one fewer than the groups, or none).
    static func assemble(_ draft: Draft, separators: [Character]) -> [Character] {
        let groups = draft.characters.count / groupLength
        var result: [Character] = []
        for group in 0..<groups {
            if group > 0, !separators.isEmpty { result.append(separators[group - 1]) }
            result.append(contentsOf: draft.characters[(group * groupLength)..<((group + 1) * groupLength)])
        }
        return result
    }

    /// Bits of the draw alone: the syllables (the replaced consonant is not drawn), the slot, the digit and the capital.
    /// 71.97 for three groups, as Apple states about 71.
    static func bits(groups: Int) -> Double {
        let syllable = log2(Double(consonants.count * vowels.count * consonants.count))
        return Double(2 * groups) * syllable - log2(Double(consonants.count)) + log2(10) + log2(Double(digitSlots.count))
            + log2(Double(groups * groupLength - 1))
    }
}
