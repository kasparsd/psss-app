import AuthenticationServices
import Foundation
import Observation

// The AutoFill reminder: a card at the top of the vault list while AutoFill is off, one confirmation when it comes on, and the
// state shown in Setup. Approved 2026-11-23 (Design/Mocks/autofill-setup.html, section 2, with the owner's change that there is
// no separate step after a vault is created: the card is how a new person learns about AutoFill).
//
// Three layers, so the decisions can be tested without a device:
//  - `AutoFillReminder` and `AutoFillMemory`: pure values. What is shown, what the button does, what is remembered.
//  - `AutoFillSystem` and `AutoFillMemoryStore`: the two things that touch the outside, behind protocols.
//  - `AutoFillStatus`: the observable object the views read. It runs the system calls and applies the pure rules.

/// What the system says about AutoFill for Psss.
enum AutoFillReading: Equatable, Sendable {
    /// Nothing has been asked yet.
    case notRead
    case on
    case off
    /// The system gave no answer. Nothing is claimed either way.
    case unreadable
}

/// The device word the copy uses.
enum AutoFillDevice: Equatable, Sendable { case iPhone, iPad, mac }

/// Which vault is open. The reminder belongs to a real vault: the sample vault registers no logins, so nothing can be filled.
enum AutoFillVault: Equatable, Sendable { case none, sample, real }

/// What this device remembers, per device and never in the vault file: another device must not inherit any of it.
struct AutoFillMemory: Codable, Equatable, Sendable {
    /// When Later was chosen. The card stays away for `AutoFillReminder.snoozeInterval` from then, and returns if AutoFill is
    /// still off. Cleared whenever AutoFill is seen on.
    var snoozedAt: Date?
    /// The system's own prompt has been used for this stretch of AutoFill being off. It is asked for once; afterwards the
    /// button opens Settings. Cleared when AutoFill is seen on, so a later switch-off can be asked about once more.
    var promptUsed = false
    /// AutoFill was seen on at least once. An off after that reads "off again".
    var seenOn = false
    /// The latest reading was off. A reading of on after it is news: the confirmation is shown once.
    var lastSeenOff = false

    /// Whether Later still holds at `now`. A date in the future (the clock was set back) does not hold.
    func isSnoozed(at now: Date) -> Bool {
        guard let snoozedAt else { return false }
        let elapsed = now.timeIntervalSince(snoozedAt)
        return elapsed >= 0 && elapsed < AutoFillReminder.snoozeInterval
    }

    /// Records a reading. Returns true when AutoFill has just come on after it was last seen off.
    @discardableResult
    mutating func observe(_ reading: AutoFillReading) -> Bool {
        switch reading {
        case .on:
            let cameOn = lastSeenOff
            seenOn = true
            lastSeenOff = false
            snoozedAt = nil
            promptUsed = false
            return cameOn
        case .off:
            lastSeenOff = true
            return false
        case .notRead, .unreadable:
            return false
        }
    }
}

/// What the card and Setup show and do, from what is known now. Pure.
struct AutoFillReminder: Equatable, Sendable {
    enum Headline: Equatable, Sendable {
        /// First time off.
        case off
        /// The system prompt was used and AutoFill is still off: the steps are in words.
        case stillOff
        /// It was on before and was turned off.
        case offAgain
    }

    enum Display: Equatable, Sendable {
        case nothing
        case card(Headline)
        case confirmation
    }

    /// What the card's main button does.
    enum Action: Equatable, Sendable {
        /// Ask through the system's prompt. Once.
        case askSystem
        /// Open the AutoFill page in Settings.
        case openSettings
    }

    var vault: AutoFillVault
    var reading: AutoFillReading
    var memory: AutoFillMemory
    /// AutoFill was found on after it was off, and Done has not been chosen. Lasts until the app is closed.
    var confirmationPending = false
    /// The time the snooze is judged against. Injected so a test can move it.
    var now = Date()

    /// How long Later keeps the card away (owner, 2026-11-23: Later snoozes, it does not hide for good). A week: long enough
    /// not to nag a person who is busy or still deciding, short enough that a reminder about a switch that does nothing until it
    /// is on is not forgotten.
    static let snoozeInterval: TimeInterval = 7 * 24 * 60 * 60

