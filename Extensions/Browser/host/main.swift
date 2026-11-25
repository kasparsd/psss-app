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

enum RelayFailure: String, Error { case notRunning = "not-running", notVerified = "not-verified", timeout, unsupported, failed }

/// Where the app listens. Nil when this host cannot say (it has no team signature, so it cannot know which group container is ours).
func socketPath() -> String? {
    #if PSSS_RELAY_TESTING
    if let path = ProcessInfo.processInfo.environment["PSSS_RELAY_SOCKET"], !path.isEmpty { return path }
    #endif
    guard let team = PeerIdentity.ownTeam(), let passwd = getpwuid(getuid()) else { return nil }
    let home = String(cString: passwd.pointee.pw_dir)
    return "\(home)/Library/Group Containers/\(team).app.psss/\(RelayLimits.folderName)/\(RelayLimits.socketName)"
}

/// Connects with a two second limit. A failure is the word the popup shows.
func connectToApp(_ path: String) -> Result<Int32, RelayFailure> {
    guard path.utf8.count <= RelayLimits.maxSocketPath else { return .failure(.notRunning) }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return .failure(.failed) }
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { raw in for (index, byte) in path.utf8.enumerated() { raw[index] = byte } }
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    if result != 0 {
        guard errno == EINPROGRESS || errno == EAGAIN else { close(fd); return .failure(.notRunning) }
        // The app's backlog is full: wait for room, but not for long.
        guard RelayIO.wait(fd, events: Int16(POLLOUT), until: RelayIO.deadline(after: 2)) == 1 else { close(fd); return .failure(.timeout) }
        var error: Int32 = 0
        var size = socklen_t(MemoryLayout<Int32>.size)
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size)
        guard error == 0 else { close(fd); return .failure(.notRunning) }
    }
    return .success(fd)
}

/// One request through the app: connect, check the app, send, wait for the reply, close. The reply bytes are the app's.
func relay(_ request: Data, caller: String, type: String?) -> Result<Data, RelayFailure> {
    guard let envelope = RelayFrame.envelope(caller: caller, request: request) else { return .failure(.unsupported) }
    guard envelope.count <= RelayLimits.maxRequest + 512 else { return .failure(.unsupported) }
    guard request.count <= RelayLimits.maxRequest else { return .failure(.unsupported) }
    guard let path = socketPath() else { return .failure(.notVerified) }
    let fd: Int32
    switch connectToApp(path) {
    case .failure(let failure): return .failure(failure)
    case .success(let connected): fd = connected
    }
    defer { close(fd) }

    #if !PSSS_RELAY_TESTING
    // The app is who it says only if its signature satisfies our team's requirement for it. Nothing is sent to anything else:
    // that is what stops another local process, which planted a socket where the app listens, from collecting a saved password.
    guard let team = PeerIdentity.ownTeam(), let requirement = PeerIdentity.requirement(team: team, identifier: PeerIdentity.appIdentifier),
          PeerIdentity.peerSatisfies(fd, requirement: requirement) else { return .failure(.notVerified) }
    #endif

    let deadline = RelayIO.deadline(after: RelayLimits.replyDeadline(for: type) + RelayLimits.hostMargin)
    guard RelayFrame.write(fd, envelope, until: RelayIO.deadline(after: 2)) else { return .failure(.failed) }
    switch RelayFrame.read(fd, maxBytes: RelayLimits.maxReply, until: deadline) {
    case .frame(let reply): return .success(reply)
    case .timeout: return .failure(.timeout)
    default: return .failure(.failed)  // closed with no reply: the app died, or refused this host
    }
}

func errorReply(_ failure: RelayFailure, id: String) -> Data { RelayFrame.error(failure.rawValue, id: id) }

/// An app reply goes back as it is, except that an error the app made before it had read the request (`busy`) has no `id`: the
/// request's goes in. Anything that is not a protocol reply of this version becomes `failed`.
func passThrough(_ reply: Data, id: String) -> Data {
    guard let object = RelayFrame.object(reply), RelayFrame.isInteger(object["v"], RelayLimits.protocolVersion) else { return errorReply(.failed, id: id) }
    if object["id"] as? String == id { return reply }
    guard object["ok"] as? Bool == false, object["id"] as? String == "" else { return errorReply(.failed, id: id) }
    var fixed = object
    fixed["id"] = id
    return (try? JSONSerialization.data(withJSONObject: fixed)) ?? errorReply(.failed, id: id)
}

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
    case .success(let reply): writeMessage(passThrough(reply, id: id))
    case .failure(let failure): writeMessage(errorReply(failure, id: id))
    }
}
