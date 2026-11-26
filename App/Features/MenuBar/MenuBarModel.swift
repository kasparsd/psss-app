#if os(macOS) && DEBUG
import AppKit
import ApplicationServices
import LocalAuthentication
import SwiftUI

enum MenuBarTab: Hashable { case search, generate, newLogin }

/// The browsers macOS can be asked for the front tab's address.
struct MenuBarBrowser: Sendable {
    let id: String
    let name: String
    /// How its AppleScript dictionary names the front tab.
    let tab: String

    static let all = [MenuBarBrowser(id: "com.apple.Safari", name: "Safari", tab: "current tab"),
                      MenuBarBrowser(id: "com.google.Chrome", name: "Chrome", tab: "active tab")]
    /// Browsers the prototype cannot read: Firefox and Zen need the Psss extension, and the other Chromium browsers are not in the
    /// sandbox exception yet. They still count as browsers, so none is matched to a login by its name.
    static let unread = ["org.mozilla.firefox": "Firefox", "app.zen-browser.zen": "Zen", "company.thebrowser.Browser": "Arc",
                         "com.brave.Browser": "Brave", "com.microsoft.edgemac": "Microsoft Edge", "com.kagi.kagimacOS": "Orion",
                         "com.vivaldi.Vivaldi": "Vivaldi", "com.operasoftware.Opera": "Opera", "org.chromium.Chromium": "Chromium"]
}

/// What is known about the page in the app that was in front when the panel opened.
enum MenuBarPage: Equatable {
    case notBrowser
    case reading
    case notAsked
    case declined
    case denied
    case unreadable
    /// Allowed, but there is no web page (no window, an empty tab, the browser just quit).
    case none
    case host(String)

    var host: String? { if case .host(let host) = self { host } else { nil } }
}

struct MenuBarDraft: Equatable {
    var name = ""
    var website = ""
    var websiteTyped = false
    var username = ""
    var password = ""
    var shown = false
    var saved = false

    var isDirty: Bool { !saved && (!name.isEmpty || !username.isEmpty || !password.isEmpty || (websiteTyped && !website.isEmpty)) }
}

enum MenuBarGenerated: CaseIterable, Hashable { case strong, characters, words, pin, key }

/// Everything the panel keeps between openings. A lock clears it; quitting ends it.
@MainActor
@Observable
final class MenuBarModel {
    let session: VaultSession
    let gate: UnlockGate
    /// Set in the sample run: the panel then shows only this, and never reads or locks the person's vaults.
    let sample: SampleVaultStore?
    let prompter = BiometricPrompter()
    /// Closes the panel. True when Psss itself is about to come forward, which is not time away.
    @ObservationIgnored var close: (_ openingApp: Bool) -> Void = { _ in }
    @ObservationIgnored private var panelOpen = false
    /// Counts locks, so an unlock that was under way when one happened is undone.
    @ObservationIgnored private var locks = 0

    var tab = MenuBarTab.search
    private(set) var query = ""
    private(set) var selection: UUID?
    /// The person typed or picked since this opening; only then does a choice hold while the page is still being read.
    private(set) var chosen = false
    /// The item whose page covers the list in Search; kept between openings until a lock.
    private(set) var opened: UUID?
    /// How far a swipe back has taken that page, 0 to 1, while the fingers or its settling move it.
    var swipe: CGFloat?
    /// Which code button in the list says “Copied”.
    let codes = CodeCopyState()
    /// Counts returns to the list, so the search field takes the keyboard again.
    private(set) var returns = 0
    /// Counts changes to the vault's items, which the store does not announce itself.
    private(set) var revision = 0
    var revealed: Set<String> = []
    var status: String?
    var shortcutTaken = false
    /// Counts openings, so the view can give the search field the keyboard each time.
    private(set) var openings = 0

    // The app in front.
    private(set) var frontName = ""
    private(set) var frontID = ""
    private(set) var page = MenuBarPage.notBrowser
    /// The host last read from this browser, empty when it had none.
    @ObservationIgnored private var lastPage: String?
    @ObservationIgnored private var pageRead = 0

    // Locked.
    var password = ""
    var failure: String?
    private(set) var unlocking = false
    private(set) var away = false

