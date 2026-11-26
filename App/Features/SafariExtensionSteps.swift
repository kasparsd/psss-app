#if os(iOS)
import SwiftUI

// How to turn on the Safari extension on iPhone and iPad (mock `#/safari-extension-reminder`, frames C, D, F and G): the steps
// sheet and its row in Settings. In the sheet there are two text sizes, the bar's title and body; supporting text is secondary
// by colour.

/// The steps, as a standard sheet with Done (a form sheet on iPad). iOS has no link to the extension's switch, so this gives the
/// two ways to reach it.
struct SafariExtensionStepsSheet: View {
    @Environment(\.dismiss) private var dismiss
    /// Opened from the reminder card, not from Settings: only then is there a card to say something about (owner, 2026-11-26).
    var openedFromCard = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Cards and addresses fill only while the Psss extension is on. Passwords don’t need it: they already fill through AutoFill.")
                    heading("In Settings")
                    GroupBox {
                        VStack(alignment: .leading, spacing: 8) {
                            step(1, "Open Settings, then tap Apps › Safari › Extensions.")
                            step(2, "Tap Psss, then turn on Allow Extension.")
                            step(3, "Leave All Websites on Ask.", detail: "The first time you tap Psss on a site, Safari asks; choose Allow for that site.")
                        }
                    }
                    heading("Or in Safari")
                    Text("Open any web page, tap the page menu (ᴀA, or the menu button), choose Manage Extensions, turn on Psss, then choose Allow when Safari asks.")
                    SafariPageMenuPicture()
                    Text("A drawing of Safari’s page menu. The real one is Safari’s and differs a little between iOS versions.")
                        .foregroundStyle(.secondary)
                    Text("Psss can’t open that page of Settings for you, so these are the steps.")
                        .foregroundStyle(.secondary)
                    if openedFromCard {
                        Text("This card goes away once Psss has run in Safari.")
                            .foregroundStyle(.secondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .navigationTitle("Turn On Psss in Safari")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationSizing(.form)
    }

    private func heading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
            .padding(.top, 8)
    }

    private func step(_ number: Int, _ text: LocalizedStringKey, detail: LocalizedStringKey? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "\(number.formatted()).").monospacedDigit()
            VStack(alignment: .leading, spacing: 4) {
                Text(text)
                if let detail { Text(detail).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// What Safari's page menu looks like, drawn: the menu with Manage Extensions marked, above the address field with ᴀA marked.
/// Safari draws the real one. It is a picture, read as one image, and it stops growing at a moderately large
/// text size, so the drawn address is not broken apart.
private struct SafariPageMenuPicture: View {
    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(verbatim: "ᴀ")
                        Spacer()
                        Text(1.0, format: .percent)
                        Spacer()
                        Text(verbatim: "A")
                    }
                    .padding(8)
                    row("Show Reader")
                    row("Website Settings")
                    Divider().padding(.horizontal, 8)
                    row("Manage Extensions", marked: true)
                }
                .padding(4)
                .frame(maxWidth: 260)
                .background(Color(.systemBackground), in: .rect(cornerRadius: 16))
                HStack(spacing: 8) {
                    Text(verbatim: "ᴀA")
                        .bold()
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 4)
                        .background(Color.accentColor.opacity(0.15), in: .rect(cornerRadius: 8))
                    Spacer(minLength: 0)
                    Image(systemName: "lock.fill").foregroundStyle(.secondary)
                    Text(verbatim: "harborshop.example")
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.clockwise")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.systemBackground), in: .capsule)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .lineLimit(1)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Safari’s page menu with Manage Extensions highlighted"))
        .accessibilityAddTraits(.isImage)
    }

    private func row(_ title: LocalizedStringKey, marked: Bool = false) -> some View {
        Text(title)
            .bold(marked)
            .foregroundStyle(marked ? Color.accentColor : Color.primary)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(marked ? Color.accentColor.opacity(0.15) : Color.clear, in: .rect(cornerRadius: 12))
    }
}

/// Settings' Safari section: one row with what is known about the extension, which opens the steps. Not a switch, because Psss
/// cannot turn the extension on or off. No section while the extension does not exist.
struct SafariExtensionSetupSection: View {
    @Environment(SafariExtensionStatus.self) private var extensionStatus
    @State private var showsSteps = false

    var body: some View {
        if extensionStatus.extensionWorks {
            Section {
                Button { showsSteps = true } label: {
                    LabeledContent(SafariExtensionCopy.settingsRow) {
                        if let status = SafariExtensionCopy.settingsStatus(extensionStatus.reading) {
                            Text(status).foregroundStyle(Color.secondary)
                        }
                    }
                }
                .task { await extensionStatus.refresh() }
                .sheet(isPresented: $showsSteps) { SafariExtensionStepsSheet() }
            } header: {
                Text("Safari")
            } footer: {
                if let footer = SafariExtensionCopy.settingsFooter(extensionStatus.reading) { Text(footer) }
            }
        }
    }
}
#endif
