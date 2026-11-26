import SwiftUI

// What a list row draws for an item, shared by the app and the AutoFill picker (the extension compiles only App/Core).

extension ItemKind {
    var label: LocalizedStringKey {
        switch self {
        case .login: "Login"
        case .creditCard: "Card"
        case .address: "Address"
        case .secureNote: "Note"
        case .keePassEntry: "Custom item"
        case .wifi: "Wi-Fi network"
        }
    }

    var symbol: String {
        switch self {
        case .login: "key"
        case .creditCard: "creditcard"
        case .address: "mappin.and.ellipse"
        case .secureNote: "note.text"
        case .keePassEntry: "doc"
        case .wifi: "wifi"
        }
    }
}

extension ItemTrait {
    /// The filled glyph a list row shows for what a login has (the notes glyph is not shown in rows).
    var rowSymbol: String {
        switch self {
        case .passkey: "person.badge.key.fill"
        case .code: "lock.badge.clock.fill"
        case .notes: "note.text"
        }
    }

    var badgeLabel: LocalizedStringKey {
        switch self {
        case .passkey: "Has a passkey"
        case .code: "Has a verification code"
        case .notes: "Has notes"
        }
    }
}

extension String {
    /// For display only: a zero-width space after every dot lets a long address wrap at the dots ("greenwayparking." then
    /// "example.com") instead of in the middle of a word. The text itself, and what is copied or spoken, is unchanged.
    var breakableAfterDots: String { replacingOccurrences(of: ".", with: ".\u{200B}") }
}

/// A site monogram today and the favicon slot later. Colour comes from the site so it is stable and offline.
struct ItemIcon: View {
    let item: VaultItem
    var size: CGFloat = 30

    private var tint: Color {
        guard item.kind == .login else { return .gray }
        let seed = (item.website.isEmpty ? item.displayTitle : item.website).unicodeScalars.reduce(UInt32(7)) { $0 &* 31 &+ $1.value }
        return Color(hue: Double(seed % 360) / 360, saturation: 0.5, brightness: 0.72)
    }

    private var brand: BrandIcons.Brand? {
        switch item.kind {
        case .login: BrandIcons.brand(forWebsite: item.website)
        case .creditCard: CardBrand(number: item.secret).map { BrandIcons.Brand(asset: $0.asset, color: $0.color, glyph: .white) }
        default: nil
        }
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.27, style: .continuous).fill(brand?.color ?? tint)
            if let brand {
                Image(brand.asset)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * 0.56, height: size * 0.56)
                    .foregroundStyle(brand.glyph)
            } else if item.kind == .login, let letter = item.displayTitle.first {
                Text(String(letter).uppercased())
                    .font(.system(size: size * 0.53, weight: .semibold, design: .rounded))
            } else {
                Image(systemName: item.kind.symbol).font(.system(size: size * 0.47, weight: .semibold))
            }
        }
        .foregroundStyle(.white)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
