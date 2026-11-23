import SwiftUI

/// The card network, read from the leading digits (the issuer identification number). Nothing leaves the device.
enum CardBrand: CaseIterable {
    case visa, mastercard, americanExpress, discover, jcb, dinersClub, maestro, unionPay, mir, elo

    var name: String {
        switch self {
        case .visa: "Visa"
        case .mastercard: "Mastercard"
        case .americanExpress: "American Express"
        case .discover: "Discover"
        case .jcb: "JCB"
        case .dinersClub: "Diners Club"
        case .maestro: "Maestro"
        case .unionPay: "UnionPay"
        case .mir: "Mir"
        case .elo: "Elo"
        }
    }

    var asset: String {
        switch self {
        case .visa: "brand-visa"
        case .mastercard: "brand-mastercard"
        case .americanExpress: "brand-americanexpress"
        case .discover: "brand-discover"
        case .jcb: "brand-jcb"
        case .dinersClub: "brand-dinersclub"
        case .maestro: "brand-maestro"
        case .unionPay: "brand-unionpay"
        case .mir: "brand-mir"
        case .elo: "brand-elo"
        }
    }

    /// Whether the asset catalog holds this network's logo. The four networks added last have none yet, so a row that shows a logo
    /// should check this and fall back to a plain card glyph.
    var hasLogo: Bool {
        switch self {
        case .visa, .mastercard, .americanExpress, .discover, .jcb, .dinersClub: true
        case .maestro, .unionPay, .mir, .elo: false
        }
    }

    var color: Color {
        switch self {
        case .visa: Color(red: 0.10, green: 0.23, blue: 0.62)
        case .mastercard: Color(red: 0.92, green: 0.0, blue: 0.11)
        case .americanExpress: Color(red: 0.0, green: 0.44, blue: 0.82)
        case .discover: Color(red: 1.0, green: 0.38, blue: 0.0)
        case .jcb: Color(red: 0.0, green: 0.33, blue: 0.63)
        case .dinersClub: Color(red: 0.0, green: 0.44, blue: 0.71)
        case .maestro: Color(red: 0.0, green: 0.45, blue: 0.82)
        case .unionPay: Color(red: 0.0, green: 0.38, blue: 0.51)
        case .mir: Color(red: 0.0, green: 0.55, blue: 0.33)
        case .elo: Color(red: 0.0, green: 0.0, blue: 0.0)
        }
    }

    /// How many digits each space-separated group of the number holds, for a number of `digitCount` digits typed so far.
    /// American Express is 4-6-5 and a 14-digit Diners Club 4-6-4. Every other number is groups of four, which for 19 digits is
    /// 4-4-4-4-3. The last group takes whatever is left, so a number can be grouped while it is being typed.
    func grouping(digitCount: Int) -> [Int] {
        switch self {
        case .americanExpress: return [4, 6, 5]
        case .dinersClub where digitCount <= 14: return [4, 6, 4]
        default: return Array(repeating: 4, count: max(digitCount, 16) / 4 + 1)
        }
    }

    /// Detects the network from a card number; spaces and dashes are ignored. Needs the first digits only.
    /// Elo is checked first: its ranges sit inside Visa's, Discover's and UnionPay's.
    init?(number: String) {
        let digits = number.filter(\.isASCII).filter(\.isNumber)
        func prefix(_ length: Int) -> Int? { digits.count >= length ? Int(digits.prefix(length)) : nil }
        guard let first = prefix(1) else { return nil }
        if let p6 = prefix(6), Self.eloRanges.contains(where: { $0.contains(p6) }) { self = .elo }
        else if first == 4 { self = .visa }
        else if let p2 = prefix(2), (51...55).contains(p2) { self = .mastercard }
        else if let p4 = prefix(4), (2221...2720).contains(p4) { self = .mastercard }
        else if let p4 = prefix(4), (2200...2204).contains(p4) { self = .mir }
        else if let p2 = prefix(2), p2 == 34 || p2 == 37 { self = .americanExpress }
        else if let p4 = prefix(4), p4 == 6011 { self = .discover }
        else if let p2 = prefix(2), p2 == 65 { self = .discover }
        else if let p3 = prefix(3), (644...649).contains(p3) { self = .discover }
        else if let p2 = prefix(2), p2 == 62 { self = .unionPay }
        else if let p4 = prefix(4), (3528...3589).contains(p4) { self = .jcb }
        else if let p3 = prefix(3), (300...305).contains(p3) { self = .dinersClub }
        else if let p2 = prefix(2), p2 == 36 || p2 == 38 || p2 == 39 { self = .dinersClub }
        else if let p2 = prefix(2), Self.maestroPrefixes.contains(p2) { self = .maestro }
        else { return nil }
    }

    /// Leading six digits of Elo cards.
    private static let eloRanges: [ClosedRange<Int>] = [
        401178...401179, 431274...431274, 438935...438935, 451416...451416, 457393...457393, 457631...457632,
        504175...504175, 506699...506778, 509000...509999, 627780...627780, 636297...636297, 636368...636368,
        650031...650033, 650035...650051, 650405...650439, 650485...650538, 650541...650598, 650700...650718,
        650720...650727, 650901...650978, 651652...651679, 655000...655019, 655021...655058]

    /// Leading two digits of Maestro cards. Wikipedia's "Payment card number" issuer table (read 2026-11-23) lists Maestro as 5018,
    /// 5020, 5038, 5893, 6304, 6759, 6761, 6762 and 6763, and Maestro UK as 6759, 676770 and 676774. Issuers also use other numbers
    /// in the same blocks (5612, 6390), so this takes the whole blocks 50, 56 to 59, 63 and 67, as card libraries do (for example
    /// Braintree's credit-card-type, from memory: not re-read). Every network checked before Maestro keeps its numbers: Elo
    /// (including 506699 to 506778 and 509xxx), Visa, Mastercard, Mir, American Express, Discover (65 and 644 to 649), UnionPay (62),
    /// JCB and Diners Club.
    private static let maestroPrefixes: Set<Int> = [50, 56, 57, 58, 59, 63, 67]
}
