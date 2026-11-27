import SwiftUI
import UniformTypeIdentifiers

/// First launch, before anything is locked or shown: start a vault, open one, or bring passwords from another app.
/// Every action is a visible, labeled button. Sources that are not built yet say so instead of pretending.
struct WelcomeView: View {
    let session: VaultSession
    /// Called with the vault source to open: "kdbx" (a real encrypted vault) or "sample".
    let onFinish: (String) -> Void

    @Environment(AppleImportRequests.self) private var imports
    @State private var picking = false
    @State private var comingSoon: String?
    @State private var fileProblem: String?
    @State private var creating = false

    @ViewBuilder
    private func choice(_ title: LocalizedStringKey, _ symbol: String, prominent: Bool = false,
                        action: @escaping () -> Void) -> some View {
        let label = Label(title, systemImage: symbol).frame(maxWidth: .infinity, alignment: .leading)
        if prominent {
            Button(action: action) { label }.buttonStyle(.borderedProminent).controlSize(.large)
        } else {
            Button(action: action) { label }.buttonStyle(.bordered).controlSize(.large)
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    WelcomeIcon()
                    Text("Psss for your secrets")
                        .font(.largeTitle.weight(.semibold))
                        .multilineTextAlignment(.center)
                    Text("The quickest storage and autofill for your logins and passwords.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 10) {
                    choice("Create a vault", "plus", prominent: true) { creating = true }
                    choice("Open a vault file", "folder") { picking = true }
                    choice("Import from Apple Passwords", "square.and.arrow.down") { imports.start() }
                    choice("Import from 1Password", "square.and.arrow.down") {
                        comingSoon = String(localized: "Importing a 1Password .1pux export is not built yet.")
                    }
                    choice("Try a sample vault", "sparkles") { onFinish("sample") }
                }
            }
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        // Centred in a tall window (iPad, Mac); it still scrolls from the top when large text makes it taller than the window.
        .defaultScrollAnchor(.center, for: .alignment)
        .background(.background)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.keePassVault, .data]) { result in
            // The file is added to the list, locked, and its unlock form follows: no password is asked here.
            guard let url = try? result.get() else { return }
            do { try session.add(fileAt: url); onFinish(RootView.keePassSource) }
            catch { fileProblem = (error as? KDBXError)?.message ?? (error as? VaultStoreError)?.message ?? String(localized: "Psss could not read that file.") }
        }
        .sheet(isPresented: $creating) {
            NewVaultSheet(session: session) { onFinish(RootView.keePassSource) }
        }
        .alert("Nothing was added", isPresented: Binding(get: { fileProblem != nil }, set: { if !$0 { fileProblem = nil } })) {
            Button("OK") { fileProblem = nil }
        } message: { Text(fileProblem ?? "") }
        .alert("Not available yet", isPresented: Binding(get: { comingSoon != nil }, set: { if !$0 { comingSoon = nil } })) {
            Button("OK") { comingSoon = nil }
        } message: { Text(comingSoon ?? "") }
    }
}


extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// The app icon on the welcome screen. It opens on the name, “psss”, and a moment later hides it as a password field would
/// (p and three dots), where it rests. A tap types the name again, holds it about a second and hides it: a small hint that
/// the icon is a field. The tap does nothing else. VoiceOver reads an image named Psss. Reduce Motion is honoured by
/// `LogoField`, which then changes the letters at once.
private struct WelcomeIcon: View {
    @State private var shown = true
    @State private var taps = 0

    var body: some View {
        LockAppIcon(shown: shown, size: 88)
            .contentShape(RoundedRectangle(cornerRadius: 88 * 0.2237, style: .continuous))
            .onTapGesture { taps += 1 }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: "Psss"))
            .accessibilityAddTraits(.isImage)
            .task(id: taps) {
                if taps > 0 { shown = true }
                try? await Task.sleep(for: .milliseconds(taps == 0 ? 900 : 1300))
                guard !Task.isCancelled else { return }
                shown = false
            }
            .padding(.bottom, 4)
    }
}
