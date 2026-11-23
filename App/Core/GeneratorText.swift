import Foundation

/// Every sentence the generator engine itself produces, in one place with the wording the owner approved (docs/plans/
/// password-generator.md, "Copy"). Everything else a person reads in the generator belongs to the interface.
///
/// Two lines are not in that table and need the owner's approval: `rulesNeedRandom` and `wordListUnavailable`.
enum GeneratorText {
    /// The one line shown when a rule made Psss leave the type the person chose.
    static func message(for adjustment: GeneratedPassword.Adjustment) -> String {
        switch adjustment {
        case .tooLongForApple(let max), .tooLongForWords(let max):
            String(localized: "This site allows at most \(max) characters, so Psss made a shorter password with random characters.")
        case .fewerWords(let from, let to, let max):
            String(localized: "This site allows at most \(max) characters, so this password has \(to) words instead of \(from).")
        case .noWordsAllowed:
            String(localized: "This site does not allow lowercase letters, so Psss made a random password.")
        case .cannotSatisfy:
            String(localized: "Psss cannot make a password that fits this site’s rules. Choose your own.")
        case .rulesNeedRandom:
            // Not in the approved table: the table's lines name a length or lowercase letters, and these two reasons are neither.
            String(localized: "This site’s rules do not fit a password like Safari makes, so Psss made a random password.")
        case .wordListUnavailable:
            String(localized: "Words are not available right now, so Psss made a random password.")
        }
    }

    /// What VoiceOver says for the masked password: the length, never the characters.
    static func maskedLabel(characters: Int) -> String {
        String(localized: "Password, hidden, \(characters) characters")
    }

    /// Which control the hint points at.
    enum Control: Sendable { case words, length }

    /// "Weaker than the recommended password. …", only below the recommended strength.
    static func hint(bits: Double, control: Control) -> String? {
        guard PasswordStrength.isWeakerThanDefault(bits: bits) else { return nil }
        let time = PasswordStrength.timeText(bits: bits)
        switch control {
        case .words:
            return String(localized: "Weaker than the recommended password. A machine trying a trillion guesses a second would need about \(time). Add a word.")
        case .length:
            return String(localized: "Weaker than the recommended password. A machine trying a trillion guesses a second would need about \(time). Make it longer.")
        }
    }
}

/// How strong a password is, from how it was made.
enum PasswordStrength {
    /// What the default (a password like Safari makes) carries, about: Apple states 71 bits.
    static let recommendedBits = 71.0
    /// Guesses a second the time sentence assumes: a site that kept a fast hash, on purpose pessimistic.
    static let guessesPerSecond = 1e12

    static func isWeakerThanDefault(bits: Double) -> Bool { bits < recommendedBits }

    /// Seconds for a machine to try half of all passwords of this strength.
    static func secondsToGuess(bits: Double) -> Double { pow(2, bits - 1) / guessesPerSecond }

    /// "30 minutes", "18 years", rounded to two significant figures; "more than a million years" at or above that.
    static func timeText(bits: Double) -> String {
        let seconds = secondsToGuess(bits: bits)
        let minute = 60.0, hour = 3600.0, day = 86400.0, year = 31_557_600.0
        if seconds / year >= 1_000_000 { return String(localized: "more than a million years") }
        let value: Double
        let unit: (one: String, many: (Int) -> String)
        if seconds < minute {
            value = max(seconds, 1)
            unit = (String(localized: "1 second"), { String(localized: "\($0) seconds") })
        } else if seconds < hour {
            value = seconds / minute
            unit = (String(localized: "1 minute"), { String(localized: "\($0) minutes") })
        } else if seconds < day {
            value = seconds / hour
            unit = (String(localized: "1 hour"), { String(localized: "\($0) hours") })
        } else if seconds < year {
            value = seconds / day
            unit = (String(localized: "1 day"), { String(localized: "\($0) days") })
        } else {
            value = seconds / year
            unit = (String(localized: "1 year"), { String(localized: "\($0) years") })
        }
        let rounded = twoSignificantFigures(value)
        return rounded == 1 ? unit.one : unit.many(Int(rounded.rounded()))
    }

    /// 18.7 gives 19 and 1234 gives 1200. The caller shows whole numbers: the units above keep the value at 1 or more.
    static func twoSignificantFigures(_ value: Double) -> Double {
        guard value > 0, value.isFinite else { return 0 }
        let magnitude = pow(10, floor(log10(value)) - 1)
        return (value / magnitude).rounded() * magnitude
    }
}
