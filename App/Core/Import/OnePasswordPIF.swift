import Foundation

/// Reads a 1Password 7 export (1PIF): a folder that ends in `.1pif` holding `data.1pif` and, when items have files, an
/// `attachments` folder. The file is read in chunks, one record per line, and nothing is loaded whole. A line that cannot
/// be read is skipped and reported, never fatal.
enum OnePasswordPIF {
    struct Limits: Sendable {
        var dataFileBytes = 256 * 1024 * 1024
        var lineBytes = 16 * 1024 * 1024
        var items = 100_000
        var attachmentBytes = 25 * 1024 * 1024
        var allAttachmentBytes = 150 * 1024 * 1024
        var attachmentsPerItem = 100

        static let standard = Limits()
    }

    static let dataFileName = "data.1pif"
    static let separator = Data("***5642bee8-a5ff-11dc-8314-0800200c9a66***".utf8)

    /// Windows category codes, translated to the Mac type names the mapping keys on.
    static let windowsCategories: [String: String] = [
        "001": PlanBuilder.loginType, "002": PlanBuilder.cardType, "003": PlanBuilder.noteType, "004": "identities.Identity",
        "005": PlanBuilder.passwordType, "100": "wallet.computer.License", "101": "wallet.financial.BankAccountUS",
        "102": "wallet.computer.Database", "103": "wallet.government.DriversLicense", "104": "wallet.government.HuntingLicense",
        "105": "wallet.membership.Membership", "106": "wallet.government.Passport", "107": "wallet.membership.RewardProgram",
        "108": "wallet.government.SsnUS", "109": "wallet.computer.Router", "110": "wallet.computer.UnixServer",
        "111": "wallet.onlineservices.Email.v2"
    ]

    /// Reads the export at a folder or at its `data.1pif`.
    static func plan(from url: URL, limits: Limits = .standard, now: Date = .now) throws -> ImportPlan {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { throw ImportError.notAnExport }
        let dataURL: URL, exportRoot: URL?
        if isDirectory.boolValue {
            dataURL = url.appendingPathComponent(dataFileName)
            guard FileManager.default.fileExists(atPath: dataURL.path) else { throw ImportError.notAnExport }
            exportRoot = url
        } else {
            dataURL = url
            exportRoot = nil
        }
        let size = (try? dataURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= limits.dataFileBytes else { throw ImportError.tooLarge }

        var plan = ImportPlan(source: .onePasswordPIF)
        plan.importedAt = now
        plan.pickedDataFileOnly = exportRoot == nil
        let attachments = exportRoot.map { Attachments(root: $0, limits: limits) }
        plan.attachmentsFolderFound = attachments?.folderExists ?? false

        var folders: [String: (title: String, parent: String?)] = [:]
        var folderIDs: [String] = []                      // per item: the folder it sits in
        var validRecords = 0, encodingFallbacks = 0, lineNumber = 0, inBrokenRecord = false, sawWindows = false
        var sawContent = false
        var allAttachmentBytes = 0

        func unreadable(_ kind: ImportIssue.Kind, _ detail: String) {
            plan.skipped.unreadable += 1
            plan.issues.append(ImportIssue(kind: kind, item: nil, detail: detail))
        }

        var tooMany = false
        try readLines(dataURL, maxLine: limits.lineBytes) { event in
            lineNumber += 1
            guard case .line(var bytes) = event else {
                unreadable(.lineTooLong, String(localized: "Line \(lineNumber) is longer than 16 MB and was not read"))
                inBrokenRecord = true
                sawContent = true
                return true
            }
            if lineNumber == 1, bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes.removeFirst(3) }
            if bytes.last == 0x0D { bytes.removeLast() }
            let trimmed = trim(bytes)
            if trimmed.isEmpty { return true }
            sawContent = true
            if trimmed == separator { inBrokenRecord = false; return true }
            guard trimmed.first == UInt8(ascii: "{") else {
                if !inBrokenRecord { unreadable(.unreadableRecord, String(localized: "Line \(lineNumber) is not a record and was skipped")) }
                return true
            }
            inBrokenRecord = false
            guard let (object, fellBack) = parse(trimmed) else {
                inBrokenRecord = true
                unreadable(.unreadableRecord, String(localized: "Line \(lineNumber) could not be read and was skipped"))
                return true
            }
            if fellBack { encodingFallbacks += 1 }

            switch classify(object) {
            case .ignored: validRecords += 1
            case .invalid:
                unreadable(.unreadableRecord, String(localized: "Line \(lineNumber) is not a 1Password item and was skipped"))
            case .folder(let id, let title, let parent):
                validRecords += 1
                folders[id] = (title, parent)
            case .item(let record, let trashed, let folder, let windows):
                validRecords += 1
                sawWindows = sawWindows || windows
                plan.recordCount += 1
                if trashed { plan.skipped.trashed += 1; return true }
                if plan.items.count >= limits.items { tooMany = true; return false }
                var built = PlanBuilder.build(record, now: now)
                plan.skipped.webFormFields += built.webFormFields
                if built.missingDate { plan.missingDates += 1 }
                if let attachments {
                    let found = attachments.list(uuid: record.uuid, title: built.item.title, totalBytes: &allAttachmentBytes)
                    built.item.attachments = found.files
                    built.item.issues += found.issues
                }
                plan.items.append(built.item)
                folderIDs.append(folder ?? "")
            }
            return true
        }
        if tooMany { throw ImportError.tooLarge }
        guard validRecords > 0 else { throw sawContent ? ImportError.notAnExport : ImportError.empty }
        guard !plan.items.isEmpty || plan.skipped.trashed > 0 else { throw ImportError.empty }

        if encodingFallbacks > 0 {
            plan.issues.append(ImportIssue(kind: .textEncoding, item: nil,
                                           detail: String(localized: "\(encodingFallbacks) records were not UTF-8 and were read as Windows text, so some characters may differ")))
        }
        if sawWindows {
            plan.lowConfidence = true
            plan.issues.append(ImportIssue(kind: .windowsExport, item: nil,
                                           detail: String(localized: "This export looks like 1Password for Windows, which is less tested. Check the imported items")))
        }
        for index in plan.items.indices { plan.items[index].folder = path(of: folderIDs[index], in: folders) }
        return plan
    }