    /// A real vault only, and never an alert, a badge or a notification: this is plain content in the list.
    var display: Display {
        guard vault == .real else { return .nothing }
        switch reading {
        case .on:
            return confirmationPending ? .confirmation : .nothing
        case .off:
            if memory.isSnoozed(at: now) { return .nothing }
            if memory.promptUsed { return .card(.stillOff) }
            return .card(memory.seenOn ? .offAgain : .off)
        case .notRead, .unreadable:
            return .nothing
        }
    }

    var action: Action { Self.action(reading: reading, promptUsed: memory.promptUsed) }

    /// The system's prompt once while AutoFill is off, then Settings. Setup follows the same rule, whatever the vault.
    static func action(reading: AutoFillReading, promptUsed: Bool) -> Action {
        reading == .off && !promptUsed ? .askSystem : .openSettings
    }

    /// The last line of the empty vault. While the card shows, or AutoFill is on, it is the short line about saving from
    /// Safari. When AutoFill is off and the card is snoozed, the longer line that says to turn it on stays.
    var emptyVaultOffersSaving: Bool { !(vault == .real && reading == .off && display == .nothing) }
}

/// The words of the card and of Setup. Same on every platform, with the device and Settings named for the one it runs on.
struct AutoFillCopy: Equatable, Sendable {
    let device: AutoFillDevice

    private var deviceName: String {
        switch device {
        case .iPhone: String(localized: "iPhone")
        case .iPad: String(localized: "iPad")
        case .mac: String(localized: "Mac")
        }
    }

    private var settingsName: String { device == .mac ? String(localized: "System Settings") : String(localized: "Settings") }

    /// The way to the switch, in words, to follow a colon or "yourself:".
    var steps: String {
        device == .mac
            ? String(localized: "open System Settings, choose General, choose AutoFill & Passwords, then switch on Psss")
            : String(localized: "open Settings, tap General, tap AutoFill & Passwords, then switch on Psss")
    }

    // MARK: Card

    func title(_ headline: AutoFillReminder.Headline) -> String {
        switch headline {
        case .off: String(localized: "AutoFill is off")
        case .stillOff: String(localized: "AutoFill is still off")
        case .offAgain: String(localized: "AutoFill is off again")
        }
    }

    func body(_ headline: AutoFillReminder.Headline) -> String {
        switch headline {
        case .off:
            String(localized: "Psss keeps your logins. Your \(deviceName) fills them in Safari and apps, and it needs your OK once. Until then, nothing fills.")
        case .stillOff:
            String(localized: "Nothing fills yet. To turn it on yourself: \(steps).")
        case .offAgain:
            String(localized: "AutoFill was turned off in \(settingsName), so Psss cannot fill logins right now.")
        }
    }

    var confirmationTitle: String { String(localized: "AutoFill is on") }

    var confirmationBody: String {
        device == .mac
            ? String(localized: "Open Safari, go to a sign-in page and click the password field. Choose Psss from the menu.")
            : String(localized: "Open a website and tap the password field. Choose Psss from the suggestions.")
    }

    func buttonLabel(_ action: AutoFillReminder.Action) -> String {
        switch action {
        case .askSystem: String(localized: "Turn On AutoFill")
        case .openSettings: String(localized: "Open AutoFill Settings…")
        }
    }

    var laterLabel: String { String(localized: "Later") }
    var doneLabel: String { String(localized: "Done") }
    var laterNotice: String { String(localized: "Psss will remind you in a week. AutoFill stays in Setup.") }

    // MARK: Alert when Settings did not open

    var settingsFailedTitle: String {
        device == .mac ? String(localized: "System Settings did not open") : String(localized: "Settings did not open")
    }

    var settingsFailedMessage: String {
        device == .mac
            ? String(localized: "Open System Settings yourself. Choose General, choose AutoFill & Passwords, then switch on Psss.")
            : String(localized: "Open the Settings app yourself. Tap General, tap AutoFill & Passwords, then switch on Psss.")
    }

    // MARK: Setup

