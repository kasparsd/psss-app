# @psss/cli-prototype

A prototype of the `psss` command and of the app's side of it, to test the proposal in `docs/cli.md`. Fictional data only. Nothing here is shipping code: the shipping command is planned in Swift inside the app bundle.

Node 24, TypeScript run directly by Node, no dependencies, no build step.

- `src/broker.ts` stands in for the app: the only holder of the (fictional) vault. It decides what leaves and in which form, and calls an approver function where the app would show a sheet confirmed with Touch ID.
- `src/cli.ts` the `psss` command. `src/client.ts` its side of the socket. `src/protocol.ts` the messages and the `psss://item/field` reference. `src/mask.ts` hides a secret in a stream of output. `src/totp.ts` verification codes.
- `scripts/app.ts` runs the stand-in in a terminal and asks its questions as lines of text, to try the command by hand.
- `test/` runs the real command as a child process and checks everything it printed. Tests named KNOWN LIMIT or KNOWN GAP assert that a weakness exists, so the document cannot quietly claim otherwise.
- `probe/peer.swift` asks macOS who is on the other end of a local socket. Compile with `scripts/heavy.sh swiftc`.

Run the tests from the repository root with `scripts/test-cli.sh`.

Not covered: who is really asking (the stand-in trusts the name a caller gives, and answers anything that speaks the protocol), Touch ID, the sandbox, the real site-matching rule, a real vault. Whoever starts the Node command also controls its environment (`NODE_OPTIONS`), which a signed Swift command with the hardened runtime does not allow.
