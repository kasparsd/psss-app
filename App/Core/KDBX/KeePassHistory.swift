import Foundation

/// Revisions: the whole earlier versions of an entry that KDBX keeps under `History`.
///
/// A revision is made when stored content changes, judged over every field (`EntryMapping.sameContent`). A change within
/// ten minutes of the entry's last change that touches no secret is folded into the current version instead. The history is
/// bounded by the file's `HistoryMaxItems` and `HistoryMaxSize`, oldest first, and never gets a copy of its newest version twice.
extension KDBXDocument {
    /// A small, recent change that touches no secret is folded into the current version. Ten minutes.
    static let coalescingWindow: TimeInterval = 10 * 60

    /// KeePass's own default for `HistoryMaxSize`, used when the file does not say: 6 MiB.
    private static let defaultHistoryMaxSize = 6_291_456
    private static let defaultHistoryMaxItems = 10

    // MARK: Writing history

    /// A copy of the entry as it is now, without its own history, ready to become a history item.
    func historySnapshot(of entry: XNode) -> XNode {
        let snapshot = entry.deepCopy()
        snapshot.children.removeAll { $0.name == "History" }
        return snapshot
    }

    /// Appends the snapshot to the entry's history, then trims. A snapshot identical to the newest item already there is not
    /// added again.
    func pushHistory(_ snapshot: XNode, to entry: XNode) {
        let history: XNode
        if let existing = entry.child("History") { history = existing } else {
            history = XNode("History")
            entry.children.append(history)
        }
        if let newest = Self.ordered(history.children).last, newest.isEqual(to: snapshot) { return }
        history.children.append(snapshot)
        trim(history)
    }

    /// Drops the oldest items until the history fits `HistoryMaxItems` (-1 is unlimited) and `HistoryMaxSize` in bytes (-1 is
    /// unlimited). A file that does not say gets KeePass's defaults.
    func trim(_ history: XNode) {
        func dropOldest() {
            guard let oldest = Self.ordered(history.children).first else { return }
            history.children.removeAll { $0 === oldest }
        }
        let maxItems = Int(meta?.child("HistoryMaxItems")?.text.trimmingCharacters(in: .whitespaces) ?? "") ?? Self.defaultHistoryMaxItems
        while maxItems >= 0, history.children.count > maxItems { dropOldest() }
        let maxSize = Int(meta?.child("HistoryMaxSize")?.text.trimmingCharacters(in: .whitespaces) ?? "") ?? Self.defaultHistoryMaxSize
        if maxSize >= 0 {
            var total = history.children.reduce(0) { $0 + historySize(of: $1) }
            while total > maxSize, let oldest = Self.ordered(history.children).first {
                total -= historySize(of: oldest)
                history.children.removeAll { $0 === oldest }
            }
        }
    }

    /// The bytes an item counts for against `HistoryMaxSize`, as KeePass counts them: the text of its strings, tags and custom
    /// data, and the attachments it refers to.
    func historySize(of snapshot: XNode) -> Int {
        var bytes = 0
        for node in snapshot.children {
            switch node.name {
            case "String":
                bytes += (node.child("Key")?.text.utf8.count ?? 0) + (node.child("Value")?.text.utf8.count ?? 0)
            case "Binary":
                bytes += node.child("Key")?.text.utf8.count ?? 0
                if let reference = node.child("Value")?.attribute("Ref").flatMap(Int.init), binaries.indices.contains(reference) {
                    bytes += max(binaries[reference].count - 1, 0)
                }
            case "CustomData":
                for item in node.children(named: "Item") {
                    bytes += (item.child("Key")?.text.utf8.count ?? 0) + (item.child("Value")?.text.utf8.count ?? 0)
                }
            case "Tags", "OverrideURL":
                bytes += node.text.utf8.count
            default:
                break
            }
        }
        return bytes
    }

