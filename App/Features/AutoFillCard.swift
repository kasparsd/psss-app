import SwiftUI
#if os(iOS)
import UIKit
#endif

// The AutoFill reminder, as the owner approved it on 2026-11-23 (Design/Mocks/autofill-setup.html, section 2, option A): a card at
// the top of the list while AutoFill is off, the same on iPhone, iPad and Mac, including in a new empty vault. The vault screen
// only hosts these views. What they say and when they show is decided in App/Core/AutoFillReminder.swift.
//
// Plain content, never an alert, a badge or a notification. Two text sizes: the headline is body size in bold, and everything
// else is body.

extension AutoFillDevice {
    /// The device this build runs on, for the words of the card.
    static var current: AutoFillDevice {
        #if os(macOS)
        .mac
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? .iPad : .iPhone
        #endif
    }
}

/// The card: the state and one labeled button, with Later beside it. When AutoFill is found on after it was off, the same card
/// says so once, with Done. Shows nothing when there is nothing to say, so a host decides whether to leave room for it
/// with `AutoFillStatus.reminder(for:).display`.
struct AutoFillCard: View {
    @Environment(AutoFillStatus.self) private var autoFill
    let vault: AutoFillVault

    var body: some View {
        let reminder = autoFill.reminder(for: vault)
        let copy = AutoFillCopy(device: .current)
        Group {
            switch reminder.display {
            case .nothing:
                EmptyView()
            case .card(let headline):
                card(title: copy.title(headline), message: copy.body(headline)) {
                    Button(copy.buttonLabel(reminder.action)) { Task { await autoFill.performAction() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(autoFill.working)
                    Button(copy.laterLabel) { autoFill.snooze() }
                        .buttonStyle(.borderless)
                }
            case .confirmation:
                card(title: copy.confirmationTitle, message: copy.confirmationBody) {
                    Button(copy.doneLabel) { autoFill.dismissConfirmation() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .animation(.default, value: reminder.display)
        .onChange(of: reminder.display) { _, now in
            // Coming back from Settings changes the card in place, which VoiceOver would not announce by itself.
            if now == .confirmation { AccessibilityNotification.Announcement(copy.confirmationTitle).post() }
        }
    }

    /// The words read as one element, then the buttons, all inside one group. The buttons sit side by side and stack when
    /// the text size is large, so no label is cut off.
    private func card<Buttons: View>(title: String, message: String, @ViewBuilder buttons: () -> Buttons) -> some View {
        let actions = buttons()
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).accessibilityAddTraits(.isHeader)
                Text(message)
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { actions; Spacer(minLength: 0) }
                VStack(alignment: .leading, spacing: 8) { actions }
            }
            #if os(iOS)
            .controlSize(.large)
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.quaternary, in: .rect(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// The one line that says the card will come back and where AutoFill stays meanwhile. It goes away by itself, and OK closes it sooner.
struct AutoFillLaterNotice: View {
    @Environment(AutoFillStatus.self) private var autoFill

    var body: some View {
        let copy = AutoFillCopy(device: .current)
        Group {
            if autoFill.laterNoticeShown {
                HStack(spacing: 12) {
                    Text(copy.laterNotice).fixedSize(horizontal: false, vertical: true)
                    Button("OK") { autoFill.dismissLaterNotice() }
                        .buttonStyle(.borderless)
                }
                .padding(.vertical, 8)
                .padding(.leading, 16)
                .padding(.trailing, 10)
                .background(.regularMaterial, in: .rect(cornerRadius: 20))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onAppear { AccessibilityNotification.Announcement(copy.laterNotice).post() }
                .task {
                    try? await Task.sleep(for: .seconds(6))
                    autoFill.dismissLaterNotice()
                }
            }
        }
        .animation(.default, value: autoFill.laterNoticeShown)
    }
}

/// Setup's AutoFill section: the state as plain text in a group of its own, and the action in a separate row. The action is the
/// card's: the system's prompt once, then Settings.
struct AutoFillSetupSection: View {
    @Environment(AutoFillStatus.self) private var autoFill

    var body: some View {
        let copy = AutoFillCopy(device: .current)
        let reading = autoFill.reading
        Section("AutoFill") {
            if let status = copy.setupStatus(reading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(status)
                    if let detail = copy.setupDetail(reading) { Text(detail).foregroundStyle(.secondary) }
                }
                .accessibilityElement(children: .combine)
            } else {
                ProgressView()
            }
        }
        .task { await autoFill.refresh() }
        Section {
            Button(copy.buttonLabel(autoFill.action)) { Task { await autoFill.performAction() } }
                .disabled(autoFill.working)
        } footer: {
            if let footer = copy.setupFooter(reading, promptUsed: autoFill.memory.promptUsed) { Text(footer) }
        }
    }
}
