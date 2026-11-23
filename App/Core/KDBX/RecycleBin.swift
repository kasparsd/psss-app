import Foundation

/// The Recycle Bin: what "Recently Deleted" shows, on the codec side.
///
/// Deleting moves an entry to the standard Recycle Bin group (name "Recycle Bin", icon 43, `Meta/RecycleBinUUID`), the one
/// KeePass and KeePassXC use, so those apps show it too. KDBX records only `LocationChanged` for a move, so the group the entry
/// came from and the deletion time are kept in the entry's custom data (`PSSS_DELETED_FROM`, `PSSS_DELETED_AT`): restore needs
/// the first and the 30-day countdown needs the second. An entry another app recycled has neither, and then restore puts it in
/// the root group and its deletion time is its `LocationChanged`.
///
/// An entry's deletion time is the latest of its own `LocationChanged`, the `LocationChanged` of every group between the bin and
/// the entry (another app that recycles a whole group stamps only the group), and its `PSSS_DELETED_AT`. With none of them the
/// time is unknown and the entry is never purged. The countdown and the date shown use that one time. Psss's two custom data
/// items are dropped from an entry found outside the bin, so an entry another app took out of the bin and recycled again starts
/// a new countdown.
///
/// Entries in the bin stay out of `items()`, of AutoFill and of import duplicate matching. Only a permanent delete writes a
/// `DeletedObject`, and only a permanent delete, not a move, adds the entry's import source to the list of deleted sources
/// (`DeletedSources`, which the importer reads).
enum RecycleBinKeys {
    /// The group UUID (as stored in the file) the entry was deleted from.
    static let deletedFrom = "PSSS_DELETED_FROM"
    /// When Psss moved the entry to the bin, as ISO 8601 text.
    static let deletedAt = "PSSS_DELETED_AT"
    /// The importer's identifier of the entry, as an entry's custom data.
    static let source = "PSSS_SOURCE"
    /// How long an item stays in the bin before the app purges it, when the vault is opened.
    static let retention: TimeInterval = 30 * 24 * 60 * 60
}

extension EntryMapping {
    static func customData(_ entry: XNode, _ key: String) -> String? {
        entry.child("CustomData")?.children(named: "Item").first { $0.child("Key")?.text == key }?.child("Value")?.text
    }

    /// Sets, adds or (with nil) removes one custom data item of an entry. A `CustomData` made here goes before `History`.
    static func setCustomData(_ entry: XNode, _ key: String, _ value: String?, modified: String) {
        let container = entry.child("CustomData")
        let existing = container?.children(named: "Item").first { $0.child("Key")?.text == key }
        guard let value else {
            if let existing, let container {
                container.children.removeAll { $0 === existing }
                if container.children.isEmpty { entry.children.removeAll { $0 === container } }
            }
            return
        }
        if let existing {
            existing.setChildText("Value", value)
            existing.setChildText("LastModificationTime", modified)
            return
        }
        let item = XNode("Item", children: [XNode("Key", text: key), XNode("Value", text: value), XNode("LastModificationTime", text: modified)])
        if let container { container.children.append(item); return }
        let node = XNode("CustomData", children: [item])
        entry.children.insert(node, at: entry.children.firstIndex { $0.name == "History" } ?? entry.children.endIndex)
    }

    /// The import identifier of an entry: its `PSSS_SOURCE` custom data, or the string of that name older imports wrote.
    static func sourceIdentifier(of entry: XNode) -> String? {
        let value = customData(entry, RecycleBinKeys.source) ?? string(entry, RecycleBinKeys.source)
        return value.flatMap { $0.isEmpty ? nil : $0 }
    }
}

extension KDBXDocument {
    // MARK: Finding

    private func group(withID id: String, outsideBin: Bool) -> XNode? {
        let bin = recycleBinID
        func visit(_ group: XNode) -> XNode? {
            if outsideBin, let bin, group.child("UUID")?.text == bin { return nil }
            if group.child("UUID")?.text == id { return group }
            for child in group.children(named: "Group") { if let found = visit(child) { return found } }
            return nil
        }
        return rootGroup.flatMap(visit)
    }

