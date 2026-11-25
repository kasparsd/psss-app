#if os(macOS)
import Darwin
import Foundation
import OSLog

/// The app's half of the browser relay: a Unix domain socket in the App Group container that the native host connects to
/// (docs/browser-extension.md, "Host and app"). It owns the socket, the lock that makes one app the only server, the limits
/// (one request per connection, at most eight connections, deadlines) and the peer check, and hands each request that passes to
/// `handler` on the main actor. It knows nothing about vaults: the request is JSON in, the reply is JSON out. Foundation only,
/// so the tests' stand-in relay compiles the same file.
///
/// Every connection is judged before a byte of it is read: the peer's code signature must satisfy the policy, or the connection
/// is closed with no reply. Nothing is logged except "peer refused", at debug level, with no path or process number.
final class BrowserRelayServer: @unchecked Sendable {
    struct Configuration {
        /// The `Relay` folder (0700). It holds the socket and the lock file and nothing else.
        var directory: URL
        var policy: PeerPolicy
        /// Whether the extension that the host names as `caller` may use the relay (the app's compiled list of extension ids).
        var callerAllowed: @Sendable (String) -> Bool
        /// The request types served. Anything else is answered `unsupported` before it reaches the handler. Nil: every type.
        var allowedTypes: Set<String>?
        /// The browser protocol, on the main actor. Request JSON in, reply JSON out.
        var handler: @MainActor @Sendable (Data) -> Data
    }

    enum StartResult: Equatable {
        case listening(socketPath: String)
        /// Another copy of Psss holds the lock. This one does not listen.
        case alreadyServed
        case pathTooLong
        /// The folder, lock or socket could not be made. The text is plain words, never an error code.
        case unavailable(String)
    }

    private let configuration: Configuration
    private let queue = DispatchQueue(label: "app.psss.relay", attributes: .concurrent)
    private let log = Logger(subsystem: "app.psss", category: "relay")
    private let stateLock = NSLock()
    private var active = 0
    private var rejecting = 0
    private var lockFD: Int32 = -1
    private var listenFD: Int32 = -1
    private var source: DispatchSourceRead?
    private var socketPath: String?

    init(_ configuration: Configuration) { self.configuration = configuration }

    var directory: URL { configuration.directory }
    var socketURL: URL { configuration.directory.appendingPathComponent(RelayLimits.socketName) }

    // MARK: Start and stop

