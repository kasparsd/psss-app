import Foundation

/// The remembered vaults behind the lock screen's vault selector: opening or creating another vault keeps the one before it,
/// switching swaps them, forgetting removes one for good. Returns how many checks failed.
@MainActor func runRememberedVaultTests() async -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    let session = VaultSession()
    session.forget()
    for vault in VaultReference.remembered { VaultReference.forget(vault.id) }

    do {
        try await session.create(name: "Remember A", credentials: .init(password: "pw"), items: [])
        let a = session.reference!
        verify("a single vault has nobody remembered next to it", session.remembered.isEmpty && session.knownVaults.map(\.id) == [a.id])

        try await session.create(name: "Remember B", credentials: .init(password: "pw"), items: [])
        let b = session.reference!
        verify("creating another vault keeps the first one", session.remembered.map(\.id) == [a.id] && VaultReference.remembered.map(\.id) == [a.id])
        verify("the active vault is listed first", session.knownVaults.map(\.name) == ["Remember B", "Remember A"])
        verify("both vaults' files can be found", a.isReachable && b.isReachable)

        session.switchTo(a.id)
        verify("switching makes the other vault active and keeps this one", session.reference?.id == a.id && VaultReference.load()?.id == a.id
               && session.remembered.map(\.id) == [b.id] && session.store == nil)
        session.switchTo(a.id)
        verify("switching to the active vault changes nothing", session.reference?.id == a.id && session.remembered.map(\.id) == [b.id])
        session.switchTo(UUID())
        verify("an unknown vault is ignored", session.reference?.id == a.id)

        // The browser popup's switch: the same list as the app's menu with each vault's state, a switch that locks and changes the
        // vault without unlocking it, and an unlock that goes through the app's own flows.
        let listed = { BrowserVaultSwitch.vaults(session).map { "\($0.name):\($0.active):\($0.state.rawValue)" } }
        verify("browser list: names, current first, a vault with no saved key needs its password", listed() == ["Remember A:true:needs-password", "Remember B:false:needs-password"]
               && BrowserVaultSwitch.vaults(session).first?.reason == .off)
        var asked = 0
        var switchOutcome = BrowserVaultSwitch.switchVault(id: b.id.uuidString, session: session, lock: { asked += 1 })
        verify("browser switch: current everywhere, the open vault locked first, nothing unlocked", switchOutcome == .switched && session.reference?.id == b.id && asked == 1 && !session.isOpen)
        switchOutcome = BrowserVaultSwitch.switchVault(id: b.id.uuidString, session: session, lock: { asked += 10 })
        verify("browser switch to the current vault changes nothing", switchOutcome == .switched && asked == 1)
        switchOutcome = BrowserVaultSwitch.switchVault(id: a.id.uuidString, session: session, lock: {})
        verify("browser switch back: current app-wide", switchOutcome == .switched && session.reference?.id == a.id && VaultReference.load()?.id == a.id)
        switchOutcome = BrowserVaultSwitch.switchVault(id: UUID().uuidString, session: session, lock: {})
        verify("browser switch to an unknown vault", switchOutcome == .notFound)
        var forwards = 0
        var unlockOutcome = await BrowserVaultSwitch.unlockVault(id: a.id.uuidString, session: session, touchID: { .unlocked }, bringForward: { forwards += 1; return true })
        verify("browser unlock of a vault that needs its password brings the app forward", unlockOutcome == .cameForward && forwards == 1)
        unlockOutcome = await BrowserVaultSwitch.unlockVault(id: a.id.uuidString, session: session, touchID: { .unlocked }, bringForward: { false })
        verify("browser unlock when the app cannot come forward says so", unlockOutcome == .needsApp)
        unlockOutcome = await BrowserVaultSwitch.unlockVault(id: b.id.uuidString, session: session, touchID: { .unlocked }, bringForward: { true })
        verify("browser unlock of another vault than the current one is refused", unlockOutcome == .notCurrent)
        unlockOutcome = await BrowserVaultSwitch.unlockVault(id: UUID().uuidString, session: session, touchID: { .unlocked }, bringForward: { true })
        verify("browser unlock of an unknown vault", unlockOutcome == .notFound)
        verify("browser list reads the stored vaults without a session", StoredVaultService().vaults().map(\.name) == ["Remember A", "Remember B"]
               && StoredVaultService().vaults().allSatisfy { !$0.isOpen } && StoredVaultService().switchVault(id: b.id.uuidString) == .unsupported)
        verify("browser unlock from the Safari extension needs the app", StoredVaultService().unlockVault(id: a.id.uuidString) == .needsApp
               && StoredVaultService().unlockVault(id: b.id.uuidString) == .notCurrent && StoredVaultService().unlockVault(id: UUID().uuidString) == .notFound)

        try await session.unlock(credentials: .init(password: "pw"))
        verify("the switched-to vault unlocks with its own password", session.isOpen && session.store?.title == "Remember A")

        session.forget()
        verify("forgetting the active vault promotes the remembered one", session.reference?.id == b.id && VaultReference.load()?.id == b.id
               && session.remembered.isEmpty)
        verify("the forgotten vault's file is gone", !a.isReachable)

        let stale = a
        stale.persist()
        verify("a forgotten vault cannot be brought back from a stale copy", VaultReference.load()?.id == b.id && VaultReference.remembered.isEmpty)

        try await session.create(name: "Remember C", credentials: .init(password: "pw"), items: [])
        let c = session.reference!
        VaultReference.forget(b.id)
        verify("forgetting a remembered vault removes only it", VaultReference.remembered.isEmpty && VaultReference.load()?.id == c.id)

        session.forget()
        verify("with none left the welcome screen shows (no reference)", session.reference == nil && VaultReference.load() == nil
               && session.remembered.isEmpty)
    } catch {
        failed += 1
        print("FAIL remembered vaults threw \(error)")
    }
    return failed
}

