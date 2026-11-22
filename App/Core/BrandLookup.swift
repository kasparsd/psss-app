import SwiftUI

extension BrandIcons {
    struct Brand {
        let asset: String
        let color: Color
        /// Light brand colours need a dark glyph to stay legible.
        let glyph: Color
    }

    /// The bundled brand for a stored website, matching the host or any parent domain (`mail.google.com` finds `google.com`).
    static func brand(forWebsite website: String) -> Brand? {
        var labels = SharedVault.host(website).split(separator: ".")
        while labels.count >= 2 {
            if let entry = byDomain[labels.joined(separator: ".")] {
                let r = Double((entry.hex >> 16) & 255), g = Double((entry.hex >> 8) & 255), b = Double(entry.hex & 255)
                let luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
                return Brand(asset: entry.asset,
                             color: Color(red: r / 255, green: g / 255, blue: b / 255),
                             glyph: luminance > 0.75 ? .black : .white)
            }
            labels.removeFirst()
        }
        return nil
    }
}