    // MARK: Records

    private enum Classified {
        case item(OnePasswordRecord, trashed: Bool, folder: String?, windows: Bool)
        case folder(id: String, title: String, parent: String?)
        case ignored
        case invalid
    }

    private static func classify(_ object: [String: Any]) -> Classified {
        typealias V = PlanBuilder.Value
        if let typeName = object["typeName"] as? String {
            // Folders are records. Saved searches, tombstones and anything else the app keeps for itself are not items.
            if typeName == "system.folder.Regular" {
                let id = (object["uuid"] as? String) ?? ""
                return id.isEmpty ? .ignored : .folder(id: id, title: (object["title"] as? String) ?? "", parent: nonEmpty(object["folderUuid"]))
            }
            if typeName.hasPrefix("system.") { return .ignored }
            let open = object["openContents"] as? [String: Any]
            let secure = (object["secureContents"] as? [String: Any]) ?? [:]
            let urls = ((secure["URLs"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any])?["url"] as? String }
            let favourite = [object["faveIndex"], open?["faveIndex"]].contains { isFavourite($0) }
            let overview = (object["unknown_overview"] ?? open?["unknown_overview"] ?? secure["unknown_overview"]) as? [String: Any]
            let record = OnePasswordRecord(
                uuid: (object["uuid"] as? String) ?? "", typeName: typeName, title: (object["title"] as? String) ?? "",
                created: V.epoch(object["createdAt"]), updated: V.epoch(object["updatedAt"]), favourite: favourite,
                tags: ((open?["tags"] as? [Any]) ?? []).compactMap { $0 as? String }, location: (object["location"] as? String) ?? "",
                websites: urls, secure: secure, fallbackTitle: (overview?["title"] as? String) ?? "")
            return .item(record, trashed: V.isBool(object["trashed"]) ? (object["trashed"] as? Bool ?? false) : (V.number(object["trashed"]) ?? 0) != 0,
                         folder: nonEmpty(object["folderUuid"]), windows: false)
        }

        // Windows: a category code, an overview and the details. Detected by that, not by the signature field.
        guard let code = V.scalarText(object["category"]) else { return .invalid }
        if object["parent"] != nil, object["details"] == nil {
            let id = (object["uuid"] as? String) ?? ""
            let overview = object["overview"] as? [String: Any]
            return id.isEmpty ? .ignored : .folder(id: id, title: (overview?["title"] as? String) ?? (object["title"] as? String) ?? "", parent: nonEmpty(object["parent"]))
        }
        guard let overview = object["overview"] as? [String: Any] else { return .ignored }
        let secure = (object["details"] as? [String: Any]) ?? [:]
        var urls = ((overview["URLs"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any])?["u"] as? String }
        if urls.isEmpty, let single = overview["url"] as? String, !single.isEmpty { urls = [single] }
        let record = OnePasswordRecord(
            uuid: (object["uuid"] as? String) ?? "", typeName: windowsCategories[code] ?? "category:\(code)",
            title: (overview["title"] as? String) ?? "", created: V.epoch(object["created"]), updated: V.epoch(object["updated"]),
            favourite: isFavourite(object["fave"], positional: false), tags: ((overview["tags"] as? [Any]) ?? []).compactMap { $0 as? String },
            location: "", websites: urls, secure: secure)
        return .item(record, trashed: (V.isBool(object["trashed"]) ? (object["trashed"] as? Bool ?? false) : (V.number(object["trashed"]) ?? 0) != 0),
                     folder: nonEmpty(object["folder"]), windows: true)
    }

