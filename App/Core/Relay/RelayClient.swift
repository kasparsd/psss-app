#if os(macOS)
import Darwin
import Foundation

/// Why a request did not get an answer from the app. The raw value is the protocol error word the popup shows.
enum RelayFailure: String, Error, Sendable { case notRunning = "not-running", notVerified = "not-verified", timeout, unsupported, failed }

/// The client side of the browser relay, shared by the native messaging host and the Safari app extension: connect to the socket in
/// the App Group container, check that the process that answers is our app, send one request in the relay envelope, read one reply.
/// It holds no key and no vault code. See `RelayFrame` for the wire format.
enum RelayClient {
    /// The socket in a team's group container. The group identifier is the team id and `app.psss` (`SharedVault.groupID`). Nil for a
    /// process with no team signature, which cannot know whose container is ours.
    static func socketPath(home: String) -> String? {
        guard let team = PeerIdentity.ownTeam() else { return nil }
        return "\(home)/Library/Group Containers/\(team).app.psss/\(RelayLimits.folderName)/\(RelayLimits.socketName)"
    }

    /// Connects with a two second limit. A failure is the word the popup shows.
    static func connect(_ path: String) -> Result<Int32, RelayFailure> {
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
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
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

    /// One request through the app: connect, check the app (unless `verifyApp` is false, for the tests' stand-in), send, wait for the
    /// reply, close. `replyWithin` is how long the caller will wait for the reply. The reply bytes are the app's.
    static func send(_ request: Data, caller: String, socketPath path: String?, verifyApp: Bool = true, replyWithin: TimeInterval) -> Result<Data, RelayFailure> {
        guard request.count <= RelayLimits.maxRequest, let envelope = RelayFrame.envelope(caller: caller, request: request),
              envelope.count <= RelayLimits.maxRequest + 512 else { return .failure(.unsupported) }
        // No team signature: this process cannot know which container is ours, so it cannot show that any app is.
        guard let path else { return .failure(.notVerified) }
        let fd: Int32
        switch connect(path) {
        case .failure(let failure): return .failure(failure)
        case .success(let connected): fd = connected
        }
        defer { close(fd) }

        if verifyApp {
            // The app is who it says only if its signature satisfies our team's requirement for it. Nothing is sent to anything else:
            // that is what stops another local process, which planted a socket where the app listens, from collecting a saved password.
            guard let team = PeerIdentity.ownTeam(), let requirement = PeerIdentity.requirement(team: team, identifier: PeerIdentity.appIdentifier),
                  PeerIdentity.peerSatisfies(fd, requirement: requirement) else { return .failure(.notVerified) }
        }

        let deadline = RelayIO.deadline(after: replyWithin)
        guard RelayFrame.write(fd, envelope, until: RelayIO.deadline(after: 2)) else { return .failure(.failed) }
        switch RelayFrame.read(fd, maxBytes: RelayLimits.maxReply, until: deadline) {
        case .frame(let reply): return .success(reply)
        case .timeout: return .failure(.timeout)
        default: return .failure(.failed)  // closed with no reply: the app died, or refused this caller
        }
    }

    /// An app reply goes back as it is, except that an error the app made before it had read the request (`busy`) has no `id`: the
    /// request's goes in. Anything that is not a protocol reply of this version becomes `failed`.
    static func passThrough(_ reply: Data, id: String) -> Data {
        guard let object = RelayFrame.object(reply), RelayFrame.isInteger(object["v"], RelayLimits.protocolVersion) else { return RelayFrame.error(RelayFailure.failed.rawValue, id: id) }
        if object["id"] as? String == id { return reply }
        guard object["ok"] as? Bool == false, object["id"] as? String == "" else { return RelayFrame.error(RelayFailure.failed.rawValue, id: id) }
        var fixed = object
        fixed["id"] = id
        return (try? JSONSerialization.data(withJSONObject: fixed)) ?? RelayFrame.error(RelayFailure.failed.rawValue, id: id)
    }
}
#endif
