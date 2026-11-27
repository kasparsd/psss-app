import Foundation

// Hostless checks for site matching. Run with scripts/test-matching.sh.

nonisolated(unsafe) var failures = 0
func expect(_ name: String, _ got: Bool, _ want: Bool) {
    if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)\n  got  \(got)\n  want \(want)") }
}
func same(_ name: String, _ got: String?, _ want: String?) {
    if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name)\n  got  \(got ?? "nil")\n  want \(want ?? "nil")") }
}
nonisolated(unsafe) var pairs: [(String, String)] = []
func yes(_ stored: String, _ requested: String) { pairs.append((stored, requested)); expect("match \(stored) on \(requested)", SiteMatch.matches(stored: stored, requested: requested), true) }
func no(_ stored: String, _ requested: String) { pairs.append((stored, requested)); expect("no match \(stored) on \(requested)", SiteMatch.matches(stored: stored, requested: requested), false) }
func rel(_ stored: String, _ requested: String, _ want: Bool) {
    pairs.append((stored, requested))
    expect("related \(stored) / \(requested) = \(want)", SiteMatch.related(stored: stored, requested: requested), want)
}

// Normalization
same("normalize url", SiteMatch.normalizedHost("https://WWW.Example.com/path?x=1"), "example.com")
same("normalize bare host", SiteMatch.normalizedHost("  Example.COM. "), "example.com")
same("normalize host with port", SiteMatch.normalizedHost("example.com:8443"), "example.com")
same("normalize ipv6", SiteMatch.normalizedHost("http://[::1]:8080/"), "::1")
same("normalize empty", SiteMatch.normalizedHost("  "), "")
same("normalize unicode", SiteMatch.normalizedHost("https://bücher.de"), "xn--bcher-kva.de")

// Registrable domains
same("registrable example.com", SiteMatch.registrableDomain("example.com"), "example.com")
same("registrable shop.example.co.uk", SiteMatch.registrableDomain("shop.example.co.uk"), "example.co.uk")
same("registrable co.uk is nil", SiteMatch.registrableDomain("co.uk"), nil)
same("registrable com is nil", SiteMatch.registrableDomain("com"), nil)
same("registrable a.github.io", SiteMatch.registrableDomain("x.a.github.io"), "a.github.io")
same("registrable github.io is nil", SiteMatch.registrableDomain("github.io"), nil)
same("registrable wildcard foo.bar.ck", SiteMatch.registrableDomain("foo.bar.ck"), "foo.bar.ck")
same("registrable wildcard bar.ck is nil", SiteMatch.registrableDomain("bar.ck"), nil)
same("registrable exception city.kawasaki.jp", SiteMatch.registrableDomain("city.kawasaki.jp"), "city.kawasaki.jp")
same("registrable wildcard x.kawasaki.jp is suffix", SiteMatch.registrableDomain("x.kawasaki.jp"), nil)
same("registrable ipv4 is nil", SiteMatch.registrableDomain("192.168.1.10"), nil)
same("registrable ipv6 is nil", SiteMatch.registrableDomain("::1"), nil)
same("registrable localhost", SiteMatch.registrableDomain("localhost"), "localhost")
same("registrable unlisted tld", SiteMatch.registrableDomain("a.b.example.invalidtld"), "example.invalidtld")
same("registrable empty", SiteMatch.registrableDomain(""), nil)

// Exact, case, www, trailing dot
yes("example.com", "example.com")
yes("https://www.example.com/login", "example.com")
yes("example.com", "www.example.com")
yes("EXAMPLE.com", "example.COM")
yes("example.com.", "example.com")
yes("example.com", "example.com.")

// Direction
yes("example.com", "login.example.com")
yes("example.com", "a.b.example.com")
no("login.example.com", "example.com")
no("login.bank.com", "bank.com")
no("a.example.com", "b.example.com")
rel("a.example.com", "b.example.com", true)
rel("login.example.com", "example.com", true)
rel("example.com", "login.example.com", false)
rel("example.com", "example.com", false)
no("a.github.io", "b.github.io")
rel("a.github.io", "b.github.io", false)
yes("a.github.io", "x.a.github.io")

// Public suffixes as stored host
no("github.io", "evil.github.io")
yes("github.io", "github.io")
no("github.io", "a.github.io")
yes("co.uk", "co.uk")
no("co.uk", "example.co.uk")
no("co.uk", "uk")
no("co.uk", "com")
yes("blogspot.com", "blogspot.com")
no("blogspot.com", "x.blogspot.com")
no("blogspot.com", "attacker.blogspot.com")
no("vercel.app", "attacker.vercel.app")
no("co.uk", "evil.co.uk")
no("com", "example.com")
yes("com", "com")

// Multi-label suffix
yes("example.co.uk", "shop.example.co.uk")
yes("example.co.uk", "example.co.uk")
no("shop.example.co.uk", "example.co.uk")
no("example.co.uk", "other.co.uk")
no("example.co.uk", "example.com")
rel("shop.example.co.uk", "other.example.co.uk", true)

// Wildcard and exception rules (*.ck; *.kawasaki.jp with !city.kawasaki.jp)
no("bar.ck", "foo.bar.ck")
yes("foo.bar.ck", "x.foo.bar.ck")
no("foo.bar.ck", "baz.bar.ck")
yes("city.kawasaki.jp", "x.city.kawasaki.jp")
no("city.kawasaki.jp", "other.kawasaki.jp")
no("x.kawasaki.jp", "y.x.kawasaki.jp")

// `www.` stripping never turns a real host into a bare public suffix: `www.ck` (exception under `*.ck`) and `www.com` stay.
same("normalize www.ck keeps www", SiteMatch.normalizedHost("https://www.ck/"), "www.ck")
same("normalize www.com keeps www", SiteMatch.normalizedHost("www.com"), "www.com")
same("normalize www.co.uk keeps www", SiteMatch.normalizedHost("www.co.uk"), "www.co.uk")
same("normalize www.example.ck keeps www (example.ck is a suffix)", SiteMatch.normalizedHost("www.example.ck"), "www.example.ck")
same("normalize www.example.com strips", SiteMatch.normalizedHost("www.example.com"), "example.com")
same("registrable www.ck", SiteMatch.registrableDomain("www.ck"), "www.ck")
yes("www.ck", "www.ck")
yes("www.ck", "x.www.ck")
no("www.ck", "other.ck")
no("www.ck", "ck")
no("other.ck", "www.ck")

// Lookalikes
no("example.com", "example.com.evil.net")
no("example.com", "evilexample.com")
no("example.com", "example.com.evil.example")
no("example.com", "example.com-evil.net")
no("example.com", "xexample.com")

// IP addresses and localhost
yes("192.168.1.10", "192.168.1.10")
no("192.168.1.10", "168.1.10")
no("168.1.10.5", "5")
no("1.2.3.4", "9.1.2.3.4")
no("2.3.4", "1.2.3.4")
yes("::1", "::1")
no("::1", "::2")
yes("[::1]", "::1")
yes("localhost", "localhost")
yes("http://localhost:3000", "localhost")
no("localhost", "evil.localhost.example")
no("localhost", "127.0.0.1")
no("127.0.0.1", "localhost")
rel("1.2.3.4", "1.2.3.5", false)

// Punycode and Unicode forms under a multi-label suffix
yes("xn--bcher-kva.co.uk", "shop.xn--bcher-kva.co.uk")
yes("bücher.co.uk", "xn--bcher-kva.co.uk")
yes("https://bücher.co.uk", "shop.bücher.co.uk")
same("registrable unicode under co.uk", SiteMatch.registrableDomain("shop.bücher.co.uk"), "xn--bcher-kva.co.uk")
no("xn--bcher-kva.co.uk", "xn--bcher-kva.com")

// Empty strings and a requested host that is only a public suffix
no("", "example.com")
no("example.com", "")
no("", "")
no("example.com", "com")
no("example.com", "co.uk")
no("example.co.uk", "co.uk")
no("a.github.io", "github.io")

// 1. Single-label and local names are exact-only
no("localhost", "evil.localhost")
no("localhost", "sub.localhost")
for name in ["local", "lan", "internal", "home", "corp", "intranet", "test", "example", "invalid"] {
    yes(name, name)
    no(name, "evil.\(name)")
}
yes("nas.local", "x.nas.local")
yes("nas.local", "nas.local")
no("nas.local", "evil.local")
no("nas.local", "local")
no("x.nas.local", "nas.local")
same("www.localhost keeps www (localhost is a suffix)", SiteMatch.normalizedHost("www.localhost"), "www.localhost")

