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
