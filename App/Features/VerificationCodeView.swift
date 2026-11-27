import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
import VisionKit
#else
import AppKit
#endif

enum VerificationCodeInput: Identifiable {
    case manual
    case pastedImage([NSItemProvider])

    var id: Int {
        switch self {
        case .manual: 0
        case .pastedImage: 1
        }
    }
}

/// Check the clipboard's types here. The system Paste button reads the image only when pressed.
struct CodeImagePaste<Content: View>: View {
    let onPaste: ([NSItemProvider]) -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.scenePhase) private var scenePhase
    @State private var hasImage = false
    #if os(macOS)
    @State private var changeCount: Int?
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
            if hasImage {
                // The system button cannot be renamed, so the row says what it reads: a copied QR code image.
                HStack(spacing: 12) {
                    Text("From QR code in screenshot")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    PasteButton(supportedContentTypes: [.image], payloadAction: onPaste)
                        .fixedSize()
                        .help("Read the setup key from the copied image")
                }
                    #if os(macOS)
                    // SwiftUI's PasteButton revalidates on clipboard changes on iOS only.
                    .id(changeCount)
                    #endif
            }
        }
        .onAppear(perform: update)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { update() }
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.changedNotification)) { _ in update() }
        .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.removedNotification)) { _ in update() }
        #else
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                update()
                try? await Task.sleep(for: .milliseconds(350))
            }
        }
        #endif
    }

    private func update() {
        #if os(iOS)
        hasImage = UIPasteboard.general.hasImages
        #else
        let pasteboard = NSPasteboard.general
        let count = pasteboard.changeCount
        guard changeCount != count else { return }
        hasImage = pasteboard.types?.contains { UTType($0.rawValue)?.conforms(to: .image) == true } ?? false
        changeCount = count
        #endif
    }
}

/// Adds a verification code (TOTP) to a login by paste, image or camera. See docs/verification-codes.md.
///
/// The common case is a phone that shows the website and holds the vault, so the camera cannot help: copy the setup key
/// (or screenshot the QR code, Copy and Delete), come back, tap Paste. Everything is read on this device.
struct VerificationCodeSheet: View {
    /// The login's name, for the confirm and saved lines.
    let loginName: String
    let hasExistingCode: Bool
    let input: VerificationCodeInput
    /// Called when the person confirms. The caller stores the code in the login.
    let onSave: (TOTPSetup) -> Void
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable {
        case collect
        case confirm(TOTPSetup, remindToDeleteScreenshot: Bool)
        case saved(remindToDeleteScreenshot: Bool)
    }

    @State private var phase = Phase.collect
    @State private var problem: LocalizedStringKey?
    @State private var dropTargeted = false
    @State private var scanning = false
    @State private var choosingFile = false
    @State private var photo: PhotosPickerItem?
    @State private var started = false

