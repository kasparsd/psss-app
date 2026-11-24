import Foundation
#if os(iOS)
import os
#endif

/// Whether the AutoFill extension may run a vault's key derivation for a typed vault password, and what it measures while it does
/// (plan `vault-switcher-and-extension-style`, section 3: "Risk to measure"). Argon2 asks for its whole memory parameter at once
/// (`KDBXKDF.memoryBytes`), and the extension runs under a much lower memory limit than the app. When the limit would be crossed
/// the system ends the extension without a word, in the middle of someone's sign-in, so the extension refuses up front and says
/// "Open Psss to unlock <name>." instead.
///
/// The decision is pure so `scripts/test-matching.sh` covers it. The numbers:
///
/// - **iPhone and iPad: 64 MiB at most, and only while the system says there is room.** Apple publishes no limit for a credential
///   provider; reports and the owner's figure put it near 120 MB. A running extension with the sheet, the vault and the frameworks
///   holds roughly 40 to 50 MB, so 64 MiB (the default for every new vault, `KDBXKDF.recommended()`) is the most that can fit with
///   a margin, and a vault made elsewhere with more (128 MiB, 1 GiB) can never fit. On top of that ceiling `os_proc_available_memory()`
///   is read just before the key derivation: it must have room for the memory parameter plus `headroom`, which catches the
///   device whose limit is lower than 120 MB or whose extension already holds more. A value of 0 or a missing one (a simulator)
///   means "unknown", and the ceiling alone decides.
/// - **Mac: 512 MiB at most.** A Mac extension has no memory limit the system enforces the same way, so the ceiling only keeps a
///   vault with an absurd setting (Argon2 allows up to 4 GiB) from freezing a sign-in.
///
/// Measured on a Mac, optimized build, fresh process (2026-11-24): one 64 MiB Argon2id derivation takes the peak resident size from
/// 13 MiB to 78 MiB and the footprint to 66 MiB, and the memory comes back afterwards, so the derivation costs the memory parameter
/// plus about 2 MiB. The device figure for the extension itself is read from the log line `provider key derivation about to run`
/// (`ProcessMemory.Snapshot.text`, numbers only) and still has to be taken on the oldest supported iPhone.
///
/// `headroom` is the decrypted vault, the XML tree and the SwiftUI screen on top of the derivation; Argon2's own buffer is freed
/// before the file is decrypted, so the two do not add up.
enum ExtensionUnlockBudget {
    static let mebibyte: UInt64 = 1024 * 1024

    /// The largest Argon2 memory parameter the extension runs for a typed vault password.
    static var ceilingBytes: UInt64 {
        #if os(iOS)
        64 * mebibyte
        #else
        512 * mebibyte
        #endif
    }

    /// Memory the extension needs beyond the derivation itself.
    static let headroomBytes: UInt64 = 8 * mebibyte

    /// True when a vault whose key derivation asks for `kdfBytes` may be unlocked with a typed password here. `availableBytes` is what
    /// the system says this process may still allocate before it is ended; nil or 0 is unknown.
    static func allows(kdfBytes: UInt64, availableBytes: UInt64? = ProcessMemory.availableBytes) -> Bool {
        allows(kdfBytes: kdfBytes, availableBytes: availableBytes, ceiling: ceilingBytes)
    }

    static func allows(kdfBytes: UInt64, availableBytes: UInt64?, ceiling: UInt64) -> Bool {
        guard kdfBytes <= ceiling else { return false }
        guard let availableBytes, availableBytes > 0 else { return true }
        return kdfBytes + headroomBytes <= availableBytes
    }
}

/// The extension's refusal to run the key derivation here; the screen says to open Psss.
enum ExtensionUnlockError: Error, Equatable {
    case tooMuchMemory
}

/// The process's memory, for the log that settles the budget above on a real device. Numbers only: never a name, a password, a key
/// or a path.
enum ProcessMemory {
    struct Snapshot: Sendable {
        /// Pages in memory now.
        var residentBytes: UInt64
        /// The most pages in memory at any time since the process started.
        var peakResidentBytes: UInt64
        /// What the system charges the process (the figure the memory limit is judged on, where there is one).
        var footprintBytes: UInt64
        /// What the process may still allocate before the system ends it; nil where the system gives no such number.
        var availableBytes: UInt64?

        func mib(_ bytes: UInt64) -> Int { Int(bytes / ExtensionUnlockBudget.mebibyte) }

        var text: String {
            let available = availableBytes.map { "\(mib($0)) MiB" } ?? "unknown"
            return "resident \(mib(residentBytes)) MiB, peak resident \(mib(peakResidentBytes)) MiB, footprint \(mib(footprintBytes)) MiB, available \(available)"
        }
    }

    /// What the system says this process may still allocate. iOS only; 0 and nil both mean unknown.
    static var availableBytes: UInt64? {
        #if os(iOS)
        let value = os_proc_available_memory()
        return value > 0 ? UInt64(value) : nil
        #else
        return nil
        #endif
    }

    static func snapshot() -> Snapshot {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(task_self_trap(), task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard status == KERN_SUCCESS else {
            return Snapshot(residentBytes: 0, peakResidentBytes: 0, footprintBytes: 0, availableBytes: availableBytes)
        }
        return Snapshot(residentBytes: UInt64(info.resident_size), peakResidentBytes: UInt64(info.resident_size_peak),
                        footprintBytes: UInt64(info.phys_footprint), availableBytes: availableBytes)
    }
}
