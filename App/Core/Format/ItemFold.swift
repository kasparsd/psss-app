import Foundation

// Item change records, kind 16 (spec section 5.1): the payload shape and folding into state.

/// A field name is text; two names are the same only when their UTF-8 bytes are (section 2: no normalization).
struct ItemChange: Equatable, Sendable {
    var itemID: Data
    var set: [(name: Data, value: CBORValue)]
    var clear: [Data]
    /// Integer keys of 128 and above in the payload, kept and otherwise ignored.
    var extensionKeys: [UInt64]

    static func == (a: ItemChange, b: ItemChange) -> Bool {
        a.itemID == b.itemID && a.clear == b.clear && a.extensionKeys == b.extensionKeys
            && a.set.count == b.set.count && zip(a.set, b.set).allSatisfy { $0.name == $1.name && $0.value == $1.value }
    }

    /// The reserved field of section 5.1.
    static let deletedField = Data("deleted".utf8)

    /// Checks a kind 16 payload `{ 1: item_id (16 bytes), 2: set, 3: clear }`: set is a map with text keys, clear a sorted
    /// array of text, no name in both, and `deleted`, when set, an unsigned integer. Other keys below 128 are refused.
    static func parse(payload: CBORValue) throws -> ItemChange {
        let bad = FormatError("bad_payload", .discard)
        guard let entries = payload.mapEntries else { throw bad }
        var itemID: Data?
        var setValue: CBORValue?
        var clearValue: CBORValue?
        var extensions: [UInt64] = []
        for entry in entries {
            guard let key = entry.key.uintValue else { throw bad }
            switch key {
            case 1: itemID = entry.value.bytesValue
            case 2: setValue = entry.value
            case 3: clearValue = entry.value
            case 128...: extensions.append(key)
            default: throw bad
            }
        }
        guard let itemID, itemID.count == 16, let setValue, let clearValue,
              let setEntries = setValue.mapEntries, let clearItems = clearValue.arrayValue else { throw bad }
        var set: [(name: Data, value: CBORValue)] = []
        for entry in setEntries {
            guard let name = entry.key.textValue else { throw bad }
            set.append((Data(name.utf8), entry.value))
        }
        var clear: [Data] = []
        for item in clearItems {
            guard let name = item.textValue else { throw bad }
            clear.append(Data(name.utf8))
        }
        guard (try? FormatCBOR.isSorted(clearItems)) == true else { throw bad }
        let setNames = Set(set.map(\.name))
        guard clear.allSatisfy({ !setNames.contains($0) }) else { throw bad }
        if let deleted = set.first(where: { $0.name == deletedField }), deleted.value.uintValue == nil { throw bad }
        return ItemChange(itemID: itemID, set: set, clear: clear, extensionKeys: extensions.sorted())
    }
}

/// One write of one field, with its place in the order. `value` is nil for a clear.
struct ItemWrite: Equatable, Sendable {
    var order: RecordOrder
    var value: CBORValue?
}

struct FieldState: Equatable, Sendable {
    /// The greatest write: a set (the value) or a clear.
    var current: ItemWrite
    /// The writes that lost, oldest first. (The specification does not fix the order of history.)
    var history: [ItemWrite]
}

struct ItemState: Equatable, Sendable {
    /// Field name (UTF-8 bytes) to state; includes the reserved `deleted` field when it was ever written.
    var fields: [Data: FieldState]

    /// In Recently Deleted: `deleted` is set and no other field has a winning write strictly later than the winning write of
    /// `deleted` (section 5.1). Every field other than `deleted` counts as a content field here; the item schema, which
    /// names the bookkeeping fields, is outside this implementation.
    var isDeleted: Bool {
        guard let deleted = fields[ItemChange.deletedField], deleted.current.value != nil else { return false }
        return !fields.contains { $0.key != ItemChange.deletedField && $0.value.current.order > deleted.current.order }
    }
}

enum ItemFold {
    /// Folds changes, each with the place of its record in the order, into item states. The result does not depend on the
    /// order of `changes`, and a change listed twice counts once.
    static func fold(_ changes: [(order: RecordOrder, change: ItemChange)]) throws -> [Data: ItemState] {
        var writes: [Data: [Data: [RecordOrder: ItemWrite]]] = [:]
        func add(_ item: Data, _ field: Data, _ write: ItemWrite) throws {
            if let existing = writes[item]?[field]?[write.order] {
                // The same place twice is the same write. If the two disagree (a fork that was not caught), take the greater
                // one by its bytes so that the result still does not depend on the order of arrival.
                let a = try existing.value.map { try FormatCBOR.encode($0) }
                let b = try write.value.map { try FormatCBOR.encode($0) }
                let keepNew: Bool
                switch (a, b) {
                case (nil, nil): keepNew = false
                case (nil, _): keepNew = true
                case (_, nil): keepNew = false
                case let (x?, y?): keepNew = x.formatLess(than: y)
                }
                if !keepNew { return }
            }
            writes[item, default: [:]][field, default: [:]][write.order] = write
        }
        for (order, change) in changes {
            for entry in change.set { try add(change.itemID, entry.name, ItemWrite(order: order, value: entry.value)) }
            for name in change.clear { try add(change.itemID, name, ItemWrite(order: order, value: nil)) }
        }
        var state: [Data: ItemState] = [:]
        for (item, fields) in writes {
            var itemState = ItemState(fields: [:])
            for (name, byOrder) in fields {
                let sorted = byOrder.values.sorted { $0.order < $1.order }
                itemState.fields[name] = FieldState(current: sorted[sorted.count - 1], history: Array(sorted.dropLast()))
            }
            state[item] = itemState
        }
        return state
    }
}
