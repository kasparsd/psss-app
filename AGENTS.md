# Agent instructions

- Keep documentation and roadmap organized by concern under ./docs -- update the relevant document in place when a decision changes, rather than creating a parallel review or summary file for the same thing.

- When starting work use ./docs/plans/{task-name}.md (untracked) to outline the task and a keep a checklist to ensure that all are completed. A plan file is shared working memory across agent sessions; when its work is fully implemented, fold the lasting decisions into README.md or ./docs and delete the plan file.

- When starting a new task, identify what a successfull outcome means and how it can be measured and evaluated. Then use that as guidance but keep agency and evaluate from first principles at all times. 

- After completing tasks, ensure README.md and documentation is up to date and matches the codebase.

- Update AGENTS.md only for agent-specific instructions and use CONTRIBUTING.md for everything else (prefered).

## Builds and tests on this Mac

Unlimited Swift compiles and `xcodebuild` runs at once have exhausted memory and crashed the machine (10 cores, 16 GB). At most two heavy jobs run at a time:

- Build only with `scripts/xcb.sh …` (it takes `xcodebuild` arguments), never `xcodebuild` directly. Run tests only through `scripts/test-*.sh`. Compile anything else, such as a probe, with `scripts/heavy.sh swiftc …`. All of these share two slots (`PSSS_HEAVY_SLOTS`, default 2), wait when both are taken and run at low priority.
- Within one agent, run builds and test runs one after another in the foreground, not in the background, and do not run several copies of a test binary at once.
- When delegating, give at most two agents at a time work that builds or runs tests, and only when they own different files. Agents that only read or write documents can run alongside.
- If the machine becomes sluggish again, go back to one: `PSSS_HEAVY_SLOTS=1`.

## Native app interface conventions

For macOS/iOS interface changes, consult the relevant current Apple Human Interface Guidelines and prefer standard platform controls and interactions. The user explicitly wants recommendations or pushback when a requested design conflicts with Apple's guidance. Explain the tradeoff and propose a suitable alternative; distinguish a recommendation from an explicit requirement.

Keep passive selection/status information visually separate from actionable controls. In macOS toolbars, place the selection summary in its own ToolbarItem; on macOS 26+, hide its shared background and use native fixed toolbar spacers. 

References:

- https://developer.apple.com/design/human-interface-guidelines/toolbars
- https://developer.apple.com/documentation/swiftui/toolbarcontent/sharedbackgroundvisibility(_:)

Honor the system accent color and default control styling. Do not introduce an app-wide custom tint or branded green UI accent. Use Color.accentColor when a custom selection/drag indicator needs the user's accent; use semantic primary and secondary foreground styles for passive content. Destructive-state red is reserved for deletion feedback and is not the app's accent color.

Keep iPhone, iPad and Mac behavior in sync. Review semantics (what queues, keeps, protects or deletes), copy and safety rules live in shared code (`App/Core`, `App/Features`) and apply to every platform; each platform keeps its own native idiom for presenting them (toolbar vs. menu bar, tap vs. click, sidebar on iPad and Mac). When a change touches one platform's UI, make the matching change on the others in the same task, including Help text and `docs/`. If that isn't possible, record the gap in `docs/roadmap.md` and say so in the final summary. Build both schemes before calling the work done, and check iPad (regular width) when changing iOS layouts.

## Interface clarity

Whenever you propose, build, suggest or review an interface or its copy, apply the `ui-clarity` skill (`.claude/skills/ui-clarity/SKILL.md`): say what is being created, where it is stored, who holds the key, how to get out and what happens next, in plain words, before polishing visuals. For a new or unclear screen, show a quick visual mock of the normal and error states and get approval before building (step 0 of the skill). Use at most two type sizes on a screen (title and body); never shrink text to footnote or caption to fit more.

## Greenfield project

This is a greenfield project. Do not spend effort on data migrations, backward compatibility, or preserving behavior for hypothetical existing users. Earlier implementation choices are not constraints: prefer a clean design and change it when a better approach serves the task.

## Notes

- Product philosophy, pricing and brand are shared with the sibling photo app at `../macos-photo-db`. Read `docs/product.md` before changing commercial, privacy or branding behavior, and keep the two apps consistent.
- Write custom tooling, build scripts, generators and reference implementations for Node 24, not Python. See `docs/development.md`, “Tooling outside Xcode”.
- Always use soft line breaks (not hard) in documentation.
- Keep important actions visible, labeled and prominent. Do not hide them behind icon-only buttons, menus or gestures. Use progressive disclosure only for rarely needed or risky detail. See `docs/experience.md`, “Cross-cutting rules”.
  Icon-only controls are allowed only where Apple's Human Interface Guidelines permit or require them (for example a standard toolbar symbol, a search field's clear button, or a system biometric glyph) and always carry an accessibility label and a help tooltip. When the guidelines leave the choice open, add the label.