// 2. Normalization is a fixed point; matching is the same on raw and normalized input
same("www.www.example.com", SiteMatch.normalizedHost("www.www.example.com"), "example.com")
same("www.www.www.example.com", SiteMatch.normalizedHost("https://WWW.www.WWW.example.com/"), "example.com")
same("www.www.co.uk keeps one www", SiteMatch.normalizedHost("www.www.co.uk"), "www.co.uk")
yes("www.www.example.com", "example.com")
yes("example.com", "www.www.example.com")
yes("www.www.x.com", "www.www.x.com")
yes("https://www.www.x.com", "x.com")
no("www.github.io", "github.io")
no("github.io", "www.github.io")
yes("www.github.io", "www.github.io")
same("www.github.io is its own host", SiteMatch.normalizedHost("www.github.io"), "www.github.io")

// 3. IPv4-like hosts are exact-only
for numeric in ["1", "0.1", "0.0.1", "0x7f.0.0.1", "0177.0.0.1", "127.0.0.1.1", "2130706433.1", "0X7F.0X0.0x0.0x1", "0x7f"] {
    yes(numeric, numeric)
}
no("0.0.1", "127.0.0.1.1")
no("0.0.1", "0x7f.0.0.1")
no("1", "0x7f.0.0.1")
no("0.1", "0177.0.0.1")
no("0.1", "2130706433.1")
no("0x7f.0.0.1", "127.0.0.1")
no("127.0.0.1", "0x7f.0.0.1")
no("127.0.0.1.1", "127.0.0.1")
no("1.2.3.4", "x.1.2.3.4")
no("::1", "x.::1")

// 4. Malformed input normalizes to empty and matches nothing, not even itself
for junk in ["https://evil.net\\@example.com", "https://user@example.com", "https://user:pw@example.com", "https://user%40x@example.com",
             "https://example.com%2f.evil.net", "a..example.com", ".example.com", "example.com..", "exa mple.com", "example.com\u{0}",
             "https://exa\tmple.com", "javascript:alert(1)", "data:text/html,hi", "about:blank", "file:///etc/hosts", "mailto:a@example.com",
             "/login", "www.", "www", "", "   ", "https://", "https:///x", "https://[::1", "https://example.com:abc", "evil:80@example.com",
             "exam<ple.com", "https://exa\\mple.com", String(repeating: "a", count: 64) + ".com", "https://example.com:1:2"] {
    same("junk empty: \(junk.debugDescription)", SiteMatch.normalizedHost(junk), "")
    expect("junk never matches itself: \(junk.debugDescription)", SiteMatch.matches(stored: junk, requested: junk), false)
    expect("junk never matches example.com: \(junk.debugDescription)", SiteMatch.matches(stored: "example.com", requested: junk), false)
    expect("junk has no registrable domain: \(junk.debugDescription)", SiteMatch.registrableDomain(junk) == nil, true)
}
no("example.com", "https://evil.net\\@example.com")
no("example.com", "https://example.com@evil.net")
no("example.com", "a..example.com")
no("example.com", ".example.com")
no("example.com", "example.com..")
same("single trailing dot is stripped", SiteMatch.normalizedHost("example.com."), "example.com")
same("port is stripped", SiteMatch.normalizedHost("https://example.com:8443/x?y=@z#f"), "example.com")
same("http url", SiteMatch.normalizedHost("http://Example.com/a b"), "example.com")
same("ipv6 with port", SiteMatch.normalizedHost("[2001:DB8::1]:443"), "2001:db8::1")
let host253 = [String(repeating: "a", count: 63), String(repeating: "a", count: 63), String(repeating: "a", count: 63), String(repeating: "b", count: 61)].joined(separator: ".")
same("253 characters is fine", SiteMatch.normalizedHost(host253), host253)
same("254 characters is refused", SiteMatch.normalizedHost(host253 + "b"), "")
same("63-character label is fine", "\(SiteMatch.normalizedHost(String(repeating: "a", count: 63) + ".com").count)", "67")
// Uppercase punycode and a Cyrillic homograph of a Latin host
same("uppercase punycode", SiteMatch.normalizedHost("XN--BCHER-KVA.DE"), "xn--bcher-kva.de")
yes("XN--BCHER-KVA.DE", "xn--bcher-kva.de")
yes("bücher.de", "XN--BCHER-KVA.DE")
no("apple.com", "\u{0430}pple.com")
no("\u{0430}pple.com", "apple.com")
expect("homograph is punycode", SiteMatch.normalizedHost("\u{0430}pple.com").hasPrefix("xn--"), true)

// 5. Hostile input returns quickly
for (name, hostile) in [("1 MB of www.", String(repeating: "www.", count: 262_144)), ("1 MB of labels", String(repeating: "a.", count: 524_288)),
                        ("1 MB single label", String(repeating: "a", count: 1_048_576)), ("1 MB url path", "https://example.com/" + String(repeating: "x", count: 1_048_576)),
                        ("1 MB colons", String(repeating: ":", count: 1_048_576))] {
    let start = Date()
    _ = SiteMatch.normalizedHost(hostile); _ = SiteMatch.matches(stored: hostile, requested: hostile); _ = SiteMatch.registrableDomain(hostile)
    let seconds = Date().timeIntervalSince(start)
    expect("\(name) in \(String(format: "%.3f", seconds)) s", seconds < 0.5, true)
}
let longest = "www." + Array(repeating: "a", count: 124).joined(separator: ".")  // 253 characters, many labels
let walkStart = Date()
for _ in 0..<200 { _ = SiteMatch.normalizedHost("www.www." + longest); _ = SiteMatch.matches(stored: longest, requested: longest) }
expect("many-label host is quick", Date().timeIntervalSince(walkStart) < 0.5, true)
same("hostile www run is refused, not walked", SiteMatch.normalizedHost(String(repeating: "www.", count: 100) + "example.com"), "")

// Pinned decisions
// A bare `user@example.com` is an email address, not a website: it normalizes to empty and never matches.
same("email address is not a website", SiteMatch.normalizedHost("user@example.com"), "")
no("user@example.com", "example.com")
no("example.com", "user@example.com")
// A scheme-relative `//example.com/path` has no scheme to say it is a web address: empty.
same("scheme-relative url is empty", SiteMatch.normalizedHost("//example.com/path"), "")
// An empty port (`example.com:`) is malformed: empty, with or without a scheme.
same("empty port is empty", SiteMatch.normalizedHost("example.com:"), "")
same("empty port with scheme is empty", SiteMatch.normalizedHost("https://example.com:"), "")
same("empty port on ipv6 is empty", SiteMatch.normalizedHost("[::1]:"), "")
// Hosts with `+`, `!` or `*` are not plain hostnames: empty, and the browser protocol treats them as not fillable.
for odd in ["a+b.example.com", "https://a+b.example.com", "a!b.example.com", "*.example.com", "https://*.example.com"] {
    same("odd character is empty: \(odd)", SiteMatch.normalizedHost(odd), "")
    no("example.com", odd)
}
// A port above 65535 is accepted: the port is ignored for matching and only its shape (1 to 5 digits) is checked.
same("port above 65535 is ignored", SiteMatch.normalizedHost("https://example.com:99999/x"), "example.com")
yes("example.com", "https://example.com:99999")
same("port of six digits is empty", SiteMatch.normalizedHost("example.com:123456"), "")

// 6. Parents of wildcard rules are exact-only
yes("kawasaki.jp", "kawasaki.jp")
no("kawasaki.jp", "other.kawasaki.jp")
no("kawasaki.jp", "x.y.kawasaki.jp")
no("compute.amazonaws.com", "x.compute.amazonaws.com")
no("elb.amazonaws.com", "x.elb.amazonaws.com")
no("sch.uk", "school.sch.uk")
yes("compute.amazonaws.com", "compute.amazonaws.com")
yes("x.y.kawasaki.jp", "z.x.y.kawasaki.jp")
yes("city.kawasaki.jp", "login.city.kawasaki.jp")
no("x.kawasaki.jp", "y.x.kawasaki.jp")
yes("amazonaws.com", "amazonaws.com")
no("other.kawasaki.jp", "kawasaki.jp")

