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
publisher and year off the citation line, page-less location-only highlights,
roman-numeral pages, notes folded onto their passage, standalone notes left
alone, and a passage that literally contains `class="noteText"` not opening a
phantom block.

## Where this is thinner than the app's export

The web notebook simply does not carry everything the device does. The script
stays silent rather than guessing, and the parser treats all of these as
absent:

- **No chapter headings.** The app's export writes a `sectionHeading` div per
  chapter, from the book's table of contents. The web page has no equivalent,
  so every passage imports with `section == nil`.
- **No subsections.** For the same reason there is no `Subsection > Page N`
  in the heading — which also means Legium's anthology *piece* detection and
  its inlined-heading lift have nothing to work with on these files.
- **No bookmarks.** The web notebook lists highlights and notes only.
- **Citation is best-effort.** Publisher and year come through only when the
  page offers a citation line; otherwise the div is omitted entirely.

If chapter context matters for a particular book, export that one from the
reading app itself — the two formats are the same, so it drops straight in.

## Config

Constants at the top of the script: `fetchDelayMs` (throttle between books),
`retries`, `downloadDelayMs`. `SELECTORS` holds every page-specific selector in
one object, so an Amazon redesign is a one-line fix rather than a hunt.
`window.legiumExport` exposes the internals for poking from the console.
