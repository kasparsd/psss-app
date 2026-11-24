// Probe: what can the app truthfully say about whoever is on the other end of a local socket?
//
// The approval sheet says “Claude wants to use …”. That name must come from the system, not from the caller.
// This probe listens on a socket, and for one connection prints what the kernel and the code-signing system report:
// the peer's process, its signature, and every ancestor up to launchd, each with its own signature.
//
//   scripts/heavy.sh swiftc -O Packages/cli/probe/peer.swift -o build/cli/peer
//   build/cli/peer serve build/cli/probe.sock &      (prints one report, then exits)
//   build/cli/peer connect build/cli/probe.sock
//
// Unsandboxed and unsigned, so it says nothing about what a sandboxed Mac App Store build may do. That needs spike S5.
import Darwin
import Foundation
import Security

let SOL_LOCAL_LEVEL: Int32 = 0  // SOL_LOCAL
let PEERPID: Int32 = 0x002  // LOCAL_PEERPID
let PEERTOKEN: Int32 = 0x006  // LOCAL_PEERTOKEN, an audit token: it names one process run, so it cannot be reused by a later process with the same number

func address(_ path: String) -> sockaddr_un {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    precondition(bytes.count < MemoryLayout.size(ofValue: addr.sun_path), "socket path too long")
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
        for (index, byte) in bytes.enumerated() { raw[index] = byte }
    }
    return addr
}

func withSockaddr<T>(_ addr: inout sockaddr_un, _ body: (UnsafePointer<sockaddr>, socklen_t) -> T) -> T {
    withUnsafePointer(to: &addr) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
}

struct Signature {
    var identifier = "-"
    var team = "-"
    var valid = false
    var platform = false
}

func signature(_ attributes: [CFString: Any]) -> Signature {
    var result = Signature()
    var code: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes as CFDictionary, [], &code) == errSecSuccess, let code else { return result }
    result.valid = SecCodeCheckValidity(code, [], nil) == errSecSuccess
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return result }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
        let dict = info as? [String: Any]
    else { return result }
    result.identifier = dict[kSecCodeInfoIdentifier as String] as? String ?? "-"
    result.team = dict[kSecCodeInfoTeamIdentifier as String] as? String ?? "-"
    result.platform = (dict[kSecCodeInfoPlatformIdentifier as String] as? Int ?? 0) != 0
    return result
}

func processInfo(_ pid: pid_t) -> (parent: pid_t, terminal: Int32)? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
    return (info.kp_eproc.e_ppid, info.kp_eproc.e_tdev)
}

func executable(_ pid: pid_t) -> String {
    var buffer = [CChar](repeating: 0, count: 4096)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    return length > 0 ? String(cString: buffer) : "?"
}

/// The app bundle a path sits in, if any: the outermost “.app”.
func bundle(_ path: String) -> String? {
    guard let range = path.range(of: ".app/") else { return nil }
    return String(path[..<range.lowerBound]) + ".app"
}

func describe(_ label: String, _ pid: pid_t, _ sig: Signature) {
    let path = executable(pid)
    let terminal = processInfo(pid)?.terminal ?? -1
    print("\(label) pid=\(pid) terminal=\(terminal == -1 ? "none" : String(terminal))")
    print("    path:      \(path)")
    print("    signed as: \(sig.identifier)  team: \(sig.team)  valid: \(sig.valid)  apple: \(sig.platform)")
    if let app = bundle(path) { print("    inside:    \(app)") }
}

func serve(_ path: String) {
    unlink(path)
    let listener = socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = address(path)
    guard withSockaddr(&addr, { bind(listener, $0, $1) }) == 0, listen(listener, 1) == 0 else {
        print("could not listen on \(path): \(String(cString: strerror(errno)))")
        exit(1)
    }
    chmod(path, 0o600)
    let peer = accept(listener, nil, nil)
    guard peer >= 0 else { exit(1) }

    var pid: pid_t = 0
    var pidSize = socklen_t(MemoryLayout<pid_t>.size)
    let pidStatus = getsockopt(peer, SOL_LOCAL_LEVEL, PEERPID, &pid, &pidSize)
    var token = audit_token_t()
    var tokenSize = socklen_t(MemoryLayout<audit_token_t>.size)
    let tokenStatus = getsockopt(peer, SOL_LOCAL_LEVEL, PEERTOKEN, &token, &tokenSize)
    print("kernel: peer pid \(pidStatus == 0 ? String(pid) : "unavailable"), audit token \(tokenStatus == 0 ? "available" : "unavailable")")

    // The peer itself is identified by its audit token. In the app this must be the signed psss command, or the request is dropped.
    let tokenData = withUnsafeBytes(of: &token) { Data($0) }
    describe("peer    ", pid, tokenStatus == 0 ? signature([kSecGuestAttributeAudit: tokenData]) : Signature())

    // Ancestors are looked up by process number, which is a label and not proof: a parent can exit and its number be reused.
    var current = pid
    // The name for the sheet: the first application found walking outward, then the outermost application signed by the
    // same team. A helper bundled inside an app (“claude” inside “Claude”) is not what the person knows it by.
    var firstApp: String?
    var firstTeam = "-"
    var namedApp: String?
    var depth = 0
    while let info = processInfo(current), info.parent > 1, depth < 32 {
        current = info.parent
        depth += 1
        let path = executable(current)
        let sig = signature([kSecGuestAttributePid: NSNumber(value: current)])
        describe("ancestor", current, sig)
        guard let app = bundle(path) else { continue }
        if firstApp == nil {
            firstApp = app
            firstTeam = sig.team
            namedApp = app
        } else if sig.valid, sig.team != "-", sig.team == firstTeam {
            namedApp = app
        }
    }
    print("chain ends at launchd after \(depth) ancestors")
    print("first application found: \(firstApp ?? "none")")
    print("the sheet would name: \(namedApp.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent } ?? "no app found (a remote login or a background job)")")
    var done: UInt8 = 1
    write(peer, &done, 1)
    close(peer)
    close(listener)
    unlink(path)
}

func connectTo(_ path: String) {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = address(path)
    guard withSockaddr(&addr, { connect(fd, $0, $1) }) == 0 else {
        print("could not connect to \(path): \(String(cString: strerror(errno)))")
        exit(1)
    }
    // Stay alive until the server has looked at this process.
    var byte: UInt8 = 0
    _ = read(fd, &byte, 1)
    close(fd)
}

let arguments = CommandLine.arguments
guard arguments.count == 3, ["serve", "connect"].contains(arguments[1]) else {
    print("use: peer serve <socket> | peer connect <socket>")
    exit(2)
}
if arguments[1] == "serve" { serve(arguments[2]) } else { connectTo(arguments[2]) }