// Every input above: normalization is a fixed point, and raw and normalized inputs agree (the real call path is
// `SharedVault.matches(item, host: SharedVault.host(requested))`)
var inputs = Set<String>()
for (s, r) in pairs { inputs.insert(s); inputs.insert(r) }
inputs.formUnion(["www.www.example.com", "WWW.www.WWW.example.com", "www.www.co.uk", "www.ck", "www.", "[::1]", "2001:DB8::1", "bücher.de", "xn--BCHER-kva.de", "Example.COM:443"])
for input in inputs.sorted() {
    let once = SiteMatch.normalizedHost(input)
    if SiteMatch.normalizedHost(once) != once { failures += 1; print("FAIL not idempotent: \(input.debugDescription) -> \(once) -> \(SiteMatch.normalizedHost(once))") }
}
print("ok   normalization is idempotent over \(inputs.count) inputs")
var disagreements = 0
for (s, r) in pairs {
    let raw = SiteMatch.matches(stored: s, requested: r)
    let real = SiteMatch.matches(stored: s, requested: SiteMatch.normalizedHost(r))
    let both = SiteMatch.matches(stored: SiteMatch.normalizedHost(s), requested: SiteMatch.normalizedHost(r))
    if raw != real || raw != both { disagreements += 1; failures += 1; print("FAIL raw/normalized disagree: \(s.debugDescription) on \(r.debugDescription)") }
}
print("ok   matching agrees on raw and normalized input over \(pairs.count) pairs (\(disagreements) disagreements)")

// The passkey-request list: a page with a pending passkey request still offers the saved password.
func login(_ website: String, account: String = "me", secret: String = "pw") -> VaultItem {
    VaultItem(kind: .login, title: website, account: account, website: website, secret: secret)
}
func passkeyItem(_ rpID: String, id: UInt8 = 1) -> VaultItem {
    var item = VaultItem(kind: .login, account: "me", website: rpID)
    item.passkey = PasskeyRecord(credentialID: Data([id]), userHandle: Data([9]), rpID: rpID, privateKey: Data([7]), created: Date(timeIntervalSince1970: 0))
    return item
}
func request(_ items: [VaultItem], _ identifiers: [String], rpID: String = "google.com", allowed: [Data] = []) -> PasskeyRequestList {
    PasskeyRequestList(items: items, serviceIdentifiers: identifiers, rpID: rpID, allowedCredentials: allowed)
}
let accounts = ["https://accounts.google.com/v3/signin"]
do {
    let googleLogin = login("google.com")
    let r = request([googleLogin], accounts)
    expect("google: login listed", r.siteLogins.map(\.id) == [googleLogin.id], true)
    expect("google: no passkey listed", r.passkeys.isEmpty, true)
    expect("google: no automatic sign-in", r.signsInWithoutList, false)
    same("google: site is the page host", r.site.host, "accounts.google.com")
}
do {
    let pk = passkeyItem("google.com"), lg = login("google.com")
    let r = request([pk, lg], accounts)
    expect("passkey and login: both listed", r.passkeys.map(\.id) == [pk.id] && r.siteLogins.map(\.id) == [lg.id], true)
    expect("passkey and login: no automatic sign-in", r.signsInWithoutList, false)
}
do {
    let pk = passkeyItem("google.com")
    let r = request([pk], accounts)
    expect("one passkey, no login: signs in at once", r.signsInWithoutList, true)
    expect("one passkey, no login: the passkey", r.passkeys.map(\.id) == [pk.id], true)
    // A passkey-only item has no password, so it is not a login to fill.
    expect("passkey-only item is not a login", r.siteLogins.isEmpty, true)
}
do {
    let two = request([passkeyItem("google.com", id: 1), passkeyItem("google.com", id: 2)], accounts)
    expect("two passkeys, no login: list", two.signsInWithoutList, false)
    let none = request([], accounts)
    expect("nothing saved: list with nothing, no sign-in", none.passkeys.isEmpty && none.siteLogins.isEmpty && !none.signsInWithoutList, true)
}
do {
    let pk = passkeyItem("google.com", id: 1), lg = login("google.com")
    let r = request([pk, lg], accounts, allowed: [Data([2])])
    expect("allowed credentials exclude the passkey", r.passkeys.isEmpty, true)
    expect("allowed credentials: logins still listed", r.siteLogins.map(\.id) == [lg.id], true)
    expect("allowed credentials: no automatic sign-in", r.signsInWithoutList, false)
    expect("named passkeys, only another one here: missing", r.namedPasskeysMissing, true)
    expect("named passkeys, none for the site: missing", request([lg], accounts, allowed: [Data([2])]).namedPasskeysMissing, true)
    expect("no passkeys named: not missing", request([lg], accounts).namedPasskeysMissing, false)
    expect("a named passkey is here: not missing", request([pk, lg], accounts, allowed: [Data([1])]).namedPasskeysMissing, false)
    let one = ResultGroups.noMatchingPasskeyBody(vault: "Passwords", otherVaults: false)
    let two = ResultGroups.noMatchingPasskeyBody(vault: "Passwords", otherVaults: true)
    expect("missing passkey words name the vault", one.contains("Passwords has none"), true)
    expect("missing passkey words offer another vault only with two", !one.contains("another vault") && two.hasSuffix("Or choose another vault above."), true)
    let ok = request([pk, lg], accounts, allowed: [Data([1]), Data([5])])
    expect("allowed credentials include the passkey", ok.passkeys.map(\.id) == [pk.id], true)
    let other = request([passkeyItem("example.com")], accounts)
    expect("passkey for another relying party is not listed", other.passkeys.isEmpty, true)
}
do {
    let lg = login("google.com")
    let none = request([lg], [], rpID: "example.com")
    expect("empty identifiers: no site login for another rpID", none.siteLogins.isEmpty, true)
    expect("empty identifiers: site is the rpID", none.site == .secure(host: "example.com"), true)
    let fallback = request([lg], [])
    expect("empty identifiers: login for the rpID is listed", fallback.siteLogins.map(\.id) == [lg.id], true)
    let nothing = request([lg], [], rpID: "")
    expect("empty identifiers and rpID: site unknown, no site logins", nothing.site == .unknown && nothing.siteLogins.isEmpty, true)
    let junk = request([lg], ["javascript:alert(1)"], rpID: "")
    expect("identifier without a host and no rpID: unknown", junk.site == .unknown && junk.siteLogins.isEmpty, true)
}
do {
    let r = request([login("example.com"), login("google.com.evil.example"), login("login.accounts.example"), login("")], accounts)
    expect("other sites' logins are never in the matching list", r.siteLogins.map(\.website) == [], true)
    let mine = request([login("example.com"), login("google.com", account: "a")], accounts)
    expect("only the site's login is matching", mine.siteLogins.map(\.account) == ["a"], true)
    let noPassword = request([login("google.com", secret: "")], accounts)
    expect("a login without a password is not listed", noPassword.siteLogins.isEmpty, true)
    expect("subdomain login is not offered on its parent", request([login("accounts.google.com")], ["https://google.com/"]).siteLogins.isEmpty, true)
}
do {
    let r = request([login("example.com")], ["http://example.com/login"], rpID: "example.com")
    if case .plainHTTP(let host) = r.site { same("plain http page stays plain http", host, "example.com") } else { expect("plain http page stays plain http", false, true) }
    expect("plain http page: the pages login is still found, behind the lists own confirmation", r.siteLogins.count == 1, true)
}

