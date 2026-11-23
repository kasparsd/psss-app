import Foundation

/// Pure helpers for card numbers. Nothing here reads or writes a vault or touches the interface.
enum CardNumber {
    /// The digits of the text, with spaces, dashes and every other character dropped. Only the ASCII digits 0 to 9 count.
    static func normalized(_ text: String) -> String {
        String(text.unicodeScalars.filter { ("0"..."9").contains($0) })
    }

    /// Whether the digits pass the Luhn check. A number of fewer than two digits does not. A failed check is a warning, not a
    /// refusal: gift cards and some store cards fail it.
    static func isValidLuhn(_ text: String) -> Bool {
        let digits = normalized(text).compactMap(\.wholeNumberValue)
        guard digits.count >= 2 else { return false }
        var sum = 0
        for (offset, digit) in digits.reversed().enumerated() {
            if offset % 2 == 1 {
                let doubled = digit * 2
                sum += doubled > 9 ? doubled - 9 : doubled
            } else {
                sum += digit
            }
        }
        return sum % 10 == 0
    }

    /// The digits grouped for display with single spaces, by the card's network (see `CardBrand.grouping(digitCount:)`). A number
    /// whose network is unknown is grouped by four. Works on a partly typed number.
    static func grouped(_ text: String) -> String {
        let digits = Array(normalized(text))
        let sizes = (CardBrand(number: String(digits))?.grouping(digitCount: digits.count)) ?? Array(repeating: 4, count: digits.count / 4 + 1)
        var groups: [String] = []
        var index = 0
        for size in sizes where index < digits.count {
            let end = min(index + size, digits.count)
            groups.append(String(digits[index..<end]))
            index = end
        }
        while index < digits.count {
            let end = min(index + 4, digits.count)
            groups.append(String(digits[index..<end]))
            index = end
        }
        return groups.joined(separator: " ")
    }
}

/// A card's expiry month and year.
struct CardExpiry: Equatable, Sendable {
    let month: Int
    /// Four digits, 2000 to 2099.
    let year: Int

    /// Reads what people type: `08/30`, `0830`, `8/30`, `08/2030`, `2030-08`, `08-30`, `203008` and the same with dots or
    /// spaces for the slash. A two-digit year is 20xx. Nil when it is not a month from 1 to 12 and a year from 2000 to 2099.
    /// With two numbers of two digits the month comes first (`12-08` is December 2008).
    static func parse(_ text: String) -> CardExpiry? {
        let separators: Set<Character> = ["/", "-", ".", " ", "\\"]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isASCII && ($0.isNumber || separators.contains($0)) }) else { return nil }
        let parts = trimmed.split(whereSeparator: { separators.contains($0) }).map(String.init)

        func make(month: String, year: String) -> CardExpiry? {
            guard let m = Int(month), (1...12).contains(m), let y = Int(year) else { return nil }
            switch year.count {
            case 2: return CardExpiry(month: m, year: 2000 + y)
            case 4: return (2000...2099).contains(y) ? CardExpiry(month: m, year: y) : nil
            default: return nil
            }
        }

        switch parts.count {
        case 2:
            let (a, b) = (parts[0], parts[1])
            if a.count == 4, (1...2).contains(b.count) { return make(month: b, year: a) }
            guard (1...2).contains(a.count) else { return nil }
            return make(month: a, year: b)
        case 1:
            let digits = parts[0]
            switch digits.count {
            case 3: return make(month: String(digits.prefix(1)), year: String(digits.suffix(2)))
            case 4: return make(month: String(digits.prefix(2)), year: String(digits.suffix(2)))
            case 5: return make(month: String(digits.prefix(1)), year: String(digits.suffix(4)))
            case 6:
                // 082030 (month first) or 203008 (year first). A month from 1 to 12 and a year from 2000 decides.
                return make(month: String(digits.prefix(2)), year: String(digits.suffix(4)))
                    ?? make(month: String(digits.suffix(2)), year: String(digits.prefix(4)))
            default: return nil
            }
        default:
            return nil
        }
    }

    /// `MM/YY`, the form stored in the vault.
    var formatted: String { String(format: "%02d/%02d", month, year % 100) }

    /// Whether the card has expired. A card is good through the last day of its month. The month is read in the Gregorian
    /// calendar, in the time zone of `calendar` (the person's, by default): a card's year is a Gregorian year whatever calendar the
    /// device shows (Buddhist, Japanese, Islamic, Persian), so only the time zone of the calendar passed in is used.
    func isPast(now: Date = .now, calendar: Calendar = .current) -> Bool {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        let parts = gregorian.dateComponents([.year, .month], from: now)
        guard let currentYear = parts.year, let currentMonth = parts.month else { return false }
        return (year, month) < (currentYear, currentMonth)
    }
}
