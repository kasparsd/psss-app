import Foundation

/// Tests of the time parser alone, so the same checks run in the optimized build and in an unoptimized one (where an integer
/// overflow traps instead of wrapping). Returns how many failed.
func runTimeParserTests() -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    func seconds(_ text: String) -> Double? { KeePassTime.date(text)?.timeIntervalSince1970 }
    let base = 1_614_834_367.0   // 2021-03-04T05:06:07Z

    verify("time: plain ISO", seconds("2021-03-04T05:06:07Z") == base)
    verify("time: fraction of 3 digits", seconds("2021-03-04T05:06:07.250Z") == base + 0.25)
    verify("time: 20 fractional digits count only the first nine", abs((seconds("2021-03-04T05:06:07.12345678901234567890Z") ?? 0) - (base + 0.123456789)) < 1e-6)
    verify("time: 5,000 fractional digits do not trap", seconds("2021-03-04T05:06:07." + String(repeating: "9", count: 5_000) + "Z") == nil
           || seconds("2021-03-04T05:06:07." + String(repeating: "9", count: 5_000) + "Z") != nil)
    verify("time: offsets", seconds("2021-03-04T07:06:07+02:00") == base && seconds("2021-03-03T23:36:07-0530") == base)
    verify("time: an offset out of range is nil", seconds("2021-03-04T07:06:07+24:00") == nil && seconds("2021-03-04T07:06:07+02:60") == nil)
    verify("time: 30 February is nil, not 2 March", seconds("2021-02-30T00:00:00Z") == nil && seconds("2020-02-30T00:00:00Z") == nil)
    verify("time: 29 February only in a leap year", seconds("2020-02-29T00:00:00Z") != nil && seconds("2000-02-29T00:00:00Z") != nil
           && seconds("2021-02-29T00:00:00Z") == nil && seconds("2100-02-29T00:00:00Z") == nil)
    verify("time: 31 April, month 13, day 0, hour 24, minute 60 are nil", ["2021-04-31T00:00:00Z", "2021-13-01T00:00:00Z", "2021-01-00T00:00:00Z",
           "2021-01-01T24:00:00Z", "2021-01-01T00:60:00Z"].allSatisfy { seconds($0) == nil })
    verify("time: year 0 is nil, year 1 and year 9999 are read", seconds("0000-01-01T00:00:00Z") == nil
           && KeePassTime.date("0001-01-01T00:00:00Z") == KeePassTime.date("AAAAAAAAAAA=")
           && seconds("9999-12-31T23:59:59Z") == 253_402_300_799)
    verify("time: no zone, a stray tail, empty, a lone Z are nil", ["2021-03-04T05:06:07", "2021-03-04T05:06:07Zx", "2021-03-04T05:06:07Z ZZ", "", "Z", "2021-03-04T05:06:07.Z"]
        .allSatisfy { seconds($0) == nil })
    verify("time: an embedded NUL is nil", seconds("2021-03-04T05:06:\u{0}7Z") == nil && seconds("\u{0}") == nil)
    verify("time: 8 bytes of base64 beyond year 9999 are nil", seconds("//////////8=") == nil)
    verify("time: base64 of 8 bytes is read", KeePassTime.date("v2HS1w4AAAA=") == Date(timeIntervalSince1970: base))
    verify("time: isISO tells the forms apart", KeePassTime.isISO("2021-03-04T05:06:07Z") && !KeePassTime.isISO("v2HS1w4AAAA="))

    // Random and adversarial text: whatever it is, it returns, and a date it returns is inside years 1 to 9999.
    var state: UInt64 = 0x9E3779B97F4A7C15
    func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
    func pick<T>(_ items: [T]) -> T { items[Int(next() % UInt64(items.count))] }
    let pieces = ["2021", "0000", "9999", "99999999999999999999", "-", "+", ":", "T", "Z", ".", " ", "\u{0}", "٢٠٢١", "０１", "\u{FF}", "e", "03", "04", "05", "06", "07", "60", "61", "24",
                  "12345678901234567890", String(repeating: "7", count: 400), "\n", "=", "A", "/", "+02:00"]
    var strings: [String] = []
    for _ in 0..<4_000 { strings.append((0..<Int(next() % 14)).map { _ in pick(pieces) }.joined()) }
    let valid = "2021-03-04T05:06:07.5Z"
    for _ in 0..<2_000 {                      // a valid time with one piece replaced, inserted or cut
        var characters = Array(valid)
        let at = Int(next() % UInt64(characters.count))
        switch next() % 3 {
        case 0: characters[at] = pick(Array("0123456789-:TZ.+ \u{0}９"))
        case 1: characters.insert(contentsOf: pick(pieces), at: at)
        default: characters.removeSubrange(at..<min(characters.count, at + 1 + Int(next() % 4)))
        }
        strings.append(String(characters))
    }
    for _ in 0..<1_000 {                      // 8 random bytes as base64, and random lengths of it
        let bytes = Data((0..<8).map { _ in UInt8(truncatingIfNeeded: next()) })
        strings.append(bytes.base64EncodedString())
        strings.append(String(bytes.base64EncodedString().prefix(Int(next() % 13))))
    }
    strings += [String(repeating: "9", count: 10_000), String(repeating: "+", count: 1_000), "2021-03-04T05:06:07." + String(repeating: "0", count: 100_000) + "Z",
                String(repeating: "2021-03-04T05:06:07Z", count: 1_000), "9999999999999999999-01-01T00:00:00Z", "-99999-01-01T00:00:00Z"]
    var returned = 0, outOfRange = 0
    for text in strings {
        if let date = KeePassTime.date(text) {
            returned += 1
            let value = date.timeIntervalSince1970
            if value < -62_135_596_800 || value > 253_402_300_800 { outOfRange += 1 }
        }
        _ = KeePassTime.isISO(text)
    }
    verify("time: \(strings.count) random and adversarial strings return without trapping (\(returned) read as dates)", true)
    verify("time: no date outside years 1 to 9999 came back", outOfRange == 0)
    return failed
}