    /// The passive status line. Nil before the first reading, so nothing wrong is claimed for a moment.
    func setupStatus(_ reading: AutoFillReading) -> String? {
        switch reading {
        case .notRead: nil
        case .on: String(localized: "AutoFill is on")
        case .off: String(localized: "AutoFill is off")
        case .unreadable: String(localized: "Psss cannot tell if AutoFill is on")
        }
    }

    func setupDetail(_ reading: AutoFillReading) -> String? {
        switch reading {
        case .notRead: nil
        case .on: String(localized: "Psss fills your logins in Safari and apps.")
        case .off: String(localized: "Psss cannot fill logins in Safari or apps yet.")
        case .unreadable: String(localized: "Open \(settingsName) to check. Your vault is fine.")
        }
    }

    func setupFooter(_ reading: AutoFillReading, promptUsed: Bool) -> String? {
        switch reading {
        case .notRead: nil
        case .on: String(localized: "Passwords and passkeys are switched in \(settingsName), General, AutoFill & Passwords.")
        case .off:
            promptUsed
                ? String(localized: "Psss cannot turn it on for you. To do it yourself: \(steps).")
                : String(localized: "Your \(deviceName) does the filling, and it needs your OK once. Psss cannot turn it on for you.")
        case .unreadable: String(localized: "If this stays, Safari still shows whether Psss fills.")
        }
    }
}

// MARK: - The outside

/// The system calls, behind a protocol so a test uses a stand-in.
protocol AutoFillSystem: Sendable {
    /// Whether Psss is switched on for AutoFill. Nil when the system gave no answer.
    func isEnabled() async -> Bool?
    /// Asks through the system's prompt. True when AutoFill for Psss is on afterwards. The system takes one request per
    /// 10 seconds, so the caller asks once and then opens Settings.
    func requestToTurnOn() async -> Bool
    /// Opens the AutoFill page in Settings. False when the system could not open it.
    func openSettings() async -> Bool
}

/// Where this device keeps `AutoFillMemory`.
protocol AutoFillMemoryStore {
    func load() -> AutoFillMemory
    func save(_ memory: AutoFillMemory)
}

/// A store that keeps the memory in the process only. Used by tests and as a stand-in.
final class InMemoryAutoFillMemory: AutoFillMemoryStore {
    private(set) var memory: AutoFillMemory
    init(_ memory: AutoFillMemory = AutoFillMemory()) { self.memory = memory }
    func load() -> AutoFillMemory { memory }
    func save(_ memory: AutoFillMemory) { self.memory = memory }
}

#if HOSTLESS_TESTS
/// Hostless tests never reach the real credential identity store or Settings.
struct UnavailableAutoFillSystem: AutoFillSystem {
    func isEnabled() async -> Bool? { nil }
    func requestToTurnOn() async -> Bool { false }
    func openSettings() async -> Bool { false }
}
#else
/// The real system. `ASCredentialIdentityStore.getState` is the only way to learn the state: there is no change notification,
/// so the app asks when it opens, unlocks and becomes active.
struct LiveAutoFillSystem: AutoFillSystem {
    func isEnabled() async -> Bool? {
        await ASCredentialIdentityStore.shared.state().isEnabled
    }

    func requestToTurnOn() async -> Bool {
        await withCheckedContinuation { continuation in
            // The prompt is user interface, so it is asked for on the main thread.
            DispatchQueue.main.async {
                ASSettingsHelper.requestToTurnOnCredentialProviderExtension { continuation.resume(returning: $0) }
            }
        }
    }

    func openSettings() async -> Bool {
        do {
            try await ASSettingsHelper.openCredentialProviderAppSettings()
            return true
        } catch {
            return false
        }
    }
}

/// Local app preferences of this device (not the App Group, not the vault file, not synced).
struct DefaultsAutoFillMemory: AutoFillMemoryStore {
    private static let key = "autoFillReminder"

    func load() -> AutoFillMemory {
        UserDefaults.standard.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(AutoFillMemory.self, from: $0) } ?? AutoFillMemory()
    }

    func save(_ memory: AutoFillMemory) {
        if let data = try? JSONEncoder().encode(memory) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}
#endif

// MARK: - What the views read

