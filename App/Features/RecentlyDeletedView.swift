import SwiftUI

/// Recently Deleted: the pieces the vault screen hosts. Deleting an item moves it here for 30 days; only a labeled, confirmed button
/// removes anything for good. The words come from `RecentlyDeletedText`, so every platform says the same thing.

// MARK: Confirmation

/// What the person asked to remove for good, waiting for the confirmation.
enum DeletionRequest: Hashable {
    case all
    case one(VaultItem.ID)
}

/// The confirmation before something is removed for good. Mac asks with an alert whose default button is Cancel; iPhone and iPad
/// with a centred alert too, because it always shows Cancel (a confirmation dialog is drawn by iOS 26 as a popover with one red
/// button and no Cancel when its anchor is a toolbar button or a view inside the navigation content). The vault screen attaches it once, to its root, and the buttons only
/// set the request.
struct ConfirmDeletion: ViewModifier {
    @Binding var request: DeletionRequest?
    let entries: [DeletedItem]
    let deleteAll: () -> Void
    let deleteOne: (VaultItem.ID) -> Void

    private var shown: Binding<Bool> {
        Binding(get: { request != nil }, set: { if !$0 { request = nil } })
    }

    private func name(_ id: VaultItem.ID) -> String { entries.first { $0.id == id }?.item.displayTitle ?? "" }

    private func question(_ request: DeletionRequest) -> String {
        switch request {
        case .all: RecentlyDeletedText.deleteAllQuestion(count: entries.count)
        case .one(let id): RecentlyDeletedText.deleteOneQuestion(name: name(id))
        }
    }

    private func buttonTitle(_ request: DeletionRequest) -> String {
        switch request {
        case .all: RecentlyDeletedText.deleteAllButton(count: entries.count)
        case .one: RecentlyDeletedText.deleteOneButton
        }
    }

    private func perform(_ request: DeletionRequest) {
        switch request {
        case .all: deleteAll()
        case .one(let id): deleteOne(id)
        }
    }

    func body(content: Content) -> some View {
        #if os(macOS)
        content.alert(request.map(question) ?? "", isPresented: shown, presenting: request) { request in
            // This cannot be undone, so Return means Cancel.
            Button("Cancel", role: .cancel) {}
                .keyboardShortcut(.defaultAction)
            Button(buttonTitle(request), role: .destructive) { perform(request) }
        } message: { request in
            switch request {
            case .all: Text(RecentlyDeletedText.deleteAllConsequence(count: entries.count))
            case .one: Text(RecentlyDeletedText.deleteOneConsequence)
            }
        }
        #else
        // iPhone and iPad: a centred alert, which always has Cancel. A confirmation dialog hangs from a toolbar button or a view
        // inside the navigation content, and iOS 26 then draws it as a popover with one red button and no Cancel (iPad too).
        content.alert(request.map(question) ?? "", isPresented: shown, presenting: request) { request in
            Button(buttonTitle(request), role: .destructive) { perform(request) }
            Button("Cancel", role: .cancel) {}
        } message: { request in
            switch request {
            case .all: Text(RecentlyDeletedText.deleteAllConsequence(count: entries.count))
            case .one: Text(RecentlyDeletedText.deleteOneConsequence)
            }
        }
        #endif
    }
}

// MARK: Delete All

/// "Delete All…" for the navigation bar or toolbar. It only asks the screen to confirm, with the count in the question and on the
/// button, so it cannot be pressed by habit.
struct DeleteAllButton: View {
    let ask: () -> Void

    var body: some View {
        Button("Delete All…", action: ask)
    }
}

// MARK: List pieces

/// One row of the list: the name and the kind, then when it was deleted and when Psss removes it. The two text lines wrap at the
/// largest text sizes. VoiceOver reads the whole row as one element, with the removal date in the long form.
struct DeletedRow: View {
    let entry: DeletedItem
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let now = Date.now
        HStack(spacing: 12) {
            ItemIcon(item: entry.item)
                // The separator starts where the text starts, the same on every row and every platform.
                .alignmentGuide(.listRowSeparatorLeading) { $0[.trailing] + 12 }
            VStack(alignment: .leading, spacing: 2) {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: entry.item.displayTitle)
                        Text(entry.item.kind.label).foregroundStyle(.secondary)
                    }
                } else {
                    TitleAndLogin {
                        Text(verbatim: entry.item.displayTitle).lineLimit(1)
                        Text(entry.item.kind.label).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Text(verbatim: RecentlyDeletedText.rowLine(deleted: entry.deleted, now: now))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(RecentlyDeletedText.rowSpokenLabel(title: entry.item.displayTitle, kind: entry.item.kind,
                                                               deleted: entry.deleted, now: now))
    }
}

