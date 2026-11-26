import Foundation
import Observation
#if os(macOS) && !HOSTLESS_TESTS
import SafariServices
#endif

// The Safari extension reminder (mock `#/safari-extension-reminder`, approved 2026-11-26): a card like the AutoFill one while the
// Psss extension in Safari is not on. The Mac asks Safari and shows the card in the vault list. iPhone and iPad cannot ask: the
// extension leaves a "seen" note (`SafariExtensionSeen`) the first time it runs, and the card, on the Cards and Addresses places,
// shows until then. Nothing shows on a platform whose extension does not work yet (`SafariExtensionReminder.extensionWorks`).
//
// Same three layers as AutoFillReminder.swift: pure rules, the system calls behind a protocol, and an observable object the
// views read.

/// What Safari says about the Psss extension.
enum SafariExtensionReading: Equatable, Sendable {
    case notRead
    case on
    case off
    /// No answer, or no extension on this device. Nothing is claimed.
    case unreadable
}

/// What this Mac remembers about the card. Per device, never in the vault file.
struct SafariExtensionMemory: Codable, Equatable, Sendable {
    /// When Later was chosen. Cleared whenever the extension is seen on.
    var snoozedAt: Date?

    func isSnoozed(at now: Date) -> Bool {
        guard let snoozedAt else { return false }
        let elapsed = now.timeIntervalSince(snoozedAt)
        return elapsed >= 0 && elapsed < AutoFillReminder.snoozeInterval
    }

    mutating func observe(_ reading: SafariExtensionReading) {
        if reading == .on { snoozedAt = nil }
    }
}

/// Whether the card shows, from what is known now. Pure.
struct SafariExtensionReminder: Equatable, Sendable {
    #if os(macOS)
    /// Off until the Mac extension does something for a real vault in a signed Safari: the handler relays to the running app, but
    /// that has not been run, so asking people to turn it on could send them to a switch that changes nothing. Flip this when it
    /// has run in a signed Safari (docs/browser-extension.md).
    static let extensionWorks = false
    #else
    /// Off because the iPhone and iPad extension (`Extensions/SafariIOS`) cannot fill yet: the app does not write what it reads,
    /// and Release builds do not embed it. Flip this when it ships and fills cards and addresses. Until then neither the card nor
    /// the Settings row shows.
    static let extensionWorks = false
    #endif

    var reading: SafariExtensionReading
    var memory: SafariExtensionMemory
    /// What the system says about AutoFill. One card at a time: the extension card waits until AutoFill is on, because AutoFill is
    /// what the person came for and the extension only adds to it.
    var autoFill: AutoFillReading
    /// The "AutoFill is on" confirmation is on screen. The extension card waits for its Done.
    var autoFillConfirming = false
    var now = Date()
    var extensionWorks = Self.extensionWorks

    var showsCard: Bool {
        extensionWorks && autoFill == .on && !autoFillConfirming && reading == .off && !memory.isSnoozed(at: now)
    }
}

/// The words of the card, of the extension's row in Settings and of the Later notice.
enum SafariExtensionCopy {
    static var title: String { String(localized: "Fill cards and addresses in Safari") }

    /// The Mac extension also saves new logins and generates passwords, so its sentence names them.
    static func body(_ device: AutoFillDevice) -> String {
        device == .mac
            ? String(localized: "Passwords already fill through AutoFill. Cards, addresses, new logins and generated passwords in Safari need the Psss extension.")
            : String(localized: "Passwords already fill through AutoFill. Cards and addresses need the Psss extension in Safari.")
    }

    /// The Mac opens the page in Safari Settings. iOS has no link to the switch, so its button opens the steps.
    static func buttonLabel(_ device: AutoFillDevice) -> String {
        device == .mac ? String(localized: "Open Safari Settings…") : String(localized: "How to Turn It On")
    }

    static var laterLabel: String { String(localized: "Later") }

    // MARK: iPhone and iPad

    static var laterNotice: String { String(localized: "Psss will remind you in a week.") }

    static var settingsRow: String { String(localized: "Safari Extension") }

    /// The status at the end of the Settings row. "Used in Safari" is all that is known: it ran once. Nil before the first reading.
    static func settingsStatus(_ reading: SafariExtensionReading) -> String? {
        switch reading {
        case .on: String(localized: "Used in Safari")
        case .off: String(localized: "Not seen yet")
        case .notRead, .unreadable: nil
        }
    }

    static func settingsFooter(_ reading: SafariExtensionReading) -> String? {
        switch reading {
        case .on: String(localized: "Psss has run in Safari. If cards and addresses stop filling, check that it is still on: Settings › Apps › Safari › Extensions.")
        case .off: String(localized: "Fills cards and addresses in Safari. Passwords fill through AutoFill and don’t need it.")
        case .notRead, .unreadable: nil
        }
    }
}

// MARK: - The outside

