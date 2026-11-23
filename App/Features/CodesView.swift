import SwiftUI

/// When each verification code was last copied, kept on this device only (not in the vault file, like the usage counts). It holds
/// item identifiers and dates, no codes. Recently copied on the Codes list reads it.
enum CodeCopyLog {
    private static let key = "codeCopyDates"
    private static let keep = 50

    private static func load() -> [String: Double] {
        UserDefaults.standard.dictionary(forKey: key) as? [String: Double] ?? [:]
    }

    static func record(_ id: UUID, at date: Date = .now) {
        var all = load()
        all[id.uuidString] = date.timeIntervalSince1970
        if all.count > keep {
            let newest = all.sorted { $0.value > $1.value }.prefix(keep)
            all = Dictionary(uniqueKeysWithValues: newest.map { ($0.key, $0.value) })
        }
        UserDefaults.standard.set(all, forKey: key)
    }

    /// The most recently copied items first, among `ids`.
    static func recent(among ids: Set<UUID>, limit: Int) -> [UUID] {
        load().sorted { $0.value > $1.value }.compactMap { UUID(uuidString: $0.key) }.filter(ids.contains).prefix(limit).map { $0 }
    }
}

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
        CodeCopyLog.record(item.id)
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
        return TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: 1)) { context in
            let code = TOTP.grouped(TOTP.code(secret: item.otpSecret, settings: item.otpSettings, at: context.date) ?? "")
            let copied = state.copiedID == item.id
            Button {
                state.copy(item, used: used)
            } label: {
                // Both texts are laid out, so the button keeps its width while it says "Copied".
                ZStack {
                    Text(verbatim: code).font(.title2.monospacedDigit()).opacity(copied ? 0 : 1)
                        .contentTransition(.numericText())
                    Text("Copied").font(.title2).opacity(copied ? 1 : 0)
                }
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(onSelection ? Color.white : Color.accentColor)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(minHeight: 44)
                .background(onSelection ? Color.white.opacity(0.25) : Color.accentColor.opacity(0.15), in: .capsule)
                .contentShape(.capsule)
            }
            // Borderless, with the capsule drawn by the label: inside a list row the button is its own hit target, so a tap on the
            // code of the row that is already selected copies instead of being taken as a selection. The copied state is keyed by
            // the login's id in the shared `CodeCopyState`, so a change of selection never resets it.
            .buttonStyle(.borderless)
            .accessibilityLabel("Copy code for \(item.displayTitle)")
            .accessibilityValue(copied ? Text("Copied") : Text(verbatim: code))
            .help("Copy code")
        }
    }
}

/// A row of the Codes list. A login can be in both sections, so a row is named by its section too: List selection never sees two
/// rows with one tag.
private struct CodesRowID: Hashable {
    enum Section { case recent, all }
    let section: Section
    let id: VaultItem.ID
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

    /// The recently copied logins, fixed when the list appears so rows never move under a finger.
    @State private var recent: [UUID]
    /// The selected row, with its section, so the same login in two sections is selected once.
    @State private var picked: CodesRowID?
    @Environment(\.dynamicTypeSize) private var typeSize

    init(items: [VaultItem], copy: CodeCopyState, selection: Binding<VaultItem.ID?>? = nil, open: @escaping (VaultItem.ID) -> Void,
         used: @escaping (VaultItem.ID) -> Void, showLogins: @escaping () -> Void) {
        self.items = items
        self.copy = copy
        self.selection = selection
        self.open = open
        self.used = used
        self.showLogins = showLogins
        let withCode = Set(items.filter { $0.traits.contains(.code) }.map(\.id))
        _recent = State(initialValue: CodeCopyLog.recent(among: withCode, limit: 3))
    }

    /// The outer selection is a login id; the list selects rows. Maps one to the other for the detail pane and Command-C.
    private var rowSelection: Binding<CodesRowID?>? {
        guard let outer = selection else { return nil }
        return Binding(get: {
            guard let id = outer.wrappedValue else { return nil }
            return picked?.id == id ? picked : CodesRowID(section: .all, id: id)
        }, set: {
            picked = $0
            outer.wrappedValue = $0?.id
        })
    }

    private var codeItems: [VaultItem] { items.filter { $0.traits.contains(.code) } }

    private var allCodes: [VaultItem] {
        codeItems.sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
    }

    private var recentItems: [VaultItem] { recent.compactMap { id in codeItems.first { $0.id == id } } }

    /// The one countdown is for the usual 30-second codes. A list with none of them counts down to its shortest period.
    private var countdownPeriod: Int {
        let periods = codeItems.filter(\.makesCode).map(\.otpSettings.period)
        return periods.contains(30) ? 30 : (periods.min() ?? 30)
    }

