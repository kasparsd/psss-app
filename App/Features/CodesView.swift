import SwiftUI

/// What the code buttons of one list share: which button says "Copied", and the haptic.
@MainActor
@Observable
final class CodeCopyState {
    private(set) var copiedID: UUID?
    private(set) var count = 0
    private var reset: Task<Void, Never>?

    /// Copies the code that is valid now, the same way as a password (local only, concealed on Mac, gone after 60 seconds), counts
    /// the copy as using the login, and says "Copied" for about two seconds.
    func copy(_ item: VaultItem, used: () -> Void) {
        guard let code = TOTP.code(secret: item.otpSecret, settings: item.otpSettings) else { return }
        Clipboard.copy(code)
        used()
        copiedID = item.id
        count += 1
        AccessibilityNotification.Announcement(String(localized: "Copied")).post()
        reset?.cancel()
        reset = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { self?.copiedID = nil }
        }
    }
}

extension VaultItem {
    /// A login whose seed makes a code. A seed that cannot is still listed on Codes, but has no button.
    var makesCode: Bool { TOTP.code(secret: otpSecret, settings: otpSettings) != nil }
}

/// The code as a tinted capsule button. A tap copies the current code. The ring and the code change once a second, only while the
/// button is on screen.
struct CodeCopyButton: View {
    let item: VaultItem
    let state: CodeCopyState
    let used: () -> Void
    /// A selected row has an accent background, where accent text would vanish.
    @Environment(\.backgroundProminence) private var prominence

    var body: some View {
        let onSelection = prominence == .increased
        // Read here, in the button's own body, not inside the TimelineView's closure: a change of an @Observable read only in that
        // closure did not redraw it, so the button never said "Copied" although the copy had happened.
        let copied = state.copiedID == item.id
        return TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: 1)) { context in
            let code = TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? ""
            Button {
                state.copy(item, used: used)
            } label: {
                // Both texts are laid out, so the button keeps its width while it says "Copied". Body size like the rest of the row,
                // the code written the one way a code is written everywhere (`CodeDigits`), and a minimum width so every six-digit
                // code is the same size and shape.
                ZStack {
                    CodeDigits(code: code).opacity(copied ? 0 : 1)
                    Text("Copied").opacity(copied ? 1 : 0)
                }
                .lineLimit(1)
                .fixedSize()
                .frame(minWidth: 72)
                .foregroundStyle(onSelection ? Color.white : Color.accentColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(onSelection ? Color.white.opacity(0.25) : Color.accentColor.opacity(0.15), in: .capsule)
                // The capsule is compact; on iPhone and iPad the touch target is still at least 44 pt tall, and on Mac it does not
                // make the row taller than the rows of All and Cards.
                #if os(iOS)
                .frame(minHeight: 44)
                #endif
                .contentShape(Rectangle())
            }
            // Borderless, with the capsule drawn by the label: inside a list row the button is its own hit target, so a tap on the
            // code of the row that is already selected copies instead of being taken as a selection. The copied state is keyed by
            // the login's id in the shared `CodeCopyState`, so a change of selection never resets it.
            .buttonStyle(.borderless)
            .accessibilityLabel("Copy code for \(item.displayTitle)")
            .accessibilityValue(copied ? Text("Copied") : Text(verbatim: code).speechSpellsOutCharacters())
            .help("Copy code")
        }
        // A TimelineView redraws on its own schedule, not when its parent changes, so without a new identity "Copied" waited for the
        // next tick (up to a second) and was gone again within the two seconds.
        .id(copied)
    }
}

/// Every login with a verification code, live. The code is the button; the rest of a row opens the login.
struct CodesView: View {
    let items: [VaultItem]
    /// Which button says "Copied". Owned by the vault screen, so no change of selection or redraw of this list can reset it.
    let copy: CodeCopyState
    /// The selected row, in the split layouts where a list selects. nil on iPhone, which pushes the login instead.
    var selection: Binding<VaultItem.ID?>?
    let open: (VaultItem.ID) -> Void
    /// A code was copied: the login counts as used.
    let used: (VaultItem.ID) -> Void
    let showLogins: () -> Void

    /// The "Recently used" group, fixed when the list appears so rows never move under a finger. Nil until then: the group is taken
    /// from the list as it is.
    @State private var recent: [VaultItem.ID]?
    /// The selected row, with its section, so the same login in two sections is selected once.
    @State private var picked: SectionedRowID?

    init(items: [VaultItem], copy: CodeCopyState, selection: Binding<VaultItem.ID?>? = nil, open: @escaping (VaultItem.ID) -> Void,
         used: @escaping (VaultItem.ID) -> Void, showLogins: @escaping () -> Void) {
        self.items = items
        self.copy = copy
        self.selection = selection
        self.open = open
        self.used = used
        self.showLogins = showLogins
    }

