import CloudKit
import Foundation

// CloudKit transport for sealed records (docs/format-spec.md section 8.3, sync spike).
//
// One zone per group in the private database, one CKRecord per sealed record. This type knows nothing about the format: it
// moves opaque bytes named by their record_id. It has no interface and no harness logic.
//
// What the server sees (privacy trade-off, decided here, not silently): the record name (the hex record_id, a hash of
// ciphertext), the size of the sealed bytes (already padded to a bucket by section 4.2), the format version `v`, and the
// time CloudKit stamps on the record. Author, device and seq stay inside the sealed bytes. The cost: the server cannot answer
// "what is the newest record of chain X", so a reader fetches by zone change token and works out the chains itself, which is
// what section 8.2 asks of a location anyway.

/// The record type and field names. Changing these is a format decision, so they live in one place.
enum CloudKitSealedRecord {
    static let recordType = "SealedRecord"
    /// The sealed bytes as a Bytes field. A CloudKit record is limited to 1 MB in total, and a sealed record can be up to
    /// 1,052,760 bytes (section 4.1), so larger ones travel in `sealedAsset` instead.
    static let bytesField = "sealed"
    static let assetField = "sealedAsset"
    /// The format version (an Int), so a later change of fields can be told apart without opening anything.
    static let versionField = "v"
    static let version: Int64 = 1
    /// The largest sealed record that fits as bytes with room for the other fields. Measured in the spike, not guessed: see the notes.
    static let defaultAssetThreshold = 700_000
}

struct FetchedSealedRecord: Sendable, Equatable {
    var recordID: Data
    var sealed: Data
}

struct SyncFetchResult: Sendable {
    var records: [FetchedSealedRecord]
    /// Pass this to the next fetch. Persist it only after `records` are stored.
    var changeToken: Data
    /// True when the server said the token had expired and the fetch started again from nothing: `records` is then the whole
    /// zone, not only what changed, and a caller that tracks removals must treat it as a full list.
    var tokenWasReset: Bool
    /// Zone entries that were not a well-formed sealed record (wrong type, name that is not a 32-byte hex id, no bytes).
    /// Permanent: refetching will not help, so these are only counted.
    var skippedMalformed: Int
    /// Records that exist but could not be read this time: the server reported a failure for that record, or its CKAsset
    /// could not be downloaded. The change token in this result has already moved past them. The caller refetches each by id
    /// with `fetchSealed(recordID:)`, a bounded number of times, and gives up on it alone if it stays unreadable. See the plan
    /// file for why this and not "hold the token back".
    var unreadable: [Data]
    /// The zone was not there yet (nothing has been pushed by anyone); the result is empty and has no token.
    var zoneMissing: Bool
}

enum PushOutcome: Sendable, Equatable {
    case saved
    /// A record with this name was already there and held the same bytes. Counts as success (section 8.2).
    case alreadyPresent
}

enum SyncTransportError: Error, CustomStringConvertible, Sendable {
    case noAccount(String)
    case cloudKit(code: String, message: String)
    /// The server holds a record under this name with different bytes. A record name is the hash of its bytes, so this means
    /// corruption or a deliberate attempt; the transport never overwrites.
    case conflictingBytes(recordID: String)
    case retriesExhausted(code: String)
    case malformedLocal(String)
    /// The person removed the zone (for example by turning off iCloud data for the app). Unlike zoneNotFound this is not a
    /// state to repair silently by creating the zone again: the caller must ask the person, since the data is gone on purpose.
    case zoneDeletedByUser

    var description: String {
        switch self {
        case .noAccount(let s): return "no iCloud account: \(s)"
        case .cloudKit(let c, let m): return "CloudKit \(c): \(m)"
        case .conflictingBytes(let id): return "record \(id) exists with different bytes"
        case .retriesExhausted(let c): return "gave up after retries: \(c)"
        case .malformedLocal(let s): return s
        case .zoneDeletedByUser: return "the person deleted this zone"
        }
    }
}

struct SyncTransportStats: Sendable {
    /// Attempts repeated after a failure that was worth repeating (rate limit, network, busy zone, zone created on demand).
    var retries = 0
    /// How many times each CloudKit error code was seen, by name, including ones that were then retried or tolerated.
    var errors: [String: Int] = [:]
    var tokenResets = 0
    /// How many times the zone was saved to make sure it exists. CloudKit does not say whether it already existed.
    var zoneEnsures = 0
    var saved = 0
    var alreadyPresent = 0
}