/// One shared reading of AutoFill for every screen, and the actions that change it.
@MainActor
@Observable
final class AutoFillStatus {
    private(set) var reading: AutoFillReading = .notRead
    private(set) var memory: AutoFillMemory
    /// AutoFill was found on after it was off. Shown once, in place of the card, until Done. Not kept across launches.
    private(set) var confirmationPending = false
    /// The line that says the card will come back and where AutoFill stays meanwhile. Goes away by itself.
    private(set) var laterNoticeShown = false
    /// A system call is running. The button ignores a second press.
    private(set) var working = false
    /// Settings could not be opened. The vault screen shows one alert for it, then clears this.
    var settingsDidNotOpen = false

    @ObservationIgnored private let system: any AutoFillSystem
    @ObservationIgnored private let store: any AutoFillMemoryStore
    @ObservationIgnored private let clock: @Sendable () -> Date

    init(system: any AutoFillSystem, store: any AutoFillMemoryStore, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.system = system
        self.store = store
        self.clock = clock
        memory = store.load()
    }

    /// The real system and this device's preferences. Under hostless tests: nothing is reachable.
    static func live() -> AutoFillStatus {
        #if HOSTLESS_TESTS
        AutoFillStatus(system: UnavailableAutoFillSystem(), store: InMemoryAutoFillMemory())
        #else
        AutoFillStatus(system: LiveAutoFillSystem(), store: DefaultsAutoFillMemory())
        #endif
    }

    func reminder(for vault: AutoFillVault) -> AutoFillReminder {
        AutoFillReminder(vault: vault, reading: reading, memory: memory, confirmationPending: confirmationPending, now: clock())
    }

    /// What the main button does now, in the card and in Setup.
    var action: AutoFillReminder.Action { AutoFillReminder.action(reading: reading, promptUsed: memory.promptUsed) }

    /// Asks the system. At launch, after unlock and whenever the app becomes active: there is nothing to wait on.
    func refresh() async {
        let enabled = await system.isEnabled()
        apply(Self.makeReading(from: enabled))
    }

    /// The main button of the card and of Setup: the system's prompt the first time, Settings after that.
    func performAction() async {
        guard !working else { return }
        working = true
        defer { working = false }
        switch action {
        case .askSystem:
            // The card keeps its words until the system's prompt returns: the answer decides what it says next. The use of the
            // prompt is remembered as soon as it returns, whatever the answer, and `working` blocks a second press meanwhile
            // (the system takes one request per 10 seconds). A prompt answered by leaving the app returns in the same way.
            let accepted = await system.requestToTurnOn()
            update { $0.promptUsed = true }
            if accepted {
                apply(.on, announce: true)
            } else {
                // The answer is only a yes or a no. The state says what is true now.
                let enabled = await system.isEnabled()
                apply(Self.makeReading(from: enabled), announce: enabled == true)
            }
        case .openSettings:
            let opened = await system.openSettings()
            if !opened { settingsDidNotOpen = true }
        }
    }

    /// Later: the card comes back after `AutoFillReminder.snoozeInterval` if AutoFill is still off. Seeing AutoFill on ends it.
    func snooze() {
        let now = clock()
        update { $0.snoozedAt = now }
        laterNoticeShown = true
    }

    func dismissLaterNotice() { laterNoticeShown = false }
    func dismissConfirmation() { confirmationPending = false }

    private static func makeReading(from enabled: Bool?) -> AutoFillReading {
        switch enabled {
        case true?: .on
        case false?: .off
        case nil: .unreadable
        }
    }

    /// `announce` forces the confirmation, for a yes the person has just given.
    private func apply(_ new: AutoFillReading, announce: Bool = false) {
        var updated = memory
        let cameOn = updated.observe(new)
        reading = new
        switch new {
        case .on: if cameOn || announce { confirmationPending = true }
        case .off, .unreadable, .notRead: confirmationPending = false
        }
        save(updated)
    }

    private func update(_ change: (inout AutoFillMemory) -> Void) {
        var updated = memory
        change(&updated)
        save(updated)
    }

    private func save(_ updated: AutoFillMemory) {
        guard updated != memory else { return }
        memory = updated
        store.save(updated)
    }
}
