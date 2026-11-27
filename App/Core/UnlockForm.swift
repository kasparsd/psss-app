import SwiftUI

// The pieces of the unlock form, shared by the app's lock screen and the AutoFill sheet (plan
// `vault-switcher-and-extension-style`, section 3): a notice under the field, the vault password field, and the Key file row.
// They hold no state of their own; the screen decides when each shows. Nothing here reads or keeps a secret beyond the text
// binding it is handed.

/// The one warning symbol: an orange triangle beside the words, with no coloured box. The words beside it say what is wrong.
struct WarningSymbol: View {
    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).accessibilityHidden(true)
    }
}

/// A notice under the unlock buttons (owner, 2026-11-24, mock `#/unlock-screen` section 5): progress, a wrong password and every
/// other message as a symbol and words, with no coloured box (owner, 2026-11-26). An orange triangle for a problem (red is kept for
/// deletion), a grey circled i for information, a spinner for progress.
struct LockNotice: View {
    enum Kind { case progress, warning, info }
    let kind: Kind
    var title: LocalizedStringKey?
    let text: String
    /// One labeled button under the words, for the way out the notice names ("Choose Key File…"). Nil leaves it out.
    var action: (title: LocalizedStringKey, run: () -> Void)?

    private var spoken: String { kind == .warning ? String(localized: "Warning: \(text)") : text }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                switch kind {
                case .progress: ProgressView().controlSize(.small)
                case .warning: WarningSymbol()
                case .info: Image(systemName: "info.circle").foregroundStyle(.secondary)
                }
            }
            .frame(width: 22, height: 22)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let title { Text(title).fontWeight(.medium) }
                Text(verbatim: text).foregroundStyle(title == nil ? .primary : .secondary)
                if let action {
                    Button(action.title, action: action.run).buttonStyle(.bordered).foregroundStyle(.primary).padding(.top, 4)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: kind == .warning && action == nil ? .ignore : .combine)
        .accessibilityLabel(kind == .warning && action == nil ? Text(verbatim: spoken) : Text(verbatim: ""))
        .onAppear { if kind == .warning { AccessibilityNotification.Announcement(spoken).post() } }
    }
}


/// The vault password field: a plain secure field in a bordered, darker box so it reads as a place to type, with the accent
/// colour on focus.
struct UnlockPasswordField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    /// Dimmed and not editable while the password is checked. It is not disabled then: that would close the keyboard and move
    /// the whole screen.
    var working = false
    /// Not editable (the file is missing).
    var disabled = false
    let onSubmit: () -> Void

    /// Input fields are darker than the grey rows around them, with a visible edge.
    static var fill: Color {
        #if os(macOS)
        Color(nsColor: .textBackgroundColor)
        #else
        Color(uiColor: .secondarySystemBackground)
        #endif
    }

    var body: some View {
        SecureField("Vault Password", text: working ? .constant(text) : $text)
            .textFieldStyle(.plain)
            .focused(focused)
            .onSubmit {
                onSubmit()
                #if os(iOS)
                // Return closes the keyboard by itself; it stays up so the screen does not move.
                Task { @MainActor in focused.wrappedValue = true }
                #endif
            }
            .disabled(disabled)
            .padding(12)
            .background(Self.fill, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .strokeBorder(focused.wrappedValue ? Color.accentColor : Color.secondary.opacity(0.4), lineWidth: focused.wrappedValue ? 2 : 1))
            .opacity(working ? 0.5 : 1)
    }
}

/// The Key file row (mock `#/unlock-screen`, frames T, W, X to Z). Show it only when the vault is known to use a key file
/// (`VaultReference.usesKeyFile`) or after the person chose "Choose Key File…" from the wrong-password notice: `UnlockKeyFile.shows`.
/// "Choose…" before a file is chosen; after, the file's name (cut in the middle), "Change…" and a remove button.
struct KeyFileRow: View {
    /// The chosen file's name, nil before a choice.
    let fileName: String?
    let choose: () -> Void
    let remove: () -> Void

