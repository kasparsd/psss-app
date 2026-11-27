import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#endif

/// Import from Apple Passwords (mock `#/import-passwords`): how to start, one review with the destination and what to check, the
/// finished screen and the problems. Nothing is written before Import (or Create), and that is one write.
struct AppleImportSheet: View {
    let session: VaultSession
    let requests: AppleImportRequests
    /// A vault now holds the import and is the one the session shows.
    let onImported: () -> Void

    private struct Review {
        var plan: ImportPlan
        /// The chosen file; nil for a direct move.
        var file: URL?
        var destination: UUID?
    }

    private struct Finished {
        var count: Int
        var vault: String
        var file: URL?
    }

    private enum Step {
        case start
        case review(Review)
        case done(Finished)
        /// A problem with its one action. `back` is the review to return to.
        case failed(message: String, action: Retry)
    }

    private enum Retry {
        case none, chooseFile
        case again(Review)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var step = Step.start
    @State private var summary: ImportSummary?
    @State private var picking = false
    @State private var creating = false
    @State private var working = false
    @State private var confirmsDelete = false
    @State private var deleteResult: String?

    var body: some View {
        NavigationStack {
            Form {
                switch step {
                case .start: startContent
                case .review(let review): reviewContent(review)
                case .done(let finished): doneContent(finished)
                case .failed(let message, _): ProblemText(text: message)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom) { bottomBar }
        }
        .modifier(VaultSheetSize())
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            if let url = try? result.get() { read(url) }
        }
        .sheet(isPresented: $creating) {
            if case .review(let review) = step {
                NewVaultSheet(session: session, importPlan: review.plan, onAdded: { added in
                    finish(added, vault: DisplayText.safe(session.reference?.name ?? ""), file: review.file)
                }) { creating = false }
            }
        }
        .onAppear { requests.openSheets += 1; take() }
        .onDisappear { requests.openSheets -= 1 }
        .onChange(of: requests.arrivals) { take() }
    }

    private var title: String {
        switch step {
        case .start: String(localized: "Import from Apple Passwords")
        case .review: summary?.needsWrite == false ? String(localized: "Nothing new to import") : String(localized: "Review the import")
        case .done(let finished): AppleImportText.doneTitle(finished.count)
        case .failed: String(localized: "Nothing was imported")
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        switch step {
        case .done:
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        case .failed(_, .none):
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        case .review where summary?.needsWrite == false:
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        default:
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
        }
    }

    // MARK: Start

    @ViewBuilder private var startContent: some View {
        Section("Move directly") {
            #if os(macOS)
            Text("1. In Passwords, choose File › Export All Items to App…")
            #else
            Text("1. In Passwords, choose Export Data to Another App.")
            #endif
            Text("2. Choose Psss and confirm.")
            Text("3. Psss opens and shows what will be added.")
            Text("Passwords, passkeys and verification codes move. No file is made.")
            #if os(macOS)
            Button("Open Passwords") { openPasswords() }.buttonStyle(.borderedProminent)
            #endif
        }
        Section("Or use a file") {
            #if os(macOS)
            Text("In Passwords, choose File › Export All Passwords to File…, then choose that file here. A file is not encrypted and has no passkeys.")
            #else
            Text("Choose a passwords file (CSV) that you exported. A file is not encrypted and has no passkeys.")
            #endif
            Button("Choose File…") { picking = true }
        }
    }

    #if os(macOS)
    private func openPasswords() {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Passwords") else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
    #endif

    // MARK: Review

    private func vaultName(_ id: UUID?) -> String {
        id.flatMap { id in session.openVaults.first { $0.id == id }?.name }.map { DisplayText.safe($0) } ?? ""
    }

    @ViewBuilder private func reviewContent(_ review: Review) -> some View {
        Section {
            Text(AppleImportText.found(review.plan, fromFile: review.file != nil))
        }
        Section {
            Picker("Import into", selection: Binding(get: { review.destination }, set: { choose($0, for: review) })) {
                ForEach(session.openVaults, id: \.id) { vault in Text(DisplayText.safe(vault.name)).tag(UUID?.some(vault.id)) }
                Text("New vault").tag(UUID?.none)
            }
            .disabled(working)
        }
        if let summary {
            let name = vaultName(review.destination)
            if !summary.needsWrite {
                Section { Text(AppleImportText.nothingNew(summary, vault: name)) }
            } else if review.destination != nil, summary.duplicatesSkipped > 0 || summary.merged > 0 {
                Section {
                    if summary.duplicatesSkipped > 0 { Text(AppleImportText.alreadyThere(summary.duplicatesSkipped, vault: name)) }
                    if summary.merged > 0 { Text(AppleImportText.gaining(summary.merged, vault: name)) }
                }
            }
        }
        let told = review.destination == nil ? review.plan.summary : summary ?? review.plan.summary
        let checks = AppleImportText.checks(told.issues, deleted: told.deletedItems)
        if !checks.shown.isEmpty {
            Section("Check these") {
                ForEach(checks.shown) { check in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: check.title).fontWeight(.semibold)
                        Text(verbatim: check.detail)
                    }
                }
                if checks.more > 0 { Text("And \(checks.more) more.") }
            }
        }
    }