    var body: some View {
        NavigationStack {
            // Scrolls instead of squeezing: at the medium detent the text must wrap in full, never end in "…".
            ScrollView {
                Group {
                    switch phase {
                    case .collect: collect
                    case .confirm(let setup, let remind): confirm(setup, remindToDeleteScreenshot: remind)
                    case .saved(let remind): saved(remindToDeleteScreenshot: remind)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding()
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Add verification code")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if case .saved = phase { EmptyView() } else { Button("Cancel") { dismiss() } }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 450, minHeight: 380)
        .onPasteCommand(of: [.image, .plainText], perform: ingest)
        #else
        .presentationDetents([.medium, .large])
        #endif
        .onDrop(of: [.image, .plainText], isTargeted: $dropTargeted) { providers in
            ingest(providers)
            return true
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { readFile(url) }
        }
        .onAppear {
            guard !started else { return }
            started = true
            if case .pastedImage(let providers) = input { ingest(providers) }
        }
        #if os(iOS)
        .sheet(isPresented: $scanning) { CameraScanner { text in scanning = false; handle([text], fromImage: true) } }
        #endif
    }

    // MARK: Collect

    /// Three rows in one card (mock `#/code-setup`, option H): the system Paste control at the end of the first,
    /// then the other ways in. One help block under the card, which a problem replaces.
    private var collect: some View {
        VStack(spacing: 16) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text("Screenshot or key")
                    Spacer(minLength: 8)
                    PasteButton(supportedContentTypes: [.image, .plainText], payloadAction: ingest)
                        .buttonBorderShape(.capsule)
                }
                .frame(minHeight: 46)
                .padding(.horizontal, 16)
                #if os(iOS)
                Divider().padding(.leading, 16)
                Button { startScan() } label: { CardRowLabel(title: "Scan with camera", systemImage: "camera") }
                    .buttonStyle(.plain)
                Divider().padding(.leading, 16)
                PhotosPicker(selection: $photo, matching: .screenshots) {
                    // Inline, not CardRowLabel: this closure is not main-actor isolated.
                    Label("Choose photo", systemImage: "photo")
                        .foregroundStyle(Color.accentColor)
                        .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
                        .padding(.horizontal, 16)
                        .contentShape(Rectangle())
                }
                    .buttonStyle(.plain)
                    .onChange(of: photo) { _, item in readPhoto(item) }
                #else
                Divider().padding(.leading, 16)
                Button { choosingFile = true } label: { CardRowLabel(title: "Choose image…", systemImage: "photo") }
                    .buttonStyle(.plain)
                #endif
            }
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
            if let problem {
                Label { Text(problem).multilineTextAlignment(.leading) } icon: { WarningSymbol() }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.updatesFrequently)
            } else {
                #if os(iOS)
                Text("Take a screenshot of the QR code, then paste it or pick it from your photos. Or copy the setup key from the site and paste that.")
                    .multilineTextAlignment(.center)
                #else
                Text("Take a screenshot of the QR code with ⇧⌃⌘4, which copies it, then paste. Or choose an image, drop one here, or copy the setup key and paste that.")
                    .multilineTextAlignment(.center)
                #endif
            }
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 12).stroke(Color.accentColor, lineWidth: 3).padding(-8)
            }
        }
    }

    // MARK: Confirm

    private func confirm(_ setup: TOTPSetup, remindToDeleteScreenshot: Bool) -> some View {
        // The corner Cancel already leaves a new code; only a replacement needs words for what leaving keeps.
        CodeConfirmContent(setup: setup, loginName: loginName, hasExistingCode: hasExistingCode,
                           secondary: hasExistingCode ? (title: "Keep current code", action: { dismiss() }) : nil) {
            onSave(setup)
            phase = .saved(remindToDeleteScreenshot: remindToDeleteScreenshot)
        }
    }

    private func saved(remindToDeleteScreenshot: Bool) -> some View {
        CodeSavedContent(loginName: loginName, remindToDeleteScreenshot: remindToDeleteScreenshot) { dismiss() }
    }

    // MARK: Input

    /// Prefer the image if a copied screenshot also carries a filename as text.
    private func ingest(_ providers: [NSItemProvider]) {
        problem = nil
        guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) })
                ?? providers.first(where: { $0.canLoadObject(ofClass: String.self) }) else {
            problem = "Nothing to paste. Copy the setup key or QR code first."
            return
        }
        if provider.canLoadObject(ofClass: String.self), !provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            _ = provider.loadObject(ofClass: String.self) { text, _ in
                Task { @MainActor in handle(text.map { [$0] } ?? [], fromImage: false) }
            }
        } else {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                let found = data.map(QRDecoder.payloads(in:)) ?? []
                Task { @MainActor in handle(found, fromImage: true, imageRead: data != nil, remindToDeleteScreenshot: true) }
            }
        }
    }

    private func readFile(_ url: URL) {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        let data = try? Data(contentsOf: url)
        handle(data.map(QRDecoder.payloads(in:)) ?? [], fromImage: true, imageRead: data != nil, remindToDeleteScreenshot: true)
    }

    #if os(iOS)
    private func readPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            let data = try? await item.loadTransferable(type: Data.self)
            photo = nil
            handle(data.map(QRDecoder.payloads(in:)) ?? [], fromImage: true, imageRead: data != nil, remindToDeleteScreenshot: true)
        }
    }

    private func startScan() {
        guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
            problem = "Psss can’t use the camera. Allow it in Settings, or choose a photo."
            return
        }
        problem = nil
        scanning = true
    }
    #endif

    /// Picks the first usable code among what was read and shows it, or says what is wrong with the best candidate.
    private func handle(_ texts: [String], fromImage: Bool, imageRead: Bool = true, remindToDeleteScreenshot: Bool = false) {
        if fromImage, texts.isEmpty {
            problem = imageRead ? "No QR code found in that image. Try a sharper screenshot, or paste the setup key."
                                : "That image could not be read. Try another, or paste the setup key."
            return
        }
        if texts.isEmpty {
            problem = "Nothing to paste. Copy the setup key or QR code first."
            return
        }
        let results = texts.map { TOTP.parse($0) }
        if let setup = results.lazy.compactMap({ if case .setup(let s) = $0 { s } else { nil } }).first {
            problem = nil
            phase = .confirm(setup, remindToDeleteScreenshot: remindToDeleteScreenshot)
            return
        }
        problem = (results.first(where: { $0 != .empty }) ?? .empty).problemText
    }
}