/// The person-facing vault states (`VaultState`): the mapping from facts, the words and glyphs, the safe name, and the state of
/// real vault references. Returns how many checks failed.
@MainActor func runVaultStateTests() async -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    typealias S = VaultState

    // Mapping: every combination of the facts.
    func state(_ file: VaultFileCondition, _ quick: QuickUnlock, current: Bool = true, unlocked: Bool = false) -> S {
        S(file: file, quickUnlock: quick, isCurrent: current, isUnlocked: unlocked)
    }
    verify("state: the unlocked current vault is open", state(.available, .ready, unlocked: true) == .open)
    verify("state: open wins over a quick unlock that is off", state(.available, .off, unlocked: true) == .open)
    verify("state: a vault that is not the current one is never open", state(.available, .ready, current: false, unlocked: true) == .locked)
    verify("state: locked with a ready saved key", state(.available, .ready) == .locked)
    verify("state: quick unlock off needs the password", state(.available, .off) == .needsPassword(.off))
    verify("state: a lost key needs the password", state(.available, .lost) == .needsPassword(.lost))
    verify("state: a saved key the system cannot ask for needs the password", state(.available, .unavailableNow) == .needsPassword(.unavailableNow))
    for quick in [QuickUnlock.ready, .off, .lost, .unavailableNow] {
        verify("state: a file that is not downloaded is not available (\(quick))", state(.notDownloaded, quick) == .notDownloaded)
        verify("state: a file that is not found is not available (\(quick))", state(.notFound, quick) == .notFound)
        verify("state: a file that cannot be read is not available (\(quick))", state(.unreadable, quick) == .unreadable)
    }

    // Words and glyphs.
    verify("words: open and locked show where the file is kept", S.open.subtitle == nil && S.locked.subtitle == nil
           && S.locked.subtitle(location: "iCloud Drive") == "iCloud Drive")
    verify("words: needs password", S.needsPassword(.lost).subtitle == "Needs vault password"
           && S.needsPassword(.off).subtitle(location: "x") == "Needs vault password")
    verify("words: not available reasons", S.notDownloaded.subtitle == "Not downloaded yet" && S.notFound.subtitle == "Not found"
           && S.unreadable.subtitle == "Can’t be read")
    verify("glyphs: open padlock, closed padlock, warning", S.open.symbol == "lock.open" && S.locked.symbol == "lock"
           && S.needsPassword(.off).symbol == "lock" && [S.notDownloaded, .notFound, .unreadable].allSatisfy { $0.symbol == "exclamationmark.triangle" })
    verify("available: only the three file states are not", S.open.isAvailable && S.locked.isAvailable && S.needsPassword(.off).isAvailable
           && ![S.notDownloaded, .notFound, .unreadable].contains { $0.isAvailable })
    verify("unlock button: only for a locked vault", S.locked.isLocked && S.needsPassword(.lost).isLocked && !S.open.isLocked
           && ![S.notDownloaded, .notFound, .unreadable].contains { $0.isLocked })
    verify("spoken labels name the reason", S.open.spoken == "Unlocked" && S.locked.spoken == "Locked" && S.notFound.spoken == "Not available, not found")
    verify("notice: why a password is needed", S.needsPassword(.off).passwordNotice(name: "Work", method: "Face ID") == "Face ID is off for Work."
           && S.needsPassword(.lost).passwordNotice(name: "Work", method: "Face ID") == "Face ID changed since Work was set up."
           && S.needsPassword(.unavailableNow).passwordNotice(name: "Work", method: "Face ID") == "Face ID is locked out right now."
           && S.locked.passwordNotice(name: "Work", method: "Face ID") == nil && S.notFound.passwordNotice(name: "Work", method: "Face ID") == nil)

    // The facts of a reference.
    var reference = VaultReference(name: "Facts", managed: true, bookmark: nil, fileName: "facts-state-test.kdbx")
    verify("quick unlock: off by default", reference.quickUnlock() == .off)
    reference.biometricUnlock = true
    verify("quick unlock: ready when saved", reference.quickUnlock() == .ready && reference.quickUnlock(usable: false) == .unavailableNow)
    reference.biometricUnlock = false; reference.biometricStale = true
    verify("quick unlock: lost when the key went stale", reference.quickUnlock() == .lost)
    verify("file: a managed vault with no file is not found", reference.fileCondition() == .notFound)
    var unbookmarked = reference
    unbookmarked.managed = false; unbookmarked.bookmark = nil
    verify("file: a vault with no bookmark is not found", unbookmarked.fileCondition() == .notFound)
    var junk = reference
    junk.managed = false; junk.bookmark = Data("not a bookmark".utf8)
    verify("file: a bookmark that does not resolve is not found", junk.fileCondition() == .notFound)

    // Real vaults through a session.
    let session = VaultSession()
    session.forget()
    for vault in VaultReference.remembered { VaultReference.forget(vault.id) }
    do {
        try await session.create(name: "State A", credentials: .init(password: "pw"), items: [])
        let a = session.reference!
        try await session.create(name: "State B", credentials: .init(password: "pw"), items: [])
        let b = session.reference!
        verify("session: the open vault is open", session.state(of: b, unlocked: true) == .open)
        verify("session: another vault is locked (quick unlock off here), even while this one is open",
               session.state(of: a, unlocked: true) == .needsPassword(.off))
        verify("session: the current vault, locked", session.state(of: b, unlocked: false) == .needsPassword(.off))
        verify("session: unreadable is clear before any failed open", session.unreadable.isEmpty && b.fileCondition() == .available)
        verify("file: a damaged file reads as unreadable once known", b.fileCondition(knownUnreadable: true) == .unreadable
               && session.state(of: b, unlocked: false) != .unreadable)
        // A file that is not a vault: opening it fails and the session remembers.
        let url = VaultFiles.managedURL(fileName: b.fileName)
        let original = try Data(contentsOf: url)
        try Data("this is not a vault".utf8).write(to: url)
        session.lock()
        _ = try? await session.unlock(credentials: .init(password: "pw"))
        verify("session: a file that is not a vault becomes Can’t be read", session.unreadable.contains(b.id)
               && session.state(of: b, unlocked: false) == .unreadable)
        try original.write(to: url)
        try await session.unlock(credentials: .init(password: "pw"))
        verify("session: opening it again clears the mark", !session.unreadable.contains(b.id) && session.state(of: b, unlocked: true) == .open)
        try FileManager.default.removeItem(at: url)
        verify("session: a deleted file is not found", session.state(of: b, unlocked: false) == .notFound)
        session.forget()
        session.forget()
    } catch {
        failed += 1
        print("FAIL vault states threw \(error)")
    }

    // Names: a vault's name is the person's text and may be hostile.
    verify("name: plain", VaultName.short("Work") == "Work")
    verify("name: newlines and tabs become one space", VaultName.short("Work\n\nTaxes\t2026") == "Work Taxes 2026")
    verify("name: bidirectional controls and zero-width characters are removed", VaultName.short("Wo\u{202E}rk\u{200B}") == "Work")
    verify("name: nothing left falls back to Vault", VaultName.short("\u{202E}\n") == "Vault" && VaultName.short("") == "Vault")
    let long = "Quarterly-" + String(repeating: "x", count: 200) + "-final.kdbx"
    let cut = VaultName.short(long)
    verify("name: a long name is cut in the middle and keeps its start", cut.count <= VaultName.maxLength && cut.hasPrefix("Quarterly-") && cut.contains("…"))
    verify("name: a huge name stays one line", !VaultName.short(String(repeating: "ab\n", count: 50_000)).contains("\n"))
    verify("name: the sentence form is the same safe text", VaultName.sentence("A\nB") == "A B")

    return failed
}