// Search counts and highlighting: every field that holds the text counts, a row's shown name included (device test: "loc" against
// "localhost" gave Name 0).
do {
    func counts(_ item: VaultItem, _ q: String) -> String {
        let c = PickerSearch.counts([item], query: q)
        return SearchField.allCases.map { "\($0.label)=\(c[$0] ?? 0)" }.joined(separator: ",")
    }
    let named = VaultItem(kind: .login, title: "localhost", account: "sam@example.com", website: "localhost", secret: "pw")
    same("search: name equals website, counts in both", counts(named, "loc"), "Name=1,Website=1,Username=0")
    let sameAsAccount = VaultItem(kind: .login, title: "sam@example.com", account: "sam@example.com", website: "gitforge.example", secret: "pw")
    same("search: name equals account, counts in both", counts(sameAsAccount, "sam@"), "Name=1,Website=0,Username=1")
    let nameless = VaultItem(kind: .login, title: "", account: "sam@example.com", website: "localhost", secret: "pw")
    same("search: a nameless imported login counts under Website only (owner rule)", counts(nameless, "loc"), "Name=0,Website=1,Username=0")
    same("save: a login saved from a page is named by the site when the page has no title", SaveWords.newTitle(requestTitle: "  ", host: "localhost"), "localhost")
    same("save: the page's title wins", SaveWords.newTitle(requestTitle: "Gitforge", host: "gitforge.example"), "Gitforge")
    let old = VaultItem(kind: .login, title: "localhost", account: "alex@example.net", website: "localhost", secret: "old")
    let other = VaultItem(kind: .login, title: "Elsewhere", account: "alex@example.net", website: "elsewhere.example", secret: "x")
    func submitted(_ r: SaveMatch.Submitted) -> String {
        switch r { case .alreadySaved: return "saved"; case .update(let i): return "update \(i.secret)"; case .completePending(let i): return "pending \(i.secret)"; case .new: return "new" }
    }
    same("save: generated password, username known and its login exists: nothing now, the submit asks to Update", SaveMatch.generated(in: [old, other], host: "localhost", user: "alex@example.net", password: "gen") == .nothing ? "nothing" : "saveNew", "nothing")
    same("save: generated password, new username: saved now", SaveMatch.generated(in: [old], host: "localhost", user: "kim@example.net", password: "gen") == .saveNew ? "saveNew" : "nothing", "saveNew")
    same("save: generated password, no username yet: saved now", SaveMatch.generated(in: [old], host: "localhost", user: "", password: "gen") == .saveNew ? "saveNew" : "nothing", "saveNew")
    let pendingLogin = VaultItem(kind: .login, title: "localhost", account: "", website: "localhost", secret: "gen")
    same("save: generated password already saved: nothing", SaveMatch.generated(in: [pendingLogin], host: "localhost", user: "", password: "gen") == .nothing ? "nothing" : "saveNew", "nothing")
    same("save: submit with an existing username updates it", submitted(SaveMatch.submitted(in: [other, old], host: "localhost", user: "alex@example.net", password: "gen")), "update old")
    same("save: submit after a generated save without username completes that login", submitted(SaveMatch.submitted(in: [old, pendingLogin], host: "localhost", user: "kim@example.net", password: "gen")), "pending gen")
    var genWithUser = pendingLogin; genWithUser.account = "kim@example.net"
    same("save: submit when the login already holds this password asks nothing", submitted(SaveMatch.submitted(in: [VaultItem(kind: .login, title: "k", account: "kim@example.net", website: "localhost", secret: "older"), genWithUser], host: "localhost", user: "kim@example.net", password: "gen")), "saved")
    same("save: submit with an unknown username and no pending login is new", submitted(SaveMatch.submitted(in: [old], host: "localhost", user: "kim@example.net", password: "other")), "new")
    same("save: another site's login is never updated", submitted(SaveMatch.submitted(in: [other], host: "localhost", user: "alex@example.net", password: "gen")), "new")
    var saved = VaultItem(kind: .login, title: SaveWords.newTitle(requestTitle: "", host: "localhost"), account: "sam@example.com", website: "localhost", secret: "pw")
    same("search: a login saved from a page counts under Name and Website", counts(saved, "loc"), "Name=1,Website=1,Username=0")
    saved.title = ""
    same("search: the list rule counts the same", ItemSearch.counts([named], query: "LOC").map { "\($0.key.label)=\($0.value)" }.sorted().joined(separator: ","), "Name=1,Username=0,Website=1")
    same("search: a chosen Name pill keeps the item", String(PickerSearch.matches([named], query: "loc", in: [.name]).count), "1")
    same("search: a chosen Name pill drops a nameless login", String(PickerSearch.matches([nameless], query: "loc", in: [.name]).count), "0")
    let hit = ItemSearch.hit(of: named, query: "loc", chosen: [.name])
    same("search: Name pill chosen, the name is the hit", hit.map { "\($0.field.label) \($0.text) \($0.range.map { "\($0.lowerBound)..<\($0.upperBound)" } ?? "-")" }, "Name localhost 0..<3")
    same("search: bold in the name when Name counts the match", ItemSearch.nameHighlight(of: named, query: "loc"), "loc")
    same("search: a nameless login's made-up name gets no bold (not a Name match)", ItemSearch.nameHighlight(of: nameless, query: "loc"), "")
    same("search: no bold in the name when only the account matched", ItemSearch.nameHighlight(of: named, query: "sam@"), "")
    let hit2 = ItemSearch.hit(of: named, query: "loc", chosen: [])
    same("search: no pill, an account without the text leaves the next field", hit2.map { $0.field.label }, "Website")
}

// The picker search and one-value release.
func card(_ number: String, name: String = "", holder: String = "Kid Example", expiry: String = "08/29", code: String = "123") -> VaultItem {
    VaultItem(kind: .creditCard, title: name, account: holder, secret: number, expiry: expiry, securityCode: code)
}
do {
    let bank = login("heron-bank-old.example", account: "kid@example.com")
    let club = login("heron-club.example", account: "kid@example.com")
    let visa = card("4242424242424242")
    let note = VaultItem(kind: .secureNote, title: "heron note")
    let empty = login("heron-empty.example", secret: "")
    let all = [club, bank, visa, note, empty]
    same("search by name", PickerSearch.matches(all, query: "club").map(\.website).joined(separator: ","), "heron-club.example")
    same("search by saved site finds the old address", PickerSearch.matches(all, query: "bank-old").first?.website, "heron-bank-old.example")
    same("search by account", String(PickerSearch.matches(all, query: "kid@example").count), "2")
    same("search is A to Z", PickerSearch.matches(all, query: "heron").map(\.website).joined(separator: ","), "heron-bank-old.example,heron-club.example")
    same("empty query lists every offerable item", String(PickerSearch.matches(all, query: "  ").count), "3")
    expect("a note is never offered", PickerSearch.matches(all, query: "note").isEmpty, true)
    expect("a login without a password is never offered", PickerSearch.matches(all, query: "empty").isEmpty, true)
    same("a card is found by its holder", PickerSearch.matches(all, query: "Kid Example").first.map { String($0.kind == .creditCard) }, "true")
    same("pill counts for a name", PickerSearch.counts(all, query: "heron").map { "\($0.key.label)=\($0.value)" }.sorted().joined(separator: ","), "Name=2,Username=0,Website=2")
    same("a chosen pill narrows the search (nothing has it as a username)", String(PickerSearch.matches(all, query: "heron", in: [.username]).count), "0")
    same("a chosen pill keeps what has the text there", String(PickerSearch.matches(all, query: "heron", in: [.website]).count), "2")
    same("login values", PickerSearch.values(of: bank).map(\.label).joined(separator: ","), "Username,Password")
    same("login password preview is hidden", PickerSearch.values(of: bank).first { $0.role == .password }?.preview, "••••••••")
    same("card values", PickerSearch.values(of: visa).map(\.label).joined(separator: ","), "Card number,Name on card,Expiry,Security code")
    same("card number preview is the last four", PickerSearch.values(of: visa).first { $0.role == .cardNumber }?.preview, "•••• 4242")
    same("card security code preview is hidden", PickerSearch.values(of: visa).first { $0.role == .securityCode }?.preview, "•••")
    same("one value: username only", ReleaseCheck.value(item: bank, role: .username), "kid@example.com")
    same("one value: password", ReleaseCheck.value(item: bank, role: .password), "pw")
    same("a login has no card number to release", ReleaseCheck.value(item: bank, role: .cardNumber), nil)
    same("a website is never a value", ReleaseCheck.value(item: bank, role: .loginWebsite), nil)
    same("a card releases its number", ReleaseCheck.value(item: visa, role: .cardNumber), "4242424242424242")
    same("a card has no password", ReleaseCheck.value(item: visa, role: .password), nil)
    same("a note releases nothing", ReleaseCheck.value(item: note, role: .username), nil)
}

