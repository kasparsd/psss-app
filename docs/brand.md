# Brand

Visual identity decided 2026-11-22; the logo became one field in two states on 2026-11-24. The product name, positioning and tone live in [product](product.md). This page holds the mark, colour, type and reuse rules. Assets are in `Design/`.

## Idea

A password field with the name typed into it. Hidden, it shows a lowercase p and three dots that stand for “sss”. Shown, each dot is the s it stands for and the field reads “psss”. It is the one thing every password manager asks of you, a box to type in, and it is the same box in both states, so the name is spelled and the dots stay the symbol. The feeling is quiet, precise and generous: secure passwords for the rest of us.

Three dots without the field are a “more” button or a sentence trailing off, so the field is never dropped.

## Mark

### Logo: one field, shown and hidden

Approved by the owner on 2026-11-24. An outline pill (the field) with the word inside it, on one centre line (y 60). The field is 118 units wide and 56 high with a 5 unit outline. The letters are Varela Round with an x-height of 21 units, thickened to a 6 unit line so they are a little heavier than the outline, and spaced 5 typeface units wider than the font sets them. The p's stem runs down into the field's bottom line and is cut flush with the field's outer edge, so nothing leaves the field. The word is centred, with the same space on its left and right. In the hidden state each s is a dot of radius 7 in the letter's place, so nothing moves when the state changes.

- Files, built by `node scripts/build-logo.mjs` from the numbers at the top of that script and the glyphs in `Design/Logo/psss-glyphs.json`: `Design/Logo/Psss-field-hidden.svg` and `Psss-field-shown.svg` (charcoal), each with a `-butter` version. Change the script, not the files.
- For a web page: `Design/Logo/psss-logo.svg` holds both states in one drawing and takes the text colour, and `psss-logo.css` switches it on hover or tap with no script. By default it rests hidden and shows the name on hover. With the class `rest-shown` it rests on “psss” and hides the name on hover; both are kept (owner, 2026-11-24).
- In the logo files the letters are thickened with a stroke around the typeface's outlines. That renders the same in browsers, but a tool that wants plain filled shapes (some printers) needs the stroke turned into outlines first. The app icon's layers already have no strokes; see App icon.
- No gradient, shadow or extra accent. Never add a caret, and never let any part leave the field.
- In the app the switch belongs to the lock screen: hidden while locked, shown while the vault opens (built; see [experience](experience.md)). The script writes the icon cut as SwiftUI paths to `App/Features/LogoFieldGeometry.swift` for it. Not at the top left of the main screen and not as a launch animation. The lock screen runs it slower than the web logo (0.28 s per place, 120 ms apart, about 0.5 s in all, against 0.16 s and 70 ms), because it is a single moment that Face ID can cut short (owner, 2026-11-24).

### Cuts

The same drawing in three weights, all from the script. The letters are always a little heavier than the outline.

| Cut | Outline | Letters | Dots (radius) | Use |
| --- | --- | --- | --- | --- |
| Master | 5 | 6 | 7 | The logo: page headers, print, about 48 px high and above. |
| Icon | 6.5 | 7.4 | 7.2 | The app icon. Glass bevels eat into a thin line. Its field is 124 units wide, 6 more than the logo's. |

## Small mark

For places the field is too wide for: the browser toolbar button and the landing page's favicon (owner, 2026-11-25; the mock is `#/small-mark`). A ring with one dot in the middle, drawn in a 56 unit box by `scripts/small-mark.mjs`.

