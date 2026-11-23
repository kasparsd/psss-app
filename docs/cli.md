# Command line and AI agents

**Status: proposal, 2026-11-23. Not approved and not built.** A prototype with fictional data is in `Packages/cli`, the screens are drawn in `Design/Mocks/command-line-and-agents.html`, and the decisions waiting for the owner are [at the end](#decisions-for-the-owner). Nothing here changes the app until they are made.

## What was asked

Give Psss a command-line interface so that scripts, developer tools and AI agents can work with what is in the vault, and let the person grant that access without the secrets being exposed.

## The problem

A person working in a terminal, or an AI assistant working for them, needs secrets all day: a token to call an API, a password for a deploy, a verification code to sign in. Today that means copying from the password manager and pasting into a terminal, a `.env` file or a chat. Each paste leaves a copy: in shell history, in a file that gets committed, in a log, or in an AI conversation that is stored on someone else's servers.

What the person wants is narrower than “give the assistant my password”. It is “let this task use that one login”. The design question is therefore in what form a secret leaves the vault, and who decides each time.

## What others do

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

## The idea

**The app is the only thing that opens a vault. The `psss` command holds no key: it carries a question to the running app, and the app asks the person.**

Four things follow.

1. **A program handles names, not values.** It refers to a secret as `psss://item/field`, for example `psss://Example API/token`. A reference is safe to write in a script, a configuration file or a conversation.
2. **The form a secret leaves in is chosen per use,** from “never leaves Psss's own code” to “printed”. The sheet says which, in one sentence.
3. **The person approves in the app, with Touch ID.** The sheet names the app that asked, the item, what will be done with it and for how long. An assistant that can control the screen can click a button; it cannot give a fingerprint.
4. **A program never gets a list of the vault.** It asks for one item by name, and sees only what it was allowed.

This is the same door the browser extension already needs: [browser extension](browser-extension.md#host-and-app) says the native host must hold no key and relay each request over a local socket to the running app, which verifies the caller, unlocks if needed and approves the release. The command line is a second caller of that one relay, not a second system.

## Ways to use a secret

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

## What it protects against, and what it does not

Stated plainly, because “without exposing the secrets” is easy to over-promise. The lines about the software are checked by tests in `Packages/cli/test/agent.test.ts`; the last two are about people and other programs and are not.

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

## Who is asking

The sheet says “Claude wants to…”. That name has to come from the system and not from the caller.

- **The direct caller must be Psss's own signed `psss` command.** The app reads the caller's identity from the socket and checks its code signature. Anything else is dropped without an answer. This is what stops a program from speaking the protocol itself to collect raw values.
- **The app that started it is found by walking up the process chain** to the first one that is an application (Terminal, Claude, an editor). That is a label for the person, not proof: a parent process can exit and its number be reused.
- **When no application is found** (a remote login, a background job), the sheet says so and offers no “until Psss locks”.

The prototype cannot check any of this, because Node cannot read who is on the other end of a socket: it takes the caller's word. A Swift probe (`Packages/cli/probe/peer.swift`) shows what macOS reports; its result is under [measured](#what-the-prototype-measured).

## How it fits

- **One relay in the app** serves the browser host and the command line: a local socket in the app's group container, a check of the caller, a queue of requests, and the approval sheet. The item “Replace the host's vault access with a socket relay to the app” in [browser extension](browser-extension.md#status) is this work.
- **Format-neutral.** The relay reads items through `VaultStore` and never touches a file, so it works on today's KDBX store and on the [record log](format.md) alike.
- **The shipping command is Swift, inside the app bundle,** signed with the app. The Node prototype settles the behaviour and the protocol; its code is the start of the cross-platform [reference tool](format.md#roadmap), which is a different thing (it opens a folder vault directly, with its own key, on Windows and Linux).
- **Mac only.** iPhone and iPad have no command line, so this is a deliberate platform difference: the allowances and the activity list are per Mac and do not sync. Nothing changes in review semantics, copy or safety rules shared across platforms.
- **Off by default,** one switch under Setup. It is a tenth-setting candidate against the [simplicity budget](product.md#simplicity-budget) of fewer than ten, and it is never on the main path.

What only a signed build can settle, to add to spike S5:

- Whether a command-line tool shipped inside a sandboxed Mac App Store app can be run from Terminal and reach the app's socket in the group container.
- How the person gets `psss` onto their path: a sandboxed app cannot write to `/usr/local/bin`. The options are a one-line command the app shows, a Homebrew formula for a notarized copy, or a direct-download build. This is the same question as [Mac distribution](roadmap.md#open-decisions) for the browser host.
- Whether the caller's signature check and Touch ID sheet work when the app is in the background or has no window, and whether the command may start the app when it is not running.

## Ideas considered

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

## The prototype

`Packages/cli` (Node 24, no dependencies, fictional data):

- `src/broker.ts` stands in for the app: it holds the fictional vault, decides what leaves and asks an “approver” function where the app would show a sheet.
- `src/cli.ts` is the `psss` command: `run`, `fetch`, `code`, `save`, `list`, `show`, `status`.
- `src/mask.ts` hides a secret in a stream of output. `src/protocol.ts` is the messages and the `psss://` reference.
- `test/agent.test.ts` runs the real command as a child process and checks everything it printed, which is what an assistant would see.
- `probe/peer.swift` asks macOS who is on the other end of a socket.
- `scripts/test-cli.sh` runs the tests.

To try it by hand, in one terminal start the stand-in, which asks its questions as lines of text:

```sh
cd Packages/cli && node scripts/app.ts
```

and in a second terminal, after the `export PSSS_SOCKET=…` line the first one prints:

```sh
node src/cli.ts run --env TOKEN=psss://Example API/token -- printenv TOKEN
```

### What the prototype measured

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

### What it does not show

- Who is really asking. The prototype trusts a name the caller gives.
- Touch ID, the sheet itself, and anything about the sandbox.
- The real site-matching rule. It compares host names exactly; the app would use `SiteMatch`.
- A real vault. Items come from a JSON file of fictional logins.

## Proposed order of work

1. **Owner decisions** below, and approval of the mock's decision list.
2. **Spike, with S5:** the three signed-build questions above.
3. **The relay in the app,** shared with the browser host, with the approval sheet and the Setup section.
4. **The `psss` command, first version:** `fetch`, `run`, `code`, `save`, `list`, `status` and `show`, with Help text.
5. **`psss mcp`.**
6. **Git credential helper.**
7. **A machine as a group member,** after sharing by group has shipped and been reviewed.

None of it belongs before the M0 gate or in the path to the first TestFlight. The recommended place is the “Later” list, together with other Mac browsers, because both wait on the same relay and the same distribution decision.

## Decisions for the owner

| Decision | Recommendation |
| --- | --- |
| Is this in scope at all, and when? | Yes, after 1.0, in “Later” beside other Mac browsers. It is what a developer would switch from 1Password for, it costs little once the relay exists, and it does not touch the main path. |
| The app as the only door, with a command that holds no key | Yes. It is the only design where approval cannot be skipped by a script. |
| Lengths of an allowance: once, or until Psss locks; no “Always” | Yes. |
| May `run` be kept until Psss locks at all? | No. Two versions were tried (per program, then per exact command line) and an independent run walked around each. `run` is asked for every time; `fetch` and verification codes are the uses that can be kept. This makes `run` tiring for an assistant that calls it often, which is the honest cost and a reason to grow `fetch`. |
| A program never gets a list of the vault and asks by name | Yes. The cost: the person tells the assistant the item's name. |
| `psss show` exists, loud and never kept | Yes. Without it people paste from the app. |
| Verification codes may be handed over | Yes, with the sheet saying so. An assistant that has both the password (through `run`) and a code can sign in as the person, which is the point of asking, and the risk. |
| MCP server after the command | Yes, without any way to see a value. |
| A machine as a group member, for unattended use | Later, and only for groups made for machines. |
| Name: `psss` | Yes. It is short and already the product's name. |

## Roadmap

- [ ] Owner decisions above; mock decisions approved.
- [x] Prototype of the command, the stand-in and the tests (`Packages/cli`, 2026-11-23).
- [x] Three independent runs recorded (2026-11-23).
- [ ] Signed-build questions answered in S5.
- [ ] Relay in the app, shared with the browser host.
- [ ] `psss` first version, Setup section, Help text.
- [ ] `psss mcp`.
