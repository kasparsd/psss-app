import SwiftUI
import UniformTypeIdentifiers

/// First launch, before anything is locked or shown: start a vault, open one, or bring passwords from another app.
/// Every action is a visible, labeled button. Sources that are not built yet say so instead of pretending.
struct WelcomeView: View {
    /// Called with the vault source to open: "mine" (own items only) or "sample".
    let onFinish: (String) -> Void

    @State private var importing = false
    @State private var notice: String?
    @State private var comingSoon: String?

    private func choice(_ title: LocalizedStringKey, _ symbol: String, prominent: Bool = false,
                        action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .modifier(Prominent(on: prominent))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Image(systemName: "key.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                    Text("Welcome to Psss")
                        .font(.largeTitle.weight(.semibold))
                    Text("Passwords, passkeys and TOTP codes that stay on your devices.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                VStack(spacing: 10) {
                    choice("Create a vault", "plus", prominent: true) { onFinish("mine") }
                    choice("Open a vault file", "folder") {
                        comingSoon = String(localized: "Opening a .kdbx vault from Files or iCloud Drive is not built yet.")
                    }
                    choice("Import from Apple Passwords", "square.and.arrow.down") { importing = true }
                    choice("Import from 1Password", "square.and.arrow.down") {
                        comingSoon = String(localized: "Importing a 1Password .1pux export is not built yet.")
                    }
                    choice("Try a sample vault", "sparkles") { onFinish("sample") }
                    Text("Exports from other apps are not encrypted. Delete the file after importing.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 6)
                }
            }
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .background(.background)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let parsed = try CSVImport.items(from: String(contentsOf: url, encoding: .utf8))
                for item in parsed.items { SharedVault.save(item) }
                SharedVault.registerIdentities(for: parsed.items)
                notice = parsed.skipped == 0
                    ? String(localized: "Imported \(parsed.items.count) logins.")
                    : String(localized: "Imported \(parsed.items.count) logins. Skipped \(parsed.skipped) empty rows.")
            } catch let failure as CSVImport.Failure {
                comingSoon = failure.message
            } catch {
                comingSoon = error.localizedDescription
            }
        }
        .alert("Imported", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("Open vault") { notice = nil; onFinish("mine") }
        } message: { Text(notice ?? "") }
        .alert("Not available yet", isPresented: Binding(get: { comingSoon != nil }, set: { if !$0 { comingSoon = nil } })) {
            Button("OK") { comingSoon = nil }
        } message: { Text(comingSoon ?? "") }
    }
}

private struct Prominent: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.buttonStyle(.borderedProminent) } else { content }
    }
}
