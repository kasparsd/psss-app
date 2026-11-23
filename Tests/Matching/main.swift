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

if failures > 0 { print("\n\(failures) FAILED"); exit(1) }
print("\nall site matching checks passed")