    private static func nonEmpty(_ any: Any?) -> String? {
        guard let text = any as? String, !text.isEmpty else { return nil }
        return text
    }

    /// On Mac a favourite carries its position, which can be 0, so the key being there is what counts. Windows writes `fave`
    /// as a flag or a position, and zero cannot be told from "not a favourite", so only a non-zero value counts there.
    private static func isFavourite(_ any: Any?, positional: Bool = true) -> Bool {
        guard let any, !(any is NSNull) else { return false }
        if PlanBuilder.Value.isBool(any) { return (any as? Bool) ?? false }
        if !positional { return (PlanBuilder.Value.number(any) ?? 0) != 0 }
        return true
    }

    /// Folder names from the top down. A folder that points back at itself ends the walk.
    private static func path(of folder: String, in folders: [String: (title: String, parent: String?)]) -> [String] {
        var names: [String] = []
        var seen = Set<String>()
        var current: String? = folder.isEmpty ? nil : folder
        while let id = current, let entry = folders[id], seen.insert(id).inserted, names.count < 32 {
            let name = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
            names.append(name.isEmpty ? String(localized: "Untitled folder") : name)
            current = entry.parent
        }
        return names.reversed()
    }

    // MARK: Lines

    private enum LineEvent {
        case line(Data)
        case tooLong
    }

