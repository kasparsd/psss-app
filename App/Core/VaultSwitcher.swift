import SwiftUI

/// Where a vault menu is shown. The same rows everywhere; the sections after them differ (owner, 2026-11-25, mock
/// `#/vault-switcher` section 3).
enum VaultMenuContext {
    /// The app window's menu (iPhone, and iPad with the sidebar hidden): every vault in the fixed order, the current one checked;
    /// a section named for the current vault with "Vault Settings…" and "Lock <name>"; then the three add items.
    case app
    /// The lock screen's pop-up: header "Vault", the rows, the three add items. No current-vault section: nothing is open.
    case lockScreen
    /// AutoFill and the browser: header naming the current vault, the rows, nothing else (adding a vault is done in the app).
    case `extension`
}

/// The three ways to add a vault (owner, 2026-11-25, mock `#/vault-switcher` and `#/settings`). The chooser sheet is gone: each
/// place that adds a vault (Settings, the vault switcher, the sidebar, the File menu, the lock screens) names one of these and
/// starts that flow directly with `.addVaultFlow`.
enum AddVaultChoice: Hashable, Identifiable {
    /// A new, empty vault: its form asks for a name and a password.
    case create
    /// A KeePass file from Files, iCloud Drive or another folder.
    case open
    /// A new vault made from an Apple Passwords export (a CSV file).
    case importPasswords

    var id: Self { self }

    /// The words of the row that starts it (iOS) and of its push button (Mac).
    var title: LocalizedStringKey {
        switch self {
        case .create: "Create a New Vault"
        case .open: "Open a Vault File"
        case .importPasswords: "Import from Apple Passwords"
        }
    }

    var buttonTitle: LocalizedStringKey {
        switch self {
        case .create: "Create…"
        case .open: "Open…"
        case .importPasswords: "Import…"
        }
    }

    /// The footer under the "Add Vault" group, the same everywhere.
    static var footer: LocalizedStringKey {
        "Create makes a new, empty vault. Open adds a KeePass file from iCloud Drive or another folder. Import makes a new vault from an Apple Passwords export; exports are not encrypted, so delete the file afterwards."
    }
}

extension AddVaultChoice {
    /// The three ways to add a vault, in the order every menu and Settings list them.
    static let all: [AddVaultChoice] = [.create, .open, .importPasswords]

    /// The words of the menu item (File menu, vault menu, sidebar foot).
    var menuTitle: LocalizedStringKey {
        switch self {
        case .create: "New Vault…"
        case .open: "Open Vault File…"
        case .importPasswords: "Import from Apple Passwords…"
        }
    }
}

/// The rows of the vault menu, shared by the app, the unlock screens and the extensions (owner, 2026-11-24, mock
/// `#/vault-states`). Each vault shows its name (cut in the middle when long), under it where it is kept or the words of its
/// `VaultState`, a check on the shown one and, on a vault that is not open, the state's glyph: closed padlock or the warning
/// triangle. An open vault has no padlock (owner, 2026-11-25): several can be open at once.
///
/// `lock` is the app's lock action and is used only in the `.app` context; `addVault` is the last row and only the `.app` and
/// `.lockScreen` contexts show it. Not available vaults stay selectable: choosing one shows its lock screen, where the way out is.
struct VaultMenuItems: View {
    let session: VaultSession
    var context = VaultMenuContext.extension
    let choose: (UUID) -> Void
    /// Starts one of the three add flows. The `.app` and `.lockScreen` contexts list them as the last section.
    var add: ((AddVaultChoice) -> Void)?
    /// The old single "Add Vault…" row, for a caller that has not moved to `add` yet. Ignored when `add` is given.
    var addVault: (() -> Void)?
    /// "Lock <name>", in the `.app` context: locks the shown vault only.
    var lock: (() -> Void)?
    /// "Lock All Vaults", in the `.app` context, listed only while two or more vaults are open.
    var lockAll: (() -> Void)?
    /// "Vault Settings…", in the `.app` context: Settings at the current vault's page.
    var settings: (() -> Void)?

    var body: some View {
        let current = session.reference
        let currentName = VaultName.short(current?.name ?? String(localized: "Vault"))
        switch context {
        case .app:
            Section { rows(current) }
            if lock != nil || settings != nil {
                Section {
                    if let settings { Button(String(localized: "Vault Settings…"), systemImage: "gearshape", action: settings) }
                    if let lock { Button(String(localized: "Lock \(currentName)"), systemImage: "lock", action: lock) }
                    if let lockAll, session.openVaults.count >= 2 { Button(String(localized: "Lock All Vaults"), systemImage: "lock", action: lockAll) }
                } header: { Text(verbatim: currentName) }
            }
        case .lockScreen:
            Section { rows(current) } header: { Text("Vault") }
        case .extension:
            Section { rows(current) } header: { Text(verbatim: currentName) }
        }
        if context != .extension, add != nil || addVault != nil {
            Section {
                if let add {
                    ForEach(AddVaultChoice.all) { choice in Button(choice.menuTitle) { add(choice) } }
                } else if let addVault {
                    Button("Add Vault…", action: addVault)
                }
            }
        }
    }

