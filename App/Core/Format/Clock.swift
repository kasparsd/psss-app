import Foundation

// Clock and order (spec section 4.5).

struct RecordClock: Equatable, Hashable, Sendable {
    var wallMs: UInt64
    var counter: UInt64
}

/// The place of a record in the total order `(wall_ms, counter, author, device, seq)`, compared element by element,
/// byte strings bytewise.
struct RecordOrder: Comparable, Hashable, Sendable {
    var wallMs: UInt64
    var counter: UInt64
    var author: Data
    var device: Data
    var seq: UInt64

    static func < (a: RecordOrder, b: RecordOrder) -> Bool {
        if a.wallMs != b.wallMs { return a.wallMs < b.wallMs }
        if a.counter != b.counter { return a.counter < b.counter }
        if a.author != b.author { return a.author.formatLess(than: b.author) }
        if a.device != b.device { return a.device.formatLess(than: b.device) }
        return a.seq < b.seq
    }
}

enum FormatClock {
    /// A record whose wall_ms is more than 10 minutes ahead of the reader's own time is held back.
    static let holdBackMs: UInt64 = 10 * 60 * 1000

    /// Items in Recently Deleted are removed 30 days after the device accepted the delete (section 5.1, "30 days in Psss").
    static let purgeAfterMs: UInt64 = 30 * 24 * 60 * 60 * 1000

    static func isHeldBack(wallMs: UInt64, nowMs: UInt64) -> Bool {
        wallMs > nowMs && wallMs - nowMs > holdBackMs
    }

    /// The clock for a record about to be written: wall_ms is the larger of the device's time and the largest wall_ms among
    /// accepted records; the counter is 0 when that is larger than every accepted wall_ms and otherwise one more than the
    /// largest accepted counter with that wall_ms.
    static func next(nowMs: UInt64, seen: [RecordClock]) -> RecordClock {
        let largestSeen = seen.map(\.wallMs).max() ?? 0
        let wall = max(nowMs, largestSeen)
        guard let counter = seen.filter({ $0.wallMs == wall }).map(\.counter).max() else {
            return RecordClock(wallMs: wall, counter: 0)
        }
        // A counter cannot pass 2^64 - 1 (section 4.5): the writer moves to the next millisecond instead. Any writer can put the
        // largest counter in a record, so this must not trap.
        if counter < UInt64.max { return RecordClock(wallMs: wall, counter: counter + 1) }
        if wall < UInt64.max { return RecordClock(wallMs: wall + 1, counter: 0) }
        return RecordClock(wallMs: wall, counter: counter)
    }

    /// "30 days" read as at least 30 days since the device accepted the delete (the specification does not say whether the
    /// boundary itself counts).
    static func isPurgeDue(acceptedMs: UInt64, nowMs: UInt64) -> Bool {
        nowMs >= acceptedMs && nowMs - acceptedMs >= purgeAfterMs
    }
}