- **A2, the default everywhere:** butter inside the ring, charcoal ring and dot, one file for light and dark. Small cut (24 px and below): stroke 7, ring radius 24.5, dot radius 10, because a 5 unit line is under a pixel at 16 px. Large cut (above 24 px): stroke 5 (the logo's line), radius 25.5, dot radius 8. Files: `Site/src/assets/Psss-mark-small.svg` (small cut) and the PNGs from `scripts/build-extension-icons.mjs`.
- **A, the monochrome fallback:** the same geometry with no fill and one colour, for template images and one-colour use: `Site/src/assets/Psss-mark-small-mono.svg` (black, small cut; the component draws it in `currentColor`).
- **Exception, Mac menu bar (owner, 2026-11-26):** the logo in its hidden state (field, p and three dots) in the app icon’s cut, 13 pt high (owner, 2026-11-26; a wide shape at the 16 pt of a square icon looked heavy), as a one-colour template image (`MenuBarController.mark()`). A ring with a dot reads there as the system’s recording symbol.
- The extension's store tile (48 and 128 px) stays the app icon.

## App icon

Redrawn from the logo on 2026-11-24: the hidden field in the icon cut. Full-bleed 1024 square with no baked-in rounding, so the system applies its own mask. The field is centred and takes 77.8 percent of the icon width. It is 6 units wider than the logo's field (3 more on each side of the p and the dots), because with the glass applied the sides looked tighter than the top (owner, 2026-11-24); 77.8 percent keeps it as tall as it was at 74 percent before the widening. `Design/AppIcon/AppIcon-light.svg` is charcoal on butter and `AppIcon-dark.svg` is butter on charcoal, drawn flat, each with a 1024 px PNG export (`rsvg-convert -w 1024 -h 1024`).

The shipped icon is the Icon Composer bundle `App/AppIcon.icon`. The artwork is two SVG objects per appearance, each on its own glass layer: `Frame.svg` (the outline with the p merged into it) and `Dots.svg` (the three dots), written by `scripts/build-logo.mjs` in one colour with no background and no transforms. The frame layer holds filled shapes only, with no strokes: Xcode also writes a fallback `AppIcon.icns` for older systems, and that renderer fills a stroked shape solid, which turned the field into a dark slab with no p (found 2026-11-24; the earlier drawing had the same fault). So the outline is a ring, and the p is the typeface's outline plus a small filled capsule along each of its edges, which together cover exactly what a round stroke would. They are separate because the glass only rounds a shape's outer edge, and a dot inside the same layer as the frame gets no bevel. The backgrounds live in `icon.json` alone: a butter gradient, a charcoal gradient for dark and a near-black solid for tinted, with a butter mark in dark and tinted. To see the icon as the system draws it without a device, use Icon Composer's command-line tool: `"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" App/AppIcon.icon --export-image --output-file out.png --platform iOS --rendition Default --width 1024 --height 1024 --scale 1` (renditions include `Dark`; platforms `iOS` and `macOS`). Clear modes cannot be specialised in the file; the system derives them from the Default and Dark layers. Flat, split-layer, punched and under-glass versions of the earlier drawing were tried and set aside, see `Design/AppIcon/variants/`; those bundles still hold the earlier drawing. The old PNG asset catalog set is gone, so Xcode finds `AppIcon` as the `.icon`.

The Home Screen icon does not change with the lock state (owner, 2026-11-24): on iPhone and iPad the system shows an alert on every icon change and it cannot be done from the background.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Butter | `#FFD84D` | Icon and page ground. |
| Charcoal | `#1F1F23` | Mark, text, dark icon. |
| Cream | `#FFF9E5` | Calm page ground and surfaces. |
| Stone | `#8A8578` | Rules and fills only, never small text. |

Tokens are in `Design/Brand/tokens.css`. Butter belongs to the icon, website and marketing. In the app itself the system accent colour and standard controls stay in charge. Alternatives explored and set aside: plum and lilac, harbor blue, terracotta, linen and moss, tangerine, bubblegum, cornflower. Cream with a butter icon is the quieter page option and a dark page in charcoal with butter works for dark mode.

## Type

- Inside the logo's field: lowercase “psss”, Regular (400) thickened to the 6 unit line, as described under Mark.
- Plain wordmark, for a place that needs a bigger name than the field gives: lowercase “psss”, Regular (400). Whether it stays is an open point.
- Native: SF Pro Rounded (`.font(.system(size:weight:design: .rounded))`). Apple's licence limits SF to Apple-platform interfaces, so do not use it for a logo file, the website or press material.
- Web headings: Nunito at 700, with tight line heights (owner, 2026-11-27; it replaces Varela Round, whose single weight looked too light), self-hosted from `Design/Fonts/Nunito/` with its `OFL.txt` (SIL Open Font License 1.1). Body text on the web uses the system’s text face (owner, 2026-11-27; before that the system rounded face), so no second font is shipped.
- Logo files: Varela Round (single weight 400, same licence), outlined, from `Design/Fonts/VarelaRound/`.
- Prose, titles and the App Store name stay “Psss” with a capital, because the name is hard enough to search for. The dots are a graphic, never a spelling.

## Lockup and clear space

The logo is the field alone. The earlier lockup, the mark followed by the wordmark, said the name twice and is gone, with its files. The plain wordmark is still in `Design/Logo/Psss-wordmark.svg` and `Psss-wordmark-butter.svg` (Varela Round, outlined).

Clear space on every side of the field is the height of the p's bowl. On butter or cream use charcoal, on charcoal use butter.

## Landing page

The website is `Site/`, an Astro project that renders the page to one static HTML file with its stylesheet inside and no JavaScript (owner, 2026-11-27; it replaces the hand-written `Design/Landing` page of 2026-11-23). Build and deployment are in [development](development.md#website). The page is made of the mock library’s own components (`Design/Mocks/app/src/landing`, with `pages/LandingPage.tsx` as the whole page), so a screen’s mock and its picture on the website are the same drawing; the mock pages `#/landing`, `#/landing-components` and the three `#/landing-galleries-…` pages hold the states, the decisions and their history.

What the page is, all decided by the owner on 2026-11-27:

- **It informs and shows the value; it asks for nothing.** No call to action, no waitlist, no contact form, and no cookies, analytics, outside fonts or scripts. A Content-Security-Policy header (`Site/public/_headers`) allows no script at all.
- **The header is the app icon**, centred: the butter tile with the logo’s field inside at the icon’s 77.8 percent, so it is plain that this is an app. On load the field reads “psss” and then hides it place by place with the lock screen’s timing (0.28 s a place, 120 ms apart); it rests on the dots, and hover or a tap shows the name again. The drawing is `Design/Logo/psss-logo.svg` itself, never a redrawing.
- **The lead** is the welcome screen’s own heading, “Psss for your secrets”, and its line “The quickest storage and autofill for your logins and passwords” (owner, 2026-11-27: the page and the app say the same thing; before that the headline was “Secure passwords for the rest of us.”), then one picture of the Mac app under the menu bar, the iPhone and the browser extension’s popup together.
- **“Sound familiar?” is a calm list.** Groups of rows by where the moment happens (Signing in, In the app, In the browser, From the Mac menu bar), every row closed, each row the moment in the visitor’s own words. A row is the browser’s own disclosure and opens to one or two sentences and a swipe gallery. To add a moment, add a topic to a group in `landing/topicGroups.tsx` or the group’s file under `landing/pictures/`.
- **A swipe gallery** is a row of pictures, the app’s screens in their device frames, each with one short line under it. It scrolls sideways and snaps. A switch at the top right of the opened row chooses iPhone, iPad or Mac where the story is drawn for more than one; on a phone only the iPhone pictures are offered where they exist, because a whole Mac window would be too small to read. Earlier the same stories were interactive demos that played by themselves; the owner found they did not look good and that pictures work better on a phone.
- **Calm, and taken from the app.** One column; each section opens with a prominent centred heading and one line, then its panels. Lists are the app’s grouped lists: a heading and one line above a card of rows with hairlines. “What you get” and “Questions” are the same card. No buttons, badges, bordered boxes or left-bordered notices.
- **Colour and type.** Cream page, butter only in the app icon, charcoal text; in the dark, charcoal with cream text. Light or dark follows the system setting, with no switch. Nunito 700 is for headings only; body text is the system’s text face, which reads better in paragraphs (this replaces the system rounded face named under Type for the website’s body).
- **No status flags.** The page carries no “in development”, “coming” or “works in test builds” labels and no “Where it stands” section (owner: “stop adding the in development, not ready tips and flags”). This is a departure from the truthful-language rule in [product](product.md#shared-philosophy): some rows show things that are approved but not built, such as the menu bar panel and the search pills. Each topic keeps a `status` and `statusNote` in code, shown on the mock pages, and two answers under “Questions” say that there is no release date and that no outside security audit has been done. Before the page is published while the app is unreleased, check each row against the roadmap and decide again; the check of 2026-11-27 is in the [roadmap](roadmap.md#website).
- **The story** is signed and says only what the owner said: built for his wife and kids to move off 1Password 7, because filling in was the pain in other apps. Nothing about a competitor is stated without a link to a public report; the two linked reports must be re-checked before publishing (both still said what the page says on 2026-11-27).
- **Found and shared.** The headline carries no search words, so the title and description do: “Psss Passwords”, password manager, iPhone, iPad and Mac, KeePass. The share image is the landing page’s dark look (owner, 2026-11-27): a charcoal ground, the butter app icon with the cream headline under it, both centred in the left pane, the dark lead picture on the right with thin edges, and no shadows (“we don’t use dropshadows”). It is drawn by the page’s own components. There is no structured data until the app is in the App Store, because there is no price, rating or download address to state.
- No price or paid tier is mentioned anywhere, following [product](product.md#business-model); the only line about money is “Nothing is decided about pricing yet. Sync through iCloud will be free.”

## Explorations

`Design/Explorations/` holds the final design canvas boards (type, wordmark, landing mock and palettes) as `.dc.html` files with a `canvas.json` index. Earlier logo rounds were dropped. The final marks are in `Design/AppIcon/` and `Design/Logo/`.

## Open points

- Look at the redrawn app icon on a device in every appearance (default, dark, tinted, clear) and at the small sizes; adjust the icon cut in `scripts/build-logo.mjs` if the glass makes the p's bowl close up.
- Decide whether the plain wordmark stays.
- Capture real screenshots for iPhone, iPad and Mac. This needs an iOS 27 simulator runtime, since the iOS app does not build for the installed 26.5 runtime.
- Check “Psss” for trademark and App Store availability (see [product](product.md)).
