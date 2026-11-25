import Darwin
import Foundation

/// The wire format between the browser's native host and the running app (docs/plans/browser-relay.md, section 5; folded into
/// docs/browser-extension.md, "Host and app"). Shared by the host and the app, so both ends agree on every limit.
///
/// One request per connection: connect, (both ends verify the other's code signature), one frame each way, close. A frame is a
/// 4-byte big-endian length and then UTF-8 JSON. The request is `{ "relay": 1, "caller": "<origin or add-on id>", "request": { … } }`.
enum RelayLimits {
    /// The envelope version. Separate from the protocol version (`BrowserProtocol.version`), which the host also answers with.
    static let relay = 1
    /// The browser protocol version in a reply (`v`). `BrowserProtocol.version` is this value.
    static let protocolVersion = 5
    /// The largest request. The largest real one, `save`, is under 2 KiB.
    static let maxRequest = 64 * 1024
    /// The largest reply (Chrome refuses a host message over 1 MiB).
    static let maxReply = 1 << 20
    /// How long the app waits for the whole request after a connection is accepted.
    static let receiveDeadline: TimeInterval = 2
    /// How long the app takes to answer, by request type. The host waits two seconds more.
    static func replyDeadline(for type: String?) -> TimeInterval {
        switch type {
        case "unlock-vault": 90
        case "save": 10
        default: 5
        }
    }
    static let hostMargin: TimeInterval = 2
    static let maxConnections = 8
    /// The longest caller text (an extension origin or an add-on id).
    static let maxCaller = 256
    /// What the Safari extension puts in `caller`. The app accepts exactly this from a peer whose signature says Safari: a Safari
    /// peer naming a Chrome origin, or a native host naming this, is refused.
    static let safariCaller = "safari"
    /// Deepest JSON nesting accepted. Real messages nest three levels (`search` has an array in an object in the envelope).
    static let maxDepth = 8
    static let socketName = "browser.sock"
    static let lockName = "relay.lock"
    static let folderName = "Relay"
    /// `sun_path` holds 104 bytes on macOS, with the terminating zero.
    static let maxSocketPath = 103
}

/// Reads and writes on a socket (or pipe) with a deadline, so no peer can hold a thread for longer than the limit says.
enum RelayIO {
    static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
    static func deadline(after seconds: TimeInterval) -> UInt64 { now() + UInt64(seconds * 1_000_000_000) }

    /// 1 ready, 0 deadline passed, -1 error.
    static func wait(_ fd: Int32, events: Int16, until deadline: UInt64) -> Int32 {
        while true {
            let current = now()
            let remaining = deadline > current ? Int32(min((deadline - current + 999_999) / 1_000_000, 60_000)) : 0
            var item = pollfd(fd: fd, events: events, revents: 0)
            let result = poll(&item, 1, remaining)
            if result > 0 { return 1 }
            if result == 0 { return deadline > now() ? wait(fd, events: events, until: deadline) : 0 }
            if errno != EINTR { return -1 }
        }
    }

    enum ReadResult { case data(Data), eof, timeout, failed }

    /// Exactly `count` bytes, or why not. `eof`: the peer closed first.
    static func read(_ fd: Int32, count: Int, until deadline: UInt64) -> ReadResult {
        var buffer = [UInt8](repeating: 0, count: count)
        var have = 0
        while have < count {
            switch wait(fd, events: Int16(POLLIN), until: deadline) {
            case 0: return .timeout
            case let n where n < 0: return .failed
            default: break
            }
            let got = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress! + have, count - have) }
            if got == 0 { return .eof }
            if got < 0 { if errno == EINTR || errno == EAGAIN { continue }; return .failed }
            have += got
        }
        return .data(Data(buffer))
    }

    static func write(_ fd: Int32, _ data: Data, until deadline: UInt64) -> Bool {
        var sent = 0
        return data.withUnsafeBytes { raw -> Bool in
            while sent < raw.count {
                if wait(fd, events: Int16(POLLOUT), until: deadline) != 1 { return false }
                let n = Darwin.write(fd, raw.baseAddress! + sent, raw.count - sent)
                if n < 0 { if errno == EINTR || errno == EAGAIN { continue }; return false }
                sent += n
            }
            return true
        }
    }

    /// After a reply: stop sending, then discard what the peer still sends until it closes (or a short time passes). Closing a socket
    /// with unread data makes the system reset the connection, which can destroy the reply the peer has not read yet.
    static func finish(_ fd: Int32, within seconds: TimeInterval = 0.1) {
        shutdown(fd, SHUT_WR)
        let deadline = deadline(after: seconds)
        var scratch = [UInt8](repeating: 0, count: 4096)
        while wait(fd, events: Int16(POLLIN), until: deadline) == 1 {
            let n = scratch.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress!, $0.count) }
            if n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN) { return }
        }
    }

    /// Whether the other end has closed (or sent more than the one request it may send). Looks without reading anything.
    static func peerGone(_ fd: Int32) -> Bool {
        var item = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        guard poll(&item, 1, 0) > 0 else { return false }
        if item.revents & Int16(POLLHUP | POLLERR | POLLNVAL) != 0 { return true }
        var byte: UInt8 = 0
        let n = recv(fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT)
        return n >= 0 || (errno != EAGAIN && errno != EINTR)
    }
}

