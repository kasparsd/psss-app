# Psss landing page

One static page: `index.html` and `style.css`, with the logo's stylesheet and the favicon files in `assets/`.
No JavaScript, no cookies, no analytics, no outside fonts or scripts.
The logo is drawn inline in `index.html`, between the `psss-logo` markers, so that it can switch on hover with CSS alone. It rests on the p and three dots and shows “psss” on hover; add the class `rest-shown` to the `svg` for the other way round.
Do not edit the drawing or `assets/psss-logo.css` by hand: run `node scripts/build-logo.mjs`, which rewrites both from `Design/Logo/`.
The favicon is the small mark (a ring with one dot, butter inside, one file for light and dark): `assets/Psss-mark-small.svg`, with `assets/favicon-32.png` as the fallback. `Psss-mark-small-mono.svg` is the one-colour version. `node scripts/build-logo.mjs` writes the SVGs and `node scripts/build-extension-icons.mjs` the PNG; do not edit them by hand.

## Preview

```
cd Design/Landing
python3 -m http.server 8000
```

Open http://localhost:8000. Check light and dark by switching the system appearance.

## Placeholders to fill in

Search for `{{` in `index.html`.

| Placeholder | What it is |
| --- | --- |
| `{{WAITLIST_ENDPOINT}}` | Where the form posts. Decide with the options below. |
| `{{CONTACT_EMAIL}}` | The address for the `mailto:` link and the footer. |
| `{{PAGE_URL}}` | The final address of the page, for the canonical link and Open Graph. |
| `{{OG_IMAGE_URL}}` | A 1200 by 630 image for link previews. None exists yet. |

Also confirm the sentence under the form ("We will use your address once, to tell you Psss is ready, and then delete it.").
It must be true for the option you choose, or be changed to match.
If the endpoint answers with a page on another site, or the service adds tracking, the footer line "no cookies, no analytics, no outside scripts" is no longer accurate for the visitor's journey.
Check that before publishing.

## Running the waitlist without breaking the privacy promise

The product collects no data, so an address list is the one place the promise is tested.
Pick one.

1. **Self-hosted endpoint that appends to a file.**
   A few lines on a server you control receive the post and append the address to a file.
   You hold the only copy and can honour the delete sentence exactly, but you run and secure a server, and need a thank-you page to redirect to.
2. **A privacy-respecting form or newsletter service.**
   A hosted form or email-list service that does not add trackers or tracking pixels and lets you export and delete addresses.
   Least work, and later sending is easy, but a third party holds the list.
   In its terms, check where data is stored, that it does not reuse addresses for its own purposes, that it adds no tracking to the form or confirmation page, whether it can send a plain-text mail without open tracking, and how deletion works.
3. **`mailto:` only, with no stored list.**
   Remove the form and keep the "email us" link.
   Nothing is collected by the page, and the only copy is in your own inbox.
   Fewer people will send an email than fill in a form, and the list is built by hand.
