# @psss/cli

The `psss` command line: create, read, write and use a vault from a terminal, a script or CI (part 1 of [docs/cli.md](../../docs/cli.md)).
Node 24, TypeScript run directly, no dependencies, no build step.
The commands call a `VaultService` port (`src/service.ts`). The real binary connects it to `@psss/vault` through `src/vault-service.ts`; the fast tests use an in-memory `FakeVaultService`, and `test/real-*.test.ts` run the real binary on real vault folders in temporary directories.

```sh
node src/bin/psss.ts --help       # the commands, options and exit codes
sh ../../scripts/test-cli.sh      # run the tests (one run at a time)
```

## What exists

| Command | State |
| --- | --- |
| `init`, `status`, `get`, `set`, `list`, `rm`, `restore`, `run`, `sync`, `verify` | Built, and connected to the vault library |
| `import <file>`, `export --format kdbx <file>` | Built: KeePass in and out, `--dry-run`, `--progress`, `--json`; one import at a time, an interrupted import says how much it stored, an export never goes into a vault folder; see [cli](../../docs/cli.md#import-and-export) |
| `search`, `code`, `generate`, `doctor`, `history` | Planned: print `psss <name> is not built yet.` on standard error, exit 1 |
| `item`, `file`, `vault`, `group`, `member`, `device`, `location`, `key` | Planned, same |

Planned commands are listed in `--help`, marked `(planned)`, and their arguments are not parsed.

## Output rules

- Results and values go to standard output. Errors, warnings, questions and progress go to standard error, so a pipe stays clean.
- With no terminal, or with `CI` set, nothing is asked and no menu is shown; a missing reference fails with exit 2 and never reads standard input to choose.
- `get` prints the bare value. At a terminal it ends with a line break; into a pipe or a file it does not, so the file holds exactly the value.
- A value is never an argument and there is no `--value` flag. `set` reads all of standard input (one trailing line break removed) or asks without echo. `set` on a title that does not exist fails with exit 3 unless `--create` is given. `rm` asks nothing (it moves to Recently Deleted; `restore` undoes it); `--yes` is accepted for scripts and the future purge.
- Reading warns and never refuses (frame A11). After the vault opens, `get`, `list`, `set`, `status` and `run` print one warning on standard error when `vault.issues` is not empty (a missing property counts as empty): `warning: "Personal" has a problem, so the value above may be out of date. Run psss verify to see what is wrong.` (`get`; `set` says `the new value may not show up until it is fixed`, because later records can wait behind a gap; `list` and `status` say "the result above"; `run` says "the program ran with a value that may be out of date"). The exit code does not change. A key file that group or others can read gets `warning: <path> can be read by other users. Run: chmod 600 <path>` before the value; it is not shown on Windows.
- A write that was not delivered says so (frame A11, decided 2026-11-24). `set`, `rm`, `restore` and a real `import` call `service.delivery()` after they have written; when changes are kept on this computer only they print on standard error `warning: 3 changes are kept on this computer only; ~/Psss/Personal.psss could not be written (permission denied). Run psss sync to deliver them.` (wrapped like the other warnings; one change is "1 change is kept"; several locations are each named; no location named when the service cannot say which). The exit code is `0`: the change is stored and read back here, only its delivery is late. `--json` of those commands carries `"delivery": { "undelivered", "locations": [ { "label", "path", "reason" } ] }` (always present; a dry run has none), and the warning never goes to standard output. `status` counts `undelivered`, marks any location that lacks those changes `Behind` and never prints `Up to date` while any wait. The vault delivers what an earlier run left before every write and import (see the vault README), and cleans up a killed writer's `.tmp-*.sealed` files.
- `verify` prints the plain text of each finding (frame A8), never ids or chain names. The library's own detail is added under `--verbose` (a `Detail:` line) and is always in `--json` (`problems[].detail`).
- `list` adds an `id:<hex>` column for items that share a title (case ignored), so they can be told apart; with no duplicates it looks as in frame A4.
- If the working folder has been deleted, the binary says so and exits 1. A value too large for a record exits 2 with `That value is too large to store (limit N bytes).` followed by the field name and the size of the value.
- `--json` is an option of each command that produces a result, never a global one. Only `get --json` contains a value. Errors stay text on standard error. Names in `--json` (item titles, group names, field names, and the names in an import's findings and lines) have control, direction-override and zero-width characters written as `\u{202e}`, as in a warning; a value is never changed.
- A refusal because another psss holds the vault (`Another psss is importing into this vault right now…`) ends with `Nothing was changed.` only for a command that would have changed something (`set`, `rm`, `restore`, `import`, `sync`): they open the vault with `{ changes: true }`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed (also: a program started by `run` could not start; `run` otherwise passes on the program's own exit code) |
| 2 | Wrong use (unknown flag, extra argument, contradictory values, bad config file, missing reference) or a failed `verify` |
| 3 | No such item, field or group; or an ambiguous name |
| 4 | Locked, no vault, no key, or a key that does not open the vault |

Constants are exported from `src/errors.ts` (`EXIT_OK` ... `EXIT_LOCKED`).

## Keys and device state

The key file is one file per vault, `<config dir>/psss/keys/<vault name>.key` (`$XDG_CONFIG_HOME` or `~/.config` on macOS and Linux, `%APPDATA%` on Windows); `--key-file` and `PSSS_KEY_FILE` override it. `init` refuses, with exit 2, a key file inside the vault folder. Only the vault folder itself is checked, not its parent: a key file beside the vault folder is allowed. Device state defaults to `$XDG_STATE_HOME/psss` or `~/.local/state/psss` (`%LOCALAPPDATA%\psss` on Windows). The service receives both folders as `ServiceOptions.configDir` and `stateDir`.
`init` offers only ways back that exist: a vault password (asked twice without echo and given to `VaultService.setPassword`) or "Not now". The recovery kit joins the list when `key kit` is built.

## Global options

Precedence: flag, environment, `.psss.json` in the working folder, user config, default.

| Flag | Environment | Config key | In `.psss.json` | Meaning |
| --- | --- | --- | --- | --- |
| `--vault <folder-or-name>` | `PSSS_VAULT` | `vault` | yes | The vault. For `init`, the folder to create it in |
| `--group <name>` | `PSSS_GROUP` | `group` | yes | Look in one group; new items go there |
| `--key-file <file>` | `PSSS_KEY_FILE` | `keyFile` | no | This computer's key file |
| `--verbose` | `PSSS_VERBOSE` | `verbose` | yes | Say on standard error where each setting came from |
| `-y`, `--yes` | `PSSS_YES` | none | no | Answer yes to questions; a file can never answer for the person |
| none | `PSSS_KEY` | none | no | A key given inline (the weakest source) |
| none | `PSSS_PASSWORD_FILE` | none | no | A file holding the vault password |

`.psss.json` is committed with a project, so it holds non-secret pointers only. A key that looks like a secret (`password`, `token`, `apiKey`, `key`, ...), a key path, or any key not in the table is rejected with exit 2, naming the file and the key.
User config: `$XDG_CONFIG_HOME/psss/config.json` (default `~/.config`) on Linux, `~/Library/Application Support/psss/config.json` on macOS, `%APPDATA%\psss\config.json` on Windows. The base comes from the injected environment, so tests point it at a temporary folder.
`PSSS_KEY` and `PSSS_PASSWORD_FILE` are never printed (not even with `--verbose`) and are removed from the environment of a program started by `run`.

## References

`psss://item/field`, `psss://group/item/field`, `psss://id:<hex>/field`; `rm` and `restore` name an item, so they take `psss://item`, `psss://group/item` or `psss://id:<hex>`. `rm psss://Example API/token` (a field) fails with exit 2 and `rm takes an item, not a field. Use: psss rm "psss://Example API"`; more parts than fit add `A slash in a title is written %2F.`

- Split at `/` first; each part is then percent-decoded as UTF-8. A `/` inside a title is written `%2F`; a `%` is written `%25`.
- Spaces and non-ASCII letters may be written as they are. In a shell, quote a reference with spaces: `psss get "psss://Example API/token"`.
- `?` and `#` are reserved for a later `?previous=` form: write them `%3F` and `%23` inside a name.
- A part starting with the literal `id:` is an item id (hex, four to 64 digits). A title that starts with `id:` is written `id%3A...`.
- Control characters, empty parts and a `%` not followed by two hex digits are errors, never guesses.
- Matching is the vault's job and is the same for every command: a title matches exactly, ignoring case, never by prefix. Two items with one title are `ambiguous` (exit 3, candidates listed by id). No match exits 3 with `Did you mean: ...?` (when there are near misses) and `See what is there with: psss list`. Near misses (`src/near.ts`): a title that starts with the name, or the name starts with it, or one to two edits away (one for names under five letters), measured on the whole title or its first letters; at most three. Hints are text only and never used as a result.

## The service port

`src/service.ts` is the whole contract the commands call: `create`, `open` (with `{ readOnly?, changes? }`), `info` (with `undelivered`, and `pending` per location), `list`, `find`, `get`, `set` (with `{ create }`), `setPassword`, `delete`, `restore`, `delivery`, `sync`, `verify`, `importKdbx`, `exportKdbx`. Results are plain data; expected failures are returned as `notFound`, `ambiguous`, `locked`, `wrongKey` or `failed`, never thrown. Only `get` returns a stored value. `CliIo.service` is a factory that receives the resolved options (including `PSSS_KEY` and the password file path) and may be asynchronous, so the real binary can build it lazily.

## The real service

`src/vault-service.ts` exports `createVaultService(options)`; `bin/psss.ts` loads it on first use, so `--help` and usage errors never load the crypto. It imports `../../vault/src/index.ts` (and, for `setPassword`, the format's slot primitives) by relative path, with no dependencies.

- **Finding the vault.** `--vault` is a vault folder, a folder that holds one `<name>.psss` (so `init x --vault ./v` and `--vault ./v` agree), or a bare name (`~/Psss/<name>.psss`). With no `--vault`, the one vault in `~/Psss`. Several vaults and no choice is a failure (exit 1) that says to name one; none is exit 4 with the no-vault message.
- **Unlock order.** `--key-file` / `PSSS_KEY_FILE`, then `PSSS_KEY`, then the default key file `<config>/psss/keys/<name>.key`, then the password in `PSSS_PASSWORD_FILE`. The first that opens the vault wins. If none does, a key that is there and wrong (`wrongKey`) is reported over one that is missing (`locked`); both exit 4. `PSSS_KEY` holds the text of a key file (`{"format":"psss-device-key",...}`) or that text in base64. The password file holds the password; one final line break is dropped.
- **Device state** is `<state dir>/<vault name>/` (the library keeps one vault's state in one folder). Moving or renaming a vault folder makes this computer a new device of it.
- **Matching** lists the items and compares titles itself: exact, ignoring case and Unicode form, never a prefix. Two items with one title are `ambiguous`, in any group the search covers. Near misses come from `src/near.ts`, over live items (over Recently Deleted for `restore`).
- **`create`** refuses a key file inside the vault folder, also at the default location and through a symbolic link, by throwing the same `ValidationError` the `init` command raises (exit 2) before anything is written. It also refuses an existing vault, a non-empty folder, an existing key file (a key is never overwritten) and existing device state, with exit 1 and "Nothing was changed."
- **`setPassword`** adds a password slot from outside the library: it opens a device slot with this computer's key file to get the person secret, seals a password slot with the format's primitives and puts the file beside the others. It needs the key file; a second password is refused.
- **`sync`** prints one `Reading <place>` progress line per location only when there are several, and reports `pushed` from the library and `pulled` as the records of other devices this computer had not remembered from the location before the command started (from `state.json`). Labels come from the path ("iCloud Drive", "Dropbox", otherwise "This computer"). The library reads one location here: the vault folder.
- **`verify`** maps damaged records (bad tag, signature, size and so on) to `changed`, a rolled-back location to `missing`, and anything else (a gap, a fork, an unauthorized author) to `other` with the library's `plain` text (a short fallback by code when the library gives none) and the raw `detail`. `open` also returns `vault.issues` and whether the key file is readable by others, which the commands turn into the A11 warnings.
- **Errors** are returned as data and pass through a scrubber that removes the inline key, the password and the value being written. Library and file-system errors become a short `failed` message with the cause (exit 1); a typed `ValueTooLarge` (or the format's size errors) becomes a usage error (exit 2); no stack trace is printed.

What the vault library still lacks for the command line: adding a password slot after creation, per-location pulled counts in `sync`, listing a location's label, adding and removing locations from the command line, and an offline write mode.

## Layout

- `src/cli.ts`: `run(argv, io)` returns the exit code and never ends the process. `CliIo` is `{ stdin, stdout, stderr, cwd, env, isTTY, now?, platform?, inheritStdio?, service? }`.
- `src/commands/`: one file per command, each default-exporting `{ name, summary, usage, options, args, run }`; `index.ts` collects them; `planned.ts` holds the stubs.
- `src/config.ts`, `src/input.ts`, `src/reference.ts`, `src/help.ts`, `src/errors.ts`, `src/io.ts`.
- `src/vault-service.ts`: the real service over `@psss/vault`.
- `test/`: `real-*.test.ts` run the real binary as a child process in temporary folders (quickstart, every exit code, secrets, two computers, a vault password); `golden.test.ts` holds frames A1 to A11 of the approved mock character for character; `test/golden/help.txt` is the `--help` golden file (update it with `node src/bin/psss.ts --help > test/golden/help.txt` when a change is intended).