// The browser protocol's search and vaults, on the prototype host's sample vaults (a temporary directory, never the real one).
do {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("psss-matching-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    BrowserPrototypeStore.directory = dir
    BrowserProtocol.vaultService = BrowserPrototypeStore.vaultService
    // A request that reads or writes logins names its vault (protocol 4); the first vault is the default of these tests.
    func ask(_ type: String, _ fields: [String: Any] = [:]) -> [String: Any] {
        let named = ["candidates", "search", "credential", "card-candidates", "card"].contains(type) ? ["vault": "passwords"] : [:]
        return BrowserProtocol.handle(["v": BrowserProtocol.version, "id": "t", "type": type].merging(named) { $1 }.merging(fields) { $1 })
    }
    func search(_ query: String, fields: [String] = [], vault: String = "passwords") -> [String: Any] {
        ask("search", ["origin": "https://example.org", "query": query, "fields": fields, "vault": vault])
    }
    func names(_ reply: [String: Any]) -> String { ((reply["vaults"] as? [[String: Any]]) ?? []).map { "\($0["name"] ?? ""):\($0["active"] ?? ""):\($0["state"] ?? "")" }.joined(separator: ",") }

    expect("protocol is version 5", BrowserProtocol.version == 5, true)
    same("an old version is refused", ask("ping", ["v": 3])["error"] as? String, "unsupported")
    let all = search("studio north")
    let counts = all["counts"] as? [String: Int] ?? [:]
    same("search counts per field", "\(counts["name"] ?? -1) \(counts["website"] ?? -1) \(counts["username"] ?? -1)", "1 0 0")
    let rows = all["results"] as? [[String: Any]] ?? []
    same("a result says which field matched and the part for bold", rows.map { "\($0["found"] ?? "") \($0["hit"] ?? "") \($0["hitRange"] ?? "")" }.joined(separator: ","), "name Studio North (work) [0, 12]")
    let byUser = search("alex@studio", fields: ["website"])
    same("a chosen field narrows the results, never the counts", "\((byUser["results"] as? [Any])?.count ?? -1) \((byUser["counts"] as? [String: Int])?["username"] ?? -1)", "0 1")
    same("a blank search finds nothing", "\((search("  ")["results"] as? [Any])?.count ?? -1)", "0")
    expect("a result for another site says so", rows.allSatisfy { $0["matches"] as? Bool == false }, true)

    func state(_ reply: [String: Any], _ id: String) -> String {
        (((reply["vaults"] as? [[String: Any]]) ?? []).first { $0["id"] as? String == id }).map { "\($0["state"] ?? "")/\($0["reason"] ?? "-")" } ?? "none"
    }
    func titles(_ vault: String, origin: String = "https://gitforge.example") -> String {
        ((ask("candidates", ["origin": origin, "vault": vault])["candidates"] as? [[String: Any]]) ?? []).map { "\($0["title"] ?? "")" }.joined(separator: ",")
    }
    let listed = ask("vaults")
    same("vaults: Passwords open, then each state", names(listed),
         "Passwords:true:open,Work:false:locked,Archive:false:locked,Family:false:needs-password,Travel:false:not-downloaded,Taxes:false:unreadable,Old:false:not-found")
    same("a vault that needs its password says why", state(listed, "family"), "needs-password/off")
    expect("an unlock of the open vault is a no-op", ask("unlock-vault", ["vault": "passwords"])["ok"] as? Bool == true, true)
    same("switching to Work shows it and locks nothing: Passwords stays open, the order is fixed", names(ask("switch-vault", ["vault": "work"])),
         "Passwords:false:open,Work:true:locked,Archive:false:locked,Family:false:needs-password,Travel:false:not-downloaded,Taxes:false:unreadable,Old:false:not-found")
    same("a locked vault serves nothing", ask("candidates", ["origin": "https://gitforge.example", "vault": "work"])["error"] as? String, "locked")
    same("a locked vault searches nothing", search("studio", vault: "work")["error"] as? String, "locked")
    same("a locked vault is not saved into", ask("save", ["origin": "https://gitforge.example", "account": "a@b.c", "secret": "pw", "vault": "work"])["error"] as? String, "locked")
    expect("Passwords is open and fills while Work is the shown vault", !((search("studio", vault: "passwords")["results"] as? [Any]) ?? []).isEmpty, true)
    same("unlock of a vault that is not the shown one is refused", ask("unlock-vault", ["vault": "passwords"])["error"] as? String, "forbidden")
    same("unlock of an unknown vault", ask("unlock-vault", ["vault": "nope"])["error"] as? String, "not-found")
    same("unlock with no vault", ask("unlock-vault")["error"] as? String, "not-found")
    same("unlock with a vault id over 64 characters", ask("unlock-vault", ["vault": String(repeating: "x", count: 65)])["error"] as? String, "not-found")
    expect("Touch ID unlocks Work, and Passwords stays open", names(ask("unlock-vault", ["vault": "work"])).hasPrefix("Passwords:false:open,Work:true:open"), true)
    same("Work serves its own logins", titles("work"), "Gitforge (work)")
    same("Passwords, open too, serves its own (none for this site)", titles("passwords"), "")
    let target = ["origin": "https://gitforge.example", "account": "sam@harbor.example", "secret": "pw-new", "vault": "work"]
    same("a save names an open vault: it updates the same site and username", ask("save", target)["result"] as? String, "updated")
    same("a save into another open vault than the shown one goes there", ask("save", target.merging(["vault": "passwords", "account": "pat@example.org"]) { $1 })["result"] as? String, "created")
    same("a login saved into Passwords is not in Work", titles("work"), "Gitforge (work)")
    same("a save into an unknown vault", ask("save", target.merging(["vault": "nope"]) { $1 })["error"] as? String, "not-found")
    same("a save with no vault", ask("save", target.filter { $0.key != "vault" })["error"] as? String, "not-found")
    same("a save with a vault id over 64 characters", ask("save", target.merging(["vault": String(repeating: "x", count: 65)]) { $1 })["error"] as? String, "not-found")
    same("a new login is created in the vault named", ask("save", target.merging(["account": "new@harbor.example"]) { $1 })["result"] as? String, "created")
    same("a request naming no vault reads nothing", ask("candidates", ["origin": "https://gitforge.example", "vault": NSNull()])["error"] as? String, "not-found")
    same("Archive becomes the shown vault, locked", state(ask("switch-vault", ["vault": "archive"]), "archive"), "locked/-")
    same("Touch ID cancelled: error, still locked, with the list", "\(ask("unlock-vault", ["vault": "archive"])["error"] ?? "") \(state(ask("vaults"), "archive"))", "cancelled locked/-")
    expect("the open vaults stay open through a cancelled unlock", names(ask("vaults")).hasPrefix("Passwords:false:open,Work:false:open"), true)
    _ = ask("switch-vault", ["vault": "family"])
    same("a vault that needs its password: needs-app, with the list", { let r = ask("unlock-vault", ["vault": "family"]); return "\(r["error"] ?? "") \(state(r, "family"))" }(), "needs-app needs-password/off")
    _ = ask("switch-vault", ["vault": "travel"])
    same("a vault that is not downloaded cannot be unlocked", { let r = ask("unlock-vault", ["vault": "travel"]); return "\(r["error"] ?? "") \(state(r, "travel"))" }(), "not-available not-downloaded/-")
    same("a vault that is not available serves nothing", ask("candidates", ["origin": "https://gitforge.example", "vault": "travel"])["error"] as? String, "not-available")
    same("unknown vault", ask("switch-vault", ["vault": "nope"])["error"] as? String, "not-found")
    expect("the vault list never carries a secret", "\(ask("vaults"))".contains("Demo-only") || "\(ask("vaults"))".contains("pw-new"), false)

    // The race: the vault the popup chose locks between the search and the fill (the state file changes under the host).
    let stateFile = dir.appendingPathComponent("vaults.json")
    _ = ask("switch-vault", ["vault": "work"])
    let workRef = (((ask("candidates", ["origin": "https://gitforge.example", "vault": "work"])["candidates"] as? [[String: Any]]) ?? []).first?["ref"] as? String) ?? ""
    expect("Work offers a login to fill", !workRef.isEmpty, true)
    try? JSONSerialization.data(withJSONObject: ["active": "work", "open": ["passwords"]]).write(to: stateFile)
    let raced = ask("credential", ["ref": workRef, "origin": "https://gitforge.example", "vault": "work"])
    same("locked between search and fill: a plain error", raced["error"] as? String, "locked")
    expect("and no data, not Work's and not another vault's", raced["secret"] == nil && raced["fields"] == nil && !"\(raced)".contains("Demo-only-Work"), true)
    same("Passwords' reference is nothing in Work, and Work's is nothing in Passwords", ask("credential", ["ref": workRef, "origin": "https://gitforge.example", "vault": "passwords"])["error"] as? String, "not-found")
    let stateText = (try? String(contentsOf: stateFile, encoding: .utf8)) ?? ""
    expect("the state file holds no secret", !stateText.contains("Demo-only") && !stateText.contains("pw-new"), true)

    // Hostile vault names in the list.
    let hostileName = "Wo\u{202E}rk\nTaxes\u{200B}" + String(repeating: "x", count: 300)
    let specs: [[String: Any]] = [["id": "h", "name": hostileName, "location": hostileName], ["id": "ok", "name": "Fine"]]
    try? JSONSerialization.data(withJSONObject: ["vaults": specs, "open": ["h"]]).write(to: stateFile)
    let hostileList = (ask("vaults")["vaults"] as? [[String: Any]]) ?? []
    expect("a hostile vault name and location are one safe, short line",
           hostileList.first.map { v in ["name", "location"].allSatisfy { key in
               let text = v[key] as? String ?? ""
               return !text.contains("\n") && !text.contains("\u{202E}") && !text.contains("\u{200B}") && text.count <= 80
           } } ?? false, true)
    same("the hostile vault is open and the other is locked, in the fixed order", hostileList.map { "\($0["id"] ?? ""):\($0["state"] ?? "")" }.joined(separator: ","), "h:open,ok:locked")
    try? FileManager.default.removeItem(at: stateFile)
    BrowserPrototypeStore.directory = nil
    BrowserProtocol.vaultService = nil
    try? FileManager.default.removeItem(at: dir)
}


// Relying party matching and allowed credentials (device test 2026-11-24: Google's passkey page offered no passkey).
do {
    // The page is accounts.google.com, the relying party the site chose is google.com. Only the relying party is compared with the
    // stored passkey; the page host only picks the logins.
    let pk = passkeyItem("google.com")
    let r = request([pk], accounts, rpID: "google.com")
    expect("rp: google.com passkey is offered on accounts.google.com for rpID google.com", r.passkeys.map(\.id) == [pk.id], true)
    same("rp: the page host is still accounts.google.com", r.site.host, "accounts.google.com")
    let sub = request([pk], accounts, rpID: "accounts.google.com")
    expect("rp: a google.com passkey is not offered for rpID accounts.google.com", sub.passkeys.isEmpty, true)
    expect("rp: it is counted as a sibling identifier in the log", sub.diagnostics.forSiblingRelyingParty == 1 && sub.diagnostics.forRelyingParty == 0, true)
    let acc = passkeyItem("accounts.google.com")
    let r2 = request([acc], accounts, rpID: "google.com")
    expect("rp: an accounts.google.com passkey is not offered for rpID google.com", r2.passkeys.isEmpty, true)
    expect("rp: and counted as a sibling", r2.diagnostics.forSiblingRelyingParty == 1, true)
    expect("rp: another domain is not a sibling", request([passkeyItem("google.example")], accounts, rpID: "google.com").diagnostics.forSiblingRelyingParty == 0, true)
    expect("rp: case differs", PasskeyRequestList.sameRelyingParty(stored: "Google.com", requested: "google.com"), false)
    expect("rp: trailing dot differs", PasskeyRequestList.sameRelyingParty(stored: "google.com.", requested: "google.com"), false)
    expect("rp: same string matches", PasskeyRequestList.sameRelyingParty(stored: "google.com", requested: "google.com"), true)
    // Allowed credentials: empty means any; otherwise only those, and the log says how many were taken out.
    let a = passkeyItem("google.com", id: 1), b = passkeyItem("google.com", id: 2)
    let both = request([a, b], accounts)
    expect("allowed: empty list offers every passkey", both.passkeys.count == 2 && both.diagnostics.excludedByAllowedCredentials == 0, true)
    let only = request([a, b], accounts, allowed: [Data([2]), Data([77])])
    expect("allowed: only the named credential", only.passkeys.map(\.id) == [b.id], true)
    expect("allowed: counts for the log", only.diagnostics == PasskeyRequestList.Diagnostics(passkeysInVault: 2, forRelyingParty: 2, forSiblingRelyingParty: 0, allowedCredentials: 2, excludedByAllowedCredentials: 1, listed: 1), true)
    let none = request([a], accounts, allowed: [Data([9])])
    expect("allowed: nothing named matches, so none is listed and the one removed is counted", none.passkeys.isEmpty && none.diagnostics.excludedByAllowedCredentials == 1, true)
    // An item with a passkey and a password is both a passkey and a login.
    var both1 = login("google.com"); both1.passkey = a.passkey
    let mixed = request([both1], accounts)
    expect("rp: one item can be a passkey and a login", mixed.passkeys.count == 1 && mixed.siteLogins.count == 1, true)
}

// The extension's budget for a typed vault password (docs/autofill.md, "The vault password in the extension").
do {
    let mib = ExtensionUnlockBudget.mebibyte
    expect("budget: 64 MiB with room fits", ExtensionUnlockBudget.allows(kdfBytes: 64 * mib, availableBytes: 90 * mib, ceiling: 64 * mib), true)
    expect("budget: 64 MiB with only 70 MiB left is refused (headroom)", ExtensionUnlockBudget.allows(kdfBytes: 64 * mib, availableBytes: 70 * mib, ceiling: 64 * mib), false)
    expect("budget: 64 MiB with exactly the headroom fits", ExtensionUnlockBudget.allows(kdfBytes: 64 * mib, availableBytes: 72 * mib, ceiling: 64 * mib), true)
    expect("budget: above the ceiling is refused whatever is free", ExtensionUnlockBudget.allows(kdfBytes: 65 * mib, availableBytes: 900 * mib, ceiling: 64 * mib), false)
    expect("budget: unknown free memory leaves the ceiling to decide", ExtensionUnlockBudget.allows(kdfBytes: 64 * mib, availableBytes: nil, ceiling: 64 * mib), true)
    expect("budget: zero free memory means unknown", ExtensionUnlockBudget.allows(kdfBytes: 64 * mib, availableBytes: 0, ceiling: 64 * mib), true)
    expect("budget: AES-KDF needs no memory", ExtensionUnlockBudget.allows(kdfBytes: 0, availableBytes: 9 * mib, ceiling: 64 * mib), true)
    let snapshot = ProcessMemory.snapshot()
    expect("budget: the process memory can be read", snapshot.residentBytes > 0 && snapshot.peakResidentBytes >= snapshot.residentBytes / 2, true)
    expect("budget: the log line holds numbers only", !snapshot.text.contains("/") && snapshot.text.hasPrefix("resident "), true)
}

// The picker row's second line, and the words of the notices and save buttons.
do {
    func row(_ title: String, account: String, website: String, site: Bool = false) -> String? {
        RowLine.text(for: VaultItem(kind: .login, title: title, account: account, website: website, secret: "x"), showsSite: site)
    }
    same("row line: the account", row("Gitforge", account: "sam.r", website: "https://gitforge.example"), "sam.r")
    same("row line: the website when the name is the account", row("sam.r", account: "sam.r", website: "https://gitforge.example"), "gitforge.example")
    same("row line: the website when there is no account", row("Gitforge", account: "", website: "https://gitforge.example"), "gitforge.example")
    same("row line: nothing to add", row("Gitforge", account: "", website: ""), nil)
    same("row line: a list of other sites adds the website", row("Gitforge", account: "sam.r", website: "https://gitforge.example", site: true), "sam.r · gitforge.example")
    same("row line: the name is the site, so it is not repeated", row("gitforge.example", account: "sam.r", website: "https://gitforge.example", site: true), "sam.r")
    same("row line: hostile newline and bidi are removed", row("Gitforge", account: "sam\n\u{202E}r", website: ""), DisplayText.safe("sam\n\u{202E}r"))

    // Rows that would read the same get what differs (owner, 2026-11-26): the website, else the vault, else the change date.
    func login(_ title: String, _ account: String, _ website: String, modified: Date? = nil) -> VaultItem {
        VaultItem(kind: .login, title: title, account: account, website: website, secret: "x", modified: modified)
    }
    func fixedDate(_ day: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(1_700_000_000 + day * 86_400)) }
    let stamp: (Date) -> String = { "Changed \(Int($0.timeIntervalSince1970))" }
    let a1 = login("E-Klase", "071114-25629", "https://auth.e-klase.lv", modified: fixedDate(0))
    let a2 = login("E-Klase", "071114-25629", "https://e-klase.lv", modified: fixedDate(1))
    let a3 = login("E-Klase", "160716-25638", "https://e-klase.lv")
    let s1 = RowLine.differences(in: [a1, a2, a3])
    same("row differences: the website tells two like rows apart", "\(s1[a1.id] ?? "nil") | \(s1[a2.id] ?? "nil")", "auth.e-klase.lv | e-klase.lv")
    same("row differences: a row that reads differently gets nothing", s1[a3.id], nil)
    let b1 = login("E-Klase", "sam", "https://e-klase.lv", modified: fixedDate(0))
    let b2 = login("E-Klase", "sam", "https://e-klase.lv", modified: fixedDate(2))
    let s2 = RowLine.differences(in: [b1, b2], changed: stamp)
    same("row differences: the same website, so the change date", "\(s2[b1.id] ?? "nil") | \(s2[b2.id] ?? "nil")", "\(stamp(fixedDate(0))) | \(stamp(fixedDate(2)))")
    let s3 = RowLine.differences(in: [b1, b2], vaultName: { $0.id == b1.id ? "Home" : "Work" }, changed: stamp)
    same("row differences: the vault comes before the change date", "\(s3[b1.id] ?? "nil") | \(s3[b2.id] ?? "nil")", "Home | Work")
    let c1 = login("E-Klase", "sam", "", modified: fixedDate(0))
    let c2 = login("E-Klase", "sam", "https://e-klase.lv", modified: fixedDate(0))
    let s4 = RowLine.differences(in: [c1, c2])
    same("row differences: a login without a website says so", "\(s4[c1.id] ?? "nil") | \(s4[c2.id] ?? "nil")", "No website | e-klase.lv")
    let d1 = login("E-Klase", "sam", "https://e-klase.lv")
    let d2 = login("E-Klase", "sam", "https://e-klase.lv")
    expect("row differences: nothing differs and nothing is dated, so nothing is added", RowLine.differences(in: [d1, d2]).isEmpty, true)
    expect("row differences: one row, none", RowLine.differences(in: [a1]).isEmpty, true)
    expect("row differences: an empty list", RowLine.differences(in: []).isEmpty, true)
    let e1 = login("sam", "sam", "https://auth.e-klase.lv")
    let e2 = login("sam", "sam", "https://e-klase.lv")
    expect("row differences: the website already in the line is compared as shown, so these differ and need nothing",
           RowLine.differences(in: [e1, e2]).isEmpty, true)
    let h1 = login("E-Klase", "sam\n\u{202E}r", "https://e-klase.lv", modified: fixedDate(0))
    let h2 = login("E-Klase", "sam r", "https://e-klase.lv", modified: fixedDate(1))
    same("row differences: hostile text is compared as it is shown (the same row line, so both are told apart by date)", String(RowLine.differences(in: [h1, h2], changed: stamp).count), "2")
    same("row line: the extra part joins with a dot", RowLine.line("071114-25629", extra: "e-klase.lv"), "071114-25629 · e-klase.lv")
    same("row line: only the extra part when there is no line", RowLine.line(nil, extra: "e-klase.lv"), "e-klase.lv")
    same("row line: no extra part", RowLine.line("sam", extra: nil), "sam")
    same("row line: nothing at all", RowLine.line(nil, extra: nil), nil)
    expect("changed text names the day", RowLine.changedText(Date(timeIntervalSince1970: 1_702_555_200)).hasPrefix("Changed "), true)

    let method = "Face ID"
    same("notice: cancelled", ProviderNotices.cancelled(method: method).text, "Face ID was cancelled.")
    same("notice: password, off", ProviderNotices.needsPassword(.needsPassword(.off), name: "Work", method: method)?.text, "Face ID is off for Work. Unlock with the vault password.")
    same("notice: password, changed", ProviderNotices.needsPassword(.needsPassword(.lost), name: "Work", method: method)?.text, "Face ID changed since Work was set up. Unlock with the vault password.")
    same("notice: password, locked out", ProviderNotices.needsPassword(.needsPassword(.unavailableNow), name: "Work", method: method)?.text, "Face ID is locked out right now. Unlock with the vault password.")
    expect("notice: no password notice for a plain locked vault", ProviderNotices.needsPassword(.locked, name: "Work", method: method) == nil, true)
    same("notice: not found", ProviderNotices.unavailable(.notFound, name: "Archive")?.text, "Archive can’t be found. Open Psss to locate it.")
    same("notice: not downloaded", ProviderNotices.unavailable(.notDownloaded, name: "Travel")?.text, "Travel isn’t downloaded yet. Open Psss to download it.")
    same("notice: can't be read", ProviderNotices.unavailable(.unreadable, name: "Taxes")?.text, "Taxes can’t be read. Open Psss for details.")
    expect("notice: an available vault has no unavailable notice", ProviderNotices.unavailable(.locked, name: "Work") == nil, true)
    expect("notice: unavailable is a warning, cancelled is information", ProviderNotices.unavailable(.notFound, name: "A")?.tone == .warning && ProviderNotices.cancelled(method: method).tone == .info, true)
    same("notice: open Psss", ProviderNotices.openPsss(name: "Work").text, "Open Psss to unlock Work.")
    same("notice: a hostile name is one safe line", ProviderNotices.openPsss(name: "Wo\nrk\u{202E}").text, "Open Psss to unlock \(VaultName.sentence("Wo\nrk\u{202E}")).")
    expect("notice: a very long name is cut", ProviderNotices.unavailable(.notFound, name: String(repeating: "x", count: 500))!.text.count < 120, true)
    expect("notice: no password in any sentence", !ProviderNotices.wrongPassword(name: "Work").lowercased().contains("hunter2"), true)

    var existing = VaultItem(kind: .login, title: "Gitforge", account: "sam.r", website: "gitforge.example", secret: "old")
    same("save: new login", SaveWords.passwordButton(existing: nil), "Save")
    same("save: update names the login", SaveWords.passwordButton(existing: existing), "Update Gitforge (sam.r)")
    same("save: passkey for a new login", SaveWords.passkeyButton(existing: nil), "Create Passkey")
    same("save: passkey joins the login", SaveWords.passkeyButton(existing: existing), "Add Passkey to Gitforge (sam.r)")
    existing.account = ""
    same("save: no username, the name alone", SaveWords.label(of: existing), "Gitforge")
    same("save: update with no username reads Update <Name>", SaveWords.passwordButton(existing: existing), "Update Gitforge")
    existing.account = "   "
    same("save: update with a blank username reads Update <Name>", SaveWords.passwordButton(existing: existing), "Update Gitforge")
    existing.account = "Gitforge"
    same("save: a username equal to the name is not repeated", SaveWords.passwordButton(existing: existing), "Update Gitforge")
    existing.title = "localhost"; existing.account = "sam@example.com"
    same("save: update names the account in the same string", SaveWords.passwordButton(existing: existing), "Update localhost (sam@example.com)")
    existing.title = String(repeating: "N", count: 200); existing.account = "a\nb"
    expect("save: a long name is cut and a newline never reaches the button", SaveWords.label(of: existing).count < 80 && !SaveWords.label(of: existing).contains("\n"), true)
}

