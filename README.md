# highlights → Legium

Saves every highlight and note in your library as one file that Legium
imports. It reads Amazon's notebook page, <https://read.amazon.com/notebook>,
in your own browser, while you are signed in. Nothing is sent anywhere else.

---

## Install

Two ways, which do the same thing. On a computer, use Firefox for the first,
or any of Firefox, Chrome, Edge or Safari for the second.

### Firefox extension

Called **Legium**. *Not yet published.* Until it is, see
[Trying the extension before it is published](#trying-the-extension-before-it-is-published).

Once installed, it adds a toolbar button. On the notebook page the
button brings back the export panel if you closed it; anywhere else it opens
the notebook page.

### Userscript

A userscript is a small script that another extension, such as Tampermonkey,
runs on one web page.

1. Install **Tampermonkey**:
   [for Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/),
   [for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo),
   [for Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd).
2. **Chrome and Edge only:** open `chrome://extensions` (`edge://extensions`),
   press **Details** under Tampermonkey, and turn on **Allow User Scripts**.
   Without it the script installs but never runs.
3. Open [legium.user.js](legium.user.js?raw=true).
   Tampermonkey shows the script's install page; press **Install**. (If you see
   the code instead, press **Raw**.)

Tampermonkey checks the same address for new versions and updates the script
itself. On Safari, the free **Userscripts** app from the App Store runs it too.

## Export

1. Open <https://read.amazon.com/notebook> and sign in. Your books are listed on
   the left.