    /// The bin group, made when `creating` and it does not exist. Making it sets `RecycleBinEnabled`, `RecycleBinUUID` and
    /// `RecycleBinChanged`. When another app switched the bin off but `RecycleBinUUID` still names a group, that group is
    /// reused and the flag is set back on: deleting here can always be undone, and a second "Recycle Bin" group would be a mess.
    /// The entries already in that group start a 30-day countdown now, so none that was visible is purged at once.
    private func recycleBinGroup(creating: Bool) -> XNode? {
        if let id = recycleBinID, let existing = group(withID: id, outsideBin: false) { return existing }
        guard creating, let rootGroup, let meta else { return nil }
        let now = KeePassTime.storedNow
        if let id = rawRecycleBinID, let existing = group(withID: id, outsideBin: false) {
            existing.walk { node in
                guard node.name == "Entry", EntryMapping.customData(node, RecycleBinKeys.deletedAt) == nil else { return }
                EntryMapping.setCustomData(node, RecycleBinKeys.deletedAt, KeePassTime.string(KeePassTime.now), modified: now)
            }
            meta.setChildText("RecycleBinEnabled", "True")
            meta.setChildText("RecycleBinChanged", now)
            return existing
        }
        let zero = Data(count: 16).base64EncodedString()
        let id = UUID().kdbxBase64
        func times() -> XNode {
            XNode("Times", children: [XNode("CreationTime", text: now), XNode("LastModificationTime", text: now),
                                      XNode("LastAccessTime", text: now), XNode("ExpiryTime", text: now),
                                      XNode("Expires", text: "False"), XNode("UsageCount", text: "0"),
                                      XNode("LocationChanged", text: now)])
        }
        let bin = XNode("Group", children: [
            XNode("UUID", text: id), XNode("Name", text: "Recycle Bin"), XNode("Notes"), XNode("IconID", text: "43"), times(),
            XNode("IsExpanded", text: "False"), XNode("DefaultAutoTypeSequence"),
            XNode("EnableAutoType", text: "False"), XNode("EnableSearching", text: "False"), XNode("LastTopVisibleEntry", text: zero)])
        rootGroup.children.append(bin)
        meta.setChildText("RecycleBinEnabled", "True")
        meta.setChildText("RecycleBinUUID", id)
        meta.setChildText("RecycleBinChanged", now)
        return bin
    }

    /// Removes Psss's deleted-from and deleted-at items from an entry that is not in the bin. They only make sense there.
    @discardableResult
    func dropStaleBinMarks(of entry: XNode) -> Bool {
        guard entry.child("CustomData") != nil else { return false }
        var dropped = false
        for key in [RecycleBinKeys.deletedFrom, RecycleBinKeys.deletedAt] where EntryMapping.customData(entry, key) != nil {
            EntryMapping.setCustomData(entry, key, nil, modified: "")
            dropped = true
        }
        return dropped
    }

    private func liveLocation(_ id: UUID) -> EntryLocation? {
        locations().first { !$0.inBin && EntryMapping.uuid(of: $0.entry) == id }
    }

    private func binLocation(_ id: UUID) -> EntryLocation? {
        locations().first { $0.inBin && EntryMapping.uuid(of: $0.entry) == id }
    }

    // MARK: Moving to the bin and back

    /// Moves a live entry, with its history, to the Recycle Bin (made on first use), remembers where it came from and when,
    /// and sets its `LocationChanged`. Returns false when there is no such live entry.
    @discardableResult
    func moveToRecycleBin(_ id: UUID) -> Bool { moveToRecycleBin([id]) > 0 }

