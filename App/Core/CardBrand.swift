import SwiftUI

/// The card network, read from the leading digits (the issuer identification number). Nothing leaves the device.
enum CardBrand: CaseIterable {
    case visa, mastercard, americanExpress, discover, jcb, dinersClub

    var name: String {
        switch self {
        case .visa: "Visa"
        case .mastercard: "Mastercard"
        case .americanExpress: "American Express"
        case .discover: "Discover"
        case .jcb: "JCB"
        case .dinersClub: "Diners Club"
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
        }
    }

    /// Detects the network from a card number; spaces and dashes are ignored. Needs the first digits only.
    init?(number: String) {
        let digits = number.filter(\.isNumber)
        func prefix(_ length: Int) -> Int? { digits.count >= length ? Int(digits.prefix(length)) : nil }
        guard let first = prefix(1) else { return nil }
        if first == 4 { self = .visa }
        else if let p2 = prefix(2), (51...55).contains(p2) { self = .mastercard }
        else if let p4 = prefix(4), (2221...2720).contains(p4) { self = .mastercard }
        else if let p2 = prefix(2), p2 == 34 || p2 == 37 { self = .americanExpress }
        else if let p4 = prefix(4), p4 == 6011 { self = .discover }
        else if let p2 = prefix(2), p2 == 65 { self = .discover }
        else if let p3 = prefix(3), (644...649).contains(p3) { self = .discover }
        else if let p4 = prefix(4), (3528...3589).contains(p4) { self = .jcb }
        else if let p3 = prefix(3), (300...305).contains(p3) { self = .dinersClub }
        else if let p2 = prefix(2), p2 == 36 || p2 == 38 || p2 == 39 { self = .dinersClub }
        else { return nil }
    }
}