2. A panel, **Export highlights for Legium**, is in the top right corner. Leave
   **One file for Legium (.json)** chosen and press **Export all books**. For
   the other choices, see [The ways to save](#the-ways-to-save).
3. Wait. It reads one book at a time; a few hundred books take several
   minutes. Keep the tab open.
4. Your browser saves `highlights-legium-<date>.json`.

## Import into Legium

1. Put the file where your iPhone or iPad can reach it: iCloud Drive, AirDrop,
   or email it to yourself and save the attachment to Files.
2. In Legium, open **Settings → Archive → Import archive…** and choose the file.

Each book comes in with its title, author, and each highlight with its page or
location. A note you wrote on a highlight is attached to that passage.

### Exporting again later

Do the same again after you have read more. Importing the newer file adds the
passages Legium doesn't have, and leaves the ones it has as they are, including
any you have edited, tagged or starred. Two cases bring in a second copy:

- a note added later to a highlight you had already imported (the passage
  arrives again, with the note), and
- a passage you deleted in Legium, once it has gone from the Trash.

### If Legium already has some of these books

The `.json` file matches books by an id made from the book, not by
title, so a book you imported earlier from the reading app's own **Export
notebook** would arrive a second time. For those books, choose **notebook
files (.zip)** instead, unzip it, and import each book's `.html`
with **Settings → Import → Import highlights…**. That import merges into the
book you have and skips passages already there. See
[Merging with what you already have](#merging-with-what-you-already-have).

## What it can't get

Amazon's notebook page has no chapter names, no bookmarks, no publisher or year,
and nothing from books you put on a device over USB. See
[What it does not give you](#what-it-does-not-give-you).

## The ways to save

Every option comes from the same read of the notebook page, so each holds the
same books, highlights and notes. They differ in shape and in how much is
decided for you.

| choice in the panel | file | for |
|---|---|---|
| One file for Legium (.json) | `highlights-legium-<date>.json` | Legium's **Import archive…** |
| Plain JSON (.json) | `highlights-<date>.json` | Other apps, your own scripts, and `tools/` |
| Spreadsheet (.csv) | `highlights-<date>.csv` | Excel, Numbers, Google Sheets |
| Document to read (.md) | `highlights-<date>.md` | Reading; any notes app that takes Markdown |
| notebook files (.zip) | `notebooks-<date>.zip` | Legium's **Import highlights…**, a book at a time |

### One file for Legium

Use this unless you have a reason not to. Every book in one file, already in
Legium's own terms — the four tidy-up steps below, always — and safe to import
again later ([Exporting again later](#exporting-again-later)). Amazon doesn't
say which of a book's people translated or edited it, so all are credited as
authors; change the role in Legium where it matters. It is laid out as
Legium's database is, books, people and passages in separate lists joined by
ids, so it is awkward to read without Legium.

### Plain JSON, Spreadsheet and Document to read

For using your highlights without Legium. These three share the **Tidy up**
switches, which appear under the choices when one of them is picked. Each does
one thing the Legium file always does; all are on to start with, and with all
of them off you get the notebook page exactly as read.

| switch | what it does |
|---|---|
| List each author separately | Amazon gives a book's people as one line. This adds them as a list: "Ada Marsh, Ben Ellery, and Cy Dunn" becomes three names, and "Marsh, Ada" becomes "Ada Marsh". |
| Attach notes to their highlights | A note goes on the highlight it was written on, instead of being a record of its own beside it. A note with no highlight stays on its own. |
| Drop repeated passages | A passage highlighted twice in one book is kept once. |
| Write places as Legium does | Adds `p. 49`, or `loc. 1114` for a book without page numbers, beside the page and location as Amazon gives them. |

Every book also carries its ASIN, Amazon's id for the ebook edition, and a
link to its page in the Amazon store the notebook came from, for finding it
again. The notebook page has no ISBN.

**Plain JSON.** Every book in one file, highlights nested under their book:

```json
{
  "format": "notebook-highlights", "version": 1,
  "scrapedAt": "2026-10-25T19:02:11.481Z",
  "shelf": 263,
  "options": {"splitAuthors": true, "attachNotes": true, "dropRepeats": true, "places": true},
  "books": [{
    "asin": "B00ABC1234", "link": "https://www.amazon.com/dp/B00ABC1234",
    "title": "…", "author": "Ada Marsh and Ben Ellery", "authors": ["Ada Marsh", "Ben Ellery"], "pages": 1,
    "records": [
      {"kind": "Highlight", "text": "…", "note": "…", "colour": "yellow", "page": "49", "location": "1114", "place": "p. 49"},
      {"kind": "Note", "text": "A note on no highlight.", "colour": "", "page": "", "location": "1200", "place": "loc. 1200"}
    ]
  }]
}
```

`options` says which switches were on. `shelf` counts every book in the
library, `books` only those with highlights. `author` is always the line as
Amazon wrote it; `authors`, a record's `note` and its `place` are there only
when their switch is on. With notes not attached, a note is a `Note` record
straight after its highlight, at the same location. `page` is empty for a book
without page numbers; `location` is digits only.

**Spreadsheet.** One row per highlight, and per note standing on its own:
`title`, `authors` (separated by `; ` when listed), `asin`, `link`, `kind`,
`text`, `note`, `colour`, `page`, `location`, `place`. The `note` and `place`
columns appear only when their switch is on.

**Document to read.** A contents list linking to each book, then a section per
book: its people, its counts and its Amazon link, then **Highlights**, each a
quotation with its place, and **Notes**, each with its place and, when notes
are attached, the start of the passage it was written on.

### notebook files

One `.zip` holding one `.html` file per book, in the format the reading app's
own **Export notebook** writes. Unzip it and import a book at a time with
**Settings → Import → Import highlights…**. That is slow for a whole shelf, so
use it for the books Legium already has: this import adds to the book that is
there and skips passages already in it, where the `.json` would create a second
copy of the book. One limit: the format has a single author line, and Legium
credits it as one person, so "Ada Marsh and Ben Ellery" arrives as one name.
Fix those by hand, or import the book from the `.json` instead if it is new to
Legium.

### Where the file goes

To your downloads folder, unless you tick **Ask where to save**, which opens
the Save dialog so you can choose the name and the folder. In the extension the
dialog opens when the file is ready; cancel it and **Save again** brings it
back, without exporting again. In the userscript on Chrome and Edge it opens
when you press **Export all books**, since browsers only allow it straight after
a click. Firefox and Safari don't let a web page open a Save dialog, so the
userscript there has no such box: set Firefox to **Always ask you where to save
files** (Settings → General → Downloads) if you want to choose.

---

# How it works

The rest is for whoever maintains this. The findings come from a real shelf;
the book titles, authors and quoted passages used to illustrate them are
invented.

Legium imports the per-book HTML that the reading app's own **Export notebook**
produces, and the single-file `legium.archive` JSON its own export used to
write. The script can emit both. The notebook HTML reproduces the app's format
exactly — the preamble is copied verbatim from a real export, and every block
reproduces a shape `NotebookExportParser` has a fixture for. The archive is
built the way `tools/build_archive.py` builds one, with two differences
described under [The browser's archive](#the-browsers-archive).

Two things matter before relying on either: the web page is **thinner** than
the app's export, and the two sources **disagree slightly on wording**, which
matters if you ever import the same book twice.

---

## The pipeline

For a shelf that overlaps what Legium already holds, the export is only the
first step. The full path:

```sh
# 1. Scrape. Choose "Plain JSON" in the panel, untick every Tidy up
#    switch, and click "Export all books".
#    -> out/web-export.json

# 2. Compare against what Legium already has, and list what is genuinely new.
python3 tools/compare.py Legium-export.json out/web-export.json \
        --emit-new new.txt

# 3. Build one archive out of the new books.
python3 tools/build_archive.py out/web-export.json \
        out/legium-web.json --only new.txt
```

Step 3 produces a single `legium.archive` JSON — one import instead of hundreds.

| tool | what it does |
|---|---|
| `extension/notebook.js` | The exporter: scrapes the notebook page; writes a `legium.archive`, plain JSON, or a zip of per-book notebook-export HTML; draws the panel |
| `extension/content.js`, `background.js`, `manifest.json` | The Firefox extension around it: saves files with the downloads API, and the toolbar button |
| `legium.user.js` | The same exporter as a userscript. **Generated**; don't edit it |
| `tools/build_userscript.py` | Writes the userscript from `extension/notebook.js` and the manifest; `--check` fails if it is stale |
| `tools/compare.py` | Checks a scrape against a Legium archive; `--emit-new` lists the books Legium lacks |
| `tools/build_archive.py` | Turns a scrape into one importable `legium.archive` JSON |
| `tools/test_compare.py` | Regression suite for the comparator |
| `tools/test_archive.py` | Runs the exporter's writers under `jsc`: the archive against `build_archive.py`, the zip against Python's `zipfile`; checks the userscript is current |

### Which format to import

| situation | import |
|---|---|
| Book Legium has never seen | The archive JSON — one file, all of them |
| Book Legium holds **partially** | The **HTML**, so `HighlightImport` merges into the existing source |
| Book Legium already holds in full | Neither. Keep what you have — see below |

The archive path matches sources **by UUID and never by title**, and does no
text-level de-duplication. Hand it a book Legium already holds and you get a
second source. That restriction is the whole reason `compare.py` exists.

---

## What the notebook page actually gives you

Findings from a signed-in shelf of 263 rail entries. These are why the selectors
are what they are.

- **`?asin=` returns a fragment**, not a page: two hidden inputs and then the
  annotation rows, with no `#kp-notebook-annotations` wrapper. Parsing falls
  back to the document body so both that and the assembled page work.
- **The pagination inputs are classes in the fragment and ids on the page**
  (`kp-notebook-content-limit-state`,
  `kp-notebook-annotations-next-page-start`). Both spellings are matched.
- **Pagination is load-bearing.** One book returned 97 highlights on its first
  page and 162 across three. Reading only the first page loses a third of a book
  with no error.
- **A header names either a page or a location, never both** — but the hidden
  `#kp-annotation-location` input holds the true location regardless. On a
  page-showing book the header reads `Page: 195` while the input says `2119`, so
  both are recovered and written as `Page 195 · Location 2119`.
- Locations print with thousands separators (`Location: 1,234`).
- **The colour comes from the CSS class, not the header's label**, and the two
  disagree: a highlight the header calls `Aqua highlight` carries the class
  `kp-notebook-highlight-blue`. The class is correct, because the reading app's
  own export writes `annotation_blue` too — reading the label would give
  web-exported books a colour string no app-exported book ever uses. Across the
  scrape only two values occur: `yellow` (4,678) and `blue` (162).
- **A row with no note still carries an `#annotationNoteHeader`**, hidden with
  `aok-hidden`. Emptiness of `#note` decides, not the header's presence.
- **The rail lists some books twice** — 13 of 263, each pair carrying identical
  annotations. De-duplicated by ASIN in `readLibrary`.

### What it does not give you

The web notebook is thinner than the device's export. The script stays silent
rather than guessing, and Legium reads all of these as absent:

- **No chapter headings.** The app writes a `sectionHeading` div per chapter,
  from the book's table of contents. Nothing on the notebook page carries one,
  so every passage imports with `section == nil`.
- **No subsections**, so no `Subsection > Page N` — which means Legium's
  anthology *piece* detection and its inlined-heading lift have nothing to work
  with on these files.
- **No bookmarks.** Highlights and notes only.
- **No citation, so no publisher and no year.** Confirmed absent from both the
  fragment and the assembled page.
- **Nothing sideloaded.** A book you put on the device over USB is not in your
  Amazon library, so its annotations never reach the cloud. They live only in
  the device's `My Clippings.txt`.

---

## Why the app's export can't be automated

The app builds its export client-side, from the downloaded book's table of
contents plus the local annotation sidecar. That is where the chapter data comes
from, and there is no way to reach it in bulk:

- **The Cloud Reader is a dead end.** It renders the book into a single
  `<canvas>` with zero DOM text, behind obfuscated internals
  (`GlyphRenderer`, `RendererCanvasInsertion`).
- **There is no API.** Readwise's own documentation says so plainly, which is
  why their sync is a browser extension reading the same notebook page
  this script reads. Bookcision is a bookmarklet on that page. Every tool in the
  ecosystem uses this one source, and none of them recover chapters either.
  StoryGraph doesn't import highlights at all.
- The only faithful route is UI-automating the desktop reading app, one book at a
  time, with every book downloaded locally. Feasible; unpleasant; brittle.

So: web export for everything in your Amazon library, the app's export by hand
for the few books whose structure carries meaning, `My Clippings.txt` for
sideloaded titles.

---

## Merging with what you already have

Comparing a scrape against a real Legium archive of 26 sources / 451 entries:
**9 books in both, 419 archive passages there, 366 identical, 51 drifted, 2
absent from the web.** Counts matched exactly on 7 of the 9. Of the other two,
The Steady Hand's extra web record is a note, which folds onto its
highlight and so is not a real difference; Northern Routes is the partial import
described below. No book lost passages to the web.

### The two sources disagree on wording

Drift is systematic, not random. Of 51 drifted passages, **35 are pure spacing**:
the app export inserts a space before certain glyphs.

```
app: "Brand of Acme ™."          web: "Brand of Acme™."
app: "6: 30 in the evening"      web: "6:30 in the evening"
app: "‘ quoted’ were all"        web: "‘quoted’ were all"
```

The rest are edge differences — in Harbour Lights the app bled `underneath—“ ` in
ahead of the highlight, where the web copy is the cleaner of the two.

**So don't import both sources for the same book.** Legium dedupes passages on a
folded key (`HighlightImport.matchKey`) that forgives case, diacritics and
whitespace *runs* — but not an inserted space. Those 51 would land as
near-duplicates.

There is a second trap. Sources match on title **and creator**, and the two
sources disagree about the creator: the app export says `Marsh, Ada` →
`Ada Marsh`, while the rail says `Ada Marsh and Ben Ellery`.
Those don't match, so you get a second source for the same book. Any book where
Amazon lists a co-author will split this way.

### Prefer the archive — except when it's partial

"Prefer what Legium already has" is right only where Legium's copy is complete.
In practice one book was a partial import: **Northern Routes, 2 passages in the
archive against 236 on the web.** `compare.py` flags books where the web holds
substantially more. Import those as HTML so `HighlightImport` merges them in.

### Books with no web counterpart

Ten archive sources had none: poems and OCR entries, plus five that look
sideloaded. Nothing to merge — they're already yours, and the web will never
have them.

---

## The format contract

What the emitter writes, and what `NotebookExportParser` reads back:

```html
<div class="bookTitle">    …title… </div>
<div class="authors">      …author… </div>
<div class="noteHeading">
    Highlight(<span class="annotation_yellow">yellow</span>)
 - Page 49 · Location 1114
</div>
<div class="noteText">     …the passage… </div>
```

- A highlight carrying a note is written as the app writes it: the highlight
  block, then a `Note` block **at the same location**. That adjacency is what
  Legium folds back into one passage with a note on it.
- Text is escaped including quotes, so a passage that literally contains
  `class="noteText"` cannot open a block of its own.
- The `citation` div is omitted entirely when there is none, which is always
  from the web.

### Origin

The archives stamp entries `import.notebook-web`, not `import.notebook-html`, so
web-scraped passages stay distinguishable. Legium needs no new case: `originRaw`
is plain text and "was this imported" is answered by the `import.` prefix — the
unknown-lane case `EntryOrigin` is explicitly designed for. The name follows that
enum's rule of naming a **format** rather than a product.

Importing the HTML files through Legium's own notebook import stamps them
`import.notebook-html` instead, because that path passes the case in itself.

### Re-importing is safe

Archive UUIDs derive from the ASIN, so regenerating produces identical ids and a
second import updates nothing. Timestamps are deterministic on purpose: the
import skips a record whose `updatedAt` isn't newer, which means a re-import
can't silently overwrite edits you've made by hand. The cost is that changing
something in the builder won't reach entries you already imported — delete those
first if you need the change to land.

### The browser's archive

The exporter's **One file for Legium** writes the same archive as
`build_archive.py` — same sources, contributors, locators, note folding and
`import.notebook-web` origin, and the same source and contributor uuids — with
two differences, both so a reader can export again after reading more and
import the new file over the old:

- **A passage's uuid comes from its ASIN and its text and note**, not its
  position in the book. `importArchive` matches entries by uuid alone, so a
  position-derived id shifts for every passage after a new mid-book highlight,
  and all of them would arrive twice.
- **`updatedAt` is fixed at `1970-01-01T00:00:00Z`.** An entry already in the
  store is replaced only when the incoming `updatedAt` is strictly newer, and
  replacing resets its note, favourite and tags to the file's. Stamped with the
  export time, every re-import would undo the reader's edits. `createdAt` is the
  export time, which is what Legium shows as *Gathered*; with `updatedAt`
  earlier, no *Edited* line appears.

Because the passage uuids differ, **don't import the browser's archive over
books that `build_archive.py` brought in**: each of their passages would arrive
a second time. `build_archive.py` keeps its position-derived ids so that the
archives already imported from it stay stable.

---

## How this was checked

Nothing here was validated against a reimplementation of Legium.

- **The emitter runs under `jsc`, and its output goes through the real
  `NotebookExportParser`**, compiled with `swiftc` against
  `ImportedHighlight.swift`. Covers entity handling, author reversal, publisher
  and year off a citation line, location-only highlights, roman-numeral pages,
  note folding, and the `class="noteText"` case.
- **The archives decode with Legium's own `LegiumArchive` wire format** — its
  structs and custom decoders, compiled directly. This is what caught the
  duplicated-ASIN bug: 13 duplicate source UUIDs and 330 duplicate entry UUIDs,
  invisible from the outside.
- **The two output paths are cross-checked against each other.** All 232 books
  hash identically through the emitter → parser as through the Python builder.
- **Against real app exports**: The Steady Hand matched 48 of 48 byte for
  byte, including its note. Harbour Lights matched 10 of 12, the differences being
  the two described above, with its bookmark absent as expected.
- `tools/test_compare.py` covers the comparator: folding, anthology roll-up,
  note pairing, drift detection, and books present on one side only.
- `tools/test_archive.py` runs the exporter's archive writer under `jsc` on an
  invented shelf and checks it against `build_archive.py` field by field, apart
  from the two intended differences; its SHA-1 and uuid5 against Python's; that
  a highlight added mid-book leaves every other passage's uuid alone; and that
  the plain JSON feeds `build_archive.py`. Run on the 263-entry scrape as well,
  the two writers agreed on all 241 sources, 211 contributors and 4,510
  passages.

```sh
python3 tools/test_compare.py
python3 tools/test_archive.py
```

---

## Config

Constants at the top of `extension/notebook.js`: `fetchDelayMs` (throttle
between books) and `retries`. `SELECTORS` holds every page-specific selector in
one object, so an Amazon redesign is a one-line fix rather than a hunt.
`legiumExport` exposes the internals for poking from the console (the
userscript's page console; for the extension, the console's context menu set to
the extension).

## One exporter, two packages

The exporter is written once, in `extension/notebook.js`, and knows nothing
about how a file is saved: whoever loads it calls
`legiumExport.start({ save, canAsk, choose })`. `save` saves a finished file,
`canAsk` says whether the host can show a Save dialog, and `choose`, for a
host that can only show one straight after a click, picks the file before the
export starts.

- **The extension** loads it as a content script, then `content.js`, whose
  `save` sends the file to `background.js`. The background script saves it with
  the downloads API. Sending a file somewhere else — a desktop app, say, through
  native messaging — would be a second branch in its `deliver`.
- **The userscript** is `notebook.js` with a header made from the manifest and
  a `save` that clicks a download link, or writes to a file chosen with
  `showSaveFilePicker` where the browser has it, written by
  `tools/build_userscript.py`.

So after any change under `extension/`:

```sh
python3 tools/build_userscript.py
python3 tools/test_archive.py      # fails if the userscript was not rebuilt
```

Two things differ between the packages and are worth knowing when one works
and the other doesn't. In a Firefox content script, `fetch` is made on the
extension's behalf, so the exporter uses `content.fetch` there, which is the
page's own and carries its sign-in. And messages between content and
background scripts carry their fields at the top level, so the file travels as
`{ type: 'save', file }`: spread into the message, the file's own `type` (its
MIME type) replaced the message's, and every save was ignored while reporting
success.

## Trying the extension before it is published

Firefox installs only extensions Mozilla has signed, except for a temporary
install, which lasts until Firefox quits:

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Press **Load Temporary Add-on…** and choose `extension/manifest.json`.
3. Open <https://read.amazon.com/notebook>. The panel appears top right.

After editing a file, press **Reload** on the same page. **Inspect** opens the
background script's console, where a failed save says why.

To keep it installed across restarts without signing, use Firefox Developer
Edition or Nightly, set `xpinstall.signatures.required` to `false` in
`about:config`, and install the `.zip` that `web-ext build` makes.

## Releasing

1. Raise `version` in `extension/manifest.json` and run
   `tools/build_userscript.py`, which copies it into the userscript's
   `@version`. Tampermonkey updates only when the version is higher; Mozilla
   refuses a version it has already signed.
2. Commit, then tag `v<version>` and push the tag.

`.github/workflows/extension.yml` runs the tests and Mozilla's `web-ext lint`
on every push, and on a `v*` tag also signs the extension with Mozilla and
attaches the `.xpi` and the userscript to a GitHub release. Signing needs, in
the repository's settings:

- secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`: the API key and secret from
  <https://addons.mozilla.org/developers/addon/api/key/>, under a free
  addons.mozilla.org developer account;
- optionally a variable `AMO_CHANNEL`: `unlisted` (the default) signs a file
  you host yourself, usually within minutes; `listed` submits it for a public
  page on addons.mozilla.org, which Mozilla reviews and then keeps updated.
  The first listed version may need its listing filled in on the site.

## out/

Generated data, untracked by git — it's the contents of a personal commonplace
book, and this repo is a script anyone could publish. Regenerate with the
pipeline above.

| file | what it is |
|---|---|
| `web-export.json` | The raw scrape: 263 rail entries, 250 distinct books, 4,840 highlights, 17 notes |
| `legium-sample.json` | 3 books, 12 passages. Import first — covers a note on a highlight, a paged book, a location-only book |
| `legium-web.json` | 232 books, 3,857 passages, 13 notes. Every book the archive did not hold |
| `notebooks/` | The same 232 books as individual HTML; `INDEX.tsv` maps ASIN to filename |
| `notebooks-partial/` | Northern Routes only — import as **HTML, not JSON** |
