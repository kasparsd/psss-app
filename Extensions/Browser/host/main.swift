import Darwin
import Foundation

// Native messaging host for the browser extension: a relay client.
//
// Chrome and Firefox start this process for each request and speak the native messaging framing on stdio: a 4-byte native-endian
// length, then UTF-8 JSON. This process holds no key, no vault code and no file. It checks who started it, connects to the running
// Psss app over a Unix domain socket in the App Group container, checks that the app on the other end is signed by our team,
// sends the request in the relay envelope (App/Core/Relay/RelayFrame.swift), and writes the app's reply back unchanged.
// See docs/browser-extension.md, "Host and app".
//
// Every answer this process makes itself is a protocol error: `not-running` (nothing is listening), `not-verified` (the app, or this
// host, could not be shown to be ours), `timeout`, `unsupported` (not one JSON object, or too large) and `failed`.
//
// A build with `-D PSSS_RELAY_TESTING` (build.py host --testing) takes the socket from PSSS_RELAY_SOCKET and skips the app check,
// so the automated tests can talk to a stand-in relay. The release build has no such code.

signal(SIGPIPE, SIG_IGN)
let maxBrowserMessage = 1 << 20

// MARK: Caller check (defense in depth; the browser already enforces the manifest allowlist, and the app checks it again)

/// Chrome passes the caller's origin, `chrome-extension://<id>/`. Firefox passes the manifest path and the add-on ID. The installer
/// writes the accepted values next to this binary. Returns the argument that matched, which is what the app is told.
func allowedCaller() -> String? {
    let binary = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let file = binary.deletingLastPathComponent().appendingPathComponent("allowed-callers.txt")
    guard let text = try? String(contentsOf: file, encoding: .utf8) else { return nil }
    let allowed = Set(text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    return CommandLine.arguments.dropFirst().first { allowed.contains($0) }
}

// MARK: Browser framing (native-endian length)

func readFully(_ count: Int) -> Data? {
    var buffer = [UInt8](repeating: 0, count: count)
    var have = 0
    while have < count {
        let n = buffer.withUnsafeMutableBytes { read(0, $0.baseAddress! + have, count - have) }
        if n == 0 { return nil }
        if n < 0 { if errno == EINTR { continue }; return nil }
        have += n
    }
    return Data(buffer)
}

func readMessage() -> Data? {
    guard let header = readFully(4) else { return nil }
    let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    guard length > 0, Int(length) <= maxBrowserMessage else { return nil }
    return readFully(Int(length))
}

func writeMessage(_ body: Data) {
    var length = UInt32(body.count)
    var out = Data(bytes: &length, count: 4)
    out.append(body)
    out.withUnsafeBytes { raw in
        var sent = 0
        while sent < raw.count {
            let n = write(1, raw.baseAddress! + sent, raw.count - sent)
            if n < 0 { if errno == EINTR { continue }; return }
            sent += n
        }
    }
}

// MARK: Relay

/// Where the app listens. Nil when this host cannot say (it has no team signature, so it cannot know which group container is ours).
func socketPath() -> String? {
    #if PSSS_RELAY_TESTING
    if let path = ProcessInfo.processInfo.environment["PSSS_RELAY_SOCKET"], !path.isEmpty { return path }
    #endif
    guard let passwd = getpwuid(getuid()) else { return nil }
    return RelayClient.socketPath(home: String(cString: passwd.pointee.pw_dir))
}

/// One request through the app (`RelayClient`). The reply bytes are the app's.
func relay(_ request: Data, caller: String, type: String?) -> Result<Data, RelayFailure> {
    #if PSSS_RELAY_TESTING
    let verify = false
    #else
    let verify = true
    #endif
    return RelayClient.send(request, caller: caller, socketPath: socketPath(), verifyApp: verify,
                            replyWithin: RelayLimits.replyDeadline(for: type) + RelayLimits.hostMargin)
}

func errorReply(_ failure: RelayFailure, id: String) -> Data { RelayFrame.error(failure.rawValue, id: id) }

// MARK: Main

guard let caller = allowedCaller() else {
    FileHandle.standardError.write(Data("psss-native-host: caller not allowed\n".utf8))
    exit(2)
}

while let data = readMessage() {
    guard let object = RelayFrame.object(data) else {
        writeMessage(errorReply(.unsupported, id: ""))
        continue
    }
    let id = object["id"] as? String ?? ""
    switch relay(data, caller: caller, type: object["type"] as? String) {
    case .success(let reply): writeMessage(RelayClient.passThrough(reply, id: id))
    case .failure(let failure): writeMessage(errorReply(failure, id: id))
    }
}