protocol SafariExtensionSystem: Sendable {
    /// Whether the extension is switched on in Safari. Nil when Safari gave no answer or there is no extension.
    func isEnabled() async -> Bool?
    /// Opens the Extensions page in Safari Settings with Psss selected. False when it could not be opened.
    func openSettings() async -> Bool
}

struct UnavailableSafariExtensionSystem: SafariExtensionSystem {
    func isEnabled() async -> Bool? { nil }
    func openSettings() async -> Bool { false }
}

/// iPhone and iPad: there is no way to ask Safari, so the extension's own note is the reading. Seen is on, not seen is off.
struct SeenSafariExtensionSystem: SafariExtensionSystem {
    var seen: @Sendable () -> Bool = { SafariExtensionSeen().read() }

    func isEnabled() async -> Bool? { seen() }
    /// iOS has no link to the extension's switch: the app shows the steps instead.
    func openSettings() async -> Bool { false }
}

#if os(macOS) && !HOSTLESS_TESTS
/// Uses Safari's async calls, not the reply-closure ones: Safari answers on its own XPC queue, and a reply closure there was checked
/// against the caller's main actor and stopped the app at launch (`_dispatch_assert_queue_fail`, found 2026-11-25, still with
/// `@Sendable` closures).
struct LiveSafariExtensionSystem: SafariExtensionSystem {
    /// The bundle identifier of the `SafariExtension-macOS` target.
    static let identifier = "app.psss.Psss.Safari"

    func isEnabled() async -> Bool? {
        (try? await SFSafariExtensionManager.stateOfSafariExtension(withIdentifier: Self.identifier))?.isEnabled
    }

    func openSettings() async -> Bool {
        do {
            try await SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.identifier)
            return true
        } catch {
            return false
        }
    }
}
#endif

/// Where this device keeps `SafariExtensionMemory` (local preferences, not synced).
struct DefaultsSafariExtensionMemory {
    private static let key = "safariExtensionReminder"

    func load() -> SafariExtensionMemory {
        UserDefaults.standard.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(SafariExtensionMemory.self, from: $0) } ?? SafariExtensionMemory()
    }

    func save(_ memory: SafariExtensionMemory) {
        if let data = try? JSONEncoder().encode(memory) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

// MARK: - What the views read

@MainActor
@Observable
final class SafariExtensionStatus {
    private(set) var reading: SafariExtensionReading = .notRead
    private(set) var memory: SafariExtensionMemory
    /// iPhone and iPad show a line after Later: when the card comes back. It goes away by itself.
    private(set) var laterNoticeShown = false
    /// `SafariExtensionReminder.extensionWorks` of this platform. With it off, nothing about the extension shows.
    let extensionWorks: Bool

    @ObservationIgnored private let system: any SafariExtensionSystem
    @ObservationIgnored private let save: (SafariExtensionMemory) -> Void
    @ObservationIgnored private let clock: @Sendable () -> Date

    init(system: any SafariExtensionSystem, memory: SafariExtensionMemory = SafariExtensionMemory(),
         save: @escaping (SafariExtensionMemory) -> Void = { _ in }, clock: @escaping @Sendable () -> Date = { Date() },
         extensionWorks: Bool = SafariExtensionReminder.extensionWorks) {
        self.extensionWorks = extensionWorks
        self.system = system
        self.memory = memory
        self.save = save
        self.clock = clock
    }

    static func live() -> SafariExtensionStatus {
        #if HOSTLESS_TESTS
        return SafariExtensionStatus(system: UnavailableSafariExtensionSystem())
        #else
        #if os(macOS)
        let system = LiveSafariExtensionSystem()
        #else
        let system = SeenSafariExtensionSystem()
        #endif
        let store = DefaultsSafariExtensionMemory()
        return SafariExtensionStatus(system: system, memory: store.load(), save: store.save)
        #endif
    }

    /// The card's rule, given what the AutoFill card is doing.
    func reminder(after autoFill: AutoFillReminder) -> SafariExtensionReminder {
        SafariExtensionReminder(reading: reading, memory: memory, autoFill: autoFill.reading,
                                autoFillConfirming: autoFill.display == .confirmation, now: clock(), extensionWorks: extensionWorks)
    }

    /// At launch, after unlock and whenever the app becomes active: there is no change notification.
    func refresh() async {
        let enabled = await system.isEnabled()
        reading = switch enabled {
        case true?: .on
        case false?: .off
        case nil: .unreadable
        }
        var updated = memory
        updated.observe(reading)
        update(updated)
    }

    func openSettings() async { _ = await system.openSettings() }

    func snooze() {
        var updated = memory
        updated.snoozedAt = clock()
        update(updated)
        laterNoticeShown = true
    }

    func dismissLaterNotice() { laterNoticeShown = false }

    private func update(_ updated: SafariExtensionMemory) {
        guard updated != memory else { return }
        memory = updated
        save(updated)
    }
}