    /// Reads 1 MiB at a time and hands over one line at a time, so a large export never sits in memory whole. A line longer
    /// than `maxLine` is dropped as it streams past, and reported as one event.
    private static func readLines(_ url: URL, maxLine: Int, _ body: (LineEvent) -> Bool) throws {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) } catch { throw ImportError.unreadable(error.localizedDescription) }
        defer { try? handle.close() }
        var pending = Data()
        var overflow = false
        while true {
            let chunk: Data
            do { chunk = try handle.read(upToCount: 1 << 20) ?? Data() } catch { throw ImportError.unreadable(error.localizedDescription) }
            if chunk.isEmpty { break }
            var start = chunk.startIndex
            while start < chunk.endIndex {
                if let newline = chunk[start...].firstIndex(of: 0x0A) {
                    if !overflow {
                        pending.append(chunk[start..<newline])
                        if pending.count > maxLine { overflow = true }
                    }
                    let event: LineEvent = overflow ? .tooLong : .line(pending)
                    pending = Data()
                    overflow = false
                    if !body(event) { return }
                    start = chunk.index(after: newline)
                } else {
                    if !overflow {
                        pending.append(chunk[start...])
                        if pending.count > maxLine { overflow = true; pending = Data() }
                    }
                    start = chunk.endIndex
                }
            }
        }
        if overflow { _ = body(.tooLong) } else if !pending.isEmpty { _ = body(.line(pending)) }
    }

    private static func trim(_ data: Data) -> Data {
        var slice = data[...]
        while let first = slice.first, first == 0x20 || first == 0x09 || first == 0x0D { slice = slice.dropFirst() }
        while let last = slice.last, last == 0x20 || last == 0x09 || last == 0x0D { slice = slice.dropLast() }
        return Data(slice)
    }

    /// One JSON object. Invalid UTF-8 is read as Windows-1252 (the flag says so). Raw control characters inside strings are
    /// escaped on a second try, since some exports hold them.
    private static func parse(_ line: Data) -> ([String: Any], Bool)? {
        var data = line
        var fellBack = false
        if String(data: data, encoding: .utf8) == nil {
            guard let text = String(data: data, encoding: .windowsCP1252), let converted = text.data(using: .utf8) else { return nil }
            data = converted
            fellBack = true
        }
        if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { return (object, fellBack) }
        if let object = (try? JSONSerialization.jsonObject(with: escapeControlCharacters(data))) as? [String: Any] { return (object, fellBack) }
        return nil
    }

    private static func escapeControlCharacters(_ data: Data) -> Data {
        var out = Data(capacity: data.count + 16)
        var inString = false, escaped = false
        for byte in data {
            if inString {
                if escaped { escaped = false }
                else if byte == UInt8(ascii: "\\") { escaped = true }
                else if byte == UInt8(ascii: "\"") { inString = false }
                else if byte < 0x20 {
                    out.append(contentsOf: Array(String(format: "\\u%04x", byte).utf8))
                    continue
                }
            } else if byte == UInt8(ascii: "\"") { inString = true }
            out.append(byte)
        }
        return out
    }

    // MARK: Attachments

    /// Lists the files of an item by the name of its folder, `attachments/<item uuid>/`. The record does not point at its
    /// files, so the folder name is the only link. Nothing is read here and nothing outside that folder is ever followed.
    private struct Attachments {
        let root: URL
        let limits: Limits
        let folder: URL
        let folderExists: Bool

        init(root: URL, limits: Limits) {
            self.root = root
            self.limits = limits
            folder = root.appendingPathComponent("attachments", isDirectory: true).resolvingSymlinksInPath()
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: root.appendingPathComponent("attachments").path, isDirectory: &isDirectory) && isDirectory.boolValue
            // An attachments folder that is a link out of the export is not followed.
            folderExists = exists && folder.path.hasPrefix(root.resolvingSymlinksInPath().path + "/")
        }

        func list(uuid: String, title: String, totalBytes: inout Int) -> (files: [ImportAttachment], issues: [ImportIssue]) {
            guard folderExists, !uuid.isEmpty else { return ([], []) }
            func issue(_ kind: ImportIssue.Kind, _ detail: String) -> ImportIssue {
                ImportIssue(kind: kind, item: title.isEmpty ? nil : title, detail: detail)
            }
            // An identifier is a name, never a path. One with a separator or `..` could point anywhere.
            let safe = uuid.count <= 128 && uuid.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
            guard safe else {
                // Only worth a word when something sits there to be followed.
                let probe = folder.appendingPathComponent(uuid)
                guard FileManager.default.fileExists(atPath: probe.path) else { return ([], []) }
                return ([], [issue(.attachmentRejected, String(localized: "its identifier is not a plain name, so the attachments folder was not followed"))])
            }
            let itemFolder = folder.appendingPathComponent(uuid, isDirectory: true)
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: itemFolder.path) else { return ([], []) }
            var files: [ImportAttachment] = [], issues: [ImportIssue] = []
            for name in names.sorted() where name != ".DS_Store" && name != "." && name != ".." {
                let entry = itemFolder.appendingPathComponent(name)
                let resolved = entry.resolvingSymlinksInPath()
                guard resolved.path.hasPrefix(folder.path + "/") else {
                    issues.append(issue(.attachmentRejected, String(localized: "the attachment \(name) points outside the export folder and was not imported")))
                    continue
                }
                guard let values = try? resolved.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]), values.isRegularFile == true else { continue }
                let size = values.fileSize ?? 0
                if size > limits.attachmentBytes {
                    issues.append(issue(.attachmentTooLarge, String(localized: "the attachment \(name) is larger than \(limits.attachmentBytes / (1024 * 1024)) MB and was not imported")))
                    continue
                }
                if files.count >= limits.attachmentsPerItem {
                    issues.append(issue(.attachmentLimitPerItem, String(localized: "the attachment \(name) was not imported: an item can hold \(limits.attachmentsPerItem) files")))
                    continue
                }
                if totalBytes + size > limits.allAttachmentBytes {
                    issues.append(issue(.attachmentsTotalLimit, String(localized: "the attachment \(name) was not imported: all attachments together are over \(limits.allAttachmentBytes / (1024 * 1024)) MB")))
                    continue
                }
                totalBytes += size
                files.append(ImportAttachment(name: name, size: size, url: resolved))
            }
            return (files, issues)
        }
    }
}
