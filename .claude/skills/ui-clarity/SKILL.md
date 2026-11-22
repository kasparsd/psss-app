---
name: ui-clarity
description: Use whenever you propose, design, suggest, change or review a user interface, screen, sheet, dialog, form or copy in this app. Checks that a regular person understands what is happening, what is created or changed, where it lives and what happens next, before any visual polish.
---

# UI clarity check

## Step 0: mock from first principles, then ask

Do not start from the existing code or screen. When a screen is new, or the user says it is unclear, cluttered or "not clean", first write down in a few lines what a first-time person must know and do there:

- **Which thing?** The name and location of the object (vault name, file name, folder), never just a generic title.
- **What must they give?** Each input, labeled, with whether it is optional and when it is needed.
- **What can go wrong?** The likely error and the exact words that name the object and the fix.
- **How do they leave?** The way out if this is the wrong object or they are stuck, and what it costs (data left behind, nothing deleted).

Then draw a quick visual mock (the visualize tool, a small HTML card per state: normal and error at least) and show it to the user **before** touching code. Build only after they approve or adjust it. This step gave much clearer results than polishing the running screen.

**Type: two sizes at most.** One title size (the object's name) and the default body size for everything else; separate supporting text by secondary color, not by shrinking it. Never use footnote, caption or callout sizes to fit more in. If it doesn't fit at body size, cut words.

**Help text lives in one place.** One block, directly under the primary action, centered; progress replaces it in the same slot. Never scatter hints inside rows, between sections and at the window edge. Truncated text is a bug: shorten the words.

## Checklist

A regular person has never read this repository. Before you propose, build or approve any interface, answer each question below from the point of view of someone seeing the screen for the first time. If the screen does not answer one, add the missing words or control, or say in your review that it is missing. Do this for every screen you touch, including sheets, alerts, empty states and errors, and on every platform.

1. **What is this?** Name the thing being created, opened, changed or deleted in plain words (not "KDBX", "KDF" or "entry"). One sentence.
2. **Why now, what for?** What the person gets from this step and what happens if they skip or cancel.
3. **Where does it live?** Where the data is stored (this device, iCloud, a file they chose), who can see it, and whether anything leaves the device. Say "nothing is uploaded" when true.
4. **Who holds the key, and what if it is lost?** For passwords, keys and recovery: what the person must remember or keep safe, and whether the app can recover it. Say so before they commit, not after.
5. **Can they get out?** How to back up, copy, export, undo or reverse it. If a promise depends on an unbuilt feature, do not make it.
6. **What happens next?** The result of the primary button, in its label or in a line beside it. Labels name the action ("Create vault"), not the mechanism ("OK").
7. **Is each field explained?** Every input says what it is for and whether it is optional. Placeholders and labels may repeat nothing; use a short caption for anything a newcomer could misread.
8. **Is it true?** Copy must match what the code does today. Mark unbuilt features as unbuilt. Update docs/experience.md when copy changes.
9. **Is the noise gone?** No stray system suggestions, jargon, or controls that distract from the one decision on the screen (for example, autofill popovers on a new vault password field).

In reviews, report each unanswered question as a finding with the exact text or control you recommend. Keep the AGENTS.md rules too: visible, labeled actions; system accent; iPhone, iPad and Mac in sync.