/// The one place the list says that other KeePass apps keep these items in their Recycle Bin.
struct RecentlyDeletedFooter: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(verbatim: RecentlyDeletedText.listFooter)
                .foregroundStyle(.secondary)
            InfoButton(topic: HelpTopics.recentlyDeleted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

/// Nothing is waiting: one sentence of reassurance and one button. There is no Delete All here.
struct RecentlyDeletedEmpty: View {
    let showAllItems: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "trash").font(.system(size: 40)).foregroundStyle(.secondary).accessibilityHidden(true)
                    HStack(spacing: 4) {
                        Text(verbatim: RecentlyDeletedText.emptyTitle).font(.title2.weight(.semibold))
                            .accessibilityAddTraits(.isHeader)
                        InfoButton(topic: HelpTopics.recentlyDeleted)
                    }
                    Text(verbatim: RecentlyDeletedText.emptyBody)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                Button("Show All Items", action: showAllItems)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        // Inside the safe area only: the large title above the list stays visible.
        .background(.background, ignoresSafeAreaEdges: [])
    }
}

// MARK: Read-only detail

/// An item in Recently Deleted, read only. Restore is the one prominent action; Delete Now… is plain and red. Secrets stay hidden
/// until Show, and Copy works. There is no Edit: restore the item first.
struct RecentlyDeletedDetail: View {
    let entry: DeletedItem
    let hideSignal: Int
    let restore: () -> Void
    /// Asks the vault screen to confirm: the dialog is attached there, see `ConfirmDeletion`.
    let askDeleteNow: () -> Void

    @State private var revealed: Set<FieldKey> = []
    /// The field whose copy icon is a checkmark, and the pill that names what was copied.
    @State private var copied: FieldKey?
    @State private var pill = CopiedPillModel()

    private typealias FieldKey = ItemField

    private var item: VaultItem { entry.item }

    private var hasNotes: Bool { !item.notes.isEmpty }
    private var hasOtherFields: Bool { item.otherFields?.isEmpty == false }

    private var footer: some View {
        Text(verbatim: RecentlyDeletedText.detailFooter)
            .font(.body)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        page.modifier(HidesRevealedValues(signal: hideSignal) { revealed = [] })
    }

    private var page: some View {
        Form {
            Section {
                actions
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            } header: {
                VStack(spacing: 8) {
                    ItemIcon(item: item, size: 64)
                    Text(verbatim: item.displayTitle)
                        .font(.title.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    Text(item.kind.label).font(.body).foregroundStyle(Color.secondary)
                    Text(verbatim: RecentlyDeletedText.detailLine(deleted: entry.deleted, now: .now))
                        .font(.body)
                        .foregroundStyle(Color.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .textCase(nil)
                .padding(.vertical, 8)
            }
            // The same groups and order as the vault's own page (owner, 2026-11-24): what you copy to sign in or pay, then the notes.
            // The line about the 30 days sits under the last card.
            if !item.filledFirstCardFields.isEmpty {
                Section {
                    ForEach(item.filledFirstCardFields, id: \.self) { field($0) }
                } footer: {
                    if !hasNotes && !hasOtherFields { footer }
                }
            }
            if hasNotes {
                Section {
                    field(.notes)
                } footer: {
                    if !hasOtherFields { footer }
                }
            }
            if let fields = item.otherFields, !fields.isEmpty {
                Section {
                    OtherStoredFields(fields: fields, hideSignal: hideSignal, pill: pill)
                } header: {
                    Text("Other fields")
                } footer: {
                    footer
                }
            }
        }
        .formStyle(.grouped)
        #if os(macOS)
        .navigationTitle(item.displayTitle)
        #else
        // The header already carries the name, so the bar stays quiet instead of repeating it.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .copiedPill(pill)
    }

    /// Restore and Delete Now…, in the content next to the sentence they act on, never in the toolbar.
    private var actions: some View {
        let restoreButton = Button(action: restore) {
            Text("Restore").frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        let deleteButton = Button(role: .destructive, action: askDeleteNow) {
            Text("Delete Now…").frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderless)
        return Group {
            #if os(macOS)
            HStack(spacing: 12) { restoreButton; deleteButton }
            #else
            VStack(spacing: 4) { restoreButton; deleteButton }
            #endif
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    private func field(_ key: FieldKey) -> some View {
        let label = key.label(for: item.kind)
        let value = key == .expiry ? CardExpiry.displayed(item.expiry) : item[key]
        return FieldRow(label: label, value: value,
                        shown: key == .secret ? item.spacedSecret : value,
                        masked: key == .secret ? item.maskedSecret : VaultItem.hiddenMask,
                        hidden: key == .secret || key == .securityCode || item.concealedFields?.contains(key.rawValue) == true,
                        revealed: Binding(get: { revealed.contains(key) },
                                          set: { if $0 { revealed.insert(key) } else { revealed.remove(key) } }),
                        copied: copied == key,
                        copy: { copy(value, as: key, name: String(localized: label)) })
    }

    private func copy(_ value: String, as key: FieldKey, name: String) {
        Clipboard.copy(value)
        copied = key
        pill.show(String(localized: "\(name) copied"))
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            if copied == key { copied = nil }
        }
    }
}
