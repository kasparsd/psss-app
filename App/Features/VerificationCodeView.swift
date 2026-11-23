import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import VisionKit
#endif

/// Adds a verification code (TOTP) to a login by paste, image or camera. See docs/verification-codes.md.
///
/// The common case is a phone that shows the website and holds the vault, so the camera cannot help: copy the setup key
/// (or screenshot the QR code, Copy and Delete), come back, tap Paste. Everything is read on this device.
struct VerificationCodeSheet: View {
    /// The login's name, for the confirm and saved lines.
    let loginName: String
    let hasExistingCode: Bool
    /// Called when the person confirms. The caller stores the code in the login.
    let onSave: (TOTPSetup) -> Void
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable {
        case collect
        case confirm(TOTPSetup, fromImage: Bool)
        case saved(fromImage: Bool)
    }

    @State private var phase = Phase.collect
    @State private var problem: LocalizedStringKey?
    @State private var dropTargeted = false
    @State private var scanning = false
    @State private var choosingFile = false
    @State private var photo: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            // Scrolls instead of squeezing: at the medium detent the text must wrap in full, never end in "…".
            ScrollView {
                Group {
                    switch phase {
                    case .collect: collect
                    case .confirm(let setup, let fromImage): confirm(setup, fromImage: fromImage)
                    case .saved(let fromImage): saved(fromImage: fromImage)
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
        #if os(iOS)
        .sheet(isPresented: $scanning) { CameraScanner { text in scanning = false; handle([text], fromImage: true) } }
        #endif
    }

    // MARK: Collect

    private var collect: some View {
        VStack(spacing: 16) {
            Text("Copy the setup key or QR code from the site. Psss reads it on this device. Nothing is uploaded.")
                .multilineTextAlignment(.center)
            #if os(iOS)
            Text("On this phone? On the site, tap “Can’t scan?”, copy the key, then tap Paste. Or take a screenshot, tap it, choose Copy and Delete, then tap Paste.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            #else
            Text("Copy the setup key, or take a screenshot with ⇧⌃⌘4, then press ⌘V. You can also drop an image here.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            #endif
            PasteButton(supportedContentTypes: [.image, .plainText], payloadAction: ingest)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
            #if os(iOS)
            HStack(spacing: 12) {
                Button("Scan with camera", systemImage: "camera") { startScan() }
                PhotosPicker("Choose photo", selection: $photo, matching: .screenshots)
            }
            .buttonStyle(.bordered)
            .onChange(of: photo) { _, item in readPhoto(item) }
            #else
            Button("Choose image…") { choosingFile = true }
            #endif
            if let problem {
                Label { Text(problem).multilineTextAlignment(.leading) } icon: { Image(systemName: "exclamationmark.triangle") }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 12).stroke(Color.accentColor, lineWidth: 3).padding(-8)
            }
        }
    }

    // MARK: Confirm

    private func confirm(_ setup: TOTPSetup, fromImage: Bool) -> some View {
        VStack(spacing: 16) {
            Text(setup.issuer.isEmpty ? "Found a verification code" : "Found a code for \(setup.issuer)")
                .font(.title2.weight(.semibold))
            if !setup.account.isEmpty { Text(setup.account).foregroundStyle(.secondary) }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let code = TOTP.code(secret: setup.secret, settings: setup.settings, at: context.date) ?? "------"
                let remaining = TOTP.secondsRemaining(period: setup.settings.period, at: context.date)
                VStack(spacing: 4) {
                    Text(TOTP.grouped(code))
                        .font(.system(.title2, design: .monospaced).weight(.semibold))
                        .contentTransition(.numericText())
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
            Button(hasExistingCode ? "Replace code" : "Save code") {
                onSave(setup)
                phase = .saved(fromImage: fromImage)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            Button(hasExistingCode ? "Keep current code" : "Cancel") { dismiss() }
        }
    }

    private func saved(fromImage: Bool) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle").font(.system(size: 40)).foregroundStyle(.secondary).accessibilityHidden(true)
            Text("Code saved to \(loginName).").font(.title2.weight(.semibold))
            if fromImage {
                Text("Delete the screenshot now. It still holds the setup key.").multilineTextAlignment(.center)
            }
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }

    // MARK: Input

    /// Text first, then image: a copied screenshot may also carry a filename as text.
    private func ingest(_ providers: [NSItemProvider]) {
        problem = nil
        guard let provider = providers.first(where: { $0.canLoadObject(ofClass: String.self) }) ?? providers.first else {
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
                Task { @MainActor in handle(found, fromImage: true, imageRead: data != nil) }
            }
        }
    }

    private func readFile(_ url: URL) {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        let data = try? Data(contentsOf: url)
        handle(data.map(QRDecoder.payloads(in:)) ?? [], fromImage: true, imageRead: data != nil)
    }

    #if os(iOS)
    private func readPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            let data = try? await item.loadTransferable(type: Data.self)
            photo = nil
            handle(data.map(QRDecoder.payloads(in:)) ?? [], fromImage: true, imageRead: data != nil)
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
    private func handle(_ texts: [String], fromImage: Bool, imageRead: Bool = true) {
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
            phase = .confirm(setup, fromImage: fromImage)
            return
        }
        switch results.first(where: { $0 != .empty }) ?? .empty {
        case .webLink: problem = "That QR code is a web link, not a verification code. Look for “Can’t scan?” on the site to get the setup key."
        case .migration: problem = "This QR code holds several accounts exported from Google Authenticator. Importing those isn’t built yet. Nothing was saved."
        case .unsupported: problem = "This code uses a type Psss can’t make yet. Nothing was saved."
        case .invalidKey: problem = "That setup key is not valid. It uses letters and the numbers 2 to 7."
        default: problem = "Nothing to paste. Copy the setup key or QR code first."
        }
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