    /// The outer selection is a login id; the list selects rows. Maps one to the other for the detail pane and Command-C.
    private var rowSelection: Binding<SectionedRowID?>? {
        selection.map { SectionedRowID.binding(outer: $0, picked: $picked, recent: Set(recentItems.map(\.id))) }
    }

    private var codeItems: [VaultItem] { items.filter { $0.traits.contains(.code) } }

    private var countText: String { codeItems.count == 1 ? String(localized: "1 code") : String(localized: "\(codeItems.count) codes") }

    private var allCodes: [VaultItem] {
        codeItems.sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
    }

    /// Up to five logins used in the last 30 days (copying a code is a use), above a list of more than five.
    private var recentItems: [VaultItem] { RecentlyUsed.visible(snapshot: recent, in: allCodes) }

    var body: some View {
        Group {
            if let rowSelection {
                List(selection: rowSelection) { rows }
            } else {
                List { rows }
            }
        }
        .itemListStyle()
        #if os(iOS)
        .sensoryFeedback(.success, trigger: copy.count)
        #endif
        .overlay {
            if codeItems.isEmpty {
                ContentUnavailableView {
                    Label("No verification codes yet", systemImage: "lock.badge.clock")
                } description: {
                    #if os(macOS)
                    Text("When a website offers two-step verification, open its login in Psss, click Edit, then Add code. Its six-digit codes then appear here.")
                    #else
                    Text("When a website offers two-step verification, open its login in Psss, tap Edit, then Add code. Its six-digit codes then appear here.")
                    #endif
                } actions: {
                    Button("Show logins", action: showLogins).buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Codes")
        #if os(iOS)
        // iPhone: the title is the name alone and the line under it carries the count, so neither is ever cut.
        .navigationSubtitle(selection == nil ? countText : "")
        #endif
        .columnTitleInList(selection != nil)
        #if os(macOS)
        .onCopyCommand {
            // Command-C copies the selected row's code. The copy is made after the system has written what this returns (nothing),
            // so the concealed copy is the one left on the clipboard.
            if let id = selection?.wrappedValue, let item = codeItems.first(where: { $0.id == id }), item.makesCode {
                Task { @MainActor in copy.copy(item) { used(id) } }
            }
            return []
        }
        #endif
        .onAppear { recent = RecentlyUsed.group(from: codeItems).map(\.id) }
    }

    @ViewBuilder
    private var rows: some View {
        if selection != nil {
            ListTitleLine(title: "Codes", count: countText)
        }
        if !codeItems.isEmpty {
            // The headings only tell the two sections apart; without a group the title already says Codes.
            let group = recentItems
            if group.isEmpty {
                Section { ForEach(allCodes) { row($0, in: .all, group: allCodes) } }
            } else {
                Section("Recently used") { ForEach(group) { row($0, in: .recent, group: group) } }
                Section("All codes") { ForEach(allCodes) { row($0, in: .all, group: allCodes) } }
            }
            Text(helpText)
                .foregroundStyle(.secondary)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .itemRowInsets(first: true, last: true)
        }
    }

    private var helpText: LocalizedStringKey {
        #if os(macOS)
        "Click a code to copy it, or press ⌘C."
        #else
        "Tap a code to copy it. Tap the name to open the login."
        #endif
    }

    private func row(_ item: VaultItem, in section: SectionedRowID.Section, group: [VaultItem]) -> some View {
        CodeRow(item: item, state: copy, open: { open(item.id) }, used: { used(item.id) })
            .tag(SectionedRowID(section: section, id: item.id))
            .itemRowInsets(first: group.first?.id == item.id, last: group.last?.id == item.id)
    }
}

/// The shared row with the code button as its accessory. A row whose seed cannot make a code has no button and no message here: it
/// is listed like the others, opens the login, and the login's page says what is wrong.
private struct CodeRow: View {
    let item: VaultItem
    let state: CodeCopyState
    let open: () -> Void
    let used: () -> Void

    /// Not the usual 30 seconds: this row names its period, in place of the account.
    private var subtitle: Text? {
        if item.makesCode, item.otpSettings.period != 30 { return Text("Every \(item.otpSettings.period) s") }
        return item.account.isEmpty ? nil : Text(verbatim: item.account)
    }

    var body: some View {
        ItemListRow(item: item, subtitle: subtitle, open: open) {
            if item.makesCode { CodeCopyButton(item: item, state: state, used: used) }
        }
    }
}

extension String {
    /// For display only: a zero-width space after every dot lets a long address wrap at the dots ("greenwayparking." then
    /// "example.com") instead of in the middle of a word. The text itself, and what is copied or spoken, is unchanged.
    var breakableAfterDots: String { replacingOccurrences(of: ".", with: ".\u{200B}") }
}
