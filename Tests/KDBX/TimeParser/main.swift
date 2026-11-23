// The time parser tests alone, built without optimization by `scripts/test-kdbx.sh`, where an integer overflow traps.
import Foundation

let failed = runTimeParserTests()
print(failed == 0 ? "time parser: all passed" : "time parser: \(failed) failed")
exit(failed == 0 ? 0 : 1)
