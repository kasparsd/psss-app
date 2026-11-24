# Command line

**Status: re-scoped 2026-11-24. Milestone 1 of part 1 is built and independently validated (2026-11-24): `Packages/vault` and `Packages/cli` give a working headless `psss` with `init`, `status`, `get`, `set`, `list`, `rm`, `restore`, `run`, `sync` and `verify` on a folder vault. `import` (KeePass) and `export --format kdbx` are built (2026-11-24, [below](#import-and-export)). Everything else in part 1, and all of part 2, is not built.** Part 1, the core command line, is the priority. The owner decided on 2026-11-24 on direct and brokered modes, the parser, recovery at `init` and one `psss` executable, and approved the terminal output drawn in the mock (frames A1 to A10); the other rows of the decisions table are recommendations. Part 2 is not approved. Part 2, agent access, is the proposal of 2026-11-23 with its prototype in `Packages/cli-agent-prototype` and its screens in `Design/Mocks/command-line-and-agents.html`; it now extends part 1 instead of standing alone. The decisions waiting for the owner are [at the end](#decisions-for-the-owner). Nothing here changes the app until they are made. The working plan is `docs/plans/command-line-and-agents.md`.

## What was asked

On 2026-11-23: give Psss a command-line interface so that scripts, developer tools and AI agents can work with what is in the vault, and let the person grant that access without the secrets being exposed.

On 2026-11-24: make it first a complete way to use a vault and its secrets from a terminal, a script or CI, on any platform, and add the agent-specific features on top. Core operations come first.

## Part 1: the core command line

### What it is for

`psss` creates and inspects a vault, reads, writes, searches and generates secrets, runs a program with secrets in its environment, moves data in and out (KeePass, backup copies), keeps locations in step, and later shares groups with people and machines. It is used by a person at a keyboard, by a script, by CI and on a server, on macOS, Linux and Windows. It works on a vault in the [record-log format](format.md), kept in a folder.

It is not a server, a secrets manager with policies and dynamic credentials, or a replacement for HashiCorp Vault. Its closest relatives are `pass`, `gopass`, `sops` and `op`; the comparison page in the package docs says where it differs.

### Two ways to open a vault

| | Direct | Brokered (part 2) |
| --- | --- | --- |
| The command holds a key | Yes, its own device key | No |
| Where it runs | macOS, Linux, Windows, CI, servers | Mac with the Psss app, signed build |
| Who approves a use | Whoever can read the key | The person, with Touch ID, in the app |
| Commands | All of part 1 | A subset of the same verbs, plus `fetch` |
| Safe to give to an AI agent | **No.** Anything running as the same user can run it | Yes, within the limits listed in part 2 |

The verbs and the `psss://` reference mean the same in both. Phase 1 to 3 build direct mode only. Direct mode is the model of `pass`, `gopass` and `sops`: the protection is the key's file permissions, the OS account and the person's care, no more. It is the “unlock by itself” design that part 2 rejects for agents, and the docs say so wherever direct mode is described.

### Conventions

Taken from the sibling repositories, read on 2026-11-24: `../pad-launch` (the `tug` command: `docs/cli.md`, `src/cli`, `docs/releases.md`) and `../wpelevator-monorepo` (`packages/js/wp-release`, `CONTRIBUTING.md`).

| Area | Rule for `psss` |
| --- | --- |
| Grammar | `psss <subject> <verb> [params]` (tug), with the everyday verbs at top level: `init`, `status`, `get`, `set`, `list`, `search`, `rm`, `run`, `code`, `generate`, `sync`, `verify`, `doctor`. Subjects: `vault`, `item`, `file`, `group`, `member`, `device`, `location`, `key`. A positional names the primary target (the reference, the folder); options qualify it |
| Parser | `node:util` `parseArgs` and one module per command (wp-release), no CLI framework, so the command keeps the no-dependency rule of `@psss/format`. Groups load lazily. A test compares the registered names with `--help` (tug) |
| Strictness | Unknown flags, extra arguments and contradictory values are errors before any read or write (tug) |
| Exit codes | `0` success, `1` failure, `2` invalid usage or a failed `verify` (wp-release), `3` no such item, an ambiguous name, or (brokered) not allowed, `4` locked, app not open or no key. One table in both modes, as drawn in the [mock](../Design/Mocks/command-line-and-agents.html). In brokered mode refusal, a wrong name and a missing field are one answer and one code (`3`), as in part 2 |
| Streams | Results and values on standard output; errors, warnings and progress on standard error, so a pipe stays clean (tug). Progress is one line per stage when not a terminal or when `CI` is set |
| JSON | `--json` on every command that produces a result, per command and never global (tug). Values appear in JSON only from `get --json`, which names the field it was asked for |
| Secrets and arguments | Never as an argument, never in a config key, never in a log. `set` reads standard input, or asks without echo in a terminal. There is no `--value` flag (tug has one and warns about it; this project has no installed base to protect) |
| Options table | Every global option has a flag, an environment variable and, where it is not a secret, a config key. Precedence: flags, environment, `.psss.json` in the working directory, user config, defaults (tug). `--vault <folder or name>` (`PSSS_VAULT`), `--group` (`PSSS_GROUP`), `--json`, `--verbose`, `--yes` |
| Choosing | With the reference left out, a terminal offers a list. With no terminal or with `CI` set the command fails and says which argument is missing; it never reads standard input to choose (tug) |
| Writes | Every command that writes or deletes in bulk has `--dry-run` (wp-release): `import`, `vault restore`, `item purge` |
| Testing | `run(argv, io)` takes an injected `CliIo` (standard streams and working directory) so most tests run in process; a few run the real executable as a child (wp-release, tug). Assertion messages state the expected behavior |

### Commands

Proposed. Names are the owner's to change before anything is built. A command that prints for a person is mocked and approved before it is built; `init` is the first, because it must say what was created, where, who holds the key and what happens if the key is lost.

**Phase 1: one person's vault.**

| Job | Commands |
| --- | --- |
| Create and check | `init [name]` (creates a vault folder and this machine's device key, and says where both are), `status` (vault, locations, up to date or behind, format version, key source), `verify` (every signature, chain, membership record and rollback check; exit 2 on any failure), `doctor` (permissions, clock, key source, location reachable) |
| Read | `get <ref>`, `list [group]`, `search <text>`, `item show <ref>`, `history <ref>` (previous values, with dates), `code <ref>` (a verification code) |
| Write | `set <ref>` (value from standard input; `--generate` makes one and prints only the reference), `item add`, `item edit`, `rm <ref>` (moves to Recently Deleted), `restore <ref>`, `item purge` (permanent, with `--dry-run` and a confirmation), `generate` (the app's password generator and word list) |
| Use | `run --env NAME=<ref> -- <program>` (the value is in that program's environment and nowhere else), `run --env-file <file>` where the file holds references |
| Files | `file get <ref>`, `file put <ref> <path>` for attachments such as certificates and key files |
| Move data | `import <file>` (KeePass is built; 1Password and CSV next, through the mappings in [items](items.md)), `export --format kdbx` (built; says what does not travel), `vault backup`, `vault restore` (adds to the vault, never replaces) |
| Keep in step | `sync`, `location add`, `location list`, `location remove` (removing never deletes what is in it) |

**Phase 2: sharing and devices.** `group create|list|show`, `member invite|accept|list|role|remove`, `device list|approve|remove`, `key password set`, `key kit`, `key recover`. Removal prints the list of what the person could see, as the app does. Needs the invitation and device approval exchanges that [format spec section 10](format-spec.md#10-not-yet-specified) lists as unwritten.

**Phase 3: automation.** A committed `.psss.json` with references and non-secret pointers only; a machine identity (below); item kinds for SSH keys and certificates, which is a schema addition; masking of `run` output in direct mode.

### References

A reference is a name for one field of one item and is safe to write in a script, a config file or a conversation. It is the form of part 2, extended: `psss://item/field`, `psss://group/item/field`, or `psss://id:<item id>/field` when titles repeat. The field is `password`, `username`, `url`, `note`, `code` (computed) or a custom field's name. Titles with spaces are quoted by the shell. In direct mode an ambiguous title exits `3` and lists the candidates by id; in brokered mode it is answered like any other refusal. Phase 1 settles the grammar with tests, including `?previous=` for an earlier password.

### Unlocking without an app

The command is a device of the vault, with its own X-Wing key pair, let in through a slot of the [format](format-spec.md#7-wrapped-keys). There is no Keychain to ask. The sources, in order of preference:

| Source | Slot | Notes |
| --- | --- | --- |
| Key file | Another device (type 3) | The default. Created by `init` with mode `0600`, one file per vault: `~/.config/psss/keys/<vault name>.key` on macOS and Linux (`XDG_CONFIG_HOME` honoured), `%APPDATA%\psss\keys` on Windows. Never inside the vault folder, and `init` refuses it there, because a key beside the vault would travel with it through iCloud Drive or Dropbox. `--key-file` or `PSSS_KEY_FILE` points a script or CI at one |
| Key in the environment | Another device (type 3) | `PSSS_KEY`, for CI that can only inject environment variables. The weakest source; the docs say file first, as tug says for its credential |
| Operating system keyring | Another device (type 3) | Keychain, libsecret, Credential Manager. Not decided: needs a spike to reach them with no native code and without the secret appearing in a process's arguments |
| Vault password | Password (type 1) | Argon2id at 128 MiB, asked without echo or read from `PSSS_PASSWORD_FILE`. Never an argument |
| Recovery kit | Recovery kit (type 2) | `key recover` only |

`init` follows the app's rule: when the device key is the only way back, it says so in plain words and offers the ways back that exist before finishing, and `--no-recovery` is the explicit opt-out. Until `key kit` is built (and its output mocked) the choices are a vault password or “Not now”; the recovery kit joins the list when it works, because a choice that ends in “not built yet” reads as a failure. It does not refuse to finish without a choice, since a script must be able to create a vault (decided 2026-11-24).

### Device state

The command remembers, outside the vault, what the format requires of a device: its device id and sequence numbers, the last chain heads it accepted from each location (the rollback check, spec 4.4), and every sealed record it wrote, stored before anything is uploaded (the never-seal-twice rule). On macOS and Linux this is `~/.local/state/psss` (`XDG_STATE_HOME` honoured), on Windows `%LOCALAPPDATA%\psss`. Losing it does not lose the vault but makes the device a new one, so it is part of what `vault backup` mentions.

#### A write that was not delivered

A write is stored on this computer first and delivered second, so a location that cannot be written (read-only, full, gone, not mounted) never loses the change. Decided 2026-11-24 after an independent run found that such a write said nothing:

- **The write succeeded, so the command exits as it would have: `0`.** The change is durable here and this computer already reads it back; only its copy in the location is late. Exit `1` would tell a script that the change was lost, which is false, and would invite a retry of a write that is already made. A script that must know checks `--json` (below) or runs `psss sync`, which does exit `1` while a location is unreachable.
- **It says so, after the result, on standard error** (frame A11, same style as the other warnings): `warning: 3 changes are kept on this computer only; ~/Psss/Personal.psss could not be written (permission denied). Run psss sync to deliver them.` One change says "1 change is kept"; several locations are each named, in one sentence; the reason is plain (`permission denied`, `the disk is full`, `the folder is read-only`, `the folder is missing`), with no paths or error codes. This applies to `set`, `rm`, `restore` and `import` (also an import that stopped part of the way); a dry run never says it and never asks. Never on standard output.
- **`--json` carries the same fact**: `"delivery": { "undelivered": 3, "locations": [ { "label", "path", "reason" } ] }` in the result of `set`, `rm`, `restore` and a real `import` (always present, `undelivered` is `0` when all is delivered, and `locations` is empty then).
- **The next write or import delivers what was left, first.** Before it does its own work it sends everything in the outbox to the locations that lack it, as stored and never sealed again (format spec 4.1), in order and a hundred records to a file; so a rerun of an import that was killed or could not write delivers the old records and adds nothing twice. A location that refused something is not written again by the same command: a later record never goes into a location that lacks the earlier ones, so the copy there has no gap. A dry run delivers nothing and touches no state.
- **`status` never says "Up to date" while the outbox holds anything.** A location that lacks changes made here is `Behind`, and below the table: `95 changes are kept on this computer only, not in every location yet. Run psss sync to deliver them.` If changes wait and no location is known to lack them, every location is `Behind`. `status --json` has `undelivered` (a count) next to the locations' `state`.
- **A killed writer's leftovers are cleaned up.** A writer that is killed (SIGKILL, power) can leave `outbox/.tmp-<pid>-<random>-….sealed`. The next command that takes the state lock removes those whose process is gone or that are older than the lock's staleness (two minutes); a young file of a live process, and every real outbox entry, are left alone.

### What direct mode does not protect against

Stated plainly, as in part 2.

- **Anything running as the same user** can read the key file and the vault and run the command. Direct mode is exactly as strong as `pass` or `sops`, and no stronger.
- **A program started with `run`** can read its own environment and print or send it. Masking of its output is a convenience, not a boundary.
- **A stolen key file is the person** until a manager removes the device, and removal cannot unsend what it already read ([costs](format.md#costs-and-risks)).
- **A person's secrets in CI** are as safe as the CI system's own secret store, which holds the machine's key. That is the same “secret zero” every tool has.

### Libraries and packages

Three packages, each with a README, `docs/` and a changelog, in the shape of `wp-release`: a CLI and a library from one package, a source condition for development, a compiled `dist/` for consumers.

| Package | Holds | State |
| --- | --- | --- |
| `@psss/format` | Records, keys, folding, folder layout, vectors. Node 24, `node:crypto` only | Exists, against spec draft 5 |
| `@psss/vault` | Opening a vault, unlocking, device state, the read model and references, writes, import and export, backup. No prompts, no output | New, phase 1 |
| `@psss/cli` | The commands over `@psss/vault`; exports `run(argv, io)`; bin `psss` | New, phase 1 |

Node does not strip types from files inside `node_modules`, so a published package has to be compiled even though the repository runs TypeScript directly. Names are not registered until the brand and domain decision in the [roadmap](roadmap.md#open-decisions). The prototype in `Packages/cli-agent-prototype` stays as the reference for part 2; it was renamed on 2026-11-24 to leave the name `Packages/cli` to `@psss/cli`.

### What 1.0 freezes

Copied from pad-launch's rule: before 1.0, a minor bump is the compatibility boundary; from 1.0 these change only compatibly inside a major.

- Command names, flags and exit codes, and the JSON printed by `--json`.
- The `psss://` reference grammar and the `.psss.json` keys.
- The format version the packages read and write, and the vault, backup and key file formats.
- Package and binary names.

Not frozen: wording of human output, `doctor` and `status` text, anything marked experimental. Every user-facing change has a changeset; releases are made by CI with provenance, never by hand.

### Import and export

Built 2026-11-24 on the [KDBX codec](../Packages/kdbx/README.md), `@psss/vault` (`importKdbx`, `exportKdbx`, the mapping in `src/keepass.ts`) and `@psss/cli`. The output of both commands is frame A9 of the mock, character for character, for the case it draws.

```
psss import <file> [--dry-run] [--strip-invalid] [--include-trash] [--update] [--kdbx-key-file <path>] [--progress] [--json]
psss export --format kdbx <file> [--dry-run] [--force] [--strip-invalid] [--kdbx-key-file <path>] [--json]
```

- **Credentials of the KeePass file** are never arguments. The password is typed without echo (`Password for Family.kdbx (not shown):`), piped in on standard input, or read from the file named by `PSSS_KDBX_PASSWORD_FILE` (one trailing line break dropped; it is not passed on to a program `run` starts). A key file is named with `--kdbx-key-file`, since `--key-file` already means this computer's vault key; with one, the password may be empty. `export` asks once for the new file's password, as the frame shows, and does not ask in a dry run.
- **Dry run.** `--dry-run` opens the vault read-only: no lock, no write to the vault, and none to the device state (no outbox entry, no remembered chain heads, no new device folder). A test lists every file before and after.
- **One import at a time.** A real import holds the vault's lock from reading to its last record. Two at once do not duplicate anything: the second waits (up to 30 seconds) and then says `Nothing new to add`. A command that needs the vault while one runs says `Another psss is importing into this vault right now. Wait for it to finish and try again.` and exits 1, and adds `Nothing was changed.` only when the command would have changed something (`set`, `rm`, `restore`, `import`, `sync`), not for `list`, `status`, `get`, `verify` or `run`. The import keeps its lock fresh while it works: before and after each write to a location, and every few seconds (a quarter of the lock's two-minute limit) while it reads entries, also entries that write nothing, so a long gap without a new record, or one slow location, never makes the lock look abandoned. Importing 20,000 entries takes about three minutes; `--progress` writes `Importing 1,200 of 20,000` to standard error (rewritten in place on a terminal, which shows it without the flag; one line a second otherwise), never to standard output and never with `--json`.
- **Stopping part of the way.** If an import fails after some items were stored (a full disk, say) it says why, how many items it added or updated, that those stay, and `Run the same command again to finish: items that are already here are left alone.` Exit 1. It says `Nothing was changed.` only when nothing was stored.
- **Same file twice.** Each imported item keeps the entry's UUID and a hash of what the file said in its `source` field (kind `keepass`), so a second import adds nothing and says `Nothing new to add`, with the number of items already here. The rules are in [items](items.md#keepass-import-and-export-in-the-record-log-vault).
- **Adds and never replaces.** An item changed in the file since it was imported is left as it is here and reported; `--update` brings in the file's version only for an item that was not changed here. An item deleted here (Recently Deleted or for good) is not brought back. The frame's caption, "Importing adds and never replaces", holds unless `--update` is given.
- **Invalid XML characters.** KeePass files cannot hold some control characters. On import a field that has them is not imported and a warning names the item and the flag; with `--strip-invalid` they are removed and counted. On export the same rule applies to the vault's fields.
- **Streams.** The summary is on standard output, findings are one `warning:` line each on standard error, grouped by kind and part of an item with the names of up to three items; names are cut to 60 characters and control and direction characters in them are written as `\u{…}`. In `--json` the same rule applies to every name a command prints (item titles, group names, field names; for `import` also the names in its findings and per-entry lines): control, direction-override and zero-width characters are written as the text `\u{202e}`, as in a warning, so the string is safe to print and cannot reorder text around it (decided 2026-11-24; the id, never the escaped title, is what a script passes back). A value printed by `get --json` is never changed. `--json` prints the counts, the findings and one line per entry (its name, cut to 60 characters, and what happened), never a value; its `file` is written as `export` writes it (`./Family.kdbx`).
- **`--strip-invalid` is offered** only for fields refused for their characters; a field over a size or number limit is counted on its own line, without the flag.
- **Exit codes.** 0 done. 4 the password or key file does not open the file (a damaged file looks the same, so the message says so). 1 for a missing, unreadable, damaged or oversized file (over 512 MiB, refused before it is read), a file that is not KeePass 2, one that needs something Psss does not read (a hardware key, Twofish), or an export that would replace a file. 2 for a missing or misspelled option or argument.
- **Export** writes KDBX 4.1 (ChaCha20, Argon2id), mode `0600`, under a temporary name, reads it back with the password and compares every entry's UUID, password and attachment count, and only then moves it into place. It reports what the file does not carry. An entry's UUID is that of the KeePass entry the item was imported from (so KeePassXC's `merge` with the original database pairs them), and the item id for any other item.
- **Export never goes into a vault folder.** A KeePass file holds every secret in the clear, so a file inside the vault folder, or any place the vault is kept in (and so synced), is refused, a dry run too, with the folder named and `Choose another place for the file, outside the vault folder.` Exit 1, as `init` does for a key file.

What does not travel out (the line after "Not in a KeePass file:", shown only for what applies): the people in shared groups; passkeys that cannot be written as KeePassXC passkeys; fields this version of Psss does not know. Always true and listed here instead of on every run: the record history of fields other than the password (only the ten newest previous passwords are written, as KeePass history), the `source` of imported items, and positions. On the way in, the findings are in the report of [items](items.md#keepass-import-and-export-in-the-record-log-vault).

### Docs and tests

README opens with a command and its real output, then the quickstart, the CLI reference, the library page, the comparison with existing tools and a development page, one job per page, as in `wp-release`. A test runs every command the docs show against a fixture vault, so no output is invented. Outcomes the work is measured by are in the plan.

## Part 2: agent access

Everything below is the proposal of 2026-11-23, now an extension of part 1: the same verbs and references, in brokered mode, for programs and AI assistants that should use a secret without holding the vault's key. Where it says “the command holds no key”, it means the brokered client.

### The problem

A person working in a terminal, or an AI assistant working for them, needs secrets all day: a token to call an API, a password for a deploy, a verification code to sign in. Today that means copying from the password manager and pasting into a terminal, a `.env` file or a chat. Each paste leaves a copy: in shell history, in a file that gets committed, in a log, or in an AI conversation that is stored on someone else's servers.

What the person wants is narrower than “give the assistant my password”. It is “let this task use that one login”. The design question is therefore in what form a secret leaves the vault, and who decides each time.

### What others do

From general knowledge of these tools, not re-checked on 2026-11-23. Verify before quoting any of it outside this document.

| Tool | How a secret is used | What Psss takes from it |
| --- | --- | --- |
| `ssh-agent` | The key never leaves the agent. Programs ask it to sign. | The model to aim for: do the operation, do not hand over the secret. |
| 1Password `op` | Secret references (`op://vault/item/field`) in place of values. `op run` puts them in one program's environment and masks them in its output. The desktop app approves each terminal with Touch ID for a few minutes. | References, `run`, masking, and approval by the app rather than by the command. |
| `aws-vault exec`, `doppler run`, `sops exec-env` | A child process gets the secret in its environment; nothing is written to disk. | The same `run` shape, so it is familiar. |
| Git and Docker credential helpers | The tool asks a helper for the login for one host. | A secret is bound to the host it is for. |
| Bitwarden `bw`, `keepassxc-cli`, `pass` | The command unlocks the vault itself (a session key in an environment variable, or the password typed each time) and prints values. | What not to do: a key any script can reach, and printing as the main path. |
| macOS Keychain | Each item has a list of programs allowed to read it, with an “Always Allow” prompt. | Per-program grants are understandable; “Always” is where people stop reading. |
| Header-injecting proxies for agents | The agent calls an API through a local proxy that adds the token. | `fetch` below, without a proxy or a certificate to install. |
| Apple Passwords | No command line. | A place where Psss can offer more. |

### The idea

**For agent access, the app is the only thing that opens a vault. In brokered mode the `psss` command holds no key: it carries a question to the running app, and the app asks the person.** The direct mode of part 1 is the opposite design and is not for agents.

Four things follow.

1. **A program handles names, not values.** It refers to a secret as `psss://item/field`, for example `psss://Example API/token`. A reference is safe to write in a script, a configuration file or a conversation.
2. **The form a secret leaves in is chosen per use,** from “never leaves Psss's own code” to “printed”. The sheet says which, in one sentence.
3. **The person approves in the app, with Touch ID.** The sheet names the app that asked, the item, what will be done with it and for how long. An assistant that can control the screen can click a button; it cannot give a fingerprint.
4. **A program never gets a list of the vault.** It asks for one item by name, and sees only what it was allowed.

This is the same door the browser extension already needs: [browser extension](browser-extension.md#host-and-app) says the native host must hold no key and relay each request over a local socket to the running app, which verifies the caller, unlocks if needed and approves the release. The command line is a second caller of that one relay, not a second system.

### Ways to use a secret

Ordered from least to most exposed. “Kept” means the person may answer “until Psss locks” so that the same request is not asked again.

| Use | Command | Where the secret ends up | Kept for |
| --- | --- | --- | --- |
| **Send to its own website** | `psss fetch psss://item/field https://…` | In the `psss` command, which sends it to the website the item is saved for and prints the answer. The caller never receives it. | The asking app, the item's field and the request shown: its method, its address with port and path, where the secret is placed, and whether there is a body. The query and the body's contents may differ |
| **Run a program with it** | `psss run --env NAME=psss://item/field -- program …` | In that one program's environment. Psss hides it in what the program prints. | Never: asked every time, with the whole command shown |
| **A verification code** | `psss code item` | A six-digit code that expires within 30 seconds is returned. The secret behind it is not. | The asking app and the item |
| **Save something new** | `psss save --title … --generate` | Nothing leaves. With `--generate` the password is made inside Psss and the caller gets only a reference. | The asking app |
| **See the value** | `psss show psss://item/field` | Printed. | Never: asked every time, and refused outside a terminal unless `--print` is given |
| **What is allowed** | `psss list` | Names and accounts of what this caller was allowed, never values. | |

Rules that hold for all of them:

- **A password is sent only to the website it is saved for,** by the same matching rule as AutoFill, over https (plain http only for the name `localhost`, as in the browser extension). There is no override on the sheet; the way through is to add the website to the item.
- **A wrong name, a refusal and a missing field are answered alike,** with one sentence and one exit code, and a wrong name still shows the person a sheet. A program cannot find out what is in the vault by guessing.
- **Allowances end when Psss locks.** There is no “Always”. They live in memory on this Mac, are never written to the vault and never sync.
- **A record of each use is kept on this Mac:** who, which item, how and when. For a program it keeps the program's path and not its arguments, and for a request the address without its query, since a caller may have typed a secret there (the path is kept, so a secret typed into a path would be too). Never a value from the vault.
- **The app itself still uses no network.** `fetch` is carried out by the `psss` command, which is Psss's own signed code, so the review finding that the app makes no connections stays true.

### What it protects against, and what it does not

Stated plainly, because “without exposing the secrets” is easy to over-promise. The lines about the software are checked by tests in `Packages/cli-agent-prototype/test/agent.test.ts`; the last two are about people and other programs and are not.

| Threat | Result | How |
| --- | --- | --- |
| A secret pasted into a terminal, a `.env` file, shell history or an AI conversation by habit | **Removed.** | References in place of values; `run`, `fetch` and `save --generate` never print one. |
| A program that logs its own token by accident | **Caught.** | Output is masked, also when the value arrives in pieces. |
| An assistant that asks for the obvious thing (“print the password”) | **Stopped before the person is bothered.** | `show` refuses outside a terminal and names the better command. |
| A program listing or guessing what is in the vault | **Stopped.** | No list, and every refusal looks the same. |
| A token sent to the wrong website, by mistake or by a redirect | **Stopped.** | `fetch` sends only to the item's own site and does not follow redirects. |
| An assistant that was tricked (by a web page, a file, a message) into trying to steal a secret through `run` | **Not stopped by the software.** | A program the assistant chose can read its own environment and print it encoded, or send it away. Masking is not a boundary. What stands in the way is the person reading the command on the sheet, which is why `run` is asked for every time and the whole command is shown. Even that is partial: the sheet cannot show the environment, the folder or the files a command depends on. |
| The same assistant using `fetch` | **Limited to the item's own website.** | The secret cannot go to another host. A site that echoes requests back is masked; a site that returns the token in another form is not. |
| Another program running as the same user | **No worse than today, not solved.** | It must ask through the same door and the sheet names it. An unlocked Mac under an attacker's control is outside the [guarantees](architecture.md) already. |
| People approving without reading | **Reduced, not removed.** | Few prompts (kept until lock), specific wording, no default button. |

The honest summary for the interface and any future marketing: **Psss lets a program use a secret without the secret being shown, stored or pasted. It does not make it safe to hand secrets to a program you do not trust.** “Send to its own website” is the only use where the caller never holds the secret at all.

### Who is asking

The sheet says “Claude wants to…”. That name has to come from the system and not from the caller.

- **The direct caller must be Psss's own signed `psss` command.** The app reads the caller's identity from the socket and checks its code signature. Anything else is dropped without an answer. This is what stops a program from speaking the protocol itself to collect raw values.
- **The app that started it is found by walking up the process chain** to the first one that is an application (Terminal, Claude, an editor). That is a label for the person, not proof: a parent process can exit and its number be reused.
- **When no application is found** (a remote login, a background job), the sheet says so and offers no “until Psss locks”.

The prototype cannot check any of this, because Node cannot read who is on the other end of a socket: it takes the caller's word. A Swift probe (`Packages/cli-agent-prototype/probe/peer.swift`) shows what macOS reports; its result is under [measured](#what-the-prototype-measured).

### How it fits

- **One relay in the app** serves the browser host and the command line: a local socket in the app's group container, a check of the caller, a queue of requests, and the approval sheet. The item “Replace the host's vault access with a socket relay to the app” in [browser extension](browser-extension.md#status) is this work.
- **Format-neutral.** The relay reads items through `VaultStore` and never touches a file, so it works on today's KDBX store and on the [record log](format.md) alike.
- **The brokered client is Swift, inside the app bundle,** signed with the app, because the peer check needs a signed caller and a Node script cannot be one. The Node prototype settles the behaviour and the protocol. The cross-platform [reference tool](format.md#roadmap) is the direct-mode command of part 1, a different thing that opens a folder vault with its own key. Recommended: it is the `psss` on the path, and brokered verbs are handed to the signed helper in the app, which is the only process that receives a value. The Node wrapper never sees one, so a caller that controls its environment gains nothing from it. This is an owner decision below.
- **Mac only.** iPhone and iPad have no command line, so this is a deliberate platform difference: the allowances and the activity list are per Mac and do not sync. Nothing changes in review semantics, copy or safety rules shared across platforms.
- **Off by default,** one switch under Setup. It is a tenth-setting candidate against the [simplicity budget](product.md#simplicity-budget) of fewer than ten, and it is never on the main path.

What only a signed build can settle, to add to spike S5:

- Whether a command-line tool shipped inside a sandboxed Mac App Store app can be run from Terminal and reach the app's socket in the group container.
- How the person gets `psss` onto their path: a sandboxed app cannot write to `/usr/local/bin`. The options are a one-line command the app shows, a Homebrew formula for a notarized copy, or a direct-download build. This is the same question as [Mac distribution](roadmap.md#open-decisions) for the browser host.
- Whether the caller's signature check and Touch ID sheet work when the app is in the background or has no window, and whether the command may start the app when it is not running.

### Ideas considered

| Idea | Verdict |
| --- | --- |
| **An MCP server** (`psss mcp`), so assistants without a shell can ask | Yes, second. It is a thin wrapper over the same relay with the same sheets. It offers fetch, run, code, save and list, and no way to see a value, because a tool result goes straight into the conversation. Build after the command, since an assistant with a shell can already use the command. |
| **An assistant as a member of a group** (“Shared with the build server”) | Yes, later, for machines with nobody at them. The [record log](format.md#membership-and-revocation) already has members with their own keys and a view-only role, so a server can be let into one group and no other, and removed like a person. Access is then limited by encryption and not by a prompt, which suits unattended work and nothing else. Needs sharing by group to exist first. |
| **Git credential helper** (`git-credential-psss`) | Yes, small, after the first version. Git asks for the login of one host and the sheet says so. The helper prints the password to Git, so anything that runs the helper itself is a `show`; it is asked like one unless Git is the caller. |
| **SSH keys, with Psss as the SSH agent** | The best example of use without exposure, and the most asked-for developer feature in other managers. Not proposed now: SSH keys are “not planned” in the [roadmap](roadmap.md#later-in-priority-order), and this needs a new item kind. Revisit with evidence of demand. |
| **Filling a template file** (`psss inject config.tpl > config`) | No. It writes secrets to disk, which is the habit this exists to end. `run` covers the need. |
| **A local proxy that adds the token to any request** | No. It needs a certificate installed to read https, and it is a standing door. `fetch` does one request at a time. |
| **“Always allow” and timed allowances** | No for now. “Until Psss locks” needs no explaining. Revisit if people report too many sheets. |
| **A group or a per-item switch for “available to the command line”** | No. An item is in exactly one group, so a login shared with the family could not also be in an “assistants” group, and a switch per item is a setting to forget. Allowing happens at the moment of use. |
| **Approving on the iPhone when away from the Mac** | No. It needs a server between the devices. |
| **Assistants that drive a browser** | Out of scope here. They fill through the browser extension and the same relay. A page the assistant controls can read a filled field, so this needs its own design. |
| **The command unlocking the vault itself** | No. See the first decision on the mock page. |

### The prototype

`Packages/cli-agent-prototype` (Node 24, no dependencies, fictional data):

- `src/broker.ts` stands in for the app: it holds the fictional vault, decides what leaves and asks an “approver” function where the app would show a sheet.
- `src/cli.ts` is the `psss` command: `run`, `fetch`, `code`, `save`, `list`, `show`, `status`.
- `src/mask.ts` hides a secret in a stream of output. `src/protocol.ts` is the messages and the `psss://` reference.
- `test/agent.test.ts` runs the real command as a child process and checks everything it printed, which is what an assistant would see.
- `probe/peer.swift` asks macOS who is on the other end of a socket.
- `scripts/test-cli-agent.sh` runs the tests.

To try it by hand, in one terminal start the stand-in, which asks its questions as lines of text:

```sh
cd Packages/cli-agent-prototype && node scripts/app.ts
```

and in a second terminal, after the `export PSSS_SOCKET=…` line the first one prints:

```sh
node src/cli.ts run --env TOKEN=psss://Example API/token -- printenv TOKEN
```

#### What the prototype measured

Three independent runs on 2026-11-23 (separate agents, which changed nothing). The first: the 19 tests of the first version pass, twice, on Node 24.21. It then acted as an assistant trying to get the fictional token into its own output.

**Held:**

- `printenv` and a program that logs its token print the placeholder; `list` never named an item that was not allowed; `show` was refused before the person was asked.
- `fetch` refused `127.0.0.1`, an address with a user name in it, a look-alike host name and plain http, and did not follow a redirect.
- Shells were asked for every time with the whole command shown. As documented, a shell command the person allows can still print the token reversed, encoded or into a file.
- Malformed requests, very long names and odd encodings did not stop the stand-in.

**Did not hold in the first version. The design above and the prototype were corrected the same day, and each point now has a test:**

- **“Until Psss locks” for a program is too wide.** It is keyed by the program alone. After one harmless `git --version` or `find /tmp` was allowed, a second command line (`git -c alias.x=!…`, `find -exec sh -c …`, `vim -c 'w! file'`) ran with no sheet and handed over the token in plain text. A list of shells cannot fix this: many ordinary programs can start another. First correction: an allowance covers the exact command line, arguments included. The second run showed that this is not enough either (below).
- **A program file can be rewritten after it was allowed.** First correction: tie the allowance to a hash of the file. The second run swapped the file between the check and the start.
- **A kept `fetch` covers the host name only,** so any port, path and method on that host. Corrected: it covers the method and the address with its port and path, as the sheet shows them; the query may differ.
- **Whoever starts the `psss` command controls its environment.** With the Node prototype, `NODE_OPTIONS` loaded code into the command and read the token there. The shipping command is Swift with the hardened runtime, which closes this route, but the principle stands: the command holds the secret for `run` and `fetch`, so it is part of what must be protected.
- **Anything that speaks the protocol gets raw values** from the stand-in, as expected without a caller check. The claim “a program never gets a list” rests entirely on the app verifying that the caller is the signed command.

**Bugs in the prototype, fixed:** field names such as `__proto__` reached the object's prototype and crashed the command after the person was asked; a header name was checked only after approval, and `Host` was silently ignored; a newline in a program path confused the list of allowances; a request could name one program and describe another.

**The second run** checked those corrections (the 26 tests of that version passing, twice) and walked around the corrected rule as well. With `run` kept for one exact command line, the identical command line was made to hand over the token seven ways with no new sheet: a Git setting in the folder it ran in, `GIT_CONFIG_*` and `GIT_EXTERNAL_DIFF` in the environment, a look-alike helper earlier on the path, a configuration file named in the arguments and rewritten, `BASH_ENV` and `ZDOTDIR` for a program that starts a shell, a library inserted into an unprotected program, and swapping the program file in the instant between the check and the start. It also found that an odd method (`M-SEARCH`) was sent under an allowance shown as `GET`, that the place a secret is put in a request and the field wanted were not part of what was kept or shown, that hidden and text-reordering characters reached the sheet unchanged, and that the record of activity kept whole command lines.

**What changed after the second run:**

- **Running a program is never kept.** It is asked for every time, whatever was allowed before. A sheet can show a command; it cannot show everything a command depends on. This is the main result of the prototype.
- A kept request covers the field, the method, the address with port and path, where the secret is placed and whether there is a body. A method that cannot be shown as it is sent is refused.
- The sheet names the fields wanted. Names with hidden or text-reordering characters are refused, and such characters in an argument are written out.
- The record keeps the program's path or the address without its query.

Still true and not solved in the prototype: an allowed request may carry any body and any other headers; the sheet does not show the environment a program will run in; and a caller that controls the environment of the Node command can read what it holds. 
**The third run** checked that version: 25 tests pass, twice. It found no way for a stored secret to reach the caller with no sheet, or under a sheet for something else. Running a program asked every time, including the earlier walk-arounds. A kept request asked again for another port, path, method, placement or a body, and not for another query, other body contents or extra headers, as stated. A kept verification code opened nothing else. Malformed and disguised names were refused with no sheet, and hidden characters in arguments were written out. Two small faults remain in the prototype, not fixed: an allowance can be recorded for a field or a code the item does not have (nothing leaks, but the list of allowances would show it), and the record keeps the path of an address, where a caller could have put a secret of its own.

**The probe** (compiled without warnings): macOS gives the caller's process and audit token, and a signature for the caller and every ancestor, so “is this our signed command?” can be checked. Run from this assistant, the chain was the command, `zsh`, the Claude Code helper, a `disclaimer` helper and Claude.app, all signed by one team. Walking outward to the first application names the inner helper (“claude”), not the app the person knows (“Claude”): the sheet should name the outermost application of the same team, and the probe now does. An extra `sh -c` and `env` did not appear in the chain, because each replaced itself with the next.

#### What it does not show

- Who is really asking. The prototype trusts a name the caller gives.
- Touch ID, the sheet itself, and anything about the sandbox.
- The real site-matching rule. It compares host names exactly; the app would use `SiteMatch`.
- A real vault. Items come from a JSON file of fictional logins.

## Proposed order of work

Core first (owner, 2026-11-24). The steps with checklists are in `docs/plans/command-line-and-agents.md`.

1. **Owner decisions** below, a mock of the core terminal output, and the headless key spike (where the device key lives with no Keychain).
2. **Phase 1: one person's vault, direct mode.** `@psss/vault`, `@psss/cli`, the core commands, import and export, docs and tests, and the interop and three-device checks.
3. **Phase 2: sharing and devices,** after the invitation and approval exchanges are specified.
4. **Phase 3: automation.** `.psss.json`, a machine identity, SSH key and certificate kinds, output masking.
5. **Phase 4: agent access.** Spike S5's three signed-build questions, the relay in the app with the approval sheet and Setup section, the brokered client with `fetch`, `run`, `code`, `save`, `list` and `status`, then `psss mcp`, then the Git credential helper.

None of it belongs before the M0 gate or in the path to the first TestFlight. Phases 1 to 3 need no app and no signed build, so they can run beside the format work; phase 4 waits on the same relay and distribution decision as other Mac browsers.

## Decisions for the owner

Part 1 (2026-11-24):

| Decision | Recommendation |
| --- | --- |
| A core command that holds its own key (direct mode), beside the key-less brokered mode | **Decided 2026-11-24: yes, both modes.** Scripts, CI, servers, Linux and Windows have no app to ask. The cost is stated in the docs: direct mode is as strong as `pass` or `sops`, and must not be given to an agent. |
| Language and parser | **Decided 2026-11-24.** Node 24 TypeScript, `node:util` `parseArgs`, one module per command, no dependencies. It matches `@psss/format` and keeps the supply chain of a secrets tool small. The alternative is `commander`, as tug uses, which adds a dependency for no function psss needs. |
| Grammar and names | tug's `psss <subject> <verb>` with the everyday verbs at top level, as in [commands](#commands). |
| Exit codes | `0`, `1`, `2` as wp-release, plus `3` no such item, ambiguous or not allowed, and `4` locked or no key, the same in both modes (changed 2026-11-24 to match the agent frames already drawn). |
| Secrets never as arguments, and no `--value` flag | Yes. |
| `get` prints to a pipe | Yes in direct mode, bare, so it can fill a file or a variable. Brokered mode keeps part 2's rule that `show` is refused outside a terminal. |
| Headless unlock sources | Key file by default, key in the environment for CI that cannot do better, keyring after a spike, vault password and recovery kit as slots. |
| `init` and recovery | **Decided 2026-11-24.** `init` says plainly that the device key is the only way back and offers a recovery kit or a password before it finishes; `--no-recovery` is the opt-out. Recommended: do not refuse without a choice, since a script must be able to create a vault. |
| Naming of items (decided 2026-11-24) | A title matches only exactly, ignoring case, in every command. Two items with one title are listed by id and exit 3; a near miss exits 3 with `Did you mean` hints that are text only. Scripts that must survive a rename use `psss://id:<id>/field`. Prefix matching was rejected: when the item a script meant is deleted, it would quietly return another item's secret. |
| `set` and `rm` (decided 2026-11-24) | `set` on a title that does not exist fails with exit 3 unless `--create` is given, so a typo cannot add a stray item. `rm` moves to Recently Deleted and asks nothing, since `restore` undoes it; only permanent purge asks. |
| Packages | `@psss/format`, `@psss/vault`, `@psss/cli`, each a library and, for the CLI, a binary; compiled `dist/` for publishing and a source condition for development. Names are registered after the brand and domain decision. |
| Release | Changesets, the 1.0 freeze list above, publication by CI with provenance and signed release files. A standalone binary is evaluated later. |
| One `psss` or two | **Decided 2026-11-24: one `psss`, final call in phase 4.** The cross-platform command is on the path and hands brokered verbs to the signed helper in the app. Decide in phase 4 after S5. |

Part 2 (2026-11-23, unchanged except the first row):

| Decision | Recommendation |
| --- | --- |
| Is agent access in scope at all, and when? | Yes, as phase 4, after the core command and after 1.0, beside other Mac browsers. It is what a developer would switch from 1Password for, it costs little once the relay exists, and it does not touch the main path. |
| The app as the only door, with a command that holds no key | Yes. It is the only design where approval cannot be skipped by a script. |
| Lengths of an allowance: once, or until Psss locks; no “Always” | Yes. |
| May `run` be kept until Psss locks at all? | No. Two versions were tried (per program, then per exact command line) and an independent run walked around each. `run` is asked for every time; `fetch` and verification codes are the uses that can be kept. This makes `run` tiring for an assistant that calls it often, which is the honest cost and a reason to grow `fetch`. |
| A program never gets a list of the vault and asks by name | Yes. The cost: the person tells the assistant the item's name. |
| `psss show` exists, loud and never kept | Yes. Without it people paste from the app. |
| Verification codes may be handed over | Yes, with the sheet saying so. An assistant that has both the password (through `run`) and a code can sign in as the person, which is the point of asking, and the risk. |
| MCP server after the command | Yes, without any way to see a value. |
| A machine as a group member, for unattended use | Phase 3 of the core command, since CI needs it too, and only for groups made for machines. Moved up on 2026-11-24 from “later”. |
| Name: `psss` | Yes. It is short and already the product's name. |

## Roadmap

Core command line (part 1):

- [ ] Owner decisions above; core terminal output mocked and approved.
- [x] Headless key custody, v1 (2026-11-24): a key file per vault, a key in the environment, a vault password; the OS keyring is deferred. Result still to be written into [vault format](format.md#keys).
- [x] Milestone 1 (2026-11-24): `@psss/vault` and `@psss/cli` with the ten commands above, `scripts/test-vault.sh` and `scripts/test-cli.sh`, validated twice by an independent agent.
- [ ] The rest of phase 1: `search`, `history`, `code`, `generate`, `item`, `file`, `location`, `vault backup` and `restore`, `doctor`, the lock and `key` commands beyond the first password, docs, the docs test.
- [ ] Interop with the Swift core, and the three-device rounds with the command as a device.
- [ ] Phase 2 (sharing and devices) and phase 3 (automation).
- [ ] Changesets, signed releases, publication by CI.

Agent access (part 2):

- [x] Prototype of the command, the stand-in and the tests (`Packages/cli-agent-prototype`, 2026-11-23).
- [x] Three independent runs recorded (2026-11-23).
- [ ] Signed-build questions answered in S5.
- [ ] Relay in the app, shared with the browser host.
- [ ] Brokered client, Setup section, Help text.
- [ ] `psss mcp`.
