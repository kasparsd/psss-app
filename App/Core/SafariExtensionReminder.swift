import Foundation
import Observation
#if os(macOS) && !HOSTLESS_TESTS
import SafariServices
#endif

// The Safari extension reminder (Mac only, 2026-11-24): a card in the vault list, like the AutoFill card, while the bundled Safari
// extension is switched off. iPhone and iPad have no Safari extension (they use system AutoFill alone, see docs/browser-extension.md),
// so there the system reads nothing and the card never shows.
//
// Same three layers as AutoFillReminder.swift: pure rules, the two system calls behind a protocol, and an observable object the
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
    /// The card stays off until the extension does something for a real vault. Today the Safari handler answers every credential
    /// request `unsupported` (docs/architecture.md, S0), so asking people to turn it on would send them to a switch that changes
    /// nothing. Flip this when the handler relays to the unlocked app and the extension has run in a signed Safari.
    static let extensionWorks = false

    var reading: SafariExtensionReading
    var memory: SafariExtensionMemory
    /// What the system says about AutoFill. One card at a time: the extension card waits until AutoFill is on, because AutoFill is
    /// what the person came for and the extension only adds to it.
    var autoFill: AutoFillReading
    var now = Date()
    var extensionWorks = Self.extensionWorks

    var showsCard: Bool {
        extensionWorks && autoFill == .on && reading == .off && !memory.isSnoozed(at: now)
    }
}

/// The words of the card.
enum SafariExtensionCopy {
    static var title: String { String(localized: "Turn on the Safari extension") }
    static var body: String {
        String(localized: "To generate passwords and save new logins on sign-up pages, turn on Psss in Safari Settings under Extensions, then allow it on websites.")
    }
    static var openLabel: String { String(localized: "Open Safari Settings…") }
    static var laterLabel: String { String(localized: "Later") }
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

    @ObservationIgnored private let system: any SafariExtensionSystem
    @ObservationIgnored private let save: (SafariExtensionMemory) -> Void
    @ObservationIgnored private let clock: @Sendable () -> Date

    init(system: any SafariExtensionSystem, memory: SafariExtensionMemory = SafariExtensionMemory(),
         save: @escaping (SafariExtensionMemory) -> Void = { _ in }, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.system = system
        self.memory = memory
        self.save = save
        self.clock = clock
    }

    static func live() -> SafariExtensionStatus {
        #if os(macOS) && !HOSTLESS_TESTS
        let store = DefaultsSafariExtensionMemory()
        return SafariExtensionStatus(system: LiveSafariExtensionSystem(), memory: store.load(), save: store.save)
        #else
        return SafariExtensionStatus(system: UnavailableSafariExtensionSystem())
        #endif
    }

    func reminder(autoFill: AutoFillReading) -> SafariExtensionReminder {
        SafariExtensionReminder(reading: reading, memory: memory, autoFill: autoFill, now: clock())
    }

    /// At launch and whenever the app becomes active: Safari has no change notification.
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
    }

    private func update(_ updated: SafariExtensionMemory) {
        guard updated != memory else { return }
        memory = updated
        save(updated)
    }
}