#if os(iOS)
/// A live camera view that returns the first QR code it sees. For a second screen: a phone cannot scan its own display.
private struct CameraScanner: View {
    let onFound: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScannerRepresentable(onFound: onFound)
                .ignoresSafeArea()
                .navigationTitle("Scan QR code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                                recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
                                                isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        private var done = false
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case .barcode(let code) in items {
                if let text = code.payloadStringValue {
                    done = true
                    scanner.stopScanning()
                    onFound(text)
                    return
                }
            }
        }
    }
}
#endif

/// One row of the setup card: the whole row is the button, in the accent colour.
private struct CardRowLabel: View {
    let title: LocalizedStringKey
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .foregroundStyle(Color.accentColor)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
    }
}

extension TOTPParse {
    /// Why a read result cannot be saved, in words that name the fix. Every way in (paste, image, camera, a site's link) says the same.
    var problemText: LocalizedStringKey {
        switch self {
        case .webLink: "That QR code is a web link, not a verification code. Look for “Can’t scan?” on the site to get the setup key."
        case .migration: "This QR code holds several accounts exported from Google Authenticator. Importing those isn’t built yet. Nothing was saved."
        case .unsupported: "This code uses a type Psss can’t make yet. Nothing was saved."
        case .invalidKey: "That setup key is not valid. It uses letters and the numbers 2 to 7."
        default: "Nothing to paste. Copy the setup key or QR code first."
        }
    }
}

/// The step that shows the code found and asks before saving it: issuer, account, a live code (the site will not turn on two-step
/// verification until a valid one is typed) and the button. Shared by the add-code sheet and the sheet a site's link opens.
struct CodeConfirmContent: View {
    let setup: TOTPSetup
    let loginName: String
    let hasExistingCode: Bool
    /// A second, quieter way out under the button: keep the current code, or choose another login.
    var secondary: (title: LocalizedStringKey, action: () -> Void)?
    let onSave: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(setup.shownIssuer.isEmpty ? "Found a verification code" : "Found a code for \(setup.shownIssuer)")
                .font(.title2.weight(.semibold))
            if !setup.shownAccount.isEmpty { Text(setup.shownAccount).foregroundStyle(.secondary) }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let code = TOTP.code(secret: setup.secret, settings: setup.settings, at: context.date) ?? "------"
                let remaining = TOTP.secondsRemaining(period: setup.settings.period, at: context.date)
                VStack(spacing: 4) {
                    CodeDigits(code: code, style: .title2)
                    ProgressView(value: Double(remaining), total: Double(setup.settings.period))
                        .frame(maxWidth: 200)
                        .accessibilityHidden(true)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Code found")
                .accessibilityValue(Text("Expires in \(remaining) seconds"))
            }
            if setup.settings != .standard {
                Text("\(setup.settings.digits) digits, every \(setup.settings.period) seconds, \(setup.settings.algorithm.rawValue)")
                    .foregroundStyle(.secondary)
            }
            Text("Type this code into the site to finish turning on two-step verification. It saves to \(loginName) in your vault, on this device.")
                .multilineTextAlignment(.center)
            if hasExistingCode {
                Text("This login already has a code. Saving replaces it.").foregroundStyle(.secondary)
            }
            Button(hasExistingCode ? "Replace code" : "Save code", action: onSave)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            if let secondary { Button(secondary.title, action: secondary.action) }
        }
    }
}

/// The saved state: the login that now holds the code, and Done.
struct CodeSavedContent: View {
    let loginName: String
    let remindToDeleteScreenshot: Bool
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle").font(.system(size: 40)).foregroundStyle(.secondary).accessibilityHidden(true)
            Text("Code saved to \(loginName).").font(.title2.weight(.semibold))
            if remindToDeleteScreenshot {
                Text("Delete the screenshot now. It still holds the setup key.").multilineTextAlignment(.center)
            }
            Button("Done", action: onDone)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }
}

extension TOTPSetup {
    /// The issuer and account a setup link names, safe to show. What is saved is the link’s own text.
    var shownIssuer: String { DisplayText.safe(issuer) }
    var shownAccount: String { DisplayText.safe(account) }
}
