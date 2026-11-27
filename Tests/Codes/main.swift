import Foundation

// Hostless checks for the order of the Codes list. Run with scripts/test-codes.sh.

nonisolated(unsafe) var failures = 0
func expect(_ name: String, _ condition: Bool) {
    if condition { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)") }
}

func login(_ title: String = "", account: String = "", website: String = "", code: Bool = true) -> VaultItem {
    VaultItem(kind: .login, title: title, account: account, website: website, otpSecret: code ? "JBSWY3DPEHPK3PXP" : "")
}

/// The order as it is defined: every comparison asks both logins for their name.
func byDefinition(_ items: [VaultItem]) -> [VaultItem.ID] {
    items.filter { $0.traits.contains(.code) }
        .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
        .map(\.id)
}

let named = [login("banana"), login("Apple"), login(website: "https://www.cherry.example/sign-in"), login(account: "date@example.net"),
             login("Item 10"), login("Item 2")]
expect("a to z by name, numbers by value, host or username for a login without a name",
       CodesOrder.ordered(named).map(\.fullName) == ["Apple", "banana", "cherry.example", "date@example.net", "Item 2", "Item 10"])

let twins = (0..<20).map { login("Same", account: "\($0)") }
expect("logins with the same name keep the order they came in", CodesOrder.ordered(twins).map(\.id) == twins.map(\.id))

var card = VaultItem(kind: .creditCard, title: "Card", secret: "4242424242424242")
card.otpSecret = "JBSWY3DPEHPK3PXP"
expect("only logins with a code are listed",
       CodesOrder.ordered([login("No code", code: false), card, login("Code")]).map(\.title) == ["Code"])
expect("nothing in, nothing out", CodesOrder.ordered([]).isEmpty)

let shared = UUID()
func entry(_ title: String, code: Bool = true) -> VaultItem {
    VaultItem(id: shared, kind: .login, title: title, otpSecret: code ? "JBSWY3DPEHPK3PXP" : "")
}
// The first in the file sorts last by name, so a lookup in the sorted list would take the other one.
let pair = [entry("Zulu"), entry("Alpha")]
expect("two logins with one id are both listed, by name", CodesOrder.ordered(pair).map(\.title) == ["Alpha", "Zulu"])
expect("an id that two logins share names the first in the file, not the first by name",
       CodesOrder.item(shared, in: pair)?.title == "Zulu")
expect("a shared id skips an entry without a code",
       CodesOrder.item(shared, in: [entry("No code", code: false), entry("Zulu"), entry("Alpha")])?.title == "Zulu")
expect("an id with no code names nothing",
       CodesOrder.item(shared, in: [entry("No code", code: false)]) == nil && CodesOrder.item(UUID(), in: pair) == nil)
expect("the listed logins keep the order they came in", CodesOrder.listed(pair).map(\.title) == ["Zulu", "Alpha"])

let many = (0..<5_000).map { index in
    let number = (index * 7_919) % 5_000
    return login(index % 9 == 0 ? "Service \(number % 100)" : "", account: "alex\(index)@example.net",
                 website: index % 11 == 0 ? "" : "https://www.site\(number % 4_000).example/login", code: index % 13 != 0)
}
let clock = ContinuousClock()
var fast: [VaultItem.ID] = [], slow: [VaultItem.ID] = []
let fastTime = clock.measure { fast = CodesOrder.ordered(many).map(\.id) }
let slowTime = clock.measure { slow = byDefinition(many) }
print("     \(many.count) logins, \(fast.count) with a code: \(fastTime), a name per comparison \(slowTime)")
expect("a large list is in the defined order, ties included", fast == slow)
// Generous: this only catches a return to work that grows with the square of the list.
expect("a large list is ordered within a second", fastTime < .seconds(1))

if failures > 0 { print("\(failures) failed"); exit(1) }
print("all passed")
