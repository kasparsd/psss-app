import Foundation

/// The remembered vaults behind the vault lists: creating another vault keeps the one before it (and open), showing a vault changes
/// the current one and nothing else, forgetting removes one for good. Returns how many checks failed.
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
        verify("vaults are listed in the order they were added, not active first", session.knownVaults.map(\.name) == ["Remember A", "Remember B"])
        verify("both vaults' files can be found", a.isReachable && b.isReachable)
        verify("creating another vault leaves the first one open", session.isOpen(a.id) && session.isOpen(b.id) && session.openVaults.map(\.name) == ["Remember A", "Remember B"])
        session.lockAll()
        verify("lock all locks both", !session.isAnyOpen && session.store == nil && session.reference?.id == b.id)

        session.show(a.id)
        verify("switching does not reorder the list", session.knownVaults.map(\.name) == ["Remember A", "Remember B"] && VaultReference.all.map(\.name) == ["Remember A", "Remember B"])
        let drive = URL(fileURLWithPath: "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Work.kdbx")
        let driveRoot = URL(fileURLWithPath: "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Work.kdbx")
        verify("iCloud Drive's container is shown as iCloud Drive", VaultFiles.folderWords(of: drive) == "iCloud Drive › Downloads"
               && VaultFiles.folderWords(of: driveRoot) == "iCloud Drive" && VaultFiles.folderWords(of: URL(fileURLWithPath: "/Users/x/Documents/Work.kdbx")) == nil)
        verify("showing makes the other vault current and keeps this one", session.reference?.id == a.id && VaultReference.load()?.id == a.id
               && session.remembered.map(\.id) == [b.id] && session.store == nil)
        session.show(a.id)
        verify("switching to the active vault changes nothing", session.reference?.id == a.id && session.remembered.map(\.id) == [b.id])
        session.show(UUID())
        verify("an unknown vault is ignored", session.reference?.id == a.id)

        // The browser popup's switch: the same list as the app's menu with each vault's state, a switch that locks and changes the
        // vault without unlocking it, and an unlock that goes through the app's own flows.
        let listed = { BrowserVaultSwitch.vaults(session).map { "\($0.name):\($0.active):\($0.state.rawValue)" } }
        verify("browser list: names, current first, a vault with no saved key needs its password", listed() == ["Remember A:true:needs-password", "Remember B:false:needs-password"]
               && BrowserVaultSwitch.vaults(session).first?.reason == .off)
        var switchOutcome = BrowserVaultSwitch.switchVault(id: b.id.uuidString, session: session)
        verify("browser switch: current everywhere, nothing locked or unlocked", switchOutcome == .switched && session.reference?.id == b.id && !session.isOpen)
        switchOutcome = BrowserVaultSwitch.switchVault(id: b.id.uuidString, session: session)
        verify("browser switch to the current vault changes nothing", switchOutcome == .switched && session.reference?.id == b.id)
        switchOutcome = BrowserVaultSwitch.switchVault(id: a.id.uuidString, session: session)
        verify("browser switch back: current app-wide", switchOutcome == .switched && session.reference?.id == a.id && VaultReference.load()?.id == a.id)
        switchOutcome = BrowserVaultSwitch.switchVault(id: UUID().uuidString, session: session)
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
    func state(_ file: VaultFileCondition, _ quick: QuickUnlock, open: Bool = false) -> S {
        S(file: file, quickUnlock: quick, isOpen: open)
    }
    verify("state: an open vault is open", state(.available, .ready, open: true) == .open)
    verify("state: open wins over a quick unlock that is off", state(.available, .off, open: true) == .open)
    verify("state: a vault that is not open is locked", state(.available, .ready) == .locked)
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
        verify("session: an open vault is open, and so is the one created before it", session.state(of: b) == .open && session.state(of: a) == .open)
        session.lock(a.id)
        verify("session: a locked vault is locked (quick unlock off here), while another is open",
               session.state(of: a) == .needsPassword(.off) && session.state(of: b) == .open)
        session.lock()
        verify("session: the current vault, locked", session.state(of: b) == .needsPassword(.off))
        verify("session: unreadable is clear before any failed open", session.unreadable.isEmpty && b.fileCondition() == .available)
        verify("file: a damaged file reads as unreadable once known", b.fileCondition(knownUnreadable: true) == .unreadable
               && session.state(of: b) != .unreadable)
        // A file that is not a vault: opening it fails and the session remembers.
        let url = VaultFiles.managedURL(fileName: b.fileName)
        let original = try Data(contentsOf: url)
        try Data("this is not a vault".utf8).write(to: url)
        session.lock()
        _ = try? await session.unlock(credentials: .init(password: "pw"))
        verify("session: a file that is not a vault becomes Can’t be read", session.unreadable.contains(b.id)
               && session.state(of: b) == .unreadable)
        try original.write(to: url)
        try await session.unlock(credentials: .init(password: "pw"))
        verify("session: opening it again clears the mark", !session.unreadable.contains(b.id) && session.state(of: b) == .open)
        try FileManager.default.removeItem(at: url)
        session.lock()
        verify("session: a deleted file is not found", session.state(of: b) == .notFound)
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
            session.show(a.id)
            try await session.unlock(credentials: .init(password: "pw-a"))
            verify("[\(location)] after switching, the first vault shows its own items", session.reference?.id == a.id && titles(session.store) == ["Personal login"])
            session.lock()
            session.show(b.id)
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

