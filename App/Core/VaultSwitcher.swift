import SwiftUI

/// Where a vault menu is shown. The same rows everywhere; the header, "Lock" and "Add Vault…" differ (plan section 2, mock
/// `#/vault-states` A to C).
enum VaultMenuContext {
    /// The app window's dropdown: a header naming the open vault, "Lock <name>" first, the rows, "Add Vault…".
    case app
    /// The lock screen's pop-up: header "Vault", no Lock (nothing is open), the rows, "Add Vault…".
    case lockScreen
    /// AutoFill and the browser: header naming the current vault, the rows, no Lock and no "Add Vault…" (adding a vault is done in the app).
    case `extension`
}

/// The rows of the vault menu, shared by the app, the unlock screens and the extensions (owner, 2026-11-24, mock
/// `#/vault-states`). Each vault shows its name (cut in the middle when long), under it where it is kept or the words of its
/// `VaultState`, a check on the current one and the state's glyph: open padlock, closed padlock or the warning triangle.
///
/// `lock` is the app's lock action and is used only in the `.app` context; `addVault` is the last row and only the `.app` and
/// `.lockScreen` contexts show it. Not available vaults stay selectable: choosing one shows its lock screen, where the way out is.
struct VaultMenuItems: View {
    let session: VaultSession
    /// Whether the active vault is unlocked. Only the active vault ever is.
    let unlocked: Bool
    var context = VaultMenuContext.extension
    let choose: (UUID) -> Void
    var addVault: (() -> Void)?
    var lock: (() -> Void)?

    var body: some View {
        let current = session.reference
        let currentName = VaultName.short(current?.name ?? String(localized: "Vault"))
        if context == .app, let lock {
            Section {
                Button(String(localized: "Lock \(currentName)"), systemImage: "lock", action: lock)
            } header: { Text(verbatim: currentName) }
        } else {
            Section {
                rows(current)
            } header: { context == .lockScreen ? Text("Vault") : Text(verbatim: currentName) }
        }
        if context == .app, lock != nil { Section { rows(current) } }
        if context != .extension, let addVault {
            Section { Button("Add Vault…", action: addVault) }
        }
    }

    /// One Button per vault, its label a plain title Text, subtitle Text and image. A `Toggle` or a `Label` with two Texts loses
    /// the second line in an iOS menu (found in the simulator, 2026-11-25); a Button's title and subtitle Texts keep it.
    ///
    /// The row's one glyph: a checkmark on the current vault, otherwise the vault's state glyph (closed padlock, or the warning
    /// triangle when it is not available). A menu row has room for one glyph, so the current vault's padlock is not drawn; its
    /// state is in the words under its name when it has any ("Needs vault password", "Not found"), and the Vault row beside the
    /// menu shows the padlock or the warning triangle.
    @ViewBuilder private func rows(_ current: VaultReference?) -> some View {
        ForEach(session.knownVaults, id: \.id) { vault in
            let isActive = vault.id == current?.id
            let state = session.state(of: vault, unlocked: unlocked)
            Button {
                if !isActive { choose(vault.id) }
            } label: {
                // A plain title, subtitle and image, as an iOS menu draws a row with a second line (not a Label).
                Text(verbatim: VaultName.short(vault.name))
                Text(verbatim: state.subtitle(location: vault.menuLocation))
                Image(systemName: isActive ? "checkmark" : state.symbol)
            }
            .accessibilityValue(Text(verbatim: (isActive ? String(localized: "Current vault. ") : "") + state.spoken))
        }
    }
}

/// The one control for choosing a vault: a menu button with the vault icon (a stack of disks).
struct VaultSwitcher: View {
    enum Style {
        /// The icon alone, as the Settings gear is: a standard toolbar symbol with a spoken label and a tooltip.
        case icon
        /// The open vault's name and the icon: the AutoFill picker and the browser popup on Mac and iPad.
        case name
        /// The open vault's name and a chevron, for the Vault row of the AutoFill screens (owner, 2026-11-24, mock `#/autofill`).
        case row
        /// "Choose Vault" and the icon: the unlock screens (owner, 2026-11-24).
        case choose
    }

    let session: VaultSession
    let unlocked: Bool
    var style = Style.icon
    /// Where the menu is shown. Defaults to AutoFill and the browser (no Lock, no Add Vault…); the app passes `.app`, the lock
    /// screen `.lockScreen`.
    var context = VaultMenuContext.extension
    let choose: (UUID) -> Void
    var addVault: (() -> Void)?
    /// The app's lock, for "Lock <name>" at the top of the `.app` menu.
    var lock: (() -> Void)?

    static let symbol = "cylinder.split.1x2"

    /// The switcher shows only with two or more vaults, except where `addVault` is the way to a file that is not listed.
    static func isShown(_ session: VaultSession) -> Bool { session.knownVaults.count >= 2 }

    var body: some View {
        let name = VaultName.short(session.reference?.name ?? String(localized: "Vault"))
        #if os(iOS)
        // The row draws its own colours (primary label, accent value); the plain style stops the menu tinting all of it.
        if style == .row { menu(name: name).buttonStyle(.plain) } else { menu(name: name) }
        #else
        menu(name: name)
        #endif
    }

