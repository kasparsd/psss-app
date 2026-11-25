import Darwin
import Foundation

// A stand-in for the Psss app's relay, for the automated tests only (build.py standin, scripts/test-relay.sh). It is the real
// `BrowserRelayServer` (socket, lock, limits, deadlines, peer check) serving the browser protocol from `PrototypeVaultService`,
// the prototype's seven vaults in a plain folder, so host_test.py and the end-to-end suites run without a signed app.
//
//   psss-relay-standin --directory RELAY_DIR [--callers any|compiled] [--allowed-types a,b,c]
//   environment: PSSS_PROTOTYPE_DIR (the prototype vault folder), PSSS_STANDIN_PEER (accept | refuse | cdhash:HEX | signed, default accept;
//                `signed` is the shipping policy: a host signed by this binary's own team as app.psss.native-host),
//                PSSS_STANDIN_DELAY_MS (every reply waits this long)
//
// Prints `ready <socket path>` once it listens. Any other start is a one-line reason on stderr and a non-zero exit.

func argument(_ name: String) -> String? {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

guard let directory = argument("--directory") else {
    FileHandle.standardError.write(Data("usage: psss-relay-standin --directory RELAY_DIR\n".utf8))
    exit(64)
}
let environment = ProcessInfo.processInfo.environment
if let prototype = environment["PSSS_PROTOTYPE_DIR"] {
    BrowserPrototypeStore.directory = URL(fileURLWithPath: prototype)
    try? FileManager.default.createDirectory(at: BrowserPrototypeStore.directory!, withIntermediateDirectories: true)
}
BrowserProtocol.vaultService = BrowserPrototypeStore.vaultService
let delay = Int(environment["PSSS_STANDIN_DELAY_MS"] ?? "") ?? 0
let anyCaller = argument("--callers") != "compiled"
let types = argument("--allowed-types").map { Set($0.split(separator: ",").map(String.init)) }

if environment["PSSS_STANDIN_PEER"] == "signed" {
    FileHandle.standardError.write(Data("signed policy: team \(PeerIdentity.ownTeam() ?? "none"), policy \(PeerPolicy.signedNativeHost() == nil ? "missing" : "built")\n".utf8))
}
let server = BrowserRelayServer(.init(
    directory: URL(fileURLWithPath: directory, isDirectory: true),
    policy: environment["PSSS_STANDIN_PEER"] == "signed" ? (PeerPolicy.signedNativeHost() ?? PeerPolicy.testing("refuse")) : PeerPolicy.testing(environment["PSSS_STANDIN_PEER"] ?? "accept"),
    callerAllowed: { anyCaller || ExtensionIDs.callers.contains($0) },
    allowedTypes: types,
    handler: { request in
        if delay > 0 { Thread.sleep(forTimeInterval: Double(delay) / 1000) }
        guard let object = RelayFrame.object(request) else { return RelayFrame.error("unsupported") }
        return (try? JSONSerialization.data(withJSONObject: BrowserProtocol.handle(object))) ?? RelayFrame.error("failed")
    }))

switch server.start() {
case .listening(let path): print("ready \(path)"); fflush(stdout)
case .alreadyServed: FileHandle.standardError.write(Data("already served\n".utf8)); exit(3)
case .pathTooLong: FileHandle.standardError.write(Data("path too long\n".utf8)); exit(4)
case .unavailable(let words): FileHandle.standardError.write(Data("\(words)\n".utf8)); exit(5)
}
dispatchMain()
