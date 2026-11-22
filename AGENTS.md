# Agent instructions

- Keep documentation and roadmap organized by concern under ./docs update the relevant document in place when a decision changes, rather than creating a parallel review or summary file for the same thing.

- Use docs/plans/{task-name}.md (untracked) to outline the task and a checklist to ensure that all are completed. A plan file is shared working memory across agent sessions; when its work is fully implemented, fold the lasting decisions into README.md or ./docs and delete the plan file.

- After completing tasks, ensure README.md and documentation is up to date and matches the codebase.

- Update AGENTS.md only for agent-specific instructions and use CONTRIBUTING.md for everything else (prefered).

## Native app interface conventions

For macOS/iOS interface changes, consult the relevant current Apple Human Interface Guidelines and prefer standard platform controls and interactions. The user explicitly wants recommendations or pushback when a requested design conflicts with Apple's guidance. Explain the tradeoff and propose a suitable alternative; distinguish a recommendation from an explicit requirement.

Keep passive selection/status information visually separate from actionable controls. In macOS toolbars, place the selection summary in its own ToolbarItem; on macOS 26+, hide its shared background and use native fixed toolbar spacers. 

References:

- https://developer.apple.com/design/human-interface-guidelines/toolbars
- https://developer.apple.com/documentation/swiftui/toolbarcontent/sharedbackgroundvisibility(_:)

Honor the system accent color and default control styling. Do not introduce an app-wide custom tint or branded green UI accent. Use Color.accentColor when a custom selection/drag indicator needs the user's accent; use semantic primary and secondary foreground styles for passive content. Destructive-state red is reserved for deletion feedback and is not the app's accent color.

Keep iPhone, iPad and Mac behavior in sync. Review semantics (what queues, keeps, protects or deletes), copy and safety rules live in shared code (`App/Core`, `App/Features`) and apply to every platform; each platform keeps its own native idiom for presenting them (toolbar vs. menu bar, tap vs. click, sidebar on iPad and Mac). When a change touches one platform's UI, make the matching change on the others in the same task, including Help text and `docs/`. If that isn't possible, record the gap in `docs/roadmap.md` and say so in the final summary. Build both schemes before calling the work done, and check iPad (regular width) when changing iOS layouts.

## Greenfield project

This is a greenfield project. Do not spend effort on data migrations, backward compatibility, or preserving behavior for hypothetical existing users. Earlier implementation choices are not constraints: prefer a clean design and change it when a better approach serves the task.

## Notes

- Product philosophy, pricing and brand are shared with the sibling photo app at `../macos-photo-db`. Read `docs/product.md` before changing commercial, privacy or branding behavior, and keep the two apps consistent.
- Always use soft line breaks (not hard) in documentation.
- Keep important actions visible, labeled and prominent. Do not hide them behind icon-only buttons, menus or gestures. Use progressive disclosure only for rarely needed or risky detail. See `docs/experience.md`, “Cross-cutting rules”.
