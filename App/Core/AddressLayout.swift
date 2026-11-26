import Contacts
import Foundation

/// How an address item is laid out and described (owner, 2026-11-26, mock `#/address-item`). Pure: no vault, no interface, so the
/// tests check it without a device. Nothing here changes what is stored.

/// The place rows of an address, in the order a country writes them.
enum AddressPart: Hashable, Sendable { case city, region, postalCode }

/// The rows between the street and the country, their order and what each is called, for one country.
struct AddressLayout: Sendable {
    let order: [AddressPart]
    let city: LocalizedStringResource
    /// Nil when the country has no such row. A region that is stored anyway is shown as `Region` after the others.
    let region: LocalizedStringResource?
    let postal: LocalizedStringResource

    func label(_ part: AddressPart) -> LocalizedStringResource? {
        switch part {
        case .city: city
        case .region: region
        case .postalCode: postal
        }
    }

    /// The default: the postal code, then the city (most of Europe).
    static let standard = AddressLayout(order: [.postalCode, .city], city: "City", region: nil, postal: "Postal code")

    /// The short table of countries whose forms differ from the default (the mock's table). Anything else is `standard`.
    static func forCountry(_ code: String) -> AddressLayout {
        switch code {
        case "US": AddressLayout(order: [.city, .region, .postalCode], city: "City", region: "State", postal: "ZIP code")
        case "CA": AddressLayout(order: [.city, .region, .postalCode], city: "City", region: "Province", postal: "Postal code")
        case "AU": AddressLayout(order: [.city, .region, .postalCode], city: "City", region: "State", postal: "Postcode")
        case "GB": AddressLayout(order: [.city, .postalCode], city: "Town or city", region: nil, postal: "Postcode")
        case "ES", "IT": AddressLayout(order: [.postalCode, .city, .region], city: "City", region: "Province", postal: "Postal code")
        default: .standard
        }
    }
}

/// Countries and regions by their two-letter code, named in the language of the interface.
enum AddressCountry {
    /// Every ISO 3166 region code.
    static let codes: [String] = Locale.Region.isoRegions.map(\.identifier).filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }

    private static let known = Set(codes)

    /// The country of this device ("" when the system gives none that is a country).
    static var device: String {
        let code = Locale.current.region?.identifier ?? ""
        return known.contains(code) ? code : ""
    }

    static func name(of code: String) -> String? {
        known.contains(code) ? Locale.current.localizedString(forRegionCode: code) : nil
    }

    /// The code for what is typed or was imported: a code in any case, or a country's name in the interface language or in English.
    /// Nil when it is neither, and the text is then kept as written.
    static func code(for text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.count == 2, known.contains(trimmed.uppercased()) { return trimmed.uppercased() }
        return names.first { $0.name.compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }?.code
    }

    /// Code and name, A to Z by name, for the picker. Names are those of the interface language.
    static var choices: [(code: String, name: String)] {
        codes.map { (code: $0, name: Locale.current.localizedString(forRegionCode: $0) ?? $0) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private static var names: [(code: String, name: String)] {
        let english = Locale(identifier: "en")
        return codes.flatMap { code -> [(String, String)] in
            let shown = Locale.current.localizedString(forRegionCode: code)
            let plain = english.localizedString(forRegionCode: code)
            return [shown, plain == shown ? nil : plain].compactMap { $0 }.map { (code, $0) }
        }
        .map { (code: $0.0, name: $0.1) }
    }
}

extension PostalAddress {
    /// The code of the country, when it is one (a code or a country's name).
    var countryCode: String? { AddressCountry.code(for: country) }

    /// The country as shown: its name for a known country, else the text as written. Empty when none.
    var shownCountry: String {
        if let code = countryCode, let name = AddressCountry.name(of: code) { return name }
        return country
    }

    /// The rows for this address's country; with none (or one that is not a country), for the country of the device.
    func layout(device: String = AddressCountry.device) -> AddressLayout {
        AddressLayout.forCountry(countryCode ?? device)
    }

    /// The place rows in order. A region that the country has no row for follows the others, so it is never hidden.
    func geoParts(device: String = AddressCountry.device) -> [AddressPart] {
        let layout = layout(device: device)
        return layout.order + (layout.region == nil && !region.isEmpty ? [.region] : [])
    }
}

extension VaultItem {
    /// The address row's second line: the full name and the city, joined by a dot. The name is left out when it is already the title
    /// (no label), so a name never shows twice. Nil when there is nothing to say. Shown text is cleaned (`DisplayText`).
    var addressSecondLine: String? {
        let label = visibleTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = DisplayText.safe(visibleAccount)
        let city = DisplayText.safe(address.city)
        let parts = [label.isEmpty ? nil : name, city].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// What Copy Address puts on the clipboard: the name and organization, then the street, place and country as the system's
    /// postal formatter writes them for that country, one per line. Values are copied as stored.
    func addressEnvelope(device: String = AddressCountry.device) -> String {
        let postal = CNMutablePostalAddress()
        postal.street = address.street
        postal.city = address.city
        postal.state = address.region
        postal.postalCode = address.postalCode
        postal.country = address.shownCountry
        if let code = address.countryCode ?? (device.isEmpty ? nil : device) { postal.isoCountryCode = code }
        let place = CNPostalAddressFormatter.string(from: postal, style: .mailingAddress)
        let lines = [account, address.organization].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return (lines + [place]).filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// Whether the address has anything to copy: a street, a city or a postal code.
    var hasPostalAddress: Bool { !address.street.isEmpty || !address.city.isEmpty || !address.postalCode.isEmpty }
}