    /// One Button per vault, its label a plain title Text, subtitle Text and image. A `Toggle` or a `Label` with two Texts loses
    /// the second line in an iOS menu (found in the simulator, 2026-11-25); a Button's title and subtitle Texts keep it.
    ///
    /// The row's one glyph: a checkmark on the shown vault, otherwise, for a vault that is not open, its state glyph (closed
    /// padlock, or the warning triangle when it is not available). An open vault has none. A menu row has room for one glyph,
    /// so the shown vault's padlock is not drawn; its state is in the words under its name when it has any ("Needs vault
    /// password", "Not found"), and the Vault row beside the menu shows the padlock or the warning triangle.
    @ViewBuilder private func rows(_ current: VaultReference?) -> some View {
        ForEach(session.knownVaults, id: \.id) { vault in
            let isActive = vault.id == current?.id
            let state = session.state(of: vault)
            Button {
                if !isActive { choose(vault.id) }
            } label: {
                // A plain title, subtitle and image, as an iOS menu draws a row with a second line (not a Label).
                Text(verbatim: VaultName.short(vault.name))
                Text(verbatim: state.subtitle(location: vault.menuLocation))
                if isActive { Image(systemName: "checkmark") } else if state != .open { Image(systemName: state.symbol) }
            }
            .accessibilityValue(Text(verbatim: (isActive ? String(localized: "Current vault. ") : "") + state.spoken))
        }
    }
}

/// The one control for choosing a vault: a menu button with the vault icon (a stack of disks).
struct VaultSwitcher: View {
    enum Style {
        /// The glyph alone, as the Settings gear is: iPhone. A standard toolbar symbol with the spoken label "Vault: <name>" and a tooltip.
        case icon
        /// The open vault's name and the icon: the AutoFill picker and the browser popup on Mac and iPad.
        case name
        /// The open vault's name and a chevron, for the Vault row of the AutoFill screens (owner, 2026-11-24, mock `#/autofill`).
        case row
        /// "Choose Vault" and the icon: the unlock screens (owner, 2026-11-24).
        case choose
        /// The vault glyph and the vault's name, tail-cut, with a chevron: iPad with the sidebar hidden (owner, 2026-11-25). The
        /// toolbar drops the name when the room runs out; the spoken label never changes.
        case capsule
    }

    let session: VaultSession
    var style = Style.icon
    /// Where the menu is shown. Defaults to AutoFill and the browser (no Lock, no Add Vault…); the app passes `.app`, the lock
    /// screen `.lockScreen`.
    var context = VaultMenuContext.extension
    let choose: (UUID) -> Void
    var add: ((AddVaultChoice) -> Void)?
    var addVault: (() -> Void)?
    /// The app's lock, for "Lock <name>" in the current vault's section of the `.app` menu.
    var lock: (() -> Void)?
    /// "Lock All Vaults" in that section while two or more vaults are open.
    var lockAll: (() -> Void)?
    /// "Vault Settings…" in that section.
    var settings: (() -> Void)?

    static let symbol = "cylinder.split.1x2"

    /// The name as the capsule shows it: cut after about 11 characters, the full name being the spoken label.
    static func capsuleName(_ name: String) -> String {
        name.count > 12 ? String(name.prefix(11)).trimmingCharacters(in: .whitespaces) + "…" : name
    }

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
            VaultMenuItems(session: session, context: context, choose: choose, add: add, addVault: addVault, lock: lock, lockAll: lockAll, settings: settings)
        } label: {
            switch style {
            case .icon:
                Label("Vault: \(name)", systemImage: Self.symbol).labelStyle(.iconOnly)
            case .capsule:
                Label(Self.capsuleName(name), systemImage: Self.symbol).labelStyle(.titleAndIcon).lineLimit(1)
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
        .accessibilityLabel(style == .icon || style == .capsule ? Text("Vault: \(name)") : style == .name || style == .row ? Text("Vault: \(name). Switch Vault") : Text("Choose Vault"))
        .help(style == .icon || style == .capsule ? Text("Vault: \(name)") : style == .choose ? Text("Choose a vault") : Text("Switch vault"))
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
        // The label and the control are one unit, centred under the centred title (owner, 2026-11-25). Pinning the colon to the
        // centre line made a short label and a long vault name look shifted to the right.
        HStack(spacing: 8) {
            Text(label) + Text(verbatim: ":")
            content.buttonStyle(.bordered).foregroundStyle(.primary)
            trailing
        }
        .fixedSize()
        .frame(maxWidth: .infinity)
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
/// - `state`: the current vault's `VaultState` (`session.state(of:)`). `unlock` is drawn only for a locked vault
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
    /// Starts one of the three add flows (the lock screen's pop-up ends with them).
    var add: ((AddVaultChoice) -> Void)?
    /// The old single "Add Vault…" row, used only while `add` is nil.
    var addVault: (() -> Void)?

    var body: some View {
        let name = VaultName.short(session.reference?.name ?? String(localized: "Vault"))
        PopUpRow("Vault", labelInside: true) {
            VaultSwitcher(session: session, style: .row, context: context, choose: choose, add: add, addVault: addVault)
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