// An otpauth:// link: which logins it suggests, and the unsaved login it starts.
do {
    func titled(_ title: String, account: String = "me", website: String = "") -> VaultItem {
        VaultItem(kind: .login, title: title, account: account, website: website, secret: "pw")
    }
    let named = titled("GitHub", account: "a@b.c")
    let bySite = titled("Code host", account: "x@y.z", website: "https://www.github.com/login")
    let unrelated = titled("Bank", account: "dev@example.com")
    let sameUser = titled("Forum", account: "dev@example.com")
    let note = VaultItem(kind: .secureNote, title: "GitHub notes")
    let all = [unrelated, note, sameUser, bySite, named]

    let withIssuer = IncomingCodeMatch.suggested(for: TOTPSetup(secret: "JBSWY3DPEHPK3PXP", issuer: "GitHub", account: "dev@example.com"), among: all)
    expect("otpauth issuer: title and website match", Set(withIssuer.map { $0.id }) == Set([named.id, bySite.id]), true)
    expect("otpauth issuer: same username alone is not suggested", withIssuer.contains { $0.id == sameUser.id || $0.id == unrelated.id }, false)
    expect("otpauth issuer: notes are never suggested", withIssuer.contains { $0.id == note.id }, false)

    let noIssuer = IncomingCodeMatch.suggested(for: TOTPSetup(secret: "JBSWY3DPEHPK3PXP", account: "DEV@Example.com"), among: all)
    expect("otpauth no issuer: username matches, any case", Set(noIssuer.map { $0.id }) == Set([unrelated.id, sameUser.id]), true)
    let nothing = IncomingCodeMatch.suggested(for: TOTPSetup(secret: "JBSWY3DPEHPK3PXP"), among: all)
    expect("otpauth no issuer and no account: nothing suggested", nothing.isEmpty, true)
    var noteWithAccount = VaultItem(kind: .secureNote, title: "n"); noteWithAccount.account = "dev@example.com"
    expect("otpauth username: non-login kinds are never suggested", IncomingCodeMatch.suggested(for: TOTPSetup(secret: "JBSWY3DPEHPK3PXP", account: "dev@example.com"), among: [noteWithAccount]).isEmpty, true)

    var settings = TOTPSettings(); settings.digits = 8; settings.period = 60
    let setup = TOTPSetup(secret: "JBSWY3DPEHPK3PXP", settings: settings, issuer: "GitHub", account: "dev@example.com")
    let fresh = IncomingCodeMatch.newLogin(for: setup)
    expect("otpauth new login: kind is login", fresh.kind == .login, true)
    same("otpauth new login: title", fresh.title, "GitHub")
    same("otpauth new login: account", fresh.account, "dev@example.com")
    same("otpauth new login: secret", fresh.otpSecret, "JBSWY3DPEHPK3PXP")
    expect("otpauth new login: settings", fresh.otpSettings == settings, true)
    expect("otpauth new login: not in any list", all.contains { $0.id == fresh.id }, false)
}