actor CloudKitRecordTransport {
    private let containerIdentifier: String
    let zoneID: CKRecordZone.ID
    private let assetThreshold: Int
    private let maxAttempts: Int
    private var database: CKDatabase?
    private var container: CKContainer?
    private var zoneEnsured = false
    private(set) var stats = SyncTransportStats()

    init(containerIdentifier: String, zoneName: String, assetThreshold: Int = CloudKitSealedRecord.defaultAssetThreshold,
         maxAttempts: Int = 8) {
        self.containerIdentifier = containerIdentifier
        self.zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
        self.assetThreshold = assetThreshold
        self.maxAttempts = maxAttempts
    }

    // MARK: Account and zone

    private func db() -> CKDatabase {
        if let database { return database }
        let c = CKContainer(identifier: containerIdentifier)
        container = c
        database = c.privateCloudDatabase
        return c.privateCloudDatabase
    }

    /// Throws `noAccount` unless an iCloud account is signed in and usable.
    func checkAccount() async throws {
        _ = db()
        guard let container else { return }
        let status = try await container.accountStatus()
        guard status == .available else {
            let name: String
            switch status {
            case .noAccount: name = "noAccount"
            case .restricted: name = "restricted"
            case .couldNotDetermine: name = "couldNotDetermine"
            case .temporarilyUnavailable: name = "temporarilyUnavailable"
            default: name = "status \(status.rawValue)"
            }
            throw SyncTransportError.noAccount(name)
        }
    }

    /// Creates the zone when it is not there. Saving a zone that exists is not an error in CloudKit, so this is safe to repeat.
    func ensureZone() async throws {
        if zoneEnsured { return }
        try await withRetry { [self] in
            let result = try await db().modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
            for (_, r) in result.saveResults { _ = try r.get() }
        }
        stats.zoneEnsures += 1
        zoneEnsured = true
    }

    // MARK: Push

    /// Sealed bytes sent inline in one request. A request is limited to about 2 MB not counting assets, so batches stay well
    /// below that; if CloudKit still says limitExceeded the batch is split in half.
    private static let inlineBytesPerRequest = 1_000_000
    private static let recordsPerRequest = 100

    /// Pushes one sealed record. Never overwrites: a record that exists with the same bytes is success.
    func push(recordID: Data, sealed: Data) async throws -> PushOutcome {
        try await push([(recordID, sealed)])[0]
    }

    /// Pushes several records. Outcomes are in the order given. Batches are cut by count and by inline size; records that
    /// failed in a way worth repeating are retried on their own, with the same bytes.
    func push(_ items: [(recordID: Data, sealed: Data)]) async throws -> [PushOutcome] {
        var outcomes = [PushOutcome?](repeating: nil, count: items.count)
        var batches: [[Int]] = []
        var inline = 0
        for (i, item) in items.enumerated() {
            let size = item.sealed.count <= assetThreshold ? item.sealed.count : 0
            if let last = batches.last, last.count < Self.recordsPerRequest, inline + size <= Self.inlineBytesPerRequest {
                batches[batches.count - 1].append(i)
                inline += size
            } else {
                batches.append([i])
                inline = size
            }
        }
        for batch in batches {
            for (i, o) in try await pushGroup(batch, items: items) { outcomes[i] = o }
        }
        return outcomes.map { $0! }
    }

    private func pushGroup(_ indices: [Int], items: [(recordID: Data, sealed: Data)]) async throws -> [(Int, PushOutcome)] {
        var pending = indices
        var results: [(Int, PushOutcome)] = []
        var attempt = 0
        while !pending.isEmpty {
            attempt += 1
            try await ensureZone()
            let r = try await pushOnce(indices: pending, items: items)
            results += r.done
            if r.limitExceeded {
                // The whole request was refused, so nothing in it was saved. Halve it (the SDK header asks for this).
                guard pending.count > 1 else { throw SyncTransportError.cloudKit(code: "limitExceeded", message: "a single record is too large") }
                stats.retries += 1
                let mid = pending.count / 2
                results += try await pushGroup(Array(pending[..<mid]), items: items)
                results += try await pushGroup(Array(pending[mid...]), items: items)
                return results
            }
            pending = r.retry
            if pending.isEmpty { break }
            if attempt >= maxAttempts { throw SyncTransportError.retriesExhausted(code: "push") }
            stats.retries += 1
            try await Task.sleep(for: .seconds(r.wait ?? Self.backoff(attempt)))
        }
        return results
    }

    private struct PushPass {
        var done: [(Int, PushOutcome)] = []
        var retry: [Int] = []
        var wait: Double?
        var limitExceeded = false
    }

    private func pushOnce(indices: [Int], items: [(recordID: Data, sealed: Data)]) async throws -> PushPass {
        var tempFiles: [URL] = []
        defer { for u in tempFiles { try? FileManager.default.removeItem(at: u) } }
        var records: [CKRecord] = []
        var byRecordID: [CKRecord.ID: Int] = [:]
        for i in indices {
            let (rid, sealed) = items[i]
            let id = CKRecord.ID(recordName: rid.cloudKitName, zoneID: zoneID)
            let record = CKRecord(recordType: CloudKitSealedRecord.recordType, recordID: id)
            record[CloudKitSealedRecord.versionField] = CloudKitSealedRecord.version
            if sealed.count <= assetThreshold {
                record[CloudKitSealedRecord.bytesField] = sealed
            } else {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("psss-sealed-\(UUID().uuidString)")
                try sealed.write(to: url)
                tempFiles.append(url)
                record[CloudKitSealedRecord.assetField] = CKAsset(fileURL: url)
            }
            records.append(record)
            byRecordID[id] = i
        }

        var pass = PushPass()
        var perRecord: [CKRecord.ID: Result<CKRecord, Error>] = [:]
        do {
            // ifServerRecordUnchanged on a record with no change tag means "only if it does not exist yet": an existing name
            // comes back as serverRecordChanged and nothing is overwritten.
            let result = try await db().modifyRecords(saving: records, deleting: [], savePolicy: .ifServerRecordUnchanged,
                                                      atomically: false)
            perRecord = result.saveResults
        } catch let error as CKError {
            note(error)
            if error.code == .partialFailure, let partial = error.partialErrorsByItemID as? [CKRecord.ID: Error] {
                for (id, e) in partial { perRecord[id] = .failure(e) }
            } else if error.code == .limitExceeded {
                pass.limitExceeded = true
                return pass
            } else if Self.isRetryable(error) {
                pass.retry = indices
                pass.wait = error.retryAfterSeconds
                return pass
            } else if error.code == .zoneNotFound {
                zoneEnsured = false
                pass.retry = indices
                pass.wait = 0
                return pass
            } else {
                throw Self.wrap(error)
            }
        }

        for (id, i) in byRecordID {
            guard let r = perRecord[id] else { pass.retry.append(i); continue }
            switch r {
            case .success:
                stats.saved += 1
                pass.done.append((i, .saved))
            case .failure(let e):
                guard let error = e as? CKError else { throw e }
                note(error)
                switch error.code {
                case .serverRecordChanged:
                    switch await presence(of: items[i].sealed, serverRecord: error.serverRecord, recordID: id) {
                    case .same:
                        stats.alreadyPresent += 1
                        pass.done.append((i, .alreadyPresent))
                    case .different:
                        throw SyncTransportError.conflictingBytes(recordID: id.recordName)
                    case .tryAgain:
                        pass.retry.append(i)
                    }
                case .zoneNotFound:
                    zoneEnsured = false
                    pass.retry.append(i)
                case .batchRequestFailed:
                    // Only the siblings of a record that failed in a non-atomic request.
                    pass.retry.append(i)
                default:
                    if Self.isRetryable(error) {
                        pass.retry.append(i)
                        if let w = error.retryAfterSeconds { pass.wait = max(pass.wait ?? 0, w) }
                    } else {
                        throw Self.wrap(error)
                    }
                }
            }
        }
        return pass
    }

    private enum Presence { case same, different, tryAgain }

    /// After serverRecordChanged: is what the server holds under this name the bytes we tried to save? The name is the hash
    /// of the bytes, so a different answer means damage. The server record that comes with the error may carry its bytes
    /// inline; a CKAsset in it has no file, so then (and when no record came back) the record is fetched by id and compared.
    private func presence(of sealed: Data, serverRecord: CKRecord?, recordID: CKRecord.ID) async -> Presence {
        if let serverRecord, case .bytes(let existing) = Self.readSealed(serverRecord, expectedName: recordID.recordName) {
            return existing == sealed ? .same : .different
        }
        do {
            guard let existing = try await fetchSealed(recordID: Data(formatHex: recordID.recordName)!) else { return .tryAgain }
            return existing == sealed ? .same : .different
        } catch {
            return .tryAgain
        }
    }

    // MARK: Fetch

    /// Everything that changed in the zone since `changeToken` (nil: from the start). Handles an expired token by starting
    /// again from nothing (reported in `tokenWasReset`) and a missing zone by returning nothing. A zone the person deleted
    /// throws `zoneDeletedByUser`. A record that cannot be read does not stop the fetch: its id is returned in `unreadable`.
    func fetchChanges(since changeToken: Data?) async throws -> SyncFetchResult {
        var token = try changeToken.map(Self.decodeToken)
        var records: [FetchedSealedRecord] = []
        var unreadable: [Data] = []
        var malformed = 0
        var reset = false
        var attempt = 0
        while true {
            do {
                let r = try await db().recordZoneChanges(inZoneWith: zoneID, since: token, desiredKeys: nil, resultsLimit: nil)
                for (id, modification) in r.modificationResultsByID {
                    guard let rid = Data(formatHex: id.recordName), rid.count == 32 else { malformed += 1; continue }
                    switch modification {
                    case .success(let m):
                        switch Self.readSealed(m.record, expectedName: id.recordName) {
                        case .bytes(let sealed): records.append(FetchedSealedRecord(recordID: rid, sealed: sealed))
                        case .malformed: malformed += 1
                        case .unreadable: unreadable.append(rid)
                        }
                    case .failure(let e):
                        if let error = e as? CKError { note(error) }
                        unreadable.append(rid)
                    }
                }
                token = r.changeToken
                attempt = 0
                if !r.moreComing {
                    return SyncFetchResult(records: records, changeToken: try Self.encodeToken(r.changeToken), tokenWasReset: reset,
                                           skippedMalformed: malformed, unreadable: unreadable, zoneMissing: false)
                }
            } catch let error as CKError {
                note(error)
                switch error.code {
                case .changeTokenExpired:
                    // The server forgot the token (zone deleted and recreated, or the token is too old). Start over; the
                    // caller sees a full list and tokenWasReset.
                    stats.tokenResets += 1
                    token = nil
                    records = []
                    unreadable = []
                    malformed = 0
                    reset = true
                case .zoneNotFound:
                    zoneEnsured = false
                    return SyncFetchResult(records: [], changeToken: changeToken ?? Data(), tokenWasReset: false, skippedMalformed: 0,
                                           unreadable: [], zoneMissing: true)
                case .userDeletedZone:
                    throw SyncTransportError.zoneDeletedByUser
                default:
                    guard Self.isRetryable(error) else { throw Self.wrap(error) }
                    guard attempt < maxAttempts else { throw SyncTransportError.retriesExhausted(code: Self.name(error.code)) }
                    attempt += 1
                    stats.retries += 1
                    try await Task.sleep(for: .seconds(error.retryAfterSeconds ?? Self.backoff(attempt)))
                }
            }
        }
    }

    /// One record by id: for `unreadable` ones from a fetch, and for comparing after serverRecordChanged. Nil when there is
    /// no such record (or no zone). Throws when it exists but its bytes cannot be read.
    func fetchSealed(recordID: Data) async throws -> Data? {
        let id = CKRecord.ID(recordName: recordID.cloudKitName, zoneID: zoneID)
        return try await retrying { [self] in
            do {
                let record = try await db().record(for: id)
                switch Self.readSealed(record, expectedName: id.recordName) {
                case .bytes(let data): return data
                case .malformed: throw SyncTransportError.malformedLocal("record \(id.recordName) is not a sealed record")
                case .unreadable: throw SyncTransportError.cloudKit(code: "assetUnreadable", message: id.recordName)
                }
            } catch let error as CKError where error.code == .unknownItem || error.code == .zoneNotFound {
                note(error)
                return nil
            }
        }
    }

    // MARK: Helpers

    private func retrying<T>(_ operation: () async throws -> T) async throws -> T {
        var attempt = 0
        while true {
            do { return try await operation() } catch let error as CKError {
                note(error)
                guard Self.isRetryable(error) else { throw Self.wrap(error) }
                attempt += 1
                if attempt >= maxAttempts { throw SyncTransportError.retriesExhausted(code: Self.name(error.code)) }
                stats.retries += 1
                try await Task.sleep(for: .seconds(error.retryAfterSeconds ?? Self.backoff(attempt)))
            }
        }
    }

    private func withRetry(_ operation: () async throws -> Void) async throws { try await retrying(operation) }

    private func note(_ error: CKError) {
        // A caller cancelling its own task is not a CloudKit failure.
        if error.code == .operationCancelled && Task.isCancelled { return }
        stats.errors[Self.name(error.code), default: 0] += 1
    }

    private enum SealedRead { case bytes(Data), malformed, unreadable }

    private static func readSealed(_ record: CKRecord, expectedName: String) -> SealedRead {
        guard record.recordType == CloudKitSealedRecord.recordType,
              expectedName.utf8.count == 64, Data(formatHex: expectedName)?.count == 32 else { return .malformed }
        if let bytes = record[CloudKitSealedRecord.bytesField] as? Data { return .bytes(bytes) }
        if let asset = record[CloudKitSealedRecord.assetField] as? CKAsset {
            // An asset that was not downloaded has no file; that is temporary, not malformed.
            guard let url = asset.fileURL, let data = try? Data(contentsOf: url) else { return .unreadable }
            return .bytes(data)
        }
        return .malformed
    }

    static func isRetryable(_ error: CKError) -> Bool {
        switch error.code {
        case .networkUnavailable, .networkFailure, .serviceUnavailable, .requestRateLimited, .zoneBusy, .serverResponseLost,
             .internalError:
            return true
        default:
            return false
        }
    }

    private static func backoff(_ attempt: Int) -> Double {
        min(15, 0.5 * pow(2, Double(attempt - 1))) * Double.random(in: 0.75...1.25)
    }

    private static func wrap(_ error: CKError) -> SyncTransportError {
        if error.code == .userDeletedZone { return .zoneDeletedByUser }
        return .cloudKit(code: name(error.code), message: error.localizedDescription)
    }

    static func name(_ code: CKError.Code) -> String {
        switch code {
        case .internalError: return "internalError"
        case .partialFailure: return "partialFailure"
        case .networkUnavailable: return "networkUnavailable"
        case .networkFailure: return "networkFailure"
        case .badContainer: return "badContainer"
        case .serviceUnavailable: return "serviceUnavailable"
        case .requestRateLimited: return "requestRateLimited"
        case .missingEntitlement: return "missingEntitlement"
        case .notAuthenticated: return "notAuthenticated"
        case .permissionFailure: return "permissionFailure"
        case .unknownItem: return "unknownItem"
        case .invalidArguments: return "invalidArguments"
        case .serverRecordChanged: return "serverRecordChanged"
        case .serverRejectedRequest: return "serverRejectedRequest"
        case .assetFileNotFound: return "assetFileNotFound"
        case .assetFileModified: return "assetFileModified"
        case .incompatibleVersion: return "incompatibleVersion"
        case .constraintViolation: return "constraintViolation"
        case .operationCancelled: return "operationCancelled"
        case .changeTokenExpired: return "changeTokenExpired"
        case .batchRequestFailed: return "batchRequestFailed"
        case .zoneBusy: return "zoneBusy"
        case .badDatabase: return "badDatabase"
        case .quotaExceeded: return "quotaExceeded"
        case .zoneNotFound: return "zoneNotFound"
        case .limitExceeded: return "limitExceeded"
        case .userDeletedZone: return "userDeletedZone"
        case .tooManyParticipants: return "tooManyParticipants"
        case .alreadyShared: return "alreadyShared"
        case .referenceViolation: return "referenceViolation"
        case .managedAccountRestricted: return "managedAccountRestricted"
        case .participantMayNeedVerification: return "participantMayNeedVerification"
        case .serverResponseLost: return "serverResponseLost"
        case .assetNotAvailable: return "assetNotAvailable"
        case .accountTemporarilyUnavailable: return "accountTemporarilyUnavailable"
        default: return "code\(code.rawValue)"
        }
    }

    private static func encodeToken(_ token: CKServerChangeToken) throws -> Data {
        try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    }

    private static func decodeToken(_ data: Data) throws -> CKServerChangeToken {
        guard let token = try NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data) else {
            throw SyncTransportError.malformedLocal("stored change token cannot be read")
        }
        return token
    }
}

private extension Data {
    var cloudKitName: String { formatHex }
}
