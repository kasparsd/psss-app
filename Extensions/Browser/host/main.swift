import Foundation

// Native messaging host for the browser extension (prototype).
//
// Chrome and Firefox start this process for each request and speak the native messaging
// framing on stdio: a 4-byte native-endian length, then UTF-8 JSON. Safari does not use this
// process: its messages reach the app extension, which implements the same protocol.
//
// PROTOTYPE LIMITS. This reads the sample vault and the App Group file directly and answers
// without asking the app. The shipping design keeps the vault key out of this process: the
// host relays each request to the running app over a local socket, the app verifies the peer,
// unlocks if needed and approves release. See docs/browser-extension.md, "Host and app".

let maxRequestBytes = 1 << 20

// MARK: Caller check (defense in depth; the browser already enforces the manifest allowlist)

/// Chrome passes the caller's origin, `chrome-extension://<id>/`. Firefox passes the manifest
/// path and the add-on ID. The installer writes the accepted values next to this binary.
func callerAllowed() -> Bool {
    let binary = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let file = binary.deletingLastPathComponent().appendingPathComponent("allowed-callers.txt")
    guard let text = try? String(contentsOf: file, encoding: .utf8) else { return false }
    let allowed = Set(text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    return CommandLine.arguments.dropFirst().contains { allowed.contains($0) }
}

// MARK: Framing

func readMessage() -> Data? {
    let input = FileHandle.standardInput
    let header = input.readData(ofLength: 4)
    guard header.count == 4 else { return nil }
    let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    guard length > 0, Int(length) <= maxRequestBytes else { return nil }
    let body = input.readData(ofLength: Int(length))
    return body.count == Int(length) ? body : nil
}

func write(_ object: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: object) else { return }
    var length = UInt32(body.count)
    FileHandle.standardOutput.write(Data(bytes: &length, count: 4))
    FileHandle.standardOutput.write(body)
}

// MARK: Storage. The host keeps a plain-text prototype file (see docs/browser-extension.md). The apps never read it.

func configureStorage() {
    let override = ProcessInfo.processInfo.environment["PSSS_PROTOTYPE_DIR"]
    let directory = override.map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Psss Prototype")
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    BrowserPrototypeStore.directory = directory
}

// MARK: Main

guard callerAllowed() else {
    FileHandle.standardError.write(Data("psss-native-host: caller not allowed\n".utf8))
    exit(2)
}

configureStorage()

while let data = readMessage() {
    if let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
        write(BrowserProtocol.handle(request))
    } else {
        write(["v": BrowserProtocol.version, "id": "", "ok": false, "error": "unsupported"])
    }
}
