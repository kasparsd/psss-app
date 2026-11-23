import Foundation

/// One short explanation shown in an info bubble. Shared by every platform, and listed together in Setup, Help. A topic explains;
/// it never holds what a person must know to act (steps, warnings and consequences stay on the screen).
struct HelpTopic: Identifiable, Hashable {
    /// A reviewed page. https only, no query parameters, nothing from the vault in the address.
    struct Link: Hashable {
        let title: String
        let url: URL
    }

    let id: String
    /// The subject, as in "About verification codes".
    let title: String
    let text: String
    let link: Link?

    var buttonLabel: String { String(localized: "About \(title.lowercased())") }
}

enum HelpTopics {
    /// The reviewed link list. Reviewed each release. A page that does not exist yet (the Psss help pages) has no entry.
    private static let twoFactorDirectory = HelpTopic.Link(title: String(localized: "Which sites offer two-step verification"),
                                                           url: URL(string: "https://2fa.directory/")!)
    private static let aboutPasskeys = HelpTopic.Link(title: String(localized: "About passkeys"),
                                                      url: URL(string: "https://support.apple.com/en-us/102195")!)

    /// The Codes countdown.
    static let verificationCodes = HelpTopic(
        id: "verification-codes", title: String(localized: "Verification codes"),
        text: String(localized: "Each code works for 30 seconds. Most sites also accept the code just before, so one that has just changed usually still works."),
        link: twoFactorDirectory)

    /// The editor's setup key row.
    static let setupKey = HelpTopic(
        id: "setup-key", title: String(localized: "Setup keys"),
        text: String(localized: "When you turn on two-step verification, a site shows a QR code or a setup key. Psss turns it into the six-digit codes, so you do not need a separate app. Keep it secret: anyone who has it can make your codes."),
        link: nil)

    /// The item page's verification code setup section.
    static let codeSetup = HelpTopic(
        id: "code-setup", title: String(localized: "Verification code setup"),
        text: String(localized: "The setup key and link let you move this login's codes to another app. Keep them secret."),
        link: nil)

    static let securityCode = HelpTopic(
        id: "security-code", title: String(localized: "Security codes"),
        text: String(localized: "The three digits on the back of the card, or four on the front of an American Express card. Sites ask for it at checkout."),
        link: nil)

    static let passkeys = HelpTopic(
        id: "passkeys", title: String(localized: "Passkeys"),
        text: String(localized: "A passkey signs you in without a password and only works on the real website. It stays in your vault."),
        link: aboutPasskeys)

    static let recentlyDeleted = HelpTopic(
        id: "recently-deleted", title: String(localized: "Recently Deleted"),
        text: String(localized: "Deleted items stay here for 30 days, then are deleted for good. Older backups of the vault may still contain them."),
        link: nil)

    /// What the code does: `Clipboard.copy` keeps the copy on this device (iPhone and iPad), marks it concealed (Mac) and clears it
    /// after 60 seconds. Other apps on the device can still read it until then.
    static let clipboard = HelpTopic(
        id: "clipboard", title: String(localized: "Copying"),
        text: String(localized: "What you copy stays on the clipboard for 60 seconds, then Psss clears it. Until then, other apps on this device can read it."),
        link: nil)

    /// Everything, in the order Setup lists it.
    static let all: [HelpTopic] = [verificationCodes, setupKey, codeSetup, securityCode, passkeys, recentlyDeleted, clipboard]
}