    @ViewBuilder private var bottomBar: some View {
        switch step {
        case .review(let review) where summary?.needsWrite != false || review.destination == nil:
            VStack(spacing: 8) {
                if review.destination == nil {
                    Text("Nothing is added until you create the vault.")
                } else {
                    Text("Nothing is added until you choose Import.")
                }
                if review.destination == nil {
                    primary("Create Vault…") { creating = true }
                } else {
                    primary(AppleImportText.importButton(summary?.itemCount ?? 0)) { apply(review) }
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            #if os(iOS)
            // The list scrolls behind the bar.
            .background(.bar)
            #endif
        case .failed(_, .chooseFile):
            primary("Choose File…") { picking = true }.padding()
        case .failed(_, .again(let review)):
            primary("Try Again") { retry(review) }.padding()
        default:
            EmptyView()
        }
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            #if os(iOS)
            Text(title).frame(maxWidth: .infinity)
            #else
            Text(title)
            #endif
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .keyboardShortcut(.defaultAction)
        .disabled(working)
    }

    // MARK: Finished

    @ViewBuilder private func doneContent(_ finished: Finished) -> some View {
        Section {
            Text("They are in the vault \(finished.vault). Nothing was sent anywhere.")
            if finished.file == nil {
                Text("They are also still in Apple Passwords. Delete them there only after you have signed in with Psss.")
            }
            #if os(macOS)
            Text("Psss fills them once AutoFill is on for Psss in System Settings.")
            #else
            Text("Psss fills them once AutoFill is on for Psss in Settings.")
            #endif
        }
        if let file = finished.file {
            Section {
                if let deleteResult {
                    Text(deleteResult)
                } else {
                    Text("The file you chose still lists every password without encryption.")
                    Button(deleteTitle) { confirmsDelete = true }
                        .buttonStyle(.bordered)
                        .confirmationDialog(deleteQuestion, isPresented: $confirmsDelete, titleVisibility: .visible) {
                            #if os(macOS)
                            Button("Move to Trash", role: .destructive) { delete(file) }
                            #else
                            Button("Delete File", role: .destructive) { delete(file) }
                            #endif
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            #if os(macOS)
                            Text("It stays in the Trash until you empty it.")
                            #endif
                        }
                }
            }
        }
    }

    private var deleteTitle: LocalizedStringKey {
        #if os(macOS)
        "Move File to Trash…"
        #else
        "Delete File…"
        #endif
    }

    private var deleteQuestion: Text {
        #if os(macOS)
        Text("Move the exported file to the Trash?")
        #else
        Text("Delete the exported file?")
        #endif
    }

    private func delete(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var failed = false
        var coordination: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordination) { actual in
            do {
                #if os(macOS)
                try FileManager.default.trashItem(at: actual, resultingItemURL: nil)
                #else
                try FileManager.default.removeItem(at: actual)
                #endif
            } catch { failed = true }
        }
        #if os(macOS)
        deleteResult = failed || coordination != nil
            ? String(localized: "Psss could not move the file to the Trash. Delete it in Finder.")
            : String(localized: "The file is in the Trash.")
        #else
        deleteResult = failed || coordination != nil
            ? String(localized: "Psss could not delete the file. Delete it in Files.")
            : String(localized: "The file was deleted.")
        #endif
    }

    // MARK: Work

    /// Shows what Apple Passwords handed over, once.
    private func take() {
        guard let arrival = requests.pending, !working else { return }
        creating = false
        switch arrival {
        case .plan(let plan): show(plan, file: nil)
        case .failed(let message):
            requests.clear()
            step = .failed(message: message, action: .none)
        }
    }

    private func finish(_ count: Int, vault: String, file: URL?) {
        requests.clear()
        requests.didImport()
        step = .done(Finished(count: count, vault: vault, file: file))
        onImported()
    }

    private func read(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do { show(try CSVSource.plan(from: url, source: .applePasswords), file: url) }
        catch { step = .failed(message: AppleImportText.fileProblem(error), action: .chooseFile) }
    }

    private func show(_ plan: ImportPlan, file: URL?) {
        let shown = session.reference?.id
        let destination = session.openVaults.first { $0.id == shown }?.id ?? session.openVaults.first?.id
        choose(destination, for: Review(plan: plan, file: file, destination: destination))
    }

    private func choose(_ destination: UUID?, for review: Review) {
        var next = review
        next.destination = destination
        summary = destination.flatMap { session.store(for: $0) }?.preview(next.plan)
        step = .review(next)
    }

    private func apply(_ review: Review) {
        guard let id = review.destination, let store = session.store(for: id) else {
            // The vault locked while the review was on screen.
            choose(nil, for: review)
            return
        }
        do {
            let result = try store.apply(review.plan)
            let name = vaultName(id)
            session.show(id)
            finish(result.itemCount, vault: name, file: review.file)
        } catch VaultStoreError.changedOnDisk {
            step = .failed(message: String(localized: "The vault file was changed by another app or device."), action: .again(review))
        } catch {
            let message = (error as? VaultStoreError)?.message ?? (error as? KDBXError)?.message ?? (error as? ImportError)?.message
                ?? String(localized: "The vault could not be written. It is unchanged.")
            step = .failed(message: message, action: .again(review))
        }
    }

    /// Reads the vault again, then shows the review as it now stands.
    private func retry(_ review: Review) {
        working = true
        Task {
            defer { working = false }
            if let id = review.destination, let store = session.store(for: id) {
                do { _ = try await store.reloadIfChanged() }
                catch {
                    session.lock(id)
                    choose(nil, for: review)
                    return
                }
                requests.didImport()
                choose(id, for: review)
            } else {
                choose(nil, for: review)
            }
        }
    }
}

extension View {
    /// The import sheet. When the person closes it, nothing of the hand-over is kept. `lockedAway` says the lock closed it
    /// instead, so what arrived waits for the next unlock.
    func appleImportSheet(isPresented: Binding<Bool>, session: VaultSession, requests: AppleImportRequests,
                          lockedAway: @escaping () -> Bool = { false }, onImported: @escaping () -> Void = {}) -> some View {
        sheet(isPresented: isPresented, onDismiss: { if lockedAway() { requests.putAside() } else { requests.close() } }) {
            AppleImportSheet(session: session, requests: requests, onImported: onImported)
        }
    }
}
