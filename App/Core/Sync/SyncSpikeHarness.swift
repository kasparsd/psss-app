#if DEBUG
import Foundation
import CryptoKit

// Sync spike harness (Debug builds only; docs/plans/sync-spike-cloudkit.md). Does nothing unless the app was launched with
// `-psss-sync-spike`. Two devices given the same seed, start time, interval and run id edit the same field of the same item
// in every round, push sealed records through CloudKitRecordTransport, poll for the other device's record, open and check
// every record with the format library, and print a summary that can be compared between the two sides.
//
// Launch arguments (all `-psss-sync-<name> <value>` except the flag):
//   -psss-sync-spike                 turn the harness on
//   -psss-sync-device <label>        device label, for example mac-a, mac-b, posti
//   -psss-sync-seed <hex>            test seed (at least 16 bytes); person secret, group key and group id derive from it
//   -psss-sync-start <unix seconds>  when round 1 is due is start + interval; rounds are at start + n x interval
//   -psss-sync-rounds <n>            default 200
//   -psss-sync-interval <seconds>    default 3
//   -psss-sync-run <id>              run identifier; the zone is named spike-<id>
//   -psss-sync-poll <seconds>        pause between fetches, default 0.5
//   -psss-sync-devices <n>           how many devices take part, default 2
//   -psss-sync-asset-threshold <n>   sealed size above which the bytes travel as a CKAsset (testing the large-record path)
//   -psss-sync-wait <seconds>        how long to wait after the last round for the other device, default 90
//
// This is a spike: key custody is out of scope, and the values are test values only.

enum SyncSpikeHarness {
    static func startIfRequested() {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-psss-sync-spike") else { return }
        func value(_ name: String) -> String? {
            guard let i = args.firstIndex(of: "-psss-sync-\(name)"), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        guard let label = value("device"), let seedHex = value("seed"), let seed = Data(formatHex: seedHex), seed.count >= 16,
              let start = value("start").flatMap(Double.init), let run = value("run") else {
            FileHandle.standardError.write(Data("psss-sync-spike: need -psss-sync-device, -seed (hex, 16+ bytes), -start and -run\n".utf8))
            exit(64)
        }
        let config = SyncSpikeConfig(
            label: label, seed: seed, start: start, runID: run,
            rounds: value("rounds").flatMap(Int.init) ?? 200,
            interval: value("interval").flatMap(Double.init) ?? 3,
            poll: value("poll").flatMap(Double.init) ?? 0.5,
            devices: value("devices").flatMap(Int.init) ?? 2,
            assetThreshold: value("asset-threshold").flatMap(Int.init) ?? CloudKitSealedRecord.defaultAssetThreshold,
            finalWait: value("wait").flatMap(Double.init) ?? 90)
        // Keep the process awake: no App Nap on the Mac, no idle lock on the phone (it must stay unlocked and in front anyway).
        let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled],
                                                             reason: "Sync spike")
        #if os(iOS)
        // UIApplication.shared is unavailable in the extension targets that also compile App/Core, so reach it by name.
        // This runs from App.init, before UIKit has made the application object, so one attempt finds nothing and the phone
        // locks after its usual idle time, which suspends the run. Set it again every few seconds for the first minute.
        for delay in stride(from: 0.5, through: 60, by: 3) {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                let application = (NSClassFromString("UIApplication") as? NSObject.Type)?.value(forKey: "sharedApplication") as? NSObject
                application?.setValue(true, forKey: "idleTimerDisabled")
            }
        }
        #endif
        Task.detached {
            let out = SpikeOutput(label: label, runID: run)
            let code = await SyncSpikeRun(config: config, out: out).run()
            out.close()
            ProcessInfo.processInfo.endActivity(activity)
            exit(code)
        }
    }
}

struct SyncSpikeConfig: Sendable {
    var label: String
    var seed: Data
    var start: Double
    var runID: String
    var rounds: Int
    var interval: Double
    var poll: Double
    var devices: Int
    var assetThreshold: Int
    var finalWait: Double
}

/// stdout and a file in the app's own Documents folder (recoverable from a phone with `devicectl device copy from`).
final class SpikeOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var handle: FileHandle?
    let path: String?

    init(label: String, runID: String) {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        if let dir {
            let url = dir.appendingPathComponent("sync-spike-\(runID)-\(label).txt")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            handle = try? FileHandle(forWritingTo: url)
            path = url.path
        } else {
            path = nil
        }
    }

    func line(_ text: String) {
        lock.lock()
        defer { lock.unlock() }
        print(text)
        fflush(stdout)
        handle?.write(Data((text + "\n").utf8))
    }

    func close() {
        lock.lock()
        defer { lock.unlock() }
        try? handle?.synchronize()
        try? handle?.close()
        handle = nil
    }
}

