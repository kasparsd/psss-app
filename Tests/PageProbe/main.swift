// Throwaway probe (P9): can a sandboxed app read the front tab's address from Safari and Chrome, and what does macOS ask?
import AppKit
import OSLog
import SwiftUI

struct Browser: Identifiable {
    let name: String
    let id: String
    let tab: String
}

let browsers = [
    Browser(name: "Safari", id: "com.apple.Safari", tab: "current tab"),
    Browser(name: "Chrome", id: "com.google.Chrome", tab: "active tab"),
]

/// What happened, newest last, shown in the window: macOS lets no other process read the app's own files.
final class ProbeLog: ObservableObject {
    static let shared = ProbeLog()
    @Published var lines: [String] = []
}

/// Statuses and button presses only, never an address.
func record(_ line: String) {
    Logger(subsystem: "app.psss.page-probe", category: "probe").notice("\(line, privacy: .public)")
    let stamped = "\(Date().formatted(date: .omitted, time: .standard))  \(line)"
    DispatchQueue.main.async { ProbeLog.shared.lines.append(stamped) }
}

/// What macOS says about sending Apple events to the browser. With `ask`, shows the prompt when it was never answered.
func permission(_ browser: Browser, ask: Bool) -> OSStatus {
    let target = NSAppleEventDescriptor(bundleIdentifier: browser.id)
    return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask)
}

func words(_ status: OSStatus, _ name: String) -> String {
    switch Int(status) {
    case 0: return "Allowed."
    case -1743: return "Refused. Change it in System Settings, Privacy & Security, Automation."
    case -1744: return "Not asked yet."
    case -600: return "\(name) is not running. Open it and try again."
    default: return "macOS answered \(status)."
    }
}

@MainActor
func frontHost(_ browser: Browser) -> String {
    let source = "tell application id \"\(browser.id)\" to return URL of \(browser.tab) of front window"
    var error: NSDictionary?
    let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
    if let error {
        let code = error[NSAppleScript.errorNumber] as? Int ?? 0
        record("\(browser.name) read error \(code)")
        return "Could not read the page (\(code))."
    }
    let host = result?.stringValue.flatMap { URL(string: $0)?.host() }
    record("\(browser.name) read ok, address: \(host == nil ? "none" : "yes")")
    return host.map { "Front tab: \($0)" } ?? "No web page in the front tab."
}

struct BrowserCard: View {
    let browser: Browser
    @State private var status = ""
    @State private var page = ""

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Text("Show logins for the page in \(browser.name)").bold()
                Text("macOS will ask to let Psss control \(browser.name). Psss reads only the front tab’s address, when this panel opens.")
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Allow in \(browser.name)…") { check(ask: true) }.buttonStyle(.borderedProminent)
                    Button("Read the Front Tab") { record("\(browser.name) pressed Read"); page = frontHost(browser) }
                    Button("Check Without Asking") { check(ask: false) }
                }
                if !status.isEmpty { Text(status) }
                if !page.isEmpty { Text(page) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        }
    }

    private func check(ask: Bool) {
        status = "Waiting for macOS…"
        record("\(browser.name) pressed \(ask ? "Allow" : "Check Without Asking")")
        let browser = browser
        // The call blocks while the prompt is up.
        DispatchQueue.global().async {
            let code = permission(browser, ask: ask)
            record("\(browser.name) permission ask=\(ask) status \(code)")
            DispatchQueue.main.async { status = words(code, browser.name) }
        }
    }
}

struct ProbeApp: App {
    @ObservedObject private var log = ProbeLog.shared

    var body: some Scene {
        Window("Psss Page Probe", id: "probe") {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(browsers) { BrowserCard(browser: $0) }
                Button("Open Automation Settings…") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
                }
                if !log.lines.isEmpty {
                    Text(log.lines.suffix(14).joined(separator: "\n"))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Copy Log") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(log.lines.joined(separator: "\n"), forType: .string)
                    }
                }
            }
            .padding(16)
            .frame(width: 520)
        }
        .windowResizability(.contentSize)
    }
}

ProbeApp.main()
