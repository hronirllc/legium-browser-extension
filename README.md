# highlights → Legium notebook export

A userscript for `read.amazon.com/notebook` that downloads every book's
highlights as the **same per-book HTML the reading app's own "Export notebook"
produces** — so Legium imports them through `NotebookExportParser` with no new
parser and no changes to the app.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) or
   [Tampermonkey](https://www.tampermonkey.net/).
2. Add `legium.user.js` to it.
3. Open <https://read.amazon.com/notebook> and sign in.
4. A panel appears top-right. Click **Export all books**.

You get one `.zip` of `Title - Author.html` files (or individual downloads, if
you untick the zip box). Feed each file to Legium's notebook import.

## What it does

Walks the library rail, fetches each book's annotations pane — following the
pane's own pagination to the end, so long books aren't truncated at the first
page — and writes the export format: a verbatim copy of the app preamble,
then `bookTitle` / `authors` / `citation`, then `noteHeading` + `noteText`
pairs in reading order.

A highlight carrying a note is written as the app writes it: the highlight
block, then a `Note` block at the same location. That adjacency is what
Legium's parser folds back into a single passage with a note on it.

## How the output was checked

The emitter is exercised off-browser against Legium's *actual* parser, not a
reimplementation of it:

```sh
# generate a notebook covering the awkward cases
jsc -e 'eval(readFile("legium.user.js")); ...writeNotebook(book)...'

# parse it with the real thing
swiftc -o parsecheck \
  ~/code/legium/Legium/Import/ImportedHighlight.swift \
  ~/code/legium/Legium/Import/NotebookExportParser.swift main.swift
./parsecheck generated.html
```

Confirmed round-tripping: `&` in titles, `Surname, Given` author reversal,
publisher and year off a citation line, page-less location-only highlights,
roman-numeral pages, notes folded onto their passage, standalone notes left
alone, and a passage that literally contains `class="noteText"` not opening a
phantom block.

Then repeated on **real records scraped from the live notebook page** — a
book's export with a genuine note attached to its highlight — which
the parser read back as one passage carrying that note, an `aqua` highlight
preserved, and no unparsed headings.

## Checked against the app's own exports

Four books that had been exported from the reading app were re-exported from the
web and compared record by record, hashing each passage's text on both sides.

**The Steady Hand — 48 of 48, byte-identical.** Every location matched,
every passage hashed the same, and the one note came through with the same
bytes. The only difference is that the app placed the note at location 1114 and
the web places it at 1113; both fold onto the same passage.

**Harbour Lights — 12 of 13, two passages differing.**

- The blue **bookmark** at location 1727 is absent, as expected.
- Location 1232 differs by 14 bytes. The app captured
  `underneath—“ The Harbour Inn:—Open Late.”`; the web gives
  `“The Harbour Inn:—Open Late.”`. The app export bled in the run of body
  text preceding the highlight — the web copy is the cleaner of the two.
- Location 14862 differs by one byte: a footnote marker, spaced as
  `Islands, 2` in the app export and `Islands,2` on the web.
- The remaining ten passages hashed identically.

**The other two — not on the web at all.** Neither appears
anywhere in the 263-book shelf, by title or author. Both are sideloaded, and
this is the gap described above: their annotations exist only in the device's
`My Clippings.txt` and local sidecar, and never reach Amazon's cloud.

### So don't import both sources for the same book

Two consequences follow from the above, and they only bite if you import a book
from the app *and* from the web:

1. **Passages dedupe on exact text.** The two Harbour Lights passages that differ
   would import as extra, near-identical passages rather than being recognised
   as ones already held.
2. **Sources match on title *and* creator**, and the two disagree about the
   creator. The app export says `Marsh, Ada` → `Ada Marsh`; the web
   rail says `Ada Marsh and Ben Ellery`. Those do not match, so a
   second Harbour Lights source would be created alongside the first. (The Steady
   Hand is fine — both sides resolve to `Sam Reyes`.)

Pick one source per book: the web export for anything in your Amazon library,
the app export for a book whose chapter context you want, and `My Clippings.txt`
for sideloaded titles.

## Where this is thinner than the app's export

Checked against a real signed-in shelf of 263 books, not assumed. The web
notebook does not carry everything the device does; the script stays silent
rather than guessing, and the parser treats all of these as absent:

- **No chapter headings.** The app's export writes a `sectionHeading` div per
  chapter. Nothing on the notebook page carries one, so every passage imports
  with `section == nil`.
- **No subsections.** No `Subsection > Page N` in the heading either — which
  means Legium's anthology *piece* detection and its inlined-heading lift have
  nothing to work with on these files.
- **No bookmarks.** The web notebook lists highlights and notes only.
- **No citation, so no publisher and no year.** Confirmed absent from both the
  fragment and the assembled page — the word "citation" appears nowhere. The
  `citation` div is therefore never written. (`writeNotebook` still supports
  one if a caller supplies it, italics and all, since the format allows it.)

If chapter context matters for a particular book, export that one from the
reading app itself — the two formats are the same, so it drops straight in.

## What the page actually gives you

Findings from the live page, which is why the selectors are what they are:

- The `?asin=` response is a **fragment**: two hidden inputs and then the
  annotation rows, with no `#kp-notebook-annotations` wrapper. Parsing falls
  back to the document body so both that and the assembled page work.
- Those hidden inputs are `kp-notebook-content-limit-state` and
  `kp-notebook-annotations-next-page-start`, carried **as classes** in the
  fragment and as ids on the assembled page. Both spellings are matched.
- **Pagination is load-bearing.** One sampled book returned 97 highlights on
  its first page and 162 across three. Reading only the first page silently
  loses a third of a book.
- A header names **either** a page or a location, never both — but the hidden
  `#kp-annotation-location` input holds the true location regardless. On a
  page-showing book the header reads `Page: 195` while the input says `2119`,
  so both are recovered and written as `Page 195 · Location 2119`.
- Locations print with thousands separators (`Location: 1,234`); digits are
  stripped out before use.
- Colours come from the CSS class, **not** from the header's label, and the two
  disagree: a highlight the header calls `Aqua highlight` carries the class
  `kp-notebook-highlight-blue` (28 of 29 sampled). The class is the correct
  source, because the reading app's own export writes `annotation_blue` for that
  colour too — reading the label instead would give web-exported books a colour
  string no app-exported book ever uses, and Legium's `highlightColours` would
  then report two colours for a shelf highlighted in one.
- Across all 263 books only two class values occur: `yellow` (4,678) and `blue`
  (162).
- A row with no note still carries an `#annotationNoteHeader`, hidden via
  `aok-hidden`. Emptiness of `#note` is what decides, not the header.

### One known wrinkle

Authors come from the library rail in natural order (`Ines Varga`), whereas
the app's export writes `Surname, Given`. Legium reverses on a *single* comma,
so a rail author with exactly one comma would be flipped. On this shelf that is
1 book in 263, and Amazon's metadata for it is already scrambled
(`"Lee Ortiz and Kim;Novak A Park, Jo;Reyes"`), so there is
nothing to preserve. 244 of 263 have no comma at all and pass through untouched.

## Config

Constants at the top of the script: `fetchDelayMs` (throttle between books),
`retries`, `downloadDelayMs`. `SELECTORS` holds every page-specific selector in
one object, so an Amazon redesign is a one-line fix rather than a hunt.
`window.legiumExport` exposes the internals for poking from the console.

## out/

Generated data, untracked by git — see `.gitignore`. Regenerate at any time:

```sh
python3 tools/compare.py <legium-archive.json> out/web-export.json --emit-new new.txt
python3 tools/build_archive.py out/web-export.json out/legium-web.json --only new.txt
```

| file | what it is |
|---|---|
| `web-export.json` | The raw scrape: 263 rail entries, 250 distinct books, 4,840 highlights, 17 notes. The source everything else derives from. |
| `legium-sample.json` | 3 books, 12 passages. Import this first — it covers a note attached to a highlight, a book with page numbers, and a location-only book. |
| `legium-web.json` | 232 books, 3,857 passages, 13 notes. Every book the archive did not already hold. |
| `notebooks/` | The same 232 books as individual notebook-export HTML, for importing through the ordinary path. `INDEX.tsv` maps ASIN to filename. |
| `notebooks-partial/` | Northern Routes only. Import as **HTML, not JSON** — the archive holds 2 of its 236 passages, and only the HTML path merges into the existing source instead of creating a second one. |

Both archives decode against Legium's own `LegiumArchive` wire format with no
duplicate or orphaned records, and all 233 HTML files parse with
`NotebookExportParser` with no unreadable headings.
