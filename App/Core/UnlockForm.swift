import SwiftUI

// The pieces of the unlock form, shared by the app's lock screen and the AutoFill sheet (plan
// `vault-switcher-and-extension-style`, section 3): a notice under the field, the vault password field, and the Key file row.
// They hold no state of their own; the screen decides when each shows. Nothing here reads or keeps a secret beyond the text
// binding it is handed.

/// A notice under the password field (owner, 2026-11-24, mock `#/unlock-screen` section 5): progress, a wrong password and every
/// other message in one tinted card with a filled symbol. Orange for a problem (red is kept for deletion), blue for information, a
/// spinner for progress.
struct LockNotice: View {
    enum Kind { case progress, warning, info }
    let kind: Kind
    var title: LocalizedStringKey?
    let text: String
    /// One labeled button under the words, for the way out the notice names ("Choose Key File…"). Nil leaves it out.
    var action: (title: LocalizedStringKey, run: () -> Void)?

    private var tint: Color {
        switch kind {
        case .progress: .secondary
        case .warning: .orange
        case .info: .accentColor
        }
    }

    private var spoken: String { kind == .warning ? String(localized: "Warning: \(text)") : text }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                switch kind {
                case .progress: ProgressView().controlSize(.small)
                case .warning: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                case .info: Image(systemName: "info.circle.fill").foregroundStyle(Color.accentColor)
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
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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
    /// Dimmed while the password is checked.
    var working = false
    /// Not editable (the file is missing, or a check is running).
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
        SecureField("Vault Password", text: $text)
            .textFieldStyle(.plain)
            .focused(focused)
            .onSubmit(onSubmit)
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
