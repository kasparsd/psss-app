#!/bin/sh
# Builds and runs the hostless password generator tests (docs/plans/password-generator.md, tests 1 to 12 and 14): Apple-style
# shape and strength, Words and Random characters, rejection sampling, a table of real password rules, length caps, the offensive
# filter, settings, the mask. It compiles only the generator's own files, so it stays fast and scripts/test-kdbx.sh does not grow.
# One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/generator-test
FILES="App/Core/PasswordRules.swift App/Core/AppleStyle.swift App/Core/OffensiveFilter.swift App/Core/WordList.swift \
  App/Core/GeneratorSettings.swift App/Core/GeneratorText.swift App/Core/PasswordGenerator.swift"
# No generated value may be logged, printed or put in an error message anywhere in the engine.
LEAKS='(^|[^A-Za-z0-9_])(print|debugPrint|dump|NSLog|os_log|Logger|fputs)[[:space:]]*\(|\.(debug|info|error|notice|log|warning|fault)\(|(fatalError|preconditionFailure|assertionFailure|precondition|assert)\(.*\\\('
if grep -nE "$LEAKS" $FILES; then
  echo "test-generator: the engine must not log, print or put a value in a message (see the lines above)" >&2
  exit 1
fi
swiftc -O -swift-version 6 -D HOSTLESS_TESTS $FILES Tests/Generator/main.swift -o build/generator-test/run
build/generator-test/run