    // New Login, one for each vault.
    var drafts: [UUID: MenuBarDraft] = [:]
    var waiting: [UUID: MenuBarDraft] = [:]
    var saveFailure: SaveFailure?
    private(set) var saving = false

    struct SaveFailure {
        let message: String
        /// The login the failed save was replacing; nil when it was saving a new one. Try Again repeats exactly that.
        let updating: UUID?
        /// False when repeating it could only do something else, such as making a new login.
        var retry = true
    }

    // Generate.
    var settings: [MenuBarGenerated: GeneratorSettings] = [
        .characters: GeneratorSettings(kind: .characters),
        .words: GeneratorSettings(kind: .words),
    ]
    var pinLength = 6
    var keyBytes = 32
    var keyIsBase64 = false
    private(set) var generated: [MenuBarGenerated: GeneratedPassword] = [:]
    private(set) var pin = ""
    private(set) var key = ""

    /// The vault id the sample run uses for its draft.
    private static let sampleID = UUID()

    init(session: VaultSession, gate: UnlockGate, sample: SampleVaultStore?) {
        self.session = session
        self.gate = gate
        self.sample = sample
        regenerateAll()
    }

    // MARK: The vault

    var reference: VaultReference? { sample == nil ? session.reference : nil }
    var vaultID: UUID { reference?.id ?? Self.sampleID }
    var vaultName: String { sample != nil ? String(localized: "Sample vault") : reference?.name ?? "" }
    var hasVault: Bool { sample != nil || reference != nil }

    /// The shown vault's open store; nil while it is locked.
    var store: (any VaultStore)? {
        if let sample { return sample }
        return gate.isUnlocked ? session.store : nil
    }

    var openCount: Int { sample != nil ? 0 : session.openVaults.count }

    func items() -> [VaultItem] {
        _ = revision
        return store?.items() ?? []
    }

    func type(_ text: String) {
        guard text != query else { return }
        query = text; selection = nil; opened = nil; status = nil; chosen = true
    }

    func pick(_ id: UUID) { selection = id; status = nil; chosen = true }

    func open(_ id: UUID) { pick(id); swipe = nil; opened = id }

    func back() {
        guard let id = opened else { return }
        pick(id)
        opened = nil
        swipe = nil
        returns += 1
    }

    func choose(_ id: UUID) {
        guard id != reference?.id else { return }
        forgetAttempt()
        query = ""; selection = nil; opened = nil; status = nil; saveFailure = nil
        session.show(id)
        revision += 1
        // The other vault's file may have changed since it was last read.
        if panelOpen { Task { await reload() } }
    }

    func show(_ tab: MenuBarTab) {
        if tab != self.tab { forgetAttempt() }
        self.tab = tab
        status = nil
    }

    // MARK: Opening and closing

    private var timing: LockTiming {
        (UserDefaults.standard.object(forKey: "lockTiming") as? Int).flatMap(LockTiming.init(rawValue:)) ?? .oneMinute
    }

    func willOpen(appIsActive: Bool) {
        // A lock made elsewhere with no window open leaves the stores open; nothing may stay open behind a lock.
        if sample == nil, !gate.isUnlocked, session.isAnyOpen { session.lockAll() }
        if sample == nil, !appIsActive, gate.decideOnReturn(after: timing) {
            session.lockAll()
            forgetEverything()
            away = true
        }
        let front = NSWorkspace.shared.frontmostApplication
        let id = front?.bundleIdentifier ?? ""
        if id != frontID { query = ""; selection = nil; opened = nil; lastPage = nil }
        chosen = false
        frontID = id
        frontName = id == Bundle.main.bundleIdentifier ? "" : front?.localizedName ?? ""
        status = nil
    }

    func didOpen() {
        panelOpen = true
        openings += 1
        revision += 1
        readPage()
        Task { await reload() }
    }

    func didClose(appIsActive: Bool, openingApp: Bool) {
        panelOpen = false
        swipe = nil
        password = ""
        failure = nil
        status = nil
        prompter.cancel()
        // The lock time counts again from here.
        if !appIsActive, !openingApp { gate.didLeave() }
    }