private struct HeldRecord {
    var opened: OpenedRecord
    var change: ItemChange
    var sealed: Data
}

private struct RoundInfo {
    var scheduled: Double
    var pushMs: Double?
    var pushed: String?
    var arrivedMs: Double?
    var ownDesc: String?
    var otherDesc: String?
    var printed = false
}

actor SyncSpikeRun {
    private let config: SyncSpikeConfig
    private let out: SpikeOutput
    private let transport: CloudKitRecordTransport
    private let person: Person
    private let gid: Data
    private let groupKey: Data
    private let deviceID: Data
    private let itemID: Data
    private let mheadStub: Data
    private let fieldName = "spike"

    private var held: [Data: HeldRecord] = [:]
    private var token: Data?
    private var ownSeq: UInt64 = 0
    private var ownLastID: Data?
    private var rounds: [Int: RoundInfo] = [:]
    private var failures: [String] = []
    private var echoed = Set<Data>()
    private var pushedOwn = 0
    private var fetchCount = 0
    private var fetchedRecordsTotal = 0
    private var finished = false
    /// Records that were in the zone before this process finished its setup. Ignored everywhere (see run()).
    private var preexisting = Set<Data>()
    /// Records that could not be opened yet for a reason that may pass (no key yet): retried at every poll.
    private var deferred: [Data: (sealed: Data, attempts: Int)] = [:]
    /// Records the transport reported as unreadable: refetched by id at every poll, at most five times each.
    private var unreadable: [Data: Int] = [:]
    static let harnessRevision = 2

    init(config: SyncSpikeConfig, out: SpikeOutput) {
        self.config = config
        self.out = out
        let seed = config.seed
        func derive(_ info: String) -> Data { FormatCrypto.hkdf(ikm: seed, salt: Data(), info: FormatCrypto.label("psss/spike/\(info)")) }
        person = try! Person(secret: derive("person"))
        groupKey = derive("group-key")
        gid = derive("gid")
        itemID = Data(derive("item").prefix(16))
        mheadStub = derive("mhead")
        deviceID = Data(FormatCrypto.sha256(FormatCrypto.label("psss/spike/device"), FormatCrypto.label(config.label)).prefix(16))
        transport = CloudKitRecordTransport(containerIdentifier: "iCloud.app.psss", zoneName: "spike-\(config.runID)",
                                            assetThreshold: config.assetThreshold)
    }

    private func now() -> Double { Date().timeIntervalSince1970 }

    // MARK: Run

    func run() async -> Int32 {
        out.line("spike device=\(config.label) run=\(config.runID) rounds=\(config.rounds) interval=\(config.interval)s poll=\(config.poll)s start=\(String(format: "%.3f", config.start)) zone=spike-\(config.runID) devices_expected=\(config.devices) asset_threshold=\(config.assetThreshold)")
        out.line("spike build \(Self.buildIdentity()) harness_revision=\(Self.harnessRevision)")
        out.line("spike fetch=polling output=\(out.path ?? "stdout only")")
        do {
            try await transport.checkAccount()
            try await transport.ensureZone()
            _ = try await fetchOnce()   // warms the connection
        } catch {
            out.line("spike FATAL setup: \(error)")
            return 2
        }
        if !held.isEmpty {
            // A reused run id or a restarted side. Everything already there is set aside and left out of every count and
            // statistic. Known limitation of the harness: a restarted side starts its chain at seq 1 again, which forks its
            // own chain, so the run is not a valid convergence test and is reported as failed.
            preexisting = Set(held.keys)
            failures.append("the zone already held \(held.count) records before this process started (reused run id or a restarted side); they are ignored in all statistics. Harness limitation: a restarted side begins its chain at seq 1 again and forks its own chain, so this run is not a valid convergence test")
            held = [:]
            rounds = [:]
            echoed = []
        }
        let startAt = config.start + config.interval
        out.line("spike setup done at \(String(format: "%.3f", now())), round 1 due at \(String(format: "%.3f", startAt)) (in \(String(format: "%.1f", startAt - now()))s)")
        if now() > config.start { failures.append("started after the start time: setup finished \(String(format: "%.1f", now() - config.start))s late") }

        let poller = Task { await self.pollLoop() }
        for n in 1...config.rounds {
            let due = config.start + Double(n) * config.interval
            let wait = due - now()
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            await writeRound(n, due: due)
        }
        // After the last round: wait for the other device's records.
        let deadline = now() + config.finalWait
        while now() < deadline, !allRoundsResolved() { try? await Task.sleep(for: .seconds(0.25)) }
        finished = true
        // Not cancelled: the loop sees `finished` within one poll interval. Cancelling would put a CloudKit
        // operationCancelled into the error counts.
        _ = await poller.value
        // One last fetch from the stored token, then from nothing, to check that a full fetch gives the same set.
        do { _ = try await fetchOnce() } catch { failures.append("final fetch: \(error)") }
        await crossCheckFullFetch()
        statsSnapshot = await transport.stats
        return summarize()
    }

    private func allRoundsResolved() -> Bool {
        (1...config.rounds).allSatisfy { rounds[$0]?.arrivedMs != nil || config.devices < 2 }
    }

    private func pollLoop() async {
        while !finished {
            do { _ = try await fetchOnce() } catch {
                if finished { break }
                failures.append("fetch: \(error)")
                out.line("spike fetch error: \(error)")
                try? await Task.sleep(for: .seconds(2))
            }
            try? await Task.sleep(for: .seconds(config.poll))
        }
    }

    // MARK: Writing

    private func writeRound(_ n: Int, due: Double) async {
        rounds[n, default: RoundInfo(scheduled: due)].scheduled = due
        let value = "\(config.label)#\(n)"
        let nowMs = UInt64(now() * 1000)
        let clock = FormatClock.next(nowMs: nowMs, seen: held.values.map(\.opened.clock))
        ownSeq += 1
        let payload = CBORValue.uintMap([(1, .bytes(itemID)), (2, .textMap([(fieldName, .text(value))])), (3, .array([]))])
        let fields = RecordFields(author: person.pid, device: deviceID, seq: ownSeq, prev: ownLastID, clock: clock, kind: 16,
                                  mhead: mheadStub, payload: payload)
        let sealed: SealedRecord
        do {
            // Sealed exactly once: CryptoKit signatures are randomized, so sealing again would give another record_id.
            sealed = try RecordCodec.seal(gid: gid, epoch: 0, groupKey: groupKey, fields: fields, sign: { [person] in try person.sign($0) })
        } catch {
            failures.append("round \(n): seal failed: \(error)")
            return
        }
        ownLastID = sealed.recordID
        rounds[n]?.ownDesc = "id=\(sealed.recordID.prefix(4).formatHex) dev=\(deviceID.prefix(4).formatHex) seq=\(ownSeq) wall_ms=\(clock.wallMs) counter=\(clock.counter)"
        do { try ingest(sealed.sealed, serverName: nil, source: "own") } catch { failures.append("round \(n): own record does not open: \(error)") }
        let t0 = now()
        do {
            let outcome = try await transport.push(recordID: sealed.recordID, sealed: sealed.sealed)
            pushedOwn += 1
            rounds[n]?.pushMs = (now() - t0) * 1000
            rounds[n]?.pushed = outcome == .saved ? "saved" : "already"
        } catch {
            rounds[n]?.pushMs = (now() - t0) * 1000
            rounds[n]?.pushed = "FAILED"
            failures.append("round \(n): push failed: \(error)")
        }
        printRoundIfComplete(n)
    }

    // MARK: Fetching and opening

    /// The token always advances. A record that cannot be handled for a reason that may pass is kept on a retry list (opened
    /// again at every poll, or refetched by id), so that one such record can neither be lost nor block the rest.
    private func fetchOnce() async throws -> Int {
        await retryPending()
        let result = try await transport.fetchChanges(since: token)
        fetchCount += 1
        fetchedRecordsTotal += result.records.count
        var fresh = 0
        for r in result.records {
            let before = held.count
            handleServerRecord(r.sealed, id: r.recordID)
            if held.count > before { fresh += 1 }
        }
        for id in result.unreadable where unreadable[id] == nil && held[id] == nil { unreadable[id] = 0 }
        if result.skippedMalformed > 0 { failures.append("\(result.skippedMalformed) malformed zone entries") }
        if result.tokenWasReset { out.line("spike token expired and was reset") }
        if !result.zoneMissing { token = result.changeToken }
        return fresh
    }

    private func handleServerRecord(_ sealed: Data, id: Data) {
        do { try ingest(sealed, serverName: id, source: "server") } catch {
            if let e = error as? FormatError, e.disposition == .wait {
                deferred[id] = (sealed, (deferred[id]?.attempts ?? 0) + 1)
            } else {
                failures.append("opening \(id.formatHex.prefix(12)): \(error)")
            }
        }
    }

    private func retryPending() async {
        for (id, entry) in deferred {
            do { try ingest(entry.sealed, serverName: id, source: "server"); deferred[id] = nil } catch {
                if let e = error as? FormatError, e.disposition == .wait { deferred[id] = (entry.sealed, entry.attempts + 1) } else {
                    deferred[id] = nil
                    failures.append("opening deferred \(id.formatHex.prefix(12)): \(error)")
                }
            }
        }
        for (id, attempts) in unreadable {
            do {
                if let sealed = try await transport.fetchSealed(recordID: id) {
                    unreadable[id] = nil
                    handleServerRecord(sealed, id: id)
                } else {
                    unreadable[id] = nil
                    failures.append("unreadable record \(id.formatHex.prefix(12)) is gone from the server")
                }
            } catch {
                if attempts + 1 >= 5 {
                    unreadable[id] = nil
                    failures.append("gave up on unreadable record \(id.formatHex.prefix(12)) after 5 refetches: \(error)")
                } else {
                    unreadable[id] = attempts + 1
                }
            }
        }
    }

    /// Opens a record with the format library and checks it. A record seen before must be byte-identical.
    private func ingest(_ sealed: Data, serverName: Data?, source: String) throws {
        let id = FormatCrypto.sha256(sealed)
        if let serverName, serverName != id { throw FormatError("record_name_is_not_hash") }
        if preexisting.contains(id) { return }
        if let existing = held[id] {
            guard existing.sealed == sealed else { throw FormatError("same_id_different_bytes") }
            if source == "server", existing.opened.device == deviceID { echoed.insert(id) }
            return
        }
        let opened = try RecordCodec.open(sealed, groupKey: { [gid, groupKey] g, e in g == gid && e == 0 ? groupKey : nil })
        guard opened.recordID == id else { throw FormatError("record_id_mismatch") }
        guard opened.author == person.pid else { throw FormatError("unexpected_author") }
        guard opened.kind == 16 else { throw FormatError("unexpected_kind") }
        if FormatClock.isHeldBack(wallMs: opened.clock.wallMs, nowMs: UInt64(now() * 1000)) { throw FormatError("held_back") }
        let change = try ItemChange.parse(payload: opened.payload)
        held[id] = HeldRecord(opened: opened, change: change, sealed: sealed)
        if source == "server", opened.device == deviceID { echoed.insert(id) }
        if source == "server", opened.device != deviceID, let (label, n) = Self.parseValue(change, field: fieldName), label != config.label {
            rounds[n, default: RoundInfo(scheduled: config.start + Double(n) * config.interval)].arrivedMs =
                (now() - (config.start + Double(n) * config.interval)) * 1000
            rounds[n]?.otherDesc = Self.describe(opened)
            printRoundIfComplete(n)
        }
    }

    private static func describe(_ r: OpenedRecord) -> String {
        "id=\(r.recordID.prefix(4).formatHex) dev=\(r.device.prefix(4).formatHex) seq=\(r.seq) wall_ms=\(r.clock.wallMs) counter=\(r.clock.counter)"
    }

    /// The executable and the debug dylib next to it, with sizes and modification times, so a run can be tied to a build.
    private static func buildIdentity() -> String {
        guard let exe = Bundle.main.executableURL else { return "unknown" }
        let dir = exe.deletingLastPathComponent()
        let names = [exe.lastPathComponent] + ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [])
            .filter { $0.hasSuffix(".debug.dylib") }.sorted()
        let iso = ISO8601DateFormatter()
        return names.map { name -> String in
            let attrs = try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(name).path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? -1
            let date = (attrs?[.modificationDate] as? Date).map { iso.string(from: $0) } ?? "?"
            return "\(name)[size=\(size) mtime=\(date)]"
        }.joined(separator: " ")
    }

    private static func parseValue(_ change: ItemChange, field: String) -> (String, Int)? {
        guard let entry = change.set.first(where: { $0.name == Data(field.utf8) }), let text = entry.value.textValue,
              let hash = text.lastIndex(of: "#"), let n = Int(text[text.index(after: hash)...]) else { return nil }
        return (String(text[..<hash]), n)
    }

    private func printRoundIfComplete(_ n: Int) {
        guard var r = rounds[n], !r.printed, r.pushMs != nil, r.arrivedMs != nil || config.devices < 2 else { return }
        r.printed = true
        rounds[n] = r
        out.line("round \(n) due=\(String(format: "%.3f", r.scheduled)) push=\(r.pushed ?? "-") push_ms=\(String(format: "%.0f", r.pushMs ?? -1)) converged_ms=\(r.arrivedMs.map { String(format: "%.0f", $0) } ?? "-") own[\(r.ownDesc ?? "-")] other[\(r.otherDesc ?? "-")]")
    }

    /// A fetch from nothing must give the same set as the incremental fetches.
    private func crossCheckFullFetch() async {
        do {
            let full = try await transport.fetchChanges(since: nil)
            let ids = Set(full.records.map(\.recordID)).subtracting(preexisting)
            if ids != Set(held.keys) {
                failures.append("full fetch holds \(ids.count) records, incremental holds \(held.count); only in full: \(ids.subtracting(held.keys).count), only incremental: \(Set(held.keys).subtracting(ids).count)")
            }
            out.line("spike full-fetch check: \(ids.count) records from nothing, \(held.count) held")
        } catch {
            failures.append("full fetch: \(error)")
        }
    }

    // MARK: Summary

    private func summarize() -> Int32 {
        for n in 1...config.rounds where rounds[n]?.printed != true {
            let r = rounds[n]
            out.line("round \(n) due=\(String(format: "%.3f", r?.scheduled ?? 0)) push=\(r?.pushed ?? "-") push_ms=\(r?.pushMs.map { String(format: "%.0f", $0) } ?? "-") converged_ms=NEVER")
            if r?.arrivedMs == nil, config.devices >= 2 { failures.append("round \(n): the other device's record never arrived") }
        }
        let own = held.values.filter { $0.opened.device == deviceID }.count
        let other = held.count - own
        // Chains: each (author, device) must be seq 1...k with every prev matching.
        var chains: [Data: [HeldRecord]] = [:]
        for h in held.values { chains[h.opened.device, default: []].append(h) }
        for (device, list) in chains {
            let sorted = list.sorted { $0.opened.seq < $1.opened.seq }
            for (i, h) in sorted.enumerated() {
                if h.opened.seq != UInt64(i + 1) { failures.append("chain \(device.formatHex.prefix(8)): gap before seq \(h.opened.seq)"); break }
                if i > 0, h.opened.prev != sorted[i - 1].opened.recordID { failures.append("chain \(device.formatHex.prefix(8)): prev mismatch at seq \(h.opened.seq)"); break }
            }
        }
        if chains.count != config.devices { failures.append("chains seen \(chains.count), expected \(config.devices)") }
        let expected = config.devices * config.rounds
        if held.count != expected { failures.append("holds \(held.count) records, expected \(expected)") }
        if own != config.rounds { failures.append("own records \(own), expected \(config.rounds)") }
        if !deferred.isEmpty { failures.append("\(deferred.count) records still could not be opened (waiting for a key)") }
        if !unreadable.isEmpty { failures.append("\(unreadable.count) records still unreadable") }
        if echoed.count < pushedOwn { failures.append("only \(echoed.count) of \(pushedOwn) own records came back from the server") }

        let idHash = FormatCrypto.sha256(held.keys.sorted { $0.formatLess(than: $1) }.reduce(Data()) { $0 + $1 }).formatHex
        var stateHash = "error"
        var winner = "none"
        do {
            let changes = held.values.map { (order: RecordCodec.order(of: $0.opened), change: $0.change) }
            let folded = try ItemFold.fold(changes)
            stateHash = try Self.hashState(folded)
            if let f = folded[itemID]?.fields[Data(fieldName.utf8)], let text = f.current.value?.textValue {
                winner = "\(text) history=\(f.history.count)"
            }
        } catch {
            failures.append("fold: \(error)")
        }
        // The winner again, without ItemFold: the greatest (wall_ms, counter, author, device, seq) of all held writes of the
        // field (section 4.5), compared here by hand.
        func greater(_ a: OpenedRecord, _ b: OpenedRecord) -> Bool {
            if a.clock.wallMs != b.clock.wallMs { return a.clock.wallMs > b.clock.wallMs }
            if a.clock.counter != b.clock.counter { return a.clock.counter > b.clock.counter }
            if a.author != b.author { return b.author.lexicographicallyPrecedes(a.author) }
            if a.device != b.device { return b.device.lexicographicallyPrecedes(a.device) }
            return a.seq > b.seq
        }
        var best: HeldRecord?
        for h in held.values where Self.parseValue(h.change, field: fieldName) != nil {
            if best == nil || greater(h.opened, best!.opened) { best = h }
        }
        let expectedWinner = best.flatMap { $0.change.set.first(where: { $0.name == Data(fieldName.utf8) })?.value.textValue } ?? "none"
        if !winner.hasPrefix(expectedWinner + " ") && winner != expectedWinner {
            failures.append("winner by ItemFold is \(winner), expected by the order of section 4.5 is \(expectedWinner)")
        }
        // How each round's two writes were decided against each other.
        var byRound: [Int: [HeldRecord]] = [:]
        for h in held.values { if let (_, n) = Self.parseValue(h.change, field: fieldName) { byRound[n, default: []].append(h) } }
        var byWall = 0, byCounter = 0, byDevice = 0, wallWonBySmallerDevice = 0, pairs = 0
        for (_, list) in byRound where list.count == 2 {
            pairs += 1
            let (a, b) = (list[0].opened, list[1].opened)
            let w = greater(a, b) ? a : b, l = greater(a, b) ? b : a
            if a.clock.wallMs != b.clock.wallMs {
                byWall += 1
                if w.device.lexicographicallyPrecedes(l.device) { wallWonBySmallerDevice += 1 }
            } else if a.clock.counter != b.clock.counter { byCounter += 1 } else { byDevice += 1 }
        }
        let conv = rounds.values.compactMap(\.arrivedMs).sorted()
        func pct(_ p: Double) -> String {
            guard !conv.isEmpty else { return "-" }
            let index = max(0, min(conv.count - 1, Int((p * Double(conv.count)).rounded(.up)) - 1))
            return String(format: "%.0f", conv[index])
        }
        let stats = awaitStats()
        let errors = stats.errors.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        out.line("summary device=\(config.label) run=\(config.runID)")
        out.line("summary records own=\(own) other=\(other) total=\(held.count) expected=\(expected)")
        out.line("summary id_hash(sha256 of the 32-byte ids, ascending)=\(idHash)")
        out.line("summary state_hash(sha256 of canonical CBOR of folded state, history included)=\(stateHash)")
        out.line("summary winner=\(winner)")
        out.line("summary winner_check expected_by_order_4.5=\(expectedWinner) fold=\(winner) match=\(winner.hasPrefix(expectedWinner))")
        out.line("summary round_decided_by pairs=\(pairs) wall_ms=\(byWall) counter=\(byCounter) device_id_tie_break=\(byDevice) wall_ms_won_by_smaller_device_id=\(wallWonBySmallerDevice)")
        out.line("summary ignored_preexisting=\(preexisting.count)")
        out.line("summary convergence_ms median=\(pct(0.5)) p95=\(pct(0.95)) worst=\(conv.last.map { String(format: "%.0f", $0) } ?? "-") n=\(conv.count) fetch=polling every \(config.poll)s")
        out.line("summary transport retries=\(stats.retries) token_resets=\(stats.tokenResets) saved=\(stats.saved) already_present=\(stats.alreadyPresent) fetches=\(fetchCount) fetched_records=\(fetchedRecordsTotal) errors={\(errors)}")
        if failures.isEmpty {
            out.line("summary result=OK")
            return 0
        }
        for f in failures.prefix(30) { out.line("summary failure: \(f)") }
        out.line("summary result=FAIL (\(failures.count) problems)")
        return 1
    }

    private var statsSnapshot = SyncTransportStats()
    private func awaitStats() -> SyncTransportStats { statsSnapshot }

    private static func hashState(_ state: [Data: ItemState]) throws -> String {
        func write(_ w: ItemWrite) -> CBORValue {
            .array([.uint(w.order.wallMs), .uint(w.order.counter), .bytes(w.order.author), .bytes(w.order.device), .uint(w.order.seq),
                    .uint(w.value == nil ? 1 : 0), w.value ?? .null])
        }
        let items = state.keys.sorted { $0.formatLess(than: $1) }.map { id -> CBORValue in
            let item = state[id]!
            let fields = item.fields.keys.sorted { $0.formatLess(than: $1) }.map { name -> CBORValue in
                let f = item.fields[name]!
                return .array([.bytes(name), write(f.current), .array(f.history.map(write))])
            }
            return .array([.bytes(id), .array(fields)])
        }
        return FormatCrypto.sha256(try FormatCBOR.encode(.array(items))).formatHex
    }
}
#endif