enum RelayFrame {
    enum Outcome: Equatable {
        case frame(Data)
        /// A length of zero.
        case empty
        /// A length over the limit. Nothing more is read.
        case tooLarge
        /// The peer closed before the header or the body was complete.
        case truncated
        case timeout
        case failed
    }

    /// Reads one frame whose body is at most `maxBytes`.
    static func read(_ fd: Int32, maxBytes: Int, until deadline: UInt64) -> Outcome {
        switch RelayIO.read(fd, count: 4, until: deadline) {
        case .eof: return .truncated
        case .timeout: return .timeout
        case .failed: return .failed
        case .data(let header):
            let length = header.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
            if length == 0 { return .empty }
            if length > UInt32(maxBytes) { return .tooLarge }
            switch RelayIO.read(fd, count: Int(length), until: deadline) {
            case .eof: return .truncated
            case .timeout: return .timeout
            case .failed: return .failed
            case .data(let body): return .frame(body)
            }
        }
    }

    static func framed(_ payload: Data) -> Data {
        var out = Data()
        let length = UInt32(payload.count)
        out.append(contentsOf: [UInt8(length >> 24 & 255), UInt8(length >> 16 & 255), UInt8(length >> 8 & 255), UInt8(length & 255)])
        out.append(payload)
        return out
    }

    static func write(_ fd: Int32, _ payload: Data, until deadline: UInt64) -> Bool {
        RelayIO.write(fd, framed(payload), until: deadline)
    }

    // MARK: JSON checks, before anything is parsed

    /// Whether `data` is one JSON object in valid UTF-8 that nests at most `maxDepth` levels. Cheap and total: it looks at bytes
    /// only, so a hostile document cannot reach the parser's recursion. The parser still decides whether the JSON is valid.
    static func looksLikeObject(_ data: Data, maxDepth: Int = RelayLimits.maxDepth) -> Bool {
        guard String(data: data, encoding: .utf8) != nil, !data.contains(0) else { return false }
        var depth = 0
        var inString = false
        var escaped = false
        var first: UInt8?
        for byte in data {
            if inString {
                if escaped { escaped = false } else if byte == 0x5C { escaped = true } else if byte == 0x22 { inString = false }
                continue
            }
            if first == nil, ![0x20, 0x09, 0x0A, 0x0D].contains(byte) { first = byte }
            switch byte {
            case 0x22: inString = true
            case 0x7B, 0x5B:
                depth += 1
                if depth > maxDepth { return false }
            case 0x7D, 0x5D: depth -= 1; if depth < 0 { return false }
            default: break
            }
        }
        return first == 0x7B && depth == 0 && !inString
    }

    /// The parsed object, or nil when it is not one object (see `looksLikeObject`).
    static func object(_ data: Data) -> [String: Any]? {
        guard looksLikeObject(data) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// `{ "relay": 1, "caller": …, "request": <the request, as the browser sent it> }`. Nil when the request is not one JSON
    /// object. The request bytes are copied, not parsed again and re-encoded, so a secret in them is never touched.
    static func envelope(caller: String, request: Data) -> Data? {
        guard looksLikeObject(request), let name = try? JSONSerialization.data(withJSONObject: [caller]) else { return nil }
        var out = Data("{\"relay\":\(RelayLimits.relay),\"caller\":".utf8)
        out.append(name.dropFirst().dropLast())
        out.append(Data(",\"request\":".utf8))
        out.append(request)
        out.append(UInt8(ascii: "}"))
        return out
    }

    struct Envelope {
        var caller: String
        /// The request object, as JSON.
        var request: Data
        var type: String?
        var id: String
    }

    enum EnvelopeError: Error { case malformed, wrongVersion, badCaller }

    static func parse(_ data: Data) -> Result<Envelope, EnvelopeError> {
        guard let object = object(data), let request = object["request"] as? [String: Any],
              let body = try? JSONSerialization.data(withJSONObject: request) else { return .failure(.malformed) }
        guard isInteger(object["relay"], RelayLimits.relay) else { return .failure(.wrongVersion) }
        guard let caller = object["caller"] as? String, !caller.isEmpty, caller.utf8.count <= RelayLimits.maxCaller,
              !caller.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else { return .failure(.badCaller) }
        return .success(Envelope(caller: caller, request: body, type: request["type"] as? String, id: request["id"] as? String ?? ""))
    }

    /// A JSON integer with this value: not a boolean, not 5.5, not a string.
    static func isInteger(_ value: Any?, _ expected: Int) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
        return number.doubleValue == Double(expected)
    }

    // MARK: Replies the relay itself makes

    /// `{ v, id, ok: false, error }`, the shape every protocol error has.
    static func error(_ code: String, id: String = "") -> Data {
        let object: [String: Any] = ["v": RelayLimits.protocolVersion, "id": id, "ok": false, "error": code]
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }
}
