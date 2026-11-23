import Foundation

/// The identifiers of imported items the person deleted in Psss, kept in the vault's own `Meta` custom data so a later import
/// does not bring them back. The importer reads the list. The delete path calls `record` when an entry that has a source
/// identifier is deleted, with the document's root node:
///
///     if let id = KeePassImport.sourceID(of: entry) { DeletedSources.record(id, in: document.root) }
///
/// The value is a JSON array of strings. Only identifiers are kept, never titles or values.
enum DeletedSources {
    static let key = "PSSS_DELETED_SOURCES"
    /// More than this many are not kept, oldest dropped first, so the list cannot grow without bound.
    static let limit = 100_000

    private static func item(in root: XNode) -> XNode? {
        root.child("Meta")?.child("CustomData")?.children(named: "Item").first { $0.child("Key")?.text == key }
    }

    /// The identifiers in the list. A list that cannot be read counts as empty.
    static func read(from root: XNode) -> Set<String> {
        guard let text = item(in: root)?.child("Value")?.text, let data = text.data(using: .utf8),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [String] else { return [] }
        return Set(list)
    }

    /// The list as last read or written, so many single `record` calls in a row do not parse it again each time.
    private struct Cached { var text: String; var list: [String]; var members: Set<String> }
    nonisolated(unsafe) private static var cache: Cached?
    private static let lock = NSLock()

    private static func parse(_ text: String) -> [String] {
        guard let data = text.data(using: .utf8), let list = (try? JSONSerialization.jsonObject(with: data)) as? [String] else { return [] }
        return list
    }

    private static func encode(_ list: [String]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: list) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Adds an identifier. Does nothing when it is there already. Calling this once per entry while emptying a bin works, but
    /// `record(_:in:)` with all the identifiers reads and writes the list once.
    static func record(_ sourceID: String, in root: XNode) { record([sourceID], in: root) }

    /// Adds identifiers, reading and writing the list once however many there are. Identifiers are cleaned the way the file stores
    /// text before they are compared, so one with a control character is not listed twice. When the list passes `limit`, the
    /// oldest are dropped.
    static func record(_ ids: some Sequence<String>, in root: XNode) {
        lock.lock(); defer { lock.unlock() }
        guard let meta = root.child("Meta") else { return }
        let existing = item(in: root)
        let text = existing?.child("Value")?.text ?? ""
        var current: Cached
        if let cache, cache.text == text { current = cache } else {
            let list = parse(text)
            current = Cached(text: text, list: list, members: Set(list))
        }
        var added: [String] = []
        for raw in ids {
            let id = ImportText.clean(raw)
            if id.isEmpty || !current.members.insert(id).inserted { continue }
            added.append(id)
        }
        guard !added.isEmpty else { return }
        var newText: String?
        if current.list.count + added.count > limit {
            current.list = Array((current.list + added).suffix(limit))
            current.members = Set(current.list)
            newText = encode(current.list)
        } else {
            // Append to the text itself, so one more identifier costs one copy of the text and not a parse.
            current.list += added
            if let tail = encode(added), tail.count >= 2, current.text.hasSuffix("]"), !current.list.isEmpty, current.list.count > added.count {
                newText = String(current.text.dropLast()) + "," + String(tail.dropFirst())
            } else {
                newText = encode(current.list)
            }
        }
        guard let newText else { return }
        current.text = newText
        cache = current
        let now = ImportTime.iso(Date())
        if let existing {
            existing.setChildText("Value", newText)
            existing.setChildText("LastModificationTime", now)
        } else {
            let custom = meta.child("CustomData") ?? {
                let node = XNode("CustomData")
                meta.children.append(node)
                return node
            }()
            custom.children.append(XNode("Item", children: [XNode("Key", text: key), XNode("Value", text: newText), XNode("LastModificationTime", text: now)]))
        }
    }
}
