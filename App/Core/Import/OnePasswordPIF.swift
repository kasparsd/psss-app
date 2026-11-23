import Foundation

/// Reads a 1Password 7 export (1PIF): a folder that ends in `.1pif` holding `data.1pif` and, when items have files, an
/// `attachments` folder. The file is read in chunks, one record per line, and nothing is loaded whole. A line that cannot
/// be read is skipped and reported, never fatal.
enum OnePasswordPIF {
    struct Limits: Sendable {
        var dataFileBytes = 256 * 1024 * 1024
        var lineBytes = 16 * 1024 * 1024
        var items = 100_000
        var attachmentBytes = 10 * 1024 * 1024
        var allAttachmentBytes = 50 * 1024 * 1024
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

    /// Reads the export at a folder or at its `data.1pif`. Only regular files are read: a FIFO, a socket, a device, a directory
    /// named `data.1pif` or a link to any of them is "not an export", and so is a data file that is a link to something else than a
    /// regular file inside the folder. At most one link is followed, and only inside the folder.
    static func plan(from url: URL, limits: Limits = .standard, now: Date = .now) throws -> ImportPlan {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { throw ImportError.notAnExport }
        let dataPath: String, exportRoot: String?
        if isDirectory.boolValue {
            guard let root = realPath(url.path) else { throw ImportError.notAnExport }
            let candidate = root + "/" + dataFileName
            switch node(candidate) {
            case .regular: dataPath = candidate
            case .link:
                guard let target = oneLink(candidate, inside: root), case .regular = node(target) else { throw ImportError.notAnExport }
                dataPath = target
            default: throw ImportError.notAnExport
            }
            exportRoot = root
        } else {
            dataPath = url.path
            exportRoot = nil
        }
        let handle = try openRegularFile(dataPath, limit: limits.dataFileBytes)
        defer { try? handle.close() }

        var plan = ImportPlan(source: .onePasswordPIF)
        plan.importedAt = now
        plan.pickedDataFileOnly = exportRoot == nil
        let attachments = exportRoot.map { Attachments(root: $0, limits: limits) }
        plan.attachmentsFolderFound = attachments?.folderExists ?? false

        var folders: [String: (title: String, parent: String?)] = [:]
        var folderIDs: [String] = []                      // per item: the folder it sits in
        var validRecords = 0, encodingFallbacks = 0, undefinedBytes = 0, tagsAltered = 0, longLines = 0, lineNumber = 0, inBrokenRecord = false, sawWindows = false
        var sawContent = false
        var allAttachmentBytes = 0

        func unreadable(_ kind: ImportIssue.Kind, _ detail: String) {
            plan.skipped.unreadable += 1
            plan.issues.append(ImportIssue(kind: kind, item: nil, detail: detail))
        }

        var tooMany = false
        let limitMegabytes = max(1, limits.lineBytes / (1024 * 1024))
        try readLines(handle, maxLine: limits.lineBytes, maxBytes: limits.dataFileBytes) { event in
            lineNumber += 1
            guard case .line(var bytes) = event else {
                longLines += 1
                unreadable(.lineTooLong, String(localized: "Line \(lineNumber) is longer than \(limitMegabytes) MB and was not read"))
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
            guard let (object, fellBack, undefined) = parse(trimmed) else {
                inBrokenRecord = true
                unreadable(.unreadableRecord, String(localized: "Line \(lineNumber) could not be read and was skipped"))
                return true
            }
            if fellBack { encodingFallbacks += 1 }
            if undefined > 0 { undefinedBytes += 1 }

            switch classify(object) {
            case .ignored: validRecords += 1
            case .invalid:
                unreadable(.unreadableRecord, String(localized: "Line \(lineNumber) is not a 1Password item and was skipped"))
            case .folder(let id, let title, let parent):
                validRecords += 1
                folders[id] = (ImportText.clean(title), parent)
            case .item(let record, let trashed, let folder, let windows):
                validRecords += 1
                sawWindows = sawWindows || windows
                plan.recordCount += 1
                if trashed { plan.skipped.trashed += 1; return true }
                if plan.items.count >= limits.items { tooMany = true; return false }
                var built = PlanBuilder.build(record, now: now)
                plan.skipped.webFormFields += built.webFormFields
                if built.missingDate { plan.missingDates += 1 }
                tagsAltered += built.tagsAltered
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
        guard validRecords > 0 else {
            // One line over the limit and nothing else readable is a different problem from a file that is not an export.
            if longLines > 0, plan.skipped.unreadable == longLines { throw ImportError.lineTooLong(limitMegabytes) }
            throw sawContent ? ImportError.notAnExport : ImportError.empty
        }
        guard !plan.items.isEmpty || plan.skipped.trashed > 0 else { throw ImportError.empty }

        if encodingFallbacks > 0 {
            plan.issues.append(ImportIssue(kind: .textEncoding, item: nil,
                                           detail: String(localized: "\(encodingFallbacks) records were not UTF-8 and were read as Windows text, so some characters may differ")))
        }
        if undefinedBytes > 0 {
            plan.issues.append(ImportIssue(kind: .textEncoding, item: nil,
                                           detail: String(localized: "\(undefinedBytes) records held bytes that Windows text leaves undefined. They were kept and those characters were replaced with \u{FFFD}")))
        }
        if tagsAltered > 0 {
            plan.issues.append(ImportIssue(kind: .tagsChanged, item: nil,
                                           detail: String(localized: "\(tagsAltered) tags held a semicolon or comma, which the vault file uses to separate tags, and got a space instead")))
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
                created: V.stamp(object["createdAt"]), updated: V.stamp(object["updatedAt"]), favourite: favourite,
                tags: ((open?["tags"] as? [Any]) ?? []).compactMap { $0 as? String }, location: (object["location"] as? String) ?? "",
                websites: urls, secure: secure, fallbackTitle: (overview?["title"] as? String) ?? "")
            return .item(record, trashed: V.isBool(object["trashed"]) ? (object["trashed"] as? Bool ?? false) : (V.number(object["trashed"]) ?? 0) != 0,
                         folder: nonEmpty(object["folderUuid"]), windows: false)
        }

        // Windows: a category code, an overview and the details. Detected by that, not by the signature field.
        guard var code = V.scalarText(object["category"]) else { return .invalid }
        // A category written as a number (5) is the same as its three-digit form ("005").
        if code.count < 3, !code.isEmpty, code.allSatisfy(\.isASCII), code.allSatisfy(\.isNumber) { code = String(repeating: "0", count: 3 - code.count) + code }
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
            title: (overview["title"] as? String) ?? "", created: V.stamp(object["created"]), updated: V.stamp(object["updated"]),
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
            let name = ImportText.clean(entry.title).trimmingCharacters(in: .whitespacesAndNewlines)
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
    /// than `maxLine` is dropped as it streams past, and reported as one event. More than `maxBytes` in total stops the read,
    /// whatever the size said before it started.
    private static func readLines(_ handle: FileHandle, maxLine: Int, maxBytes: Int, _ body: (LineEvent) -> Bool) throws {
        var pending = Data()
        var overflow = false
        var total = 0
        while true {
            let chunk: Data
            do { chunk = try handle.read(upToCount: 1 << 20) ?? Data() } catch { throw ImportError.unreadable(error.localizedDescription) }
            if chunk.isEmpty { break }
            total += chunk.count
            if total > maxBytes { throw ImportError.tooLarge }
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

    // MARK: Files

    private enum Node { case missing, regular(Int), directory, link, other }

    /// What a path is, without following a link.
    private static func node(_ path: String) -> Node {
        var info = stat()
        guard lstat(path, &info) == 0 else { return .missing }
        switch info.st_mode & S_IFMT {
        case S_IFREG: return .regular(Int(info.st_size))
        case S_IFDIR: return .directory
        case S_IFLNK: return .link
        default: return .other
        }
    }

    private static func realPath(_ path: String) -> String? {
        guard let resolved = realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// Where a link points when that is a path inside `root` that holds no link of its own, anywhere along it. Nil otherwise,
    /// so a chain of links, a loop and a link out of the folder all fail the same way.
    private static func oneLink(_ path: String, inside root: String) -> String? {
        guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: path) else { return nil }
        let full = target.hasPrefix("/") ? target : (path as NSString).deletingLastPathComponent + "/" + target
        let standard = (full as NSString).standardizingPath
        guard standard.hasPrefix(root + "/"), realPath(standard) == standard else { return nil }
        return standard
    }

    /// Opens without blocking, so a FIFO with no writer cannot hang the open, and checks what was opened. A device, a socket or
    /// a pipe is not an export. The size is checked here as well as while reading.
    static func openRegularFile(_ path: String, limit: Int) throws -> FileHandle {
        // A socket cannot be opened at all, and says so with an error that is not about permissions. Ask first.
        var before = stat()
        if stat(path, &before) == 0, before.st_mode & S_IFMT != S_IFREG { throw ImportError.notAnExport }
        let descriptor = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw ImportError.unreadable(String(cString: strerror(errno))) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else {
            close(descriptor)
            throw ImportError.notAnExport
        }
        guard Int(info.st_size) <= limit else {
            close(descriptor)
            throw ImportError.tooLarge
        }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }

    private static func trim(_ data: Data) -> Data {
        var slice = data[...]
        while let first = slice.first, first == 0x20 || first == 0x09 || first == 0x0D { slice = slice.dropFirst() }
        while let last = slice.last, last == 0x20 || last == 0x09 || last == 0x0D { slice = slice.dropLast() }
        return Data(slice)
    }

    /// One JSON object. Invalid UTF-8 is read as Windows-1252 (the flag says so, and the count says how many bytes had no
    /// meaning there). Raw control characters inside strings are escaped on a second try, since some exports hold them.
    private static func parse(_ line: Data) -> ([String: Any], Bool, Int)? {
        var data = line
        var fellBack = false
        var undefined = 0
        if String(data: data, encoding: .utf8) == nil {
            let decoded = Windows1252.decode(data)
            data = Data(decoded.text.utf8)
            undefined = decoded.undefined
            fellBack = true
        }
        if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { return (object, fellBack, undefined) }
        if let object = (try? JSONSerialization.jsonObject(with: escapeControlCharacters(data))) as? [String: Any] { return (object, fellBack, undefined) }
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
    /// files, so the folder name is the only link. Nothing is read here. Only regular files count; one link is followed when it
    /// stays inside the attachments folder, and anything else (a folder, a pipe, a loop) is skipped and said once per item.
    private struct Attachments {
        let limits: Limits
        /// The attachments folder as the file system spells it, or nil when there is none.
        let folder: String?
        var folderExists: Bool { folder != nil }

        init(root: String, limits: Limits) {
            self.limits = limits
            let path = root + "/attachments"
            if case .directory = OnePasswordPIF.node(path), let real = OnePasswordPIF.realPath(path) { folder = real } else { folder = nil }
        }

        func list(uuid: String, title: String, totalBytes: inout Int) -> (files: [ImportAttachment], issues: [ImportIssue]) {
            guard let folder, !uuid.isEmpty else { return ([], []) }
            let shown = title.isEmpty ? nil : ImportText.clean(title)
            func issue(_ kind: ImportIssue.Kind, _ detail: String) -> ImportIssue { ImportIssue(kind: kind, item: shown, detail: detail) }
            // An identifier is a name, never a path. One with a separator or `..` could point anywhere.
            let safe = uuid.count <= 128 && uuid.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
            guard safe else {
                // Only worth a word when something sits there to be followed.
                guard FileManager.default.fileExists(atPath: folder + "/" + uuid) else { return ([], []) }
                return ([], [issue(.attachmentRejected, String(localized: "its identifier is not a plain name, so the attachments folder was not followed"))])
            }
            let itemFolder = folder + "/" + uuid
            switch OnePasswordPIF.node(itemFolder) {
            case .missing: return ([], [])
            case .directory: break
            default: return ([], [issue(.attachmentSkipped, String(localized: "its attachments folder is not a plain folder, so it was not followed"))])
            }
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: itemFolder) else { return ([], []) }
            var files: [ImportAttachment] = []
            var tooLarge = 0, overTotal = 0, overCount = 0, skipped = 0, outside = 0
            for name in names.sorted() where name != ".DS_Store" {
                let entry = itemFolder + "/" + name
                var path = entry
                switch OnePasswordPIF.node(entry) {
                case .regular: break
                case .link:
                    guard let target = OnePasswordPIF.oneLink(entry, inside: folder) else { outside += 1; continue }
                    guard case .regular = OnePasswordPIF.node(target) else { skipped += 1; continue }
                    path = target
                case .missing: continue
                default: skipped += 1; continue
                }
                guard case .regular(let size) = OnePasswordPIF.node(path) else { skipped += 1; continue }
                if size > limits.attachmentBytes { tooLarge += 1; continue }
                if files.count >= limits.attachmentsPerItem { overCount += 1; continue }
                if totalBytes + size > limits.allAttachmentBytes { overTotal += 1; continue }
                totalBytes += size
                files.append(ImportAttachment(name: ImportText.clean(name), size: size, url: URL(fileURLWithPath: path)))
            }
            var issues: [ImportIssue] = []
            func megabytes(_ bytes: Int) -> String { bytes >= 1024 * 1024 ? "\(bytes / (1024 * 1024)) MB" : "\(bytes) bytes" }
            if tooLarge > 0 {
                issues.append(issue(.attachmentTooLarge, String(localized: "\(tooLarge) attachment(s) larger than the limit of \(megabytes(limits.attachmentBytes)) each were not imported")))
            }
            if overTotal > 0 {
                issues.append(issue(.attachmentsTotalLimit, String(localized: "\(overTotal) attachment(s) were not imported: all attachments together can hold \(megabytes(limits.allAttachmentBytes))")))
            }
            if overCount > 0 {
                issues.append(issue(.attachmentLimitPerItem, String(localized: "\(overCount) attachment(s) were not imported: an item can hold \(limits.attachmentsPerItem) files")))
            }
            if outside > 0 {
                issues.append(issue(.attachmentRejected, String(localized: "\(outside) attachment(s) point outside the export folder, or through more than one link, and were not imported")))
            }
            if skipped > 0 {
                issues.append(issue(.attachmentSkipped, String(localized: "skipped \(skipped) in its attachments folder that are not files (a folder, a pipe or a link to one)")))
            }
            return (files, issues)
        }
    }
}