    /// Moves live entries to the bin in one pass over the document, however many. Returns how many entries moved (an identifier
    /// with no live entry is skipped).
    @discardableResult
    func moveToRecycleBin(_ ids: [UUID]) -> Int {
        let all = locations()
        for other in all where !other.inBin { dropStaleBinMarks(of: other.entry) }
        var wanted = Set(ids)
        let picked = all.filter { location in
            guard !location.inBin, let id = EntryMapping.uuid(of: location.entry) else { return false }
            return wanted.remove(id) != nil
        }
        guard !picked.isEmpty, let bin = recycleBinGroup(creating: true) else { return 0 }
        let now = KeePassTime.now
        let stored = KeePassTime.stored(now), text = KeePassTime.string(now)
        removeEntries(picked)
        for location in picked {
            EntryMapping.correctProtection(location.entry)
            bin.children.append(location.entry)
            EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedFrom, location.group.child("UUID")?.text, modified: stored)
            EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedAt, text, modified: stored)
            ensureTimes(location.entry).times.setChildText("LocationChanged", stored)
        }
        return picked.count
    }

    /// Takes the entries out of the groups they are in: one pass per group, not one per entry.
    private func removeEntries(_ locations: [EntryLocation]) {
        var byGroup: [ObjectIdentifier: (group: XNode, doomed: Set<ObjectIdentifier>)] = [:]
        for location in locations { byGroup[ObjectIdentifier(location.group), default: (location.group, [])].doomed.insert(ObjectIdentifier(location.entry)) }
        for (_, pair) in byGroup { pair.group.children.removeAll { pair.doomed.contains(ObjectIdentifier($0)) } }
    }

    /// Puts a deleted entry back in the group it came from, or the root group when that group is gone or was never recorded.
    /// Refuses (false) when a live entry has the same identifier, so a restore never makes a duplicate; the copy in the bin stays
    /// until it is deleted for good.
    @discardableResult
    func restoreFromRecycleBin(_ id: UUID) -> Bool { restoreFromRecycleBin([id]) > 0 }

    /// Restores entries in one pass. Returns how many came back; one whose identifier a live entry has is refused.
    @discardableResult
    func restoreFromRecycleBin(_ ids: [UUID]) -> Int {
        let all = locations()
        for other in all where !other.inBin { dropStaleBinMarks(of: other.entry) }
        let live = Set(all.filter { !$0.inBin }.compactMap { EntryMapping.uuid(of: $0.entry) })
        var wanted = Set(ids)
        let picked = all.filter { location in
            guard location.inBin, let id = EntryMapping.uuid(of: location.entry), !live.contains(id) else { return false }
            return wanted.remove(id) != nil
        }
        guard !picked.isEmpty else { return 0 }
        var groups: [String: XNode] = [:]
        let bin = recycleBinID
        func collect(_ group: XNode) {
            guard let id = group.child("UUID")?.text, id != bin else { return }
            groups[id] = group
            for child in group.children where child.name == "Group" { collect(child) }
        }
        if let rootGroup { collect(rootGroup) }
        let stored = KeePassTime.storedNow
        removeEntries(picked)
        for location in picked {
            let target = EntryMapping.customData(location.entry, RecycleBinKeys.deletedFrom).flatMap { groups[$0] } ?? rootGroup
            EntryMapping.correctProtection(location.entry)
            (target ?? location.group).children.append(location.entry)
            EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedFrom, nil, modified: stored)
            EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedAt, nil, modified: stored)
            ensureTimes(location.entry).times.setChildText("LocationChanged", stored)
        }
        return picked.count
    }

    /// The restored entry's new location, or nil when it was refused. `knownUnique` skips the scan for a live entry with the same
    /// identifier, for a caller that has already looked.
    func restoreFromBin(_ location: EntryLocation, knownUnique: Bool = false) -> EntryLocation? {
        guard location.inBin, let id = EntryMapping.uuid(of: location.entry), knownUnique || liveLocation(id) == nil else { return nil }
        let from = EntryMapping.customData(location.entry, RecycleBinKeys.deletedFrom)
        guard let target = from.flatMap({ group(withID: $0, outsideBin: true) }) ?? rootGroup else { return nil }
        let stored = KeePassTime.storedNow
        EntryMapping.correctProtection(location.entry)
        location.group.children.removeAll { $0 === location.entry }
        target.children.append(location.entry)
        EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedFrom, nil, modified: stored)
        EntryMapping.setCustomData(location.entry, RecycleBinKeys.deletedAt, nil, modified: stored)
        ensureTimes(location.entry).times.setChildText("LocationChanged", stored)
        return EntryLocation(entry: location.entry, group: target, inBin: false)
    }

    // MARK: Reading the bin

    /// What the file says about when an entry in the bin was deleted: the latest of its own `LocationChanged`, the
    /// `LocationChanged` of the groups between the bin and it, and Psss's own record. `unreadable` is set when any of that
    /// evidence is present but cannot be read (damaged text, a date outside years 1 to 9999): such an entry is never purged.
    private func deletion(of location: EntryLocation) -> (date: Date?, unreadable: Bool) {
        var unreadable = location.groupUnreadable
        var dates: [Date] = []
        if let text = EntryMapping.customData(location.entry, RecycleBinKeys.deletedAt) {
            if let date = KeePassTime.date(text) { dates.append(date) } else { unreadable = true }
        }
        let own = Self.locationChangedEvidence(of: location.entry)
        if own.present { if let date = own.date { dates.append(date) } else { unreadable = true } }
        if let group = location.groupDeleted { dates.append(group) }
        return (dates.max(), unreadable)
    }

    /// What is in the bin, newest deletion first. An entry with no readable deletion time shows as deleted now, so does one
    /// whose time is in the future, and neither is ever purged.
    func recycledItems() -> [(item: VaultItem, deleted: Date)] {
        let now = KeePassTime.now
        return locations().filter(\.inBin).compactMap { location -> (item: VaultItem, deleted: Date)? in
            EntryMapping.item(from: location.entry, document: self).map { (item: $0, deleted: min(deletion(of: location).date ?? now, now)) }
        }.sorted { $0.deleted > $1.deleted }
    }

    // MARK: Deleting for good

    /// Removes the entry for good, from the live entries or the bin, and records the deletion in `DeletedObjects`. Its import
    /// source, if it has one, goes on the list of deleted sources. Returns false when there is no such entry.
    @discardableResult
    func deletePermanently(_ id: UUID) -> Bool { deletePermanently([id]) > 0 }

    /// Removes the entries for good in one pass, wherever they are. Returns how many identifiers matched an entry.
    @discardableResult
    func deletePermanently(_ ids: [UUID]) -> Int {
        let all = locations()
        for location in all where !location.inBin { dropStaleBinMarks(of: location.entry) }
        let wanted = Set(ids)
        let matches = all.filter { EntryMapping.uuid(of: $0.entry).map(wanted.contains) ?? false }
        guard !matches.isEmpty else { return 0 }
        remove(matches)
        return Set(matches.compactMap { EntryMapping.uuid(of: $0.entry) }).count
    }

    /// Deletes everything in the bin for good, subgroups of the bin included. Returns how many entries went.
    @discardableResult
    func emptyRecycleBin() -> Int {
        let all = locations()
        for location in all where !location.inBin { dropStaleBinMarks(of: location.entry) }
        let doomed = all.filter(\.inBin)
        remove(doomed)
        if let bin = recycleBinGroup(creating: false) {
            for subgroup in bin.children(named: "Group") {
                bin.children.removeAll { $0 === subgroup }
                recordDeletion(of: subgroup)
            }
        }
        return doomed.count
    }

    /// Deletes for good every entry in the bin that was deleted more than `interval` seconds before `now` (an entry deleted
    /// exactly `interval` ago stays), by the time `recycledItems` shows. A group in the bin that is left empty, and whose own time
    /// is also past the limit, goes too, so no empty shell stays; a group that still holds a younger entry or group stays, and so
    /// does anything with no known time. Returns how many entries went. The app calls it with 30 days when it opens a vault.
    @discardableResult
    func purgeRecycleBin(olderThan interval: TimeInterval, now: Date) -> Int {
        purgeRecycleBinReport(olderThan: interval, now: now).entries
    }

    /// `purgeRecycleBin`, also saying how many empty groups went, since a purge that removed only those still changes the file.
    func purgeRecycleBinReport(olderThan interval: TimeInterval, now: Date) -> (entries: Int, groups: Int) {
        var groupsRemoved = 0
        let all = locations()
        for location in all where !location.inBin { dropStaleBinMarks(of: location.entry) }
        let doomed = all.filter { location in
            guard location.inBin else { return false }
            let evidence = deletion(of: location)
            // Evidence that is present but unreadable, a time in the future, or no time at all never purges.
            guard !evidence.unreadable, let date = evidence.date, date <= now else { return false }
            return now.timeIntervalSince(date) > interval
        }
        remove(doomed)
        func prune(_ group: XNode, floor: Date?, blocked: Bool) {
            for subgroup in group.children(named: "Group") {
                let own = Self.locationChangedEvidence(of: subgroup)
                let time = [floor, own.date].compactMap { $0 }.max()
                let unreadable = blocked || (own.present && own.date == nil)
                prune(subgroup, floor: time, blocked: unreadable)
                guard !subgroup.children.contains(where: { $0.name == "Entry" || $0.name == "Group" }), !unreadable,
                      let time, time <= now, now.timeIntervalSince(time) > interval else { continue }
                group.children.removeAll { $0 === subgroup }
                recordDeletion(of: subgroup)
                groupsRemoved += 1
            }
        }
        if let bin = recycleBinGroup(creating: false) { prune(bin, floor: nil, blocked: false) }
        return (doomed.count, groupsRemoved)
    }

    private func remove(_ locations: [EntryLocation]) {
        // One pass per group, not one per entry, so deleting thousands of entries is not quadratic.
        var byGroup: [ObjectIdentifier: (group: XNode, doomed: Set<ObjectIdentifier>)] = [:]
        var sources: [String] = []
        for location in locations {
            let key = ObjectIdentifier(location.group)
            byGroup[key, default: (location.group, [])].doomed.insert(ObjectIdentifier(location.entry))
            recordDeletion(of: location.entry)
            // So a later import does not bring back what was deleted for good. The list and its format belong to the importer.
            if let source = EntryMapping.sourceIdentifier(of: location.entry) { sources.append(source) }
        }
        if !sources.isEmpty { DeletedSources.record(sources, in: root) }
        for (_, pair) in byGroup { pair.group.children.removeAll { pair.doomed.contains(ObjectIdentifier($0)) } }
    }

    private func recordDeletion(of node: XNode) {
        guard let rootNode, let id = node.child("UUID")?.text else { return }
        let deleted: XNode
        if let existing = rootNode.child("DeletedObjects") { deleted = existing } else {
            deleted = XNode("DeletedObjects")
            rootNode.children.append(deleted)
        }
        deleted.children.append(XNode("DeletedObject", children: [XNode("UUID", text: id), XNode("DeletionTime", text: KeePassTime.storedNow)]))
    }
}