/// Two vaults created back to back (the Add Vault flow): each keeps its own items and file, a vault never shows another's items,
/// and the suggested name of a new vault is "Passwords" only while no vault has that name. Returns how many checks failed.
@MainActor func runBackToBackVaultTests() async -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    let session = VaultSession()
    session.forget()
    for vault in VaultReference.remembered { VaultReference.forget(vault.id) }
    let cloudRoot = VaultFiles.storageRoot.appendingPathComponent("icloud-stand-in-two", isDirectory: true)
    setenv("PSSS_TEST_ICLOUD_ROOT", cloudRoot.path, 1)
    defer { unsetenv("PSSS_TEST_ICLOUD_ROOT") }

    func titles(_ store: KeePassVaultStore?) -> [String] { (store?.items() ?? []).map(\.title).sorted() }
    do {
        for location in [VaultLocation.thisDevice, .iCloudDrive] {
            let personal = VaultItem(kind: .login, title: "Personal login", account: "alex@example.net", website: "https://example.com", secret: "pw-personal")
            try await session.create(name: "Passwords", credentials: .init(password: "pw-a"), items: [personal], location: location)
            let a = session.reference!
            let storeA = session.store
            verify("[\(location)] the first vault holds its item", titles(storeA) == ["Personal login"])

            // Add Vault → Create "Work": the new vault is open, empty, in its own file, and the first one is untouched.
            let work = VaultItem(kind: .login, title: "Work login", account: "work@example.net", website: "https://work.example", secret: "pw-work")
            try await session.create(name: "Work", credentials: .init(password: "pw-b"), items: [], location: location)
            let b = session.reference!
            verify("[\(location)] the new vault is another vault with another file", a.id != b.id && a.fileName != b.fileName)
            verify("[\(location)] the new vault is empty, not showing the first vault's items", titles(session.store) == [])
            verify("[\(location)] the open store is the new vault's, not the first vault's", session.store !== storeA && session.store?.title == "Work")
            try session.store?.save([work])
            verify("[\(location)] an item saved now goes to Work", titles(session.store) == ["Work login"])

            // Each file opens only with its own password and holds only its own items.
            session.lock()
            let url = { (r: VaultReference) -> URL in r.managed ? VaultFiles.managedURL(fileName: r.fileName) : cloudRoot.appendingPathComponent(r.fileName) }
            let fileA = try KDBX.open(Data(contentsOf: url(a)), credentials: .init(password: "pw-a"))
            let fileB = try KDBX.open(Data(contentsOf: url(b)), credentials: .init(password: "pw-b"))
            verify("[\(location)] the first file holds only Personal login", fileA.items().map(\.title) == ["Personal login"])
            verify("[\(location)] the second file holds only Work login", fileB.items().map(\.title) == ["Work login"])

            // Switch and unlock each, the way the lock screen and the AutoFill extension do.
            session.switchTo(a.id)
            try await session.unlock(credentials: .init(password: "pw-a"))
            verify("[\(location)] after switching, the first vault shows its own items", session.reference?.id == a.id && titles(session.store) == ["Personal login"])
            session.lock()
            session.switchTo(b.id)
            try await session.unlock(credentials: .init(password: "pw-b"))
            verify("[\(location)] after switching back, Work shows its own items", session.reference?.id == b.id && titles(session.store) == ["Work login"])
            session.lock()

            session.forget(); session.forget()
            for vault in VaultReference.remembered { VaultReference.forget(vault.id) }
        }
    } catch {
        failed += 1
        print("FAIL back-to-back vaults threw \(error)")
    }

    verify("suggested name: Passwords when no vault has it", VaultName.suggested(among: []) == "Passwords" && VaultName.suggested(among: ["Work"]) == "Passwords")
    verify("suggested name: empty when Passwords exists", VaultName.suggested(among: ["Work", "Passwords"]).isEmpty
           && VaultName.suggested(among: [" passwords "]).isEmpty)
    return failed
}