    /// History items oldest first by their modification time, in file order among equal times. KeePass writes them oldest first
    /// already; other writers may not.
    static func ordered(_ items: [XNode]) -> [XNode] {
        items.enumerated().sorted { lhs, rhs in
            let a = modificationTime(of: lhs.element) ?? .distantPast, b = modificationTime(of: rhs.element) ?? .distantPast
            return a == b ? lhs.offset < rhs.offset : a < b
        }.map(\.element)
    }

    // MARK: Reading history

    /// Every version of the entry's password, oldest first, ending with the current one. A version's time is when that version
    /// was last modified.
    private func passwordVersions(of entry: XNode) -> [(password: String, time: Date?)] {
        var versions = Self.ordered(entry.child("History")?.children ?? []).map {
            (password: EntryMapping.string($0, "Password") ?? "", time: Self.modificationTime(of: $0))
        }
        versions.append((EntryMapping.string(entry, "Password") ?? "", Self.modificationTime(of: entry)))
        return versions
    }

    private func anyEntry(_ id: UUID) -> XNode? {
        let matches = locations().filter { EntryMapping.uuid(of: $0.entry) == id }
        return (matches.first { !$0.inBin } ?? matches.first)?.entry
    }

    /// The passwords the entry had before the current one, newest first, each with when it was replaced. Consecutive versions
    /// with the same password are one row, a password equal to the current one is left out (so is an empty one), and a password
    /// that was replaced twice, with another in between, shows twice. "Replaced" is the modification time of the version that
    /// followed, so after a password change it can be later by up to ten minutes when a small edit was folded into that version.
    func previousPasswords(of id: UUID) -> [(password: String, replaced: Date)] {
        guard let entry = anyEntry(id) else { return [] }
        let versions = passwordVersions(of: entry)
        guard let current = versions.last?.password else { return [] }
        var rows: [(password: String, replaced: Date)] = []
        var start = 0
        while start < versions.count - 1 {
            var end = start
            while end + 1 < versions.count, versions[end + 1].password == versions[start].password { end += 1 }
            let password = versions[start].password
            if end + 1 < versions.count, !password.isEmpty, password != current {
                let replaced = versions[end + 1].time ?? versions[end].time ?? .distantPast
                rows.append((password, replaced))
            }
            start = end + 1
        }
        return rows.reversed()
    }

    /// When the current password was set: the modification time of the oldest history version in the unbroken run that still has
    /// it, derived from the history alone. Nil when unknown: no history, or every recorded version has the same password.
    func passwordChanged(of id: UUID) -> Date? {
        guard let entry = anyEntry(id) else { return nil }
        let versions = passwordVersions(of: entry)
        guard let current = versions.last?.password else { return nil }
        var index = versions.count - 1
        while index > 0, versions[index - 1].password == current { index -= 1 }
        return index == 0 ? nil : versions[index].time
    }

    // MARK: Changing history

    /// Puts an earlier password back as the current one. The row is the one `previousPasswords` gives for that `replaced` time.
    /// It goes through the normal change path, so it is itself a revision and the password it replaces joins the history.
    /// Works on live entries only. Returns false when there is no such row.
    @discardableResult
    func restorePassword(of id: UUID, replacedAt replaced: Date) -> Bool {
        guard let live = locations().first(where: { !$0.inBin && EntryMapping.uuid(of: $0.entry) == id }),
              let row = previousPasswords(of: id).first(where: { abs($0.replaced.timeIntervalSince(replaced)) < 0.5 }),
              var item = EntryMapping.item(from: live.entry, document: self) else { return false }
        item.secret = row.password
        return upsert(item)
    }

    /// Removes the history of one entry, in the document only. Rollback copies and other devices' copies are separate. The
    /// entry's modification time moves forward, without a revision, so a merge by modification time cannot bring the history
    /// back from another copy. Returns whether there was anything to remove.
    @discardableResult
    func clearPreviousPasswords(of id: UUID) -> Bool {
        guard let entry = anyEntry(id), let history = entry.child("History"), !history.children.isEmpty else { return false }
        history.children.removeAll()
        EntryMapping.correctProtection(entry)
        stampModified(entry)
        return true
    }
}