    /// Picks up what another device or app wrote to the shown vault's file; the window may not be there to do it.
    @discardableResult
    private func reload() async -> Bool {
        guard sample == nil, gate.isUnlocked, let store = session.store else { return true }
        do {
            if try await store.reloadIfChanged() { itemsChanged() }
            return true
        } catch KDBXError.wrongCredentials {
            let notice = String(localized: "The vault was changed by another app or device and needs your vault password again.")
            if session.openVaults.count > 1, let id = reference?.id {
                // Only this vault locks; the other open vaults and their unsaved logins stay.
                session.lock(id)
                session.show(id)
                drafts[id] = nil
                waiting[id] = nil
                forgetAttempt()
                query = ""; selection = nil; opened = nil; revealed = []; saveFailure = nil
                failure = notice
            } else {
                gate.lock(notice: notice)
                session.lockAll()
                forgetEverything()
            }
            return false
        } catch {
            // Missing or unreadable for now: keep what is open; a save reports the problem.
            return true
        }
    }

    private func itemsChanged() {
        revision += 1
        NotificationCenter.default.post(name: .vaultChangedOutsideWindow, object: nil)
    }

    func appLeft() { gate.didLeave() }

    // MARK: Locking

    /// Lock or Lock All, chosen by the person.
    func lockByChoice() {
        session.lockAllByChoice()
        gate.lock()
        forgetEverything()
    }

    /// Sleep or a locked screen.
    func lockForAbsence() {
        guard sample == nil else { return }
        gate.lock()
        session.lockAll()
        forgetEverything()
    }

    func lockIfIdle() -> Bool {
        guard sample == nil, gate.lockIfIdle(after: timing) else { return false }
        session.lockAll()
        forgetEverything()
        return true
    }

