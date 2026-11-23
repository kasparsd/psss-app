import Foundation

/// What every save does to the document first, so the file it writes is always one a strict reader accepts and never holds
/// leftovers:
/// - Every time is written in the KDBX 4 form. A KDBX 3 file read here, or a file with ISO text times, never leaves a file that
///   mixes the two forms.
/// - Attachments that no entry, history item or Recycle Bin entry refers to any more are dropped from the binary pool, and the
///   remaining references are renumbered everywhere.
/// - A `HistoryMaxItems` or `HistoryMaxSize` that is not a number becomes the default, and a negative one other than -1 becomes -1.
///   KeePassXC refuses a file with such a value.
///
/// Opening a file changes nothing; this runs on the way out. It is idempotent.
extension KDBXDocument {
    /// The elements that hold an instant.
    private static let timeElements: Set<String> = [
        "CreationTime", "LastModificationTime", "LastAccessTime", "ExpiryTime", "LocationChanged", "DeletionTime",
        "DatabaseNameChanged", "DatabaseDescriptionChanged", "DefaultUserNameChanged", "MasterKeyChanged", "RecycleBinChanged",
        "EntryTemplatesGroupChanged", "SettingsChanged"]

    mutating func prepareForSave() {
        normalizeHistoryLimits()
        var references: [(node: XNode, index: Int?)] = []
        root.walk { node in
            if node.name == "Value", let reference = node.attribute("Ref") {
                references.append((node, Int(reference)))
            } else if node.children.isEmpty, Self.timeElements.contains(node.name), KeePassTime.isISO(node.text),
                      let date = KeePassTime.date(node.text) {
                node.text = KeePassTime.stored(date)
            }
        }
        pruneBinaries(references)
    }

    private func normalizeHistoryLimits() {
        for (name, fallback) in [("HistoryMaxItems", 10), ("HistoryMaxSize", 6_291_456)] {
            guard let node = meta?.child(name) else { continue }
            guard let value = Int(node.text.trimmingCharacters(in: .whitespacesAndNewlines)) else { node.text = String(fallback); continue }
            if value < -1 || value > Int(Int32.max) { node.text = "-1" }
        }
    }

    /// Drops unreferenced binaries and renumbers. A file with a reference to a binary that is not there is left alone: its
    /// references cannot be renumbered safely.
    private mutating func pruneBinaries(_ references: [(node: XNode, index: Int?)]) {
        var used = Set<Int>()
        for reference in references {
            guard let index = reference.index, binaries.indices.contains(index) else { return }
            used.insert(index)
        }
        guard used.count < binaries.count else { return }
        let kept = used.sorted()
        var renumbered: [Int: Int] = [:]
        for (new, old) in kept.enumerated() { renumbered[old] = new }
        for reference in references { reference.node.setAttribute("Ref", String(renumbered[reference.index!]!)) }
        binaries = kept.map { binaries[$0] }
    }
}