    var body: some View {
        Group {
            if let rowSelection {
                List(selection: rowSelection) { rows }
            } else {
                List { rows }
            }
        }
        #if os(iOS)
        .environment(\.defaultMinListRowHeight, 44)
        .listStyle(.plain)
        .sensoryFeedback(.success, trigger: copy.count)
        #else
        .environment(\.defaultMinListRowHeight, 32)
        .listStyle(.inset)
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
        .onAppear {
            recent = CodeCopyLog.recent(among: Set(codeItems.map(\.id)), limit: 3)
        }
    }

    @ViewBuilder
    private var rows: some View {
        if selection != nil {
            ListTitleLine(title: "Codes", count: codeItems.count == 1 ? String(localized: "1 code") : String(localized: "\(codeItems.count) codes"))
        }
        if !codeItems.isEmpty {
            CountdownLine(period: countdownPeriod)
                .listRowSeparator(.hidden)
                .listRowInsets(rowInsets)
            if !recentItems.isEmpty {
                Section("Recently copied") { ForEach(recentItems) { row($0, in: .recent) } }
            }
            // The header only tells the two sections apart; without "Recently copied" the title already says Codes.
            if recentItems.isEmpty {
                Section { ForEach(allCodes) { row($0, in: .all) } }
            } else {
                Section("All codes") { ForEach(allCodes) { row($0, in: .all) } }
            }
            Text(helpText)
                .foregroundStyle(.secondary)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(rowInsets)
        }
    }

    private var helpText: LocalizedStringKey {
        #if os(macOS)
        "Click a code to copy it, or press ⌘C."
        #else
        "Tap a code to copy it. Tap the name to open the login."
        #endif
    }

    private var rowInsets: EdgeInsets {
        #if os(iOS)
        EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
        #else
        EdgeInsets(top: 11, leading: 4, bottom: 11, trailing: 8)
        #endif
    }

    private func row(_ item: VaultItem, in section: CodesRowID.Section) -> some View {
        CodeRow(item: item, state: copy, stacked: typeSize.isAccessibilitySize,
                open: { open(item.id) }, used: { used(item.id) })
            .tag(CodesRowID(section: section, id: item.id))
            .listRowInsets(rowInsets)
    }
}

/// The ring and the one sentence about when codes change, for the whole list.
private struct CountdownLine: View {
    let period: Int

    var body: some View {
        TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: 1)) { context in
            let remaining = TOTP.secondsRemaining(period: period, at: context.date)
            HStack(spacing: 8) {
                ZStack {
                    Circle().stroke(.quaternary, lineWidth: 3)
                    Circle()
                        .trim(from: 0, to: Double(remaining) / Double(max(1, period)))
                        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
                // One short line: only the seconds change and digits are fixed-width, so nothing shifts. The longer explanation is in
                // the info bubble.
                Text("New codes in \(remaining) s").monospacedDigit()
                InfoButton(topic: HelpTopics.verificationCodes)
            }
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("New codes in \(remaining) seconds"))
        }
    }
}

/// Icon, name and account on the left, which open the login, and the code button on the right. A seed that cannot make a code has no
/// button: the whole row opens the login, with a chevron, and says what to do.
private struct CodeRow: View {
    let item: VaultItem
    let state: CodeCopyState
    let stacked: Bool
    let open: () -> Void
    let used: () -> Void

    /// Not the usual 30 seconds: this row names its period, in place of the account.
    private var secondary: Text? {
        if !item.makesCode { return Text("Can't make a code. Open the login to replace it.") }
        if item.otpSettings.period != 30 { return Text("Every \(item.otpSettings.period) s") }
        return item.account.isEmpty ? nil : Text(verbatim: item.account)
    }

    private var opener: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                ItemIcon(item: item)
                    .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
                VStack(alignment: .leading, spacing: 2) {
                    // The name may wrap to a second line rather than be cut ("Harbor Vault (8 dig…").
                    Text(verbatim: item.displayTitle.breakableAfterDots).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    if let secondary {
                        secondary.foregroundStyle(.secondary).lineLimit(item.makesCode ? 1 : 2).truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
                if !item.makesCode {
                    Image(systemName: "chevron.right").foregroundStyle(.secondary).accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        if stacked && item.makesCode {
            VStack(alignment: .leading, spacing: 8) {
                opener
                CodeCopyButton(item: item, state: state, used: used)
            }
        } else {
            HStack(spacing: 12) {
                opener
                if item.makesCode { CodeCopyButton(item: item, state: state, used: used) }
            }
        }
    }
}

extension String {
    /// For display only: a zero-width space after every dot lets a long address wrap at the dots ("greenwayparking." then
    /// "example.com") instead of in the middle of a word. The text itself, and what is copied or spoken, is unchanged.
    var breakableAfterDots: String { replacingOccurrences(of: ".", with: ".\u{200B}") }
}
