import Foundation

/// Windows-1252 text. Foundation's decoder fails the whole text on the five bytes the code page leaves undefined (0x81, 0x8D,
/// 0x8F, 0x90, 0x9D), which would drop a whole record for one byte. This one keeps the record and puts U+FFFD where a byte has no
/// meaning, and says how many it replaced.
enum Windows1252 {
    private static let high: [UInt32] = [
        0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
        0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178
    ]

    static func decode(_ data: Data) -> (text: String, undefined: Int) {
        var scalars = String.UnicodeScalarView()
        var undefined = 0
        for byte in data {
            let value: UInt32
            switch byte {
            case 0x80...0x9F:
                value = high[Int(byte) - 0x80]
                if byte == 0x81 || byte == 0x8D || byte == 0x8F || byte == 0x90 || byte == 0x9D { undefined += 1 }
            default: value = UInt32(byte)
            }
            scalars.append(Unicode.Scalar(value) ?? "\u{FFFD}")
        }
        return (String(scalars), undefined)
    }
}