    /// Also follows locks made elsewhere (the window, ⌘L, Settings, the browser): whatever closed, what was kept for it goes. When
    /// the gate locks, every vault is closed here too, since the window that would do it may be gone.
    func followLocks() {
        let open = Set(session.openVaults.map(\.id))
        let wasUnlocked = gate.isUnlocked
        withObservationTracking {
            _ = session.openVaults.map(\.id)
            _ = gate.isUnlocked
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                if self.sample == nil, wasUnlocked, !self.gate.isUnlocked {
                    self.session.lockAll()
                    self.forgetEverything()
                }
                let closed = open.subtracting(self.session.openVaults.map(\.id))
                if !closed.isEmpty {
                    for id in closed { self.drafts[id] = nil; self.waiting[id] = nil }
                    self.forgetSecrets()
                }
                self.followLocks()
            }
        }
    }

    private func forgetEverything() {
        locks += 1
        drafts = [:]; waiting = [:]
        forgetSecrets()
    }

    private func forgetSecrets() {
        query = ""; selection = nil; opened = nil; swipe = nil; revealed = []; status = nil; saveFailure = nil
        forgetAttempt()
        regenerateAll()
    }

    // MARK: Unlocking

    func forgetAttempt() { password = ""; failure = nil }

    var canUseBiometrics: Bool { reference?.biometricUnlock == true && BiometryKind.current != nil }

    func unlockWithBiometrics() async {
        guard !unlocking, let reference else { return }
        failure = nil
        let outcome = await prompter.evaluate(reason: String(localized: "Unlock \(reference.name)."))
        // Another vault was chosen while the prompt was up.
        guard session.reference?.id == reference.id else { return }
        switch outcome {
        case .evaluated(let context):
            unlocking = true
            defer { unlocking = false }
            let before = prepareUnlock()
            do {
                try await session.unlockWithBiometrics(evaluated: EvaluatedContext(context: context))
                didUnlock(unless: before)
            } catch {
                failure = String(localized: "That didn’t open \(reference.name). Enter the vault password.")
            }
        case .cancelled: if panelOpen { failure = String(localized: "Touch ID was cancelled.") }
        case .notRecognised, .unavailable: failure = String(localized: "Touch ID did not work. Enter the vault password.")
        }
    }

    func unlockWithPassword() async {
        guard !unlocking, !password.isEmpty, let reference else { return }
        failure = nil
        unlocking = true
        defer { unlocking = false }
        let entered = password
        let before = prepareUnlock()
        do {
            try await session.unlock(credentials: KDBXCredentials(password: entered))
            didUnlock(unless: before)
        } catch {
            password = ""
            failure = String(localized: "That didn’t open \(reference.name). Check Caps Lock and your keyboard language. If this vault uses a key file, unlock it in Psss.")
        }
    }

    /// Behind a locked app nothing may be open: an open store would accept any password.
    private func prepareUnlock() -> Int {
        if !gate.isUnlocked { session.lockAll() }
        return locks
    }

    private func didUnlock(unless before: Int) {
        // The screen locked or the Mac slept while the key was being derived.
        guard locks == before else {
            gate.lock()
            session.lockAll()
            return
        }
        gate.markUnlocked()
        away = false
        selection = nil
        forgetAttempt()
        // Closed in the meantime: the lock time counts from now.
        if !panelOpen, !NSApp.isActive { gate.didLeave() }
    }

    // MARK: Copying

    func copy(_ value: String, as label: String, from item: UUID? = nil) {
        Clipboard.copy(value)
        if let item { store?.markUsed(item) }
        status = String(localized: "\(label) copied. The clipboard clears in 60 seconds.")
    }

    /// A code copied from its button in the list, which puts it on the clipboard itself.
    func codeCopied(_ item: VaultItem) {
        store?.markUsed(item.id)
        status = String(localized: "\(String(localized: "Verification code")) copied. The clipboard clears in 60 seconds.")
    }

    // MARK: The page

    private func readPage() {
        pageRead += 1
        let read = pageRead
        if let name = MenuBarBrowser.unread[frontID] {
            frontName = name
            setPage(.unreadable)
            return
        }
        guard let browser = MenuBarBrowser.all.first(where: { $0.id == frontID }) else { setPage(.notBrowser); return }
        // Until the browser answers, nothing is selected.
        setPage(.reading)
        Task {
            let status = await Self.permission(browser.id, ask: false)
            guard read == pageRead else { return }
            apply(status, browser: browser)
        }
    }

    /// After the person pressed Allow: macOS asks, and the call waits for the answer.
    func allowPage() {
        guard let browser = MenuBarBrowser.all.first(where: { $0.id == frontID }) else { return }
        UserDefaults.standard.set(false, forKey: Self.declinedKey(browser.id))
        pageRead += 1
        let read = pageRead
        Task {
            let status = await Self.permission(browser.id, ask: true)
            guard read == pageRead else { return }
            apply(status, browser: browser)
        }
    }

    func declinePage() {
        UserDefaults.standard.set(true, forKey: Self.declinedKey(frontID))
        setPage(.declined)
    }

    private static func declinedKey(_ id: String) -> String { "menuBarPageDeclined.\(id)" }

    private func apply(_ status: OSStatus, browser: MenuBarBrowser) {
        switch Int(status) {
        case 0: setPage(Self.frontHost(browser).map(MenuBarPage.host) ?? .none)
        case errAEEventNotPermitted: setPage(.denied)
        case errAEEventWouldRequireUserConsent:
            setPage(UserDefaults.standard.bool(forKey: Self.declinedKey(browser.id)) ? .declined : .notAsked)
        default: setPage(.none)
        }
    }

    /// Another page, or none, starts its own search and selection; what was typed or picked since this opening stays.
    private func setPage(_ new: MenuBarPage) {
        page = new
        guard new != .reading, new != .notBrowser else { return }
        let key = new.host ?? ""
        if let lastPage, lastPage != key, !chosen { query = ""; selection = nil; opened = nil }
        lastPage = key
    }

    /// Blocks while the system prompt is up, so it runs off the main thread.
    private static func permission(_ id: String, ask: Bool) async -> OSStatus {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let target = NSAppleEventDescriptor(bundleIdentifier: id)
                continuation.resume(returning: AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask))
            }
        }
    }

    /// Only the host of the front tab is kept, and only in memory.
    private static func frontHost(_ browser: MenuBarBrowser) -> String? {
        // Asking a browser that has quit would start it again.
        guard !NSRunningApplication.runningApplications(withBundleIdentifier: browser.id).isEmpty else { return nil }
        let source = """
        with timeout of 2 seconds
        tell application id "\(browser.id)" to return URL of \(browser.tab) of front window
        end timeout
        """
        var error: NSDictionary?
        guard let text = NSAppleScript(source: source)?.executeAndReturnError(&error).stringValue, error == nil,
              let url = URL(string: text), url.scheme == "https" || url.scheme == "http" else { return nil }
        let host = SiteMatch.normalizedHost(text)
        return host.isEmpty ? nil : host
    }

    // MARK: New Login

    var draft: MenuBarDraft {
        get {
            var draft = drafts[vaultID] ?? MenuBarDraft()
            // Until something is typed, the website follows the page.
            if !draft.isDirty, !draft.saved, !draft.websiteTyped { draft.website = page.host ?? "" }
            return draft
        }
        // A field writing its text back while a lock takes it away must not bring the draft back.
        set { if store != nil { drafts[vaultID] = newValue; saveFailure = nil } }
    }

    /// Starts a new login, asking first when an unsaved one would be replaced.
    func startLogin(website: String, password: String = "") {
        let new = MenuBarDraft(website: website, password: password)
        if draft.isDirty {
            // The same site with nothing new to add: carry on with it.
            if password.isEmpty, SiteMatch.matches(stored: website, requested: draft.website) { waiting[vaultID] = nil }
            else { waiting[vaultID] = new }
        } else {
            drafts[vaultID] = new
            waiting[vaultID] = nil
        }
        show(.newLogin)
    }

    /// The saved logins for the draft's site and username, the exact site first.
    func matches(_ draft: MenuBarDraft) -> [VaultItem] {
        let host = SiteMatch.normalizedHost(draft.website)
        guard !host.isEmpty else { return [] }
        let found = items().filter { $0.kind == .login && $0.account == draft.username && SharedVault.matches($0, host: host) }
        return found.sorted { SiteMatch.normalizedHost($0.website) == host && SiteMatch.normalizedHost($1.website) != host }
    }

    /// Saves a new login, or with `updating` replaces that login's password (the old one stays in its history). The login is read
    /// again from the file first, so an edit made elsewhere is not undone.
    func saveLogin(updating: UUID?) async {
        var draft = self.draft
        let vault = vaultID
        guard !saving, store != nil, !draft.password.isEmpty else { return }
        saving = true
        defer { saving = false }
        saveFailure = nil
        // Locked or switched while reading: nothing is written.
        guard await reload(), vault == vaultID, let store else { return }
        var item: VaultItem
        if let updating {
            guard let current = store.items().first(where: { $0.id == updating }) else {
                saveFailure = SaveFailure(message: String(localized: "That login is no longer in \(vaultName). Nothing was changed."), updating: nil, retry: false)
                return
            }
            item = current
        } else {
            item = VaultItem(kind: .login, title: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
                             account: draft.username, website: draft.website.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        item.secret = draft.password
        do {
            try store.save([item])
            if sample == nil { VaultIdentities.register(vault: vault, items: store.items()) }
            itemsChanged()
            draft.saved = true
            self.draft = draft
        } catch {
            saveFailure = SaveFailure(message: String(localized: "Couldn’t save to \(vaultName). Nothing was changed."), updating: updating)
        }
    }

    // MARK: Generating

    func regenerateAll() { for kind in MenuBarGenerated.allCases { regenerate(kind) } }

    func regenerate(_ kind: MenuBarGenerated) {
        switch kind {
        case .strong: generated[kind] = PasswordGenerator.make(.recommended)
        case .characters, .words: generated[kind] = PasswordGenerator.make(settings[kind] ?? .recommended)
        // `random(in:)` draws from the system's cryptographic generator.
        case .pin: pin = (0..<pinLength).map { _ in String(Int.random(in: 0...9)) }.joined()
        case .key:
            let bytes = (0..<keyBytes).map { _ in UInt8.random(in: .min ... .max) }
            key = keyIsBase64 ? Data(bytes).base64EncodedString() : bytes.map { String(format: "%02x", $0) }.joined()
        }
    }

    func value(of kind: MenuBarGenerated) -> String {
        switch kind {
        case .pin: pin
        case .key: key
        default: generated[kind]?.value ?? ""
        }
    }
}
#endif
