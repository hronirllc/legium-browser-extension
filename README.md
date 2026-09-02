# highlights → Legium

Gets every highlight out of `read.amazon.com` and into Legium, in the
format Legium already reads.

Legium imports the per-book HTML that the reading app's own **Export notebook**
produces. So rather than teach the app a second format, this emits that same
format from the web notebook page — the preamble is copied verbatim from a real
export, and every block reproduces a shape `NotebookExportParser` has a fixture
for.

Two things fall out of that choice, and both are covered below: the web page is
**thinner** than the app's export in ways worth knowing before you rely on it,
and the two sources **disagree slightly on wording**, which matters if you ever
import the same book twice.

---

## Quick start

1. Install [Violentmonkey](https://violentmonkey.github.io/) or
   [Tampermonkey](https://www.tampermonkey.net/).
2. Add `legium.user.js`.
3. Open <https://read.amazon.com/notebook> and sign in.
4. Click **Export all books** in the panel, top right.

You get a `.zip` of `Title - Author.html` files, one per book, each importable
into Legium as a notebook export. That is the whole story if you have an empty
library.

If you already have highlights in Legium, don't import blindly — read
[Merging with what you already have](#merging-with-what-you-already-have).

---

## The pipeline

For a shelf that overlaps what Legium already holds, the userscript is only the
first step. The full path:

```sh
# 1. Scrape. Either click "Export all books" in the panel, or run the
#    extractor from the console and save the JSON it builds.
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
| `legium.user.js` | Scrapes the notebook page, writes per-book notebook-export HTML |
| `tools/compare.py` | Checks a scrape against a Legium archive; `--emit-new` lists the books Legium lacks |
| `tools/build_archive.py` | Turns a scrape into one importable `legium.archive` JSON |
| `tools/test_compare.py` | Regression suite for the comparator |

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

```sh
python3 tools/test_compare.py
```

---

## Config

Constants at the top of the userscript: `fetchDelayMs` (throttle between books),
`retries`, `downloadDelayMs`. `SELECTORS` holds every page-specific selector in
one object, so an Amazon redesign is a one-line fix rather than a hunt.
`window.legiumExport` exposes the internals for poking from the console.

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
