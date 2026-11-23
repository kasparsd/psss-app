# Brand

Visual identity decided 2026-11-22. The product name, positioning and tone live in [product](product.md). This page holds the mark, colour, type and reuse rules. Assets are in `Design/`.

## Idea

A password field with a lowercase p typed into it, followed by three dots that stand for “sss”. It reads as the one thing every password manager asks of you, a box to type in, with the name already half typed and the rest hidden. The feeling is quiet, precise and generous: secure passwords for the rest of us.

## Mark

An outline pill (the field), a monoline p whose tail meets the bottom line, and three equal dots. Everything sits on one centre line in a 120 unit square, the pill spans x 4 to 116 and y 32 to 88, and the group is nudged 1.5 units right because the p is the heaviest part. Lines are 5 units with round ends.

- Master mark for 48 px and above: `Design/AppIcon/Psss-mark.svg` (charcoal) and `Psss-mark-butter.svg`.
- Small-size cut below 48 px: same outer bounds, 7 unit line, bowl r 8.5, dots r 6.8. `Psss-mark-small.svg` and `Psss-mark-small-butter.svg`.
- No gradient, shadow or extra accent. Never add a caret, and never let any part leave the pill.

## App icon

Full-bleed 1024 square with no baked-in rounding, so the system applies its own mask. The mark is 74 percent of the icon width. `AppIcon-light.svg` is charcoal on butter and `AppIcon-dark.svg` is butter on charcoal, each with a 1024 px PNG export. The shipped icon is the Icon Composer bundle `App/AppIcon.icon`. It is flat on purpose: two layers (the frame with the p merged into it, and the dots), glass off, no shadow and no translucency, so there are no bevels or highlights inside the mark. The geometry is the master mark exactly, a 5 unit line throughout, with the p's stem running into the bottom line. The ground is a butter gradient. The dark appearance swaps to a charcoal ground with a butter mark (`*-Dark.svg`), and the tinted appearance has a near-black ground with a butter mark (`*-Tint.svg`) so the system tint stays legible. Clear modes cannot be specialised in the file; the system derives them from the Default and Dark layers. Bevelled and glass versions were tried and set aside, see `Design/AppIcon/variants/`. The old PNG asset catalog set is gone, so Xcode finds `AppIcon` as the `.icon`.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Butter | `#FFD84D` | Icon and page ground. |
| Charcoal | `#1F1F23` | Mark, text, dark icon. |
| Cream | `#FFF9E5` | Calm page ground and surfaces. |
| Stone | `#8A8578` | Rules and fills only, never small text. |

Tokens are in `Design/Brand/tokens.css`. Butter belongs to the icon, website and marketing. In the app itself the system accent colour and standard controls stay in charge. Alternatives explored and set aside: plum and lilac, harbor blue, terracotta, linen and moss, tangerine, bubblegum, cornflower. Cream with a butter icon is the quieter page option and a dark page in charcoal with butter works for dark mode.

## Type

- Wordmark: lowercase “psss”, Regular (400), with a font size of 0.64 of the mark's height. Light matches the master mark's line weight more exactly, but Regular reads best beside it and suits the small cut.
- Native: SF Pro Rounded (`.font(.system(size:weight:design: .rounded))`). Apple's licence limits SF to Apple-platform interfaces, so do not use it for a logo file, the website or press material.
- Web and logo files: Varela Round (single weight 400, SIL Open Font License 1.1), self-hosted from `Design/Fonts/VarelaRound/` with its `OFL.txt`. Body text on the web uses the system rounded font, so no second font is shipped.
- Prose, titles and the App Store name stay “Psss” with a capital, because the name is hard enough to search for. The dots are a graphic, never a spelling.

## Lockup and clear space

Outlined files, no font needed: `Design/Logo/Psss-lockup.svg` and `Psss-lockup-butter.svg` (mark plus wordmark), `Psss-wordmark.svg` and `Psss-wordmark-butter.svg` (wordmark only). The wordmark is Varela Round outlined at 0.64 of the mark's height, with its x-height centred on the pill's centre line.

Mark on the left, wordmark on the right, centred on the pill's centre line with a small gap. Clear space on every side is the height of the p's bowl. On butter use charcoal, on charcoal use butter.

## Landing page

`Design/Landing/index.html` is the pre-release page (drafted 2026-11-23): the lockup, the slogan “Secure passwords for the rest of us.” as the headline, what you get, an honest “Where it stands”, a waitlist and a few questions. It has no scripts, cookies, analytics or outside fonts, and its `README.md` lists the placeholders to fill in and the ways to run the waitlist. The App Store badge and device screenshots join it when the app is released. No price or paid tier is mentioned anywhere, following [product](product.md#business-model); the only line about money is “Nothing is decided about pricing yet. Sync through iCloud will be free.”

## Explorations

`Design/Explorations/` holds the final design canvas boards (type, wordmark, landing mock and palettes) as `.dc.html` files with a `canvas.json` index. Earlier logo rounds were dropped. The final marks are in `Design/AppIcon/` and `Design/Logo/`.

## Open points

- Variants of the icon are in `Design/AppIcon/variants/` (merged, punched, under glass, heavy small cut, inverted, cream, dark-always). Pick one if the base is not final.
- Check the app icon in clear mode and the small cut at 16 and 32 px on a device. Icon Composer has no per-size cut, so `Psss-mark-small.svg` is not used in the icon.
- Capture real screenshots for iPhone, iPad and Mac. This needs an iOS 27 simulator runtime, since the iOS app does not build for the installed 26.5 runtime.
- Check “Psss” for trademark and App Store availability (see [product](product.md)).
