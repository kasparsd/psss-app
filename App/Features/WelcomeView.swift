import SwiftUI
import UniformTypeIdentifiers

/// First launch, before anything is locked or shown: start a vault, open one, or bring passwords from another app.
/// Every action is a visible, labeled button. Sources that are not built yet say so instead of pretending.
struct WelcomeView: View {
    let session: VaultSession
    /// Called with the vault source to open: "kdbx" (a real encrypted vault) or "sample".
    let onFinish: (String) -> Void

    @State private var importing = false
    @State private var notice: String?
    @State private var comingSoon: String?
    @State private var creating = false
    @State private var pendingImport: [VaultItem] = []
    @State private var openingFile = false
    @State private var fileToOpen: URL?

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
                    choice("Create a vault", "plus", prominent: true) { pendingImport = []; creating = true }
                    choice("Open a vault file", "folder") { openingFile = true }
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
        .passwordsImporter(isPresented: $importing, notice: $notice, problem: $comingSoon) { items in
            pendingImport = items
        }
        .alert("Ready to import", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("Create Vault…") { notice = nil; creating = true }
            Button("Cancel", role: .cancel) { notice = nil; pendingImport = [] }
        } message: { Text((notice ?? "") + " " + String(localized: "Choose a vault password to create the vault that will hold them.")) }
        .sheet(isPresented: $creating) {
            NewVaultSheet(session: session, importing: pendingImport) { onFinish(RootView.keePassSource) }
        }
        .fileImporter(isPresented: $openingFile, allowedContentTypes: [.keePassVault, .data]) { result in
            if let url = try? result.get() { fileToOpen = url }
        }
        .sheet(item: $fileToOpen) { url in
            OpenVaultSheet(session: session, file: url) { onFinish(RootView.keePassSource) }
        }
        .alert("Not available yet", isPresented: Binding(get: { comingSoon != nil }, set: { if !$0 { comingSoon = nil } })) {
            Button("OK") { comingSoon = nil }
        } message: { Text(comingSoon ?? "") }
    }
}


extension View {
    /// Reads an Apple Passwords (or browser) CSV export into saved logins. Reports through `notice` or `problem`.
    func passwordsImporter(isPresented: Binding<Bool>, notice: Binding<String?>, problem: Binding<String?>,
                           add: @escaping ([VaultItem]) throws -> Void) -> some View {
        fileImporter(isPresented: isPresented, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let parsed = try CSVImport.items(from: String(contentsOf: url, encoding: .utf8))
                try add(parsed.items)
                notice.wrappedValue = parsed.skipped == 0
                    ? String(localized: "Read \(parsed.items.count) logins from the file.")
                    : String(localized: "Read \(parsed.items.count) logins from the file. Skipped \(parsed.skipped) empty rows.")
            } catch let failure as CSVImport.Failure {
                problem.wrappedValue = failure.message
            } catch VaultStoreError.changedOnDisk {
                problem.wrappedValue = String(localized: "Nothing was imported, because the vault file was changed by another app or device. Lock and unlock the vault, then import again.")
            } catch let failure as VaultStoreError {
                problem.wrappedValue = String(localized: "Nothing was imported. \(failure.message)")
            } catch {
                problem.wrappedValue = String(localized: "Nothing was imported. \(error.localizedDescription)")
            }
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