// The AutoFill sheet's groups: "For This Site" and "Other Matches", and what an Other Matches row says about where it is saved.
do {
    func item(_ title: String, _ website: String, kind: ItemKind = .login) -> VaultItem {
        VaultItem(kind: kind, title: title, account: "sam.r", website: website, secret: "pw")
    }
    func titles(_ items: [VaultItem]) -> String { items.map(\.title).joined(separator: ",") }
    let own = item("Gitforge", "gitforge.example")
    let sub = item("Gitforge sub", "https://www.gitforge.example/x")
    let lookalike = item("Git Hosting Co", "githosting.example")
    let nothing = item("Gitforge old", "")
    let split = ResultGroups.split([lookalike, own, nothing, sub], host: "gitforge.example")
    same("groups: websites that match the page are For This Site, in order", titles(split.thisSite), "Gitforge,Gitforge sub")
    same("groups: another site and no website are Other Matches, in order", titles(split.other), "Git Hosting Co,Gitforge old")
    same("groups: no result for this site leaves that group empty", titles(ResultGroups.split([lookalike, nothing], host: "gitforge.example").thisSite), "")
    same("groups: only this site leaves Other Matches empty", titles(ResultGroups.split([own, sub], host: "gitforge.example").other), "")
    same("groups: nothing at all", titles(ResultGroups.split([], host: "gitforge.example").other + ResultGroups.split([], host: "gitforge.example").thisSite), "")
    let unknown = ResultGroups.split([own, lookalike], host: nil)
    same("groups: an unknown page has nothing for this site", titles(unknown.thisSite) + "|" + titles(unknown.other), "|Gitforge,Git Hosting Co")
    same("groups: a parent domain of the saved site is not this site", titles(ResultGroups.split([own], host: "example").thisSite), "")
    same("groups: a lookalike host is not this site", titles(ResultGroups.split([own], host: "gitforge.example.evil.test").thisSite), "")
    let visa = VaultItem(kind: .creditCard, title: "Visa", account: "Kid Example", secret: "4242424242424242")
    same("groups: a card is never For This Site", titles(ResultGroups.split([visa], host: "gitforge.example").other), "Visa")

    same("saved for: another site", ResultGroups.savedForLine(lookalike), "Saved for githosting.example")
    same("saved for: no website", ResultGroups.savedForLine(nothing), "No website")
    same("saved for: only spaces and invisible characters is no website", ResultGroups.savedForLine(item("x", "  \u{202E}\u{200B}\n ")), "No website")
    same("saved for: a website with no host", ResultGroups.savedForLine(item("x", "https://")), "Saved for a site Psss could not read")
    same("saved for: a url shows its host only", ResultGroups.savedForLine(item("x", "https://WWW.Githosting.example:8443/login?a=1")), "Saved for githosting.example")
    same("saved for: an international name shows safely", ResultGroups.savedForLine(item("x", "xn--bcher-kva.example")), "Saved for bücher.example")
    let hostile = ResultGroups.savedForLine(item("x", "evil.example\u{202E}gpj.exe\nSaved for gitforge.example"))
    expect("saved for: a hostile website is one line without bidi controls", !hostile.contains("\n") && !hostile.unicodeScalars.contains { $0.value == 0x202E }, true)
    let huge = ResultGroups.savedForLine(item("x", (0..<60).map { _ in "ab" }.joined(separator: ".") + ".example"))
    expect("saved for: a long host is cut", huge.count <= "Saved for ".count + ResultGroups.siteLimit, true)
    expect("saved for: a cut host ends with an ellipsis", huge.hasSuffix("…"), true)
    let enormous = ResultGroups.savedForLine(item("x", String(repeating: "a", count: 5000) + ".example"))
    expect("saved for: an enormous label is short", enormous.count <= "Saved for a site Psss could not read".count + ResultGroups.siteLimit, true)
    same("saved site: nil for no website", ResultGroups.savedSite(nothing), nil)
    same("saved site: the host", ResultGroups.savedSite(lookalike), "githosting.example")

    let several = ResultGroups.noLoginsBody(vault: "Passwords", otherVaults: true, searchWhere: "below")
    same("no logins: with several vaults the body names the vault and both ways on", several, "Passwords has none for this site. Search all items below, or choose another vault above.")
    let one = ResultGroups.noLoginsBody(vault: "Passwords", otherVaults: false, searchWhere: "above")
    same("no logins: with one vault there is no other vault to suggest", one, "Passwords has none for this site. Search all items above.")
    let hostileVault = ResultGroups.noLoginsBody(vault: "Work\u{202E}gpj.exe\nline two", otherVaults: false, searchWhere: "above")
    expect("no logins: a hostile vault name is one line without bidi controls", !hostileVault.contains("\n") && !hostileVault.unicodeScalars.contains { $0.value == 0x202E }, true)
}

// The address a website row opens in the browser.
func opens(_ stored: String, _ url: String?, custom: Bool = false) {
    same("web address of \(stored.debugDescription)\(custom ? " (custom field)" : "")", SiteMatch.webAddress(stored, requiresScheme: custom)?.absoluteString, url)
}
opens("example.com", "https://example.com")
opens(" example.com/login?next=1 ", "https://example.com/login?next=1")
opens("www.example.com:8443", "https://www.example.com:8443")
opens("http://example.com", "http://example.com")
opens("HTTPS://Example.com/a", "HTTPS://Example.com/a")
opens("https://example.com", "https://example.com", custom: true)
opens("example.com", nil, custom: true)
opens("report.pdf", nil, custom: true)
for junk in ["", "My bank", "https://", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "ssh://example.com", "androidapp://com.example",
             "mailto:me@example.com", "tel:12345", "https://user@example.com", "https://example.com\\@evil.test", "example.com\nevil.test", "exa\u{202E}mple.com"] {
    opens(junk, nil)
    opens(junk, nil, custom: true)
}

if failures > 0 { print("\n\(failures) FAILED"); exit(1) }
print("\nall site matching checks passed")
