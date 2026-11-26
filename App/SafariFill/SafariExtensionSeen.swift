import Foundation

/// The App Group of the iPhone and iPad app and its extensions. The Safari extension compiles this folder and not
/// `SharedVault`, so the identifier is here too; `scripts/test-safari-fill.sh` checks that the two agree.
enum SafariFillAppGroup {
    static let id = "group.app.psss"
}

/// Where the "seen" note is kept: the App Group's preferences, behind a protocol so a test uses a stand-in.
protocol SafariExtensionSeenStore {
    func bool(forKey key: String) -> Bool
    func set(_ value: Bool, forKey key: String)
}

extension UserDefaults: SafariExtensionSeenStore {}

/// The note the Safari web extension leaves for the app on iPhone and iPad when Safari runs it. iOS cannot say whether a Safari
/// extension is on, so this is all the app knows: seen means it has run, not that it is still on. Once written it stays.
/// It holds no vault data. The iOS extension's handler (`Extensions/SafariIOS`) calls `SafariExtensionSeen().record()`.
/// The Mac asks Safari instead and never reads this.
struct SafariExtensionSeen {
    private static let key = "safariExtensionSeen"
    var store: (any SafariExtensionSeenStore)? = UserDefaults(suiteName: SafariFillAppGroup.id)

    func record() { store?.set(true, forKey: Self.key) }

    /// False when nothing was recorded, or there is no App Group.
    func read() -> Bool { store?.bool(forKey: Self.key) ?? false }
}