    var body: some View {
        PopUpRow("Key file") {
            HStack(spacing: 10) {
                if let fileName {
                    Text(verbatim: DisplayText.safe(fileName)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Button(action: remove) { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Remove key file"))
                        .help("Remove key file")
                }
                Button(fileName == nil ? "Choose…" : "Change…", action: choose)
            }
        }
    }
}

/// When the Key file row shows: the vault is known to use a key file, a key file is chosen, or the person asked for one after a
/// wrong password. Never a standing control for a vault that does not use one.
enum UnlockKeyFile {
    static func shows(usesKeyFile: Bool, chosen: Bool, requested: Bool) -> Bool { usesKeyFile || chosen || requested }
    /// The wrong-password notice offers "Choose Key File…" only while the row is not already on the screen.
    static func offersChoice(rowShown: Bool) -> Bool { !rowShown }
}

/// Marks the notice under the unlock buttons, so `UnlockStack` leaves it out of the centring.
struct UnlockNoticePart: LayoutValueKey {
    static let defaultValue = false
}

/// A lock screen's column, centred in at least `minHeight` as if it had no notice: a notice appears below the buttons and nothing
/// above it moves. A layout, so the position is right in the same pass in which the notice or the keyboard changes the sizes (a
/// measured height kept in state arrived a frame late and the screen jumped).
struct UnlockStack: Layout {
    var minHeight: CGFloat
    private let spacing: CGFloat = 16
    private let inset: CGFloat = 24

    private func measure(_ subviews: Subviews, width: CGFloat) -> (sizes: [CGSize], height: CGFloat, top: CGFloat) {
        let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
        var height: CGFloat = 0, notice: CGFloat = 0
        for (index, size) in sizes.enumerated() {
            let step = size.height + (index == 0 ? 0 : spacing)
            height += step
            if subviews[index][UnlockNoticePart.self] { notice += step }
        }
        return (sizes, height, max(inset, (minHeight - (height - notice)) / 2))
    }

    private func width(_ proposal: ProposedViewSize) -> CGFloat {
        guard let width = proposal.width, width.isFinite else { return 340 }
        return width
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = width(proposal)
        let measured = measure(subviews, width: width)
        return CGSize(width: width, height: max(minHeight, measured.top + measured.height + inset))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let measured = measure(subviews, width: bounds.width)
        var y = bounds.minY + measured.top
        for (subview, size) in zip(subviews, measured.sizes) {
            subview.place(at: CGPoint(x: bounds.midX, y: y), anchor: .top,
                          proposal: ProposedViewSize(width: bounds.width, height: size.height))
            y += size.height + spacing
        }
    }
}

/// The unlock form for one vault (plan `mail-style-vaults`, slice U; mock `#/unlock-screen`, `#/vault-switcher` frames E, E2, I).
/// One view for the full lock screen and for the content area beside the sidebar: an optional title ("Unlock Work"), the password
/// field, the Key file row, the actions and the notice slot.
///
/// Actions: on the Mac and in regular width (iPad) one row, `[Unlock] [Use Touch ID]`, Unlock first; on iPhone Unlock above and
/// Use Face ID below, both full width. Unlock is the default button and stays disabled until there is a password (`canUnlock`).
/// The biometric button shows only when `biometry` is non-nil, which the caller sets only when biometric unlock is set up for
/// this vault. The form holds no state and keeps no secret beyond the password binding. It never starts a biometric prompt itself:
/// `useBiometrics` is the explicit ask, and the automatic one is `View.biometricAutoPrompt` (UnlockBiometrics.swift).
struct UnlockForm<Notice: View, KeyFile: View>: View {
    /// The vault's name for the title "Unlock <name>". Nil leaves the title out (the full lock screen draws its own header).
    var vaultName: String?
    @Binding var password: String
    var focused: FocusState<Bool>.Binding
    /// Non-nil: biometric unlock is set up for this vault; names the button ("Use Touch ID").
    var biometry: BiometryKind?
    /// A check or an attempt is running: field, buttons and links are held still.
    var working = false
    /// The field cannot be edited (the vault file is missing).
    var fieldDisabled = false
    /// Something to unlock with is entered (a password or a key file).
    var canUnlock: Bool
    let unlock: () -> Void
    let useBiometrics: () -> Void
    /// Set when the vault file is missing: "Locate Vault File…" takes the place of the Unlock row.
    var locateFile: (() -> Void)?
    /// "Forgot Password" and "Help" below the actions; nil leaves each out.
    var forgotPassword: (() -> Void)?
    var help: (() -> Void)?
    @ViewBuilder var notice: Notice
    @ViewBuilder var keyFile: KeyFile
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private var sideBySide: Bool {
        #if os(iOS)
        sizeClass == .regular
        #else
        true
        #endif
    }

    /// The parts without a stack of their own: the screen puts them in its `UnlockStack`.
    var body: some View {
        if let vaultName {
            Text("Unlock \(vaultName)").font(.title2.weight(.semibold)).multilineTextAlignment(.center)
        }
        UnlockPasswordField(text: $password, focused: focused, working: working, disabled: fieldDisabled, onSubmit: submit)
        keyFile.disabled(working)
        actions
        // Under the buttons, so Unlock stays where it is when a notice appears (owner, 2026-11-26).
        notice.layoutValue(key: UnlockNoticePart.self, value: true)
        if forgotPassword != nil || help != nil {
            HStack(spacing: 8) {
                if let forgotPassword { Button("Forgot Password", action: forgotPassword) }
                if let help { Button("Help", action: help) }
            }
            .buttonStyle(.bordered).foregroundStyle(.primary).disabled(working)
        }
    }

    private func submit() { if canUnlock && !working { unlock() } }

    @ViewBuilder private var actions: some View {
        if let locateFile {
            Button(action: locateFile) { Label("Locate Vault File…", systemImage: "folder").frame(maxWidth: .infinity) }
                .modifier(PrimaryActionStyle())
        } else if sideBySide {
            HStack(spacing: 12) { unlockButton; biometricButton }
        } else {
            VStack(spacing: 12) { unlockButton; biometricButton }
        }
    }

    private var unlockButton: some View {
        Button(action: unlock) { Text("Unlock").frame(maxWidth: .infinity) }
            .modifier(PrimaryActionStyle())
            .disabled(working || !canUnlock)
            .keyboardShortcut(.defaultAction)
    }

    @ViewBuilder private var biometricButton: some View {
        if let biometry {
            Button(action: useBiometrics) { Text("Use \(biometry.label)").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(working)
        }
    }
}

/// The prominent action: filled with the accent colour on iPhone and iPad, the system's default button on the Mac.
private struct PrimaryActionStyle: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.controlSize(.large)
        #else
        content.buttonStyle(.borderedProminent).controlSize(.large)
        #endif
    }
}