/// Several vaults open at once (owner, 2026-11-25, slice M1): unlocking adds a vault to the open ones, locking one leaves the others
/// open with their data, lock all locks every vault, the fixed order never changes, removing a vault touches no other vault, a
/// vault file added by Open Vault File… stays locked until it is unlocked, and a file that disappears hurts only its own vault.
/// Also the hostile-input and secrecy checklist of AGENTS.md ("Delegated work and validation") where it applies to session code:
/// vault names with bidirectional controls and newlines are made safe in every message, a missing, unwritable or non-vault file
/// gives a plain message and changes nothing, no secret reaches a state file, and a vault is never open twice in a session (a
/// second unlock does nothing and adding the same file again reuses the vault); two processes writing one file are the store's
/// `changedOnDisk` check, tested with the lifecycle tests in main.swift. `kill -9` at any moment leaves `verify` clean because every
/// write is one atomic replace (VaultFiles.write), tested there too. Returns how many checks failed.
@MainActor func runSeveralOpenVaultTests() async -> Int {
    var failed = 0
    func verify(_ name: String, _ ok: Bool) {
        if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
    }
    let session = VaultSession()
    func reset() {
        session.lockAll()
        while session.reference != nil { session.forget() }
        for vault in VaultReference.remembered { VaultReference.forget(vault.id) }
    }
    reset()
    func titles(_ store: KeePassVaultStore?) -> [String] { (store?.items() ?? []).map(\.title).sorted() }
    let secret = "pw-secret-\(UUID().uuidString)"
    let names = { session.knownVaults.map(\.name) }
    let hostile = "Wo\u{202E}rk\nTaxes\u{200B}" + String(repeating: "x", count: 200)

    do {
        // Three vaults: A and B open (create keeps the vault before it open), C created and locked again.
        try await session.create(name: "Several A", credentials: .init(password: secret), items: [VaultItem(kind: .login, title: "In A", account: "a", website: "https://a.example", secret: "s1")])
        let a = session.reference!
        try await session.create(name: hostile, credentials: .init(password: secret), items: [VaultItem(kind: .login, title: "In B", account: "b", website: "https://b.example", secret: "s2")])
        let b = session.reference!
        try await session.create(name: "Several C", credentials: .init(password: secret), items: [VaultItem(kind: .login, title: "In C", account: "c", website: "https://c.example", secret: "s3")])
        let c = session.reference!
        let order = [a.id, b.id, c.id]
        func orderKept(_ label: String) {
            verify("order: \(label)", session.knownVaults.map(\.id) == order && VaultReference.all.map(\.id) == order)
        }
        verify("three vaults are open together, each with its own items", session.openVaults.map(\.id) == order
               && titles(session.store(for: a.id)) == ["In A"] && titles(session.store(for: b.id)) == ["In B"] && titles(session.store(for: c.id)) == ["In C"])
        orderKept("after creating three")

        // Lock one: the others stay open with their data.
        let storeB = session.store(for: b.id)
        session.lock(c.id)
        verify("lock one: it is locked, the others are open with their data", !session.isOpen(c.id) && session.isOpen(a.id) && session.isOpen(b.id)
               && session.store(for: b.id) === storeB && titles(session.store(for: a.id)) == ["In A"] && titles(session.store(for: b.id)) == ["In B"])
        verify("lock the shown vault: another open vault is shown, the next in the fixed order or the one before", session.reference?.id == b.id)
        orderKept("after locking one")
        session.lock(a.id)
        session.lock(b.id)
        verify("locking the last open vault leaves nothing open and shows no other vault", !session.isAnyOpen && session.store == nil && session.windowStore == nil)
        orderKept("after locking all one by one")

        // Unlock two, one after the other, the way the lock screen does.
        session.show(a.id)
        try await session.unlock(credentials: .init(password: secret))
        verify("unlock A: it is open and shown, the others stay locked", session.isOpen(a.id) && session.reference?.id == a.id && !session.isOpen(b.id) && !session.isOpen(c.id))
        session.show(b.id)
        verify("showing a locked vault while another is open leaves the open one open", session.isOpen(a.id) && !session.isOpen(b.id) && session.store == nil
               && session.windowStore === session.store(for: a.id))
        try await session.unlock(credentials: .init(password: secret))
        verify("unlock B: both are open, each with its own data", session.isOpen(a.id) && session.isOpen(b.id) && titles(session.store(for: a.id)) == ["In A"] && titles(session.store) == ["In B"])
        orderKept("after unlocking two")
        // A vault has one store: unlocking an open vault again does nothing, so there is never a second writer in this session.
        let openB = session.store
        try await session.unlock(credentials: .init(password: "a wrong password that is never tried"))
        verify("unlock of an open vault does nothing: the same store, no second writer", session.store === openB)
        session.show(a.id)
        verify("showing an open vault needs no password and keeps its store", session.store === session.store(for: a.id) && session.isOpen(b.id))
        orderKept("after showing")

        // Lock all.
        session.lockAll()
        verify("lock all: every vault is locked, the shown vault does not change", !session.isAnyOpen && session.reference?.id == a.id)
        orderKept("after lock all")

        // Removing a locked vault while another is open.
        session.show(a.id)
        try await session.unlock(credentials: .init(password: secret))
        verify("C is locked while A is open", !session.isOpen(c.id) && session.isOpen(a.id))
        session.remove(c.id)
        verify("remove a locked vault: it is gone, the open vault is untouched", session.knownVaults.map(\.id) == [a.id, b.id] && session.isOpen(a.id)
               && titles(session.store(for: a.id)) == ["In A"] && !c.isReachable && session.reference?.id == a.id)
        // Removing an open vault: it goes, the other stays open and is shown.
        try await session.unlock(credentials: .init(password: secret)) // A is open already: nothing
        session.show(b.id)
        try await session.unlock(credentials: .init(password: secret))
        verify("both open again", session.isOpen(a.id) && session.isOpen(b.id))
        session.remove(b.id)
        verify("remove an open vault: its store is gone, the other stays open and is shown", session.knownVaults.map(\.id) == [a.id] && !session.isOpen(b.id)
               && session.isOpen(a.id) && session.reference?.id == a.id && titles(session.store) == ["In A"] && !b.isReachable)

        // Open Vault File…: the file is added locked, no password, and unlocking names it from inside.
        let fileURL = VaultFiles.storageRoot.appendingPathComponent("added-by-file-\(UUID().uuidString).kdbx")
        let outside = try KDBX.create(name: "Inside Name", credentials: .init(password: secret))
        outside.upsert([VaultItem(kind: .login, title: "In file", account: "f", website: "https://f.example", secret: "s4")])
        try KDBX.save(outside).write(to: fileURL)
        let added = try session.add(fileAt: fileURL)
        verify("add by file: listed at the end of the fixed order, locked, shown, named after the file, A still open",
               session.knownVaults.map(\.id) == [a.id, added.id] && !session.isOpen(added.id) && session.reference?.id == added.id
               && added.name == fileURL.deletingPathExtension().lastPathComponent && session.isOpen(a.id) && session.store == nil)
        verify("add by file: no Touch ID offered before the first unlock", added.biometricUnlock == false && session.state(of: added) == .needsPassword(.off))
        let again = try session.add(fileAt: fileURL)
        verify("adding the same file again reuses the vault: not listed twice", again.id == added.id && session.knownVaults.count == 2)
        try await session.unlock(credentials: .init(password: secret))
        verify("unlock the added vault: it joins the open ones and takes its name from inside the file", session.isOpen(added.id) && session.isOpen(a.id)
               && session.reference?.name == "Inside Name" && titles(session.store) == ["In file"])
        let again2 = try session.add(fileAt: fileURL)
        verify("adding the file of an open vault shows it and does not lock or duplicate it", again2.id == added.id && session.isOpen(added.id) && session.knownVaults.count == 2)

        // A file that is not a vault, is empty or is missing is refused in plain words and adds nothing.
        let junk = VaultFiles.storageRoot.appendingPathComponent("junk-\(UUID().uuidString).kdbx")
        try Data("this is not a vault".utf8).write(to: junk)
        var refused = ""
        do { _ = try session.add(fileAt: junk) } catch { refused = (error as? KDBXError)?.message ?? "other: \(error)" }
        verify("a file that is not a vault is refused with the plain message and adds nothing", refused == KDBXError.notAVault.message && session.knownVaults.count == 2)
        let empty = VaultFiles.storageRoot.appendingPathComponent("empty-\(UUID().uuidString).kdbx")
        try Data().write(to: empty)
        var emptyRefused = false
        do { _ = try session.add(fileAt: empty) } catch { emptyRefused = true }
        verify("an empty file is refused and adds nothing", emptyRefused && session.knownVaults.count == 2)
        var missingRefused = false
        do { _ = try session.add(fileAt: VaultFiles.storageRoot.appendingPathComponent("not-there-\(UUID().uuidString).kdbx")) } catch { missingRefused = true }
        verify("a missing file is refused and adds nothing", missingRefused && session.knownVaults.count == 2)
        try? FileManager.default.removeItem(at: junk); try? FileManager.default.removeItem(at: empty)

        // A file that disappears while another vault is open.
        session.lock(added.id)
        session.show(added.id)
        try FileManager.default.removeItem(at: fileURL)
        var unlockError: Error?
        do { try await session.unlock(credentials: .init(password: secret)) } catch { unlockError = error }
        verify("a vanished file: unlock fails with the plain 'cannot find' message, the vault is not available, nothing opens",
               (unlockError as? VaultStoreError)?.message == VaultStoreError.fileMissing.message && !session.isOpen(added.id)
               && session.state(of: session.reference!) == .notFound)
        verify("a vanished file does not touch the other open vault", session.isOpen(a.id) && titles(session.store(for: a.id)) == ["In A"])
        try session.store(for: a.id)?.save([VaultItem(kind: .login, title: "Saved meanwhile", account: "m", website: "https://m.example", secret: "s5")])
        verify("the other open vault still saves", titles(session.store(for: a.id)) == ["In A", "Saved meanwhile"])
        session.remove(added.id)
        verify("removing the vanished vault leaves the open vault shown and open", session.knownVaults.map(\.id) == [a.id] && session.reference?.id == a.id && session.isOpen(a.id))

        // An unwritable location: the save is refused in plain words, nothing in memory changed, the vault stays open.
        let directory = VaultFiles.managedDirectory
        let before = titles(session.store(for: a.id))
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        var writeMessage = ""
        do { try session.store(for: a.id)?.save([VaultItem(kind: .login, title: "Cannot be saved", account: "u", website: "https://u.example", secret: "s6")]) }
        catch { writeMessage = (error as? VaultStoreError)?.message ?? "other: \(error)" }
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        verify("an unwritable location: plain message with no raw error and no secret, the vault is as it was and stays open",
               !writeMessage.isEmpty && !writeMessage.hasPrefix("other") && !writeMessage.contains("Domain") && !writeMessage.contains(secret)
               && titles(session.store(for: a.id)) == before && session.isOpen(a.id))
        try session.store(for: a.id)?.save([VaultItem(kind: .login, title: "Saved after", account: "u", website: "https://u.example", secret: "s7")])
        verify("after the location is writable again the vault saves", titles(session.store(for: a.id)).contains("Saved after"))
    } catch {
        failed += 1
        print("FAIL several open vaults threw \(error)")
    }

    // Names are the person's text and may be hostile: every message the session composes is one safe, short line.
    do {
        reset()
        try await session.create(name: hostile, credentials: .init(password: secret), items: [])
        let reference = session.reference!
        let title = session.lockMenuTitle ?? ""
        verify("hostile name: the File menu's lock item is one safe, short line", title.hasPrefix("Lock ") && !title.contains("\n") && !title.contains("\u{202E}")
               && !title.contains("\u{200B}") && title.count <= 5 + VaultName.maxLength)
        verify("hostile name: the short and sentence forms of the name are safe", VaultName.short(reference.name).count <= VaultName.maxLength
               && !VaultName.sentence(reference.name).contains("\n"))
        verify("hostile name: the name is kept as typed in the reference (only shown safely)", reference.name == hostile)
        session.lockAll()
        verify("with nothing open the File menu has no lock", session.lockMenuTitle == nil)
        try await session.create(name: "Menu A", credentials: .init(password: secret), items: [])
        verify("one open vault: the File menu says Lock and its name", session.lockMenuTitle == "Lock Menu A")
        try await session.create(name: "Menu B", credentials: .init(password: secret), items: [])
        verify("a second open vault: Lock All Vaults", session.lockMenuTitle == "Lock All Vaults")
        session.lockForMenu()
        verify("Lock All Vaults locks every vault", !session.isAnyOpen)
    } catch {
        failed += 1
        print("FAIL hostile names threw \(error)")
    }

    // No secret in any state file the session wrote (references, order, the forgotten list): the password and the vault key are not in them.
    do {
        reset()
        try await session.create(name: "Secrecy", credentials: .init(password: secret), items: [])
        session.lockAll()
        try await session.unlock(credentials: .init(password: secret))
        let key = session.store?.transformedKey ?? Data()
        var leaked = false
        let root = VaultFiles.storageRoot
        if let paths = try? FileManager.default.subpathsOfDirectory(atPath: root.path) {
            for path in paths where !path.hasSuffix(".kdbx") {
                let file = root.appendingPathComponent(path)
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue,
                      let data = try? Data(contentsOf: file) else { continue }
                let text = String(decoding: data, as: UTF8.self)
                if text.contains(secret) || (!key.isEmpty && (data.range(of: key) != nil || text.contains(key.base64EncodedString())
                    || text.contains(key.map { String(format: "%02x", $0) }.joined()))) { leaked = true; print("leak in \(file.path)") }
            }
        }
        verify("no secret in any state file: neither the password nor the vault key", !leaked && !key.isEmpty)
        session.lockAll()
    } catch {
        failed += 1
        print("FAIL secrecy threw \(error)")
    }
    reset()
    return failed
}