    func start() -> StartResult {
        let folder = configuration.directory.path
        let socket = socketURL.path
        guard socket.utf8.count <= RelayLimits.maxSocketPath else { return .pathTooLong }
        // A peer that closes before a reply is written must not end the app: a write to it fails with an error, not a signal.
        // (SO_NOSIGPIPE is also set on each connection, but cannot be set on one the peer has already closed.)
        signal(SIGPIPE, SIG_IGN)
        guard prepareFolder(folder) else { return .unavailable("Psss could not make its relay folder.") }

        // One app serves. The kernel releases the lock when this process dies, however it dies.
        let lock = open(configuration.directory.appendingPathComponent(RelayLimits.lockName).path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard lock >= 0 else { return .unavailable("Psss could not open its relay lock.") }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
            close(lock)
            return errno == EWOULDBLOCK ? .alreadyServed : .unavailable("Psss could not lock its relay.")
        }

        // Only the lock holder removes a leftover socket file and binds.
        unlink(socket)
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { close(lock); return .unavailable("Psss could not open its relay socket.") }
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { raw in for (index, byte) in socket.utf8.enumerated() { raw[index] = byte } }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0, chmod(socket, 0o600) == 0, listen(fd, 16) == 0 else {
            close(fd); unlink(socket); close(lock)
            return .unavailable("Psss could not listen on its relay socket.")
        }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        stateLock.lock()
        lockFD = lock
        listenFD = fd
        socketPath = socket
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptAll(on: fd) }
        source.setCancelHandler { close(fd) }
        self.source = source
        stateLock.unlock()
        source.resume()
        return .listening(socketPath: socket)
    }

    func stop() {
        stateLock.lock()
        let source = self.source, path = socketPath, lock = lockFD
        self.source = nil; socketPath = nil; lockFD = -1; listenFD = -1
        stateLock.unlock()
        source?.cancel()
        if let path { unlink(path) }
        if lock >= 0 { close(lock) }
    }

    /// The folder is ours, a real folder (not a link) and 0700.
    private func prepareFolder(_ path: String) -> Bool {
        var info = stat()
        if lstat(path, &info) == 0 {
            guard info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid() else { return false }
        } else {
            guard errno == ENOENT else { return false }
            // The group container exists, so one `mkdir` makes the folder (it is also the call the container protection allows a
            // team-signed process with the group entitlement). A missing parent is only a test's folder.
            if mkdir(path, 0o700) != 0 {
                guard errno == ENOENT,
                      (try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])) != nil else { return false }
            }
        }
        return chmod(path, 0o700) == 0
    }

    // MARK: Connections

    private func acceptAll(on listener: Int32) {
        while true {
            let fd = accept(listener, nil, nil)
            if fd < 0 {
                // A connection that gave up before it was accepted is not the end of the queue: keep draining it, or the connections
                // behind it wait for an event that never comes and the relay stops answering.
                if errno == ECONNABORTED || errno == EINTR || errno == EPROTO { continue }
                // Out of descriptors: try again shortly rather than never.
                if errno == EMFILE || errno == ENFILE { queue.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.acceptAll(on: listener) } }
                return  // EAGAIN: nothing more waiting
            }
            _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            stateLock.lock()
            let full = active >= RelayLimits.maxConnections
            if !full { active += 1 }
            stateLock.unlock()
            if full {
                // The ninth open connection is told at once and closed. The reply has no secret in it, so it is sent before any peer
                // check. This runs apart from the accept loop (a client that does not read must not stall it), and a flood beyond
                // sixteen of these is closed without a word.
                stateLock.lock()
                let canTell = rejecting < 16
                if canTell { rejecting += 1 }
                stateLock.unlock()
                if canTell {
                    queue.async { [self] in
                        if RelayFrame.write(fd, RelayFrame.error("busy"), until: RelayIO.deadline(after: 0.2)) { RelayIO.finish(fd) }
                        close(fd)
                        stateLock.lock(); rejecting -= 1; stateLock.unlock()
                    }
                } else {
                    close(fd)
                }
                continue
            }
            queue.async { [self] in
                if serve(fd) { RelayIO.finish(fd) }
                close(fd)
                stateLock.lock(); active -= 1; stateLock.unlock()
            }
        }
    }

    /// One connection: peer check, one request, one reply. The caller closes `fd`. True when a reply was written.
    private func serve(_ fd: Int32) -> Bool {
        guard configuration.policy.accepts(fd) else {
            log.debug("peer refused")
            return false
        }
        func reply(_ code: String, id: String = "") -> Bool {
            RelayFrame.write(fd, RelayFrame.error(code, id: id), until: RelayIO.deadline(after: 2))
        }
        let frame = RelayFrame.read(fd, maxBytes: RelayLimits.maxRequest, until: RelayIO.deadline(after: RelayLimits.receiveDeadline))
        let body: Data
        switch frame {
        case .frame(let data): body = data
        case .timeout: return reply("timeout")
        case .empty, .tooLarge: return reply("unsupported")
        case .truncated, .failed: return false
        }
        guard case .success(let envelope) = RelayFrame.parse(body) else { return reply("unsupported") }
        guard configuration.callerAllowed(envelope.caller) else { return reply("forbidden", id: envelope.id) }
        if let allowed = configuration.allowedTypes, !(envelope.type.map(allowed.contains) ?? false) { return reply("unsupported", id: envelope.id) }

        // The request runs on the main actor, one at a time in arrival order. This thread waits for it, and watches the connection:
        // a host killed in the middle of a request closes it, and the reply is then dropped.
        let result = ReplyBox()
        let handler = configuration.handler
        let request = envelope.request
        // A request that waited for the main actor past its deadline never runs: its reply was `timeout`, so a `save` must not write
        // afterwards. One that already started cannot be stopped.
        Task { @MainActor in result.finish(result.abandoned ? RelayFrame.error("timeout") : handler(request)) }
        let deadline = RelayIO.deadline(after: RelayLimits.replyDeadline(for: envelope.type))
        while !result.wait(milliseconds: 50) {
            if RelayIO.peerGone(fd) { return false }
            if RelayIO.now() >= deadline { result.abandon(); return reply("timeout", id: envelope.id) }
        }
        guard var data = result.data else { return reply("failed", id: envelope.id) }
        if envelope.type == "ping" { data = Self.markedAsApp(data) }
        if data.count > RelayLimits.maxReply { data = RelayFrame.error("failed", id: envelope.id) }
        return RelayFrame.write(fd, data, until: RelayIO.deadline(after: RelayLimits.hostMargin))
    }

    /// A `ping` answered through the relay says so: `app: true` (protocol 5).
    private static func markedAsApp(_ reply: Data) -> Data {
        guard var object = (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any], object["ok"] as? Bool == true else { return reply }
        object["app"] = true
        return (try? JSONSerialization.data(withJSONObject: object)) ?? reply
    }

    /// The reply the main actor produced, and a way to wait for it with a timeout.
    private final class ReplyBox: @unchecked Sendable {
        private let semaphore = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var stored: Data?
        private var gaveUp = false
        var data: Data? { lock.lock(); defer { lock.unlock() }; return stored }
        var abandoned: Bool { lock.lock(); defer { lock.unlock() }; return gaveUp }
        func abandon() { lock.lock(); gaveUp = true; lock.unlock() }
        func finish(_ data: Data) { lock.lock(); stored = data; lock.unlock(); semaphore.signal() }
        /// True when the reply is ready.
        func wait(milliseconds: Int) -> Bool { semaphore.wait(timeout: .now() + .milliseconds(milliseconds)) == .success }
    }
}
#endif