    private func menu(name: String) -> some View {
        Menu {
            VaultMenuItems(session: session, unlocked: unlocked, context: context, choose: choose, addVault: addVault, lock: lock)
        } label: {
            switch style {
            case .icon:
                Label("Vaults", systemImage: Self.symbol).labelStyle(.iconOnly)
            // Plain stacks, not a Label, so the menu button shows the name and not a row's title.
            case .name:
                HStack(spacing: 6) { Image(systemName: Self.symbol); Text(verbatim: name) }
            case .row:
                #if os(iOS)
                // The label spans the whole row, so a tap anywhere on it opens the menu: "Vault" at the left, the name and the
                // up/down chevrons (iOS draws no indicator for a plain label) at the right, as in a Form pop-up row. The row's
                // padding is inside the label, which is why `PopUpRow` is told `labelInside`.
                HStack(spacing: 8) {
                    Text("Vault").foregroundStyle(Color.primary)
                    Spacer(minLength: 12)
                    Text(verbatim: name).foregroundStyle(Color.accentColor)
                    Image(systemName: "chevron.up.chevron.down").fontWeight(.semibold).imageScale(.small).foregroundStyle(Color.accentColor)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
                #else
                Text(verbatim: name)
                #endif
            case .choose:
                HStack(spacing: 6) { Image(systemName: Self.symbol); Text("Choose Vault") }
            }
        }
        #if os(iOS)
        .menuIndicator(style == .icon || style == .row ? .hidden : .visible)
        #else
        .menuIndicator(style == .icon ? .hidden : .visible)
        #endif
        .accessibilityLabel(style == .icon ? Text("Vaults") : style == .name || style == .row ? Text("Vault: \(name). Switch Vault") : Text("Choose Vault"))
        .help(style == .icon ? Text("Vaults") : style == .choose ? Text("Choose a vault") : Text("Switch vault"))
    }
}

/// A labeled row for a value the person can change, as the system draws a pop-up row in a Form: the label on the left, the value
/// or control on the right. On iPhone and iPad it sits in a rounded grey row; on the Mac the control is a bordered pop-up button.
/// Used by the lock screen (Vault, Key file) and the AutoFill screens (Vault), so they match (owner, 2026-11-24).
/// `trailing` is an optional control beside the row (the Vault row's Unlock button): outside the grey row on iPhone and iPad,
/// right next to the pop-up button on the Mac.
struct PopUpRow<Content: View, Trailing: View>: View {
    let label: LocalizedStringKey
    /// iOS only: the content draws the label and the padding itself and fills the row (a menu whose label is the whole row, so
    /// a tap anywhere opens it). The Mac ignores it.
    var labelInside = false
    @ViewBuilder var content: Content
    @ViewBuilder var trailing: Trailing

    init(_ label: LocalizedStringKey, labelInside: Bool = false, @ViewBuilder content: () -> Content, @ViewBuilder trailing: () -> Trailing) {
        self.label = label
        self.labelInside = labelInside
        self.content = content()
        self.trailing = trailing()
    }

    var body: some View {
        #if os(iOS)
        HStack(spacing: 8) {
            Group {
                if labelInside { content } else { row.padding(.horizontal, 16).frame(minHeight: 48) }
            }
                .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            trailing
        }
        #else
        row
        #endif
    }

    @ViewBuilder private var row: some View {
        #if os(macOS)
        // The label and the control meet on the centre line, as in a Mac form: the pair sits under the centred title.
        HStack(spacing: 8) {
            (Text(label) + Text(verbatim: ":")).frame(maxWidth: .infinity, alignment: .trailing)
            HStack(spacing: 8) {
                content.buttonStyle(.bordered).foregroundStyle(.primary)
                trailing
            }
            .fixedSize().frame(maxWidth: .infinity, alignment: .leading)
        }
        #else
        HStack {
            Text(label)
            Spacer(minLength: 12)
            content
        }
        #endif
    }
}

extension PopUpRow where Trailing == EmptyView {
    init(_ label: LocalizedStringKey, labelInside: Bool = false, @ViewBuilder content: () -> Content) {
        self.init(label, labelInside: labelInside, content: content, trailing: { EmptyView() })
    }
}

/// The Vault row: "Vault" and the current vault's name with the pop-up chevrons, and, when the current vault is locked and the
/// caller can unlock it, a labeled **Unlock** button at the trailing end (plan section 2, mock `#/vault-states` D to N).
///
/// Used on the lock screen (no `unlock`: the screen is itself the unlock), on every AutoFill screen and, compact, in the browser
/// popup's header. Show it with two or more vaults (`VaultSwitcher.isShown`); the lock screen shows it always.
///
/// - `state`: the current vault's `VaultState` (`session.state(of:unlocked:)`). `unlock` is drawn only for a locked vault
///   (`.locked`, `.needsPassword`), never for an open one and never for a not available one: the notice under the row says what
///   Psss will do, and the row stays so another vault is one choice away.
/// - `choose`: called with the chosen vault's id (the caller switches, locks and reloads).
/// - `unlock`: what the button does (Face ID again, or the in-place unlock screen); nil leaves the button out.
/// - `context`: `.extension` by default (menu without Lock and Add Vault…); the lock screen passes `.lockScreen` with `addVault`.
struct VaultRow: View {
    let session: VaultSession
    let state: VaultState
    var context = VaultMenuContext.extension
    let choose: (UUID) -> Void
    var unlock: (() -> Void)?
    var addVault: (() -> Void)?

    var body: some View {
        let name = VaultName.short(session.reference?.name ?? String(localized: "Vault"))
        PopUpRow("Vault", labelInside: true) {
            VaultSwitcher(session: session, unlocked: state == .open, style: .row, context: context, choose: choose, addVault: addVault)
        } trailing: {
            if state.isLocked, let unlock {
                Button("Unlock", action: unlock)
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel(Text("Unlock \(name)"))
                    .help(Text("Unlock \(name)"))
            } else if !state.isAvailable {
                // Not available: the warning glyph the menu shows, in the row, and no Unlock (mock `#/autofill`, frames P to R).
                Image(systemName: state.symbol).foregroundStyle(.orange)
                    .accessibilityLabel(Text(verbatim: state.spoken))
                    .help(Text(verbatim: state.spoken))
            }
        }
    }
}
