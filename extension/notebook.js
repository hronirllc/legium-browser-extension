//
// The exporter itself: reading the notebook page, writing the three
// output formats, and the panel. Shared by both ways of installing it:
//
// - the Firefox extension loads this file as a content script, before
//   `content.js`, which hands files to the background script to save;
// - `tools/build_userscript.py` wraps it into `legium.user.js`
//   for Tampermonkey and friends, with a few lines that save through a link.
//
// Neither is started from here. Whoever loads this calls
// `legiumExport.start({ save })`, where `save({ filename, type, data })` gets a
// finished file — `data` is a string or a Uint8Array — and saves it however
// that host can.
//
// What this produces
// -----------------
// By default, one `legium.archive` JSON holding every book: what Legium's
// Settings → Archive → Import archive… reads, so a whole shelf is one import.
// It is built the way `tools/build_archive.py` builds one; see `writeArchive`
// for the two places it departs from that, both so that exporting again later
// is safe.
//
// Or plain JSON tied to no app (`writePlain`): each book's records as read.
//
// Or a .zip of one HTML file per book, byte-shaped like the reading
// app's own notebook export:
// a fixed preamble, then `bookTitle` / `authors` / `citation` divs, then a run of
// `sectionHeading` / `noteHeading` / `noteText` divs in reading order.
//
// That format is the contract. Legium's parser scans for those class names and
// nothing else, so the preamble below is copied verbatim from a real export and
// every block this emits reproduces a shape the parser has a fixture for.
//
// Where the web notebook is thinner than the app's export it stays silent rather
// than inventing: no chapter is better than a wrong chapter, and an absent
// citation line is one the parser already tolerates.
//

(function () {
    'use strict';

    // ---------------------------------------------------------------- config

    const CONFIG = {
        /** Pause between book fetches. Politeness, and it keeps Amazon calm. */
        fetchDelayMs: 350,
        /** Retries per page fetch before a book is reported as failed. */
        retries: 2,
    };

    // The app export's own preamble, verbatim. Do not reformat: it is the
    // thing that makes an exported file indistinguishable from the app's.
    const TEMPLATE_HEAD = `<!DOCTYPE html PUBLIC
"-//W3C//DTD XHTML 1.0 Strict//EN"
"XHTML1-s.dtd" >
<html xmlns="http://www.w3.org/TR/1999/REC-html-in-xml" xml:lang="en" lang="en">
    <head>
    <meta charset="UTF-8">
    <style>
        .bodyContainer {
            font-family: Arial, Helvetica, sans-serif;
            text-align: center;
            padding-left: 32px;
            padding-right: 32px;
        }
        
        .notebookFor {
            font-size: 18px;
            font-weight: 700;
            text-align: center;
            color: rgb(119, 119, 119);
            margin: 24px 0px 0px;
            padding: 0px;
        }
        
        .bookTitle {
            font-size: 24px;
            font-weight: 700;
            text-align: center;
            color: #333333;
            margin-top: 22px;
            padding: 0px;
        }
        
        .authors {
            font-size: 18px;
            font-weight: 700;
            text-align: center;
            color: rgb(119, 119, 119);
            margin-top: 22px;
            margin-bottom: 24px;
            padding: 0px;
        }
    
        .citation {
            font-size: 18px;
            font-weight: 500;
            text-align: center;
            color: #333333;
            margin-top: 22px;
            margin-bottom: 24px;
            padding: 0px;
        }
    
        .sectionHeading {
            font-size: 24px;
            font-weight: 700;
            text-align: left;
            color: #333333;
            margin-top: 24px;
            padding: 0px;
        }
        
        .noteHeading {
            font-size: 18px;
            font-weight: 700;
            text-align: left;
            color: #333333;
            margin-top: 20px;
            padding: 0px;
        }
        
        .noteText {
            font-size: 18px;
            font-weight: 500;
            text-align: left;
            color: #333333;
            margin: 2px 0px 0px;
            padding: 0px;
        }
        
        .annotation_blue {
            color: rgb(178, 205, 251);
        }
        
        .annotation_orange {
            color: #ffd7ae;
        }
        
        .annotation_pink {
            color: rgb(255, 191, 206);
        }
        
        .annotation_yellow {
            color: rgb(247, 206, 0);
        }
        
        .annotation_green {
            color: rgb(0, 169, 118);
        }

        .annotation_aqua {
            color: rgb(0, 165, 167);
        }

        .annotation_red {
            color: rgb(244, 100, 101);
        }

        .annotation_purple {
            color: rgb(140, 140, 219);
        }

        .notebookGraphic {
            margin-top: 10px;
            text-align: left;
        }
        
        .notebookGraphic img {
            -o-box-shadow:      0px 0px 5px #888;
            -icab-box-shadow:   0px 0px 5px #888;
            -khtml-box-shadow:  0px 0px 5px #888;
            -moz-box-shadow:    0px 0px 5px #888;
            -webkit-box-shadow: 0px 0px 5px #888;
            box-shadow:         0px 0px 5px #888; 
            max-width: 100%;
            height: auto;
        }
        
        hr {
            border: 0px none;
            height: 1px;
            background: none repeat scroll 0% 0% rgb(221, 221, 221);
        }
        </style>
        <script>
            </script>
    </head>
    <body>
        <div class="bodyContainer">
`;

    const TEMPLATE_TAIL = `
        </div>
    </body>
</html>
`;

    // Selectors the notebook page uses. Grouped here because they are the only
    // part of this script that Amazon can break, and each is a list so a
    // redesign can be absorbed by adding one entry rather than hunting.
    const SELECTORS = {
        libraryBook: '#kp-notebook-library .kp-notebook-library-each-book',
        bookTitle: 'h2.kp-notebook-searchable, h2',
        bookAuthor: 'p.kp-notebook-searchable, p.a-color-secondary',
        // Absent from the fetched fragment, which is a bare list of rows. Only
        // the assembled page has this wrapper, so it is a hint, not a
        // requirement — see `annotationsRoot`.
        annotationRoot: '#kp-notebook-annotations',
        annotationRow: '.a-row.a-spacing-base',
        highlightText: '#highlight',
        noteText: '#note',
        highlightHeader: '#annotationHighlightHeader',
        noteHeader: '#annotationNoteHeader',
        // The trailing dash matters: the same element also carries a bare
        // `kp-notebook-highlight`, which names no colour.
        highlightBox: '[class*="kp-notebook-highlight-"]',
        location: '#kp-annotation-location',
        // Carried as ids on the assembled page and as classes in the fragment.
        // Both spellings, or long books stop after their first page.
        limitState: '#kp-notebook-content-limit-state, .kp-notebook-content-limit-state',
        nextPageStart:
            '#kp-notebook-annotations-next-page-start, .kp-notebook-annotations-next-page-start',
    };

    // ------------------------------------------------------------- utilities

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /**
     * HTML-escapes text for insertion into an export.
     *
     * Quotes are escaped along with the angle brackets on purpose: the parser
     * finds its blocks by scanning for the literal `class="`, so a passage that
     * happened to quote some markup could otherwise open a block of its own.
     */
    const esc = (value) =>
        String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    /** An element's text, with the page's own wrapping collapsed. */
    const textOf = (element) =>
        element ? element.textContent.replace(/\s+/g, ' ').trim() : '';

    const firstMatch = (root, selector) => (root ? root.querySelector(selector) : null);

    const valueOf = (doc, selector) => {
        const field = firstMatch(doc, selector);
        return field ? (field.value || '').trim() : '';
    };

    /** A date as the reader's own calendar has it, not UTC's: an evening export is named for today. */
    const localDay = (date = new Date()) =>
        [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((part) => String(part).padStart(2, '0')).join('-');

    /** A filename that survives every filesystem, without becoming unreadable. */
    function safeFilename(name) {
        const cleaned = String(name)
            .replace(/[\/\\:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/^\.+/, '')
            .trim();
        return (cleaned || 'Notebook').slice(0, 120);
    }

    // -------------------------------------------------------------- fetching

    /**
     * `fetch` as the page itself would make it, signed-in cookies and all.
     *
     * A Firefox content script's own `fetch` is made on the extension's behalf;
     * `content.fetch` is the page's. A userscript, and Chrome's content scripts,
     * only have the page's.
     */
    function pageFetch(url, options) {
        if (typeof content === 'object' && content && typeof content.fetch === 'function') {
            return content.fetch(url, options);
        }
        return fetch(url, options);
    }

    /** Fetches one notebook page and hands back a parsed document. */
    async function fetchDocument(url) {
        let lastError;
        for (let attempt = 0; attempt <= CONFIG.retries; attempt += 1) {
            try {
                const response = await pageFetch(new URL(url, location.href).href, {
                    credentials: 'include',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const html = await response.text();
                if (/ap\/signin|<form[^>]+name="signIn"/i.test(html)) {
                    throw new Error('signed out');
                }
                return new DOMParser().parseFromString(html, 'text/html');
            } catch (error) {
                lastError = error;
                await sleep(400 * (attempt + 1));
            }
        }
        throw lastError;
    }

    /**
     * Every book on the shelf, from the library rail on the left.
     *
     * De-duplicated by ASIN, because the rail really does list the same book
     * twice — 13 of 263 on the shelf this was written against, each pair
     * carrying identical annotations. Left in, a duplicate costs a second
     * fetch of the same book and writes it out again under a second filename.
     */
    function readLibrary() {
        const seen = new Set();
        return Array.from(document.querySelectorAll(SELECTORS.libraryBook))
            .map((row) => ({
                asin: row.id || '',
                title: textOf(firstMatch(row, SELECTORS.bookTitle)),
                author: textOf(firstMatch(row, SELECTORS.bookAuthor)),
            }))
            .filter((book) => {
                if (!book.asin || seen.has(book.asin)) return false;
                seen.add(book.asin);
                return true;
            });
    }

    /**
     * Where a page's annotation rows live.
     *
     * `?asin=` returns a fragment — two hidden inputs and then the rows, with no
     * wrapper around them — while the assembled page nests the same rows inside
     * `#kp-notebook-annotations`. Falling back to the document itself covers
     * both without caring which one arrived.
     */
    function annotationsRoot(doc) {
        return firstMatch(doc, SELECTORS.annotationRoot) || doc.body || doc;
    }

    /**
     * Page and location, read out of an annotation's header line.
     *
     * The header is written for a reader — "Yellow highlight | Page: xi" — and
     * names only one of the two. The location also arrives as a hidden field,
     * which is the more dependable of the pair, so that wins where both exist.
     */
    function readPlace(row, headerText) {
        const page = (headerText.match(/(?:Page|Seite|Página|Pagina)[:\s]+([^|·]+)/i) || [])[1];
        const shown = (headerText.match(/(?:Location|Position|Posición|Posizione)[:\s]+([\d,.]+)/i) || [])[1];
        const hidden = valueOf(row, SELECTORS.location);
        const location = (hidden || shown || '').replace(/[^\d]/g, '');
        return {
            page: page ? page.trim() : '',
            location: location || '',
        };
    }

    /**
     * The highlight colour, from the class the pane paints the box with.
     *
     * The class rather than the header's label, which disagrees with it: the
     * header calls this colour "Aqua highlight" while the class calls it
     * `blue`, and the reading app's own export writes `blue` as well. Reading
     * the label would give these files a colour string no app export uses.
     * The header is consulted only when no class is present at all.
     */
    function readColour(row) {
        const box = firstMatch(row, SELECTORS.highlightBox);
        const match = box && (box.className.match(/kp-notebook-highlight-(\w+)/) || []);
        if (match && match[1]) return match[1].toLowerCase();
        // Some layouts state it only in the header: "Yellow highlight".
        const header = textOf(firstMatch(row, SELECTORS.highlightHeader));
        const named = header.match(/\b(yellow|blue|pink|orange|green|aqua|red|purple)\b/i);
        return named ? named[1].toLowerCase() : '';
    }

    /**
     * The annotations on one page of one book, in reading order.
     *
     * A row carries a highlight, a note, or both. Both is the interesting case:
     * the export writes them as two consecutive blocks sharing a location, which
     * is exactly the adjacency the parser folds back together.
     */
    function readAnnotations(doc) {
        const rows = annotationsRoot(doc).querySelectorAll(SELECTORS.annotationRow);
        const records = [];

        rows.forEach((row) => {
            const highlight = textOf(firstMatch(row, SELECTORS.highlightText));
            const note = textOf(firstMatch(row, SELECTORS.noteText));
            if (!highlight && !note) return;

            const header =
                textOf(firstMatch(row, SELECTORS.highlightHeader)) ||
                textOf(firstMatch(row, SELECTORS.noteHeader));
            const place = readPlace(row, header);

            if (highlight) {
                records.push({
                    kind: 'Highlight',
                    text: highlight,
                    colour: readColour(row),
                    page: place.page,
                    location: place.location,
                });
            }
            if (note) {
                records.push({
                    kind: 'Note',
                    text: note,
                    colour: '',
                    page: place.page,
                    location: place.location,
                });
            }
        });

        return records;
    }

    /** One book, following the pane's pagination to the end. */
    async function fetchBook(book) {
        const records = [];
        let limitState = '';
        let token = '';
        let guard = 0;

        do {
            const url =
                `/notebook?asin=${encodeURIComponent(book.asin)}` +
                `&contentLimitState=${encodeURIComponent(limitState)}` +
                `&token=${encodeURIComponent(token)}`;
            const doc = await fetchDocument(url);

            records.push(...readAnnotations(doc));

            limitState = valueOf(doc, SELECTORS.limitState);
            token = valueOf(doc, SELECTORS.nextPageStart);
            guard += 1;
            if (token) await sleep(CONFIG.fetchDelayMs);
        } while (token && guard < 200);

        // Title and author come from the library rail because the fragment states
        // neither. There is no citation to be had: the notebook page carries no
        // publisher, no year and no citation line anywhere, so that div is simply
        // never written and the parser reads both fields as absent.
        return {
            asin: book.asin,
            // The Amazon store this notebook belongs to, for a link to the book.
            store: typeof location === 'object' ? location.hostname.replace(/^read\./, 'www.') : '',
            title: book.title,
            author: book.author.replace(/^By:\s*/i, ''),
            citation: '',
            pages: guard,
            records,
        };
    }

    // --------------------------------------------------------------- writing

    /**
     * One annotation, as the two divs the export writes it in.
     *
     * The heading's shape is load-bearing down to the spacing: kind, the colour
     * parenthesised in its own span, then " - " and the place, with page and
     * location divided by a middle dot.
     */
    function writeRecord(record) {
        const place = [];
        if (record.page) place.push(`Page ${esc(record.page)}`);
        if (record.location) place.push(`Location ${esc(record.location)}`);

        const colour = record.colour
            ? `(<span class="annotation_${esc(record.colour)}">${esc(record.colour)}</span>)`
            : '';

        return (
            `<div class="noteHeading">\n` +
            `    ${record.kind}${colour}\n` +
            ` - ${place.join(' · ')}\n` +
            `</div>\n` +
            `<div class="noteText">\n` +
            `    ${esc(record.text)}\n` +
            `</div>`
        );
    }

    /** A whole book as a notebook export. */
    function writeNotebook(book) {
        const parts = [TEMPLATE_HEAD];

        parts.push(
            `            <div class="notebookFor">\n` +
            `                Notebook Export\n` +
            `            </div>\n` +
            `            <div class="bookTitle">\n` +
            `                ${esc(book.title)}\n` +
            `            </div>\n` +
            `            <div class="authors">\n` +
            `                ${esc(book.author)}\n` +
            `            </div>\n`
        );

        // Omitted rather than faked when the page does not offer one: the parser
        // reads only publisher and year from it, and both are better absent than
        // guessed.
        // Written only if a caller supplies one. Nothing on the notebook page
        // does — the format allows it, Amazon's web copy just has no citation to
        // give — and an absent div is what the parser expects in that case.
        // Passed through unescaped so an `<i>` survives: the publisher is read
        // from the closing `</i>` of the italicised title to the year.
        if (book.citation) {
            parts.push(
                `            <div class="citation">\n` +
                `                ${book.citation}\n` +
                `            </div>\n`
            );
        }

        parts.push(`            <hr />\n`);
        parts.push(book.records.map(writeRecord).join(''));
        parts.push(TEMPLATE_TAIL);

        return parts.join('');
    }

    // --------------------------------------------------------------- archive

    // The same namespace as `tools/build_archive.py`, so a source made by either
    // from the same ASIN has the same uuid.
    const ARCHIVE_NAMESPACE = '6f9e5b3a-2c41-4d8e-9a17-5b0c8e2d4f36';
    const ARCHIVE_ORIGIN = 'import.notebook-web';
    /** HighlightImport.noteAnchorSpan */
    const NOTE_ANCHOR_SPAN = 10;
    /**
     * Every passage's `updatedAt`. Legium's archive import replaces a passage it
     * already holds only when the incoming `updatedAt` is strictly newer, and
     * replacing resets its note, favourite and tags to the file's. A fixed date
     * that no edit can be older than means exporting again adds what is new and
     * leaves everything the reader has done in Legium alone.
     */
    const ARCHIVE_UPDATED_AT = '1970-01-01T00:00:00Z';

    function utf8(text) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
        const binary = unescape(encodeURIComponent(text));
        return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }

    /**
     * SHA-1 of some bytes. Written out rather than taken from `crypto.subtle`,
     * which is asynchronous and missing outside a browser, so the archive can be
     * built and checked under `jsc` as the notebook HTML is.
     */
    function sha1(bytes) {
        const length = bytes.length;
        const words = new Uint32Array((((length + 8) >> 6) + 1) * 16);
        for (let i = 0; i < length; i += 1) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
        words[length >> 2] |= 0x80 << (24 - (length % 4) * 8);
        words[words.length - 1] = length * 8;

        const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
        const w = new Uint32Array(80);
        for (let block = 0; block < words.length; block += 16) {
            for (let t = 0; t < 16; t += 1) w[t] = words[block + t];
            for (let t = 16; t < 80; t += 1) {
                const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
                w[t] = (x << 1) | (x >>> 31);
            }
            let [a, b, c, d, e] = h;
            for (let t = 0; t < 80; t += 1) {
                const f = t < 20 ? (b & c) | (~b & d)
                    : t < 40 ? b ^ c ^ d
                    : t < 60 ? (b & c) | (b & d) | (c & d)
                    : b ^ c ^ d;
                const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
                const next = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
                e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = next;
            }
            h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
            h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
        }
        const out = new Uint8Array(20);
        h.forEach((word, i) => {
            out[i * 4] = word >>> 24; out[i * 4 + 1] = (word >>> 16) & 0xff;
            out[i * 4 + 2] = (word >>> 8) & 0xff; out[i * 4 + 3] = word & 0xff;
        });
        return out;
    }

    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    /** Python's `uuid.uuid5`, upper-cased as Legium writes uuids. */
    function uuid5(namespace, name) {
        const space = Uint8Array.from(namespace.replace(/-/g, '').match(/../g), (pair) => parseInt(pair, 16));
        const label = utf8(name);
        const input = new Uint8Array(space.length + label.length);
        input.set(space);
        input.set(label, space.length);
        const digest = sha1(input).slice(0, 16);
        digest[6] = (digest[6] & 0x0f) | 0x50;
        digest[8] = (digest[8] & 0x3f) | 0x80;
        const h = hex(digest);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase();
    }

    /** `build_archive.py`'s `det`. */
    const det = (...parts) => uuid5(ARCHIVE_NAMESPACE, parts.join('\x1f'));

    /** HighlightImport.matchKey: case, diacritics and runs of whitespace forgiven. */
    function matchKey(text, note) {
        const fold = (value) =>
            (value || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
        return `${fold(text)}\x1f${fold(note)}`;
    }

    const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;

    /**
     * ImportedBook.authorDisplayName: a single comma means "Surname, Given" —
     * unless what follows it is a suffix, as in "Martin Luther King, Jr.".
     */
    function authorDisplay(name) {
        const trimmed = (name || '').trim();
        const parts = trimmed.split(',').map((part) => part.trim());
        return parts.length === 2 && parts[0] && parts[1] && !NAME_SUFFIX.test(parts[1])
            ? `${parts[1]} ${parts[0]}`
            : trimmed;
    }

    /**
     * The people in one author line, in order.
     *
     * The library rail gives a book's authors as a single line in reading
     * order: "Ada Marsh and Ben Ellery", "Ada Marsh, Ben Ellery, and Cy Dunn".
     * Credited whole, that line becomes one person named all of them. A line
     * with " and ", " & " or two or more commas is a list; anything else is one
     * name, reversed if it is "Surname, Given". A line with a semicolon is
     * Amazon's own scrambled metadata and is kept exactly as found: no split or
     * reversal of it is right.
     */
    function splitAuthors(line) {
        const text = (line || '').replace(/\s+/g, ' ').trim();
        if (!text) return [];
        const isList = / and | & /.test(text) || (text.match(/,/g) || []).length >= 2;
        if (text.includes(';')) return [text];
        if (!isList) return [authorDisplay(text)];
        const names = [];
        text.split(/,| and | & /)
            .map((part) => part.trim().replace(/^(and|&) /, ''))
            .filter(Boolean)
            .forEach((part) => {
                if (NAME_SUFFIX.test(part) && names.length) names[names.length - 1] += `, ${part}`;
                else names.push(part);
            });
        return names;
    }

    /** HighlightImport.locator: a page when the book has one, else a location. */
    function locator(page, location) {
        if (page) return `p. ${page}`;
        if (location) return `loc. ${location}`;
        return null;
    }

    /**
     * Records as Legium would file them: a note folded onto the highlight just
     * above it when it sits within the span the parser allows, otherwise kept as
     * a note with no passage. A highlight that already carries a `note` (from
     * plain JSON with notes attached) keeps it.
     */
    function passages(records) {
        const out = [];
        const number = (value) => (/^\d+$/.test(value || '') ? parseInt(value, 10) : null);
        records.forEach((record) => {
            if (record.kind === 'Highlight') {
                out.push({
                    text: record.text, note: record.note || '', colour: record.colour || '',
                    page: record.page || '', location: record.location || '',
                });
                return;
            }
            const here = number(record.location);
            const last = out[out.length - 1];
            const anchor = last ? number(last.location) : null;
            if (last && last.text && !last.note && here !== null && anchor !== null &&
                anchor <= here && here <= anchor + NOTE_ANCHOR_SPAN) {
                last.note = record.text;
            } else {
                out.push({ text: '', note: record.text, colour: '', page: record.page || '', location: record.location || '' });
            }
        });
        return out.filter((passage) => passage.text || passage.note);
    }

    /**
     * Books as one `legium.archive` (version 1, the single JSON file).
     *
     * Built as `tools/build_archive.py` builds one, with two differences, both so
     * that a reader can export again after reading more and import the new file
     * over the old:
     *
     * - A passage's uuid comes from its book and its text, not its position.
     *   Matching is by uuid alone, so a position-derived id shifts every later
     *   passage when a highlight is added mid-book, and they all arrive twice.
     * - `updatedAt` is `ARCHIVE_UPDATED_AT`, never the export's time.
     *
     * So don't import this over books that `build_archive.py` brought in: those
     * passages carry position-derived uuids and would arrive a second time.
     */
    function writeArchive(books, now = new Date()) {
        const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z'); // Legium reads no fractions
        const sources = [];
        const contributors = [];
        const entries = [];
        const people = new Map();
        const seenAsins = new Set();

        books.forEach((book) => {
            if (seenAsins.has(book.asin)) return;
            seenAsins.add(book.asin);
            const found = passages(book.records);
            if (!found.length) return;

            const sourceUUID = det('source', book.asin);
            const contributions = splitAuthors(book.author).map((name, position) => {
                if (!people.has(name)) {
                    people.set(name, det('contributor', name));
                    // sortName left blank so Legium derives its own.
                    contributors.push({ uuid: people.get(name), name, sortName: '', createdAt: stamp });
                }
                return { contributorUUID: people.get(name), role: 'author', position, marcCode: 'aut' };
            });
            sources.push({
                uuid: sourceUUID, title: book.title, kind: 'book',
                createdAt: stamp, tagUUIDs: [], contributions,
            });

            const held = new Set();
            found.forEach((passage) => {
                const key = matchKey(passage.text, passage.note);
                if (held.has(key)) return;
                held.add(key);
                entries.push({
                    uuid: det('entry', book.asin, hex(sha1(utf8(`${passage.text}\x1f${passage.note}`)))),
                    text: passage.text, note: passage.note,
                    locator: locator(passage.page, passage.location),
                    isFavorite: false, createdAt: stamp, updatedAt: ARCHIVE_UPDATED_AT,
                    sourceUUID, tagUUIDs: [], attachments: [], origin: ARCHIVE_ORIGIN,
                });
            });
        });

        return {
            format: 'legium.archive', version: 1, exportedAt: stamp,
            sources, contributors, tags: [], entries,
        };
    }


    // ---------------------------------------------------------- readable

    /**
     * What the tidy-up switches do to the plain JSON, CSV and Markdown. Each is
     * one thing the Legium archive always does; with all of them off, those
     * files hold the notebook page exactly as read.
     */
    const TIDY = [
        {
            key: 'splitAuthors',
            label: 'List each author separately',
            detail: '"A, B, and C" becomes three names; "Surname, Given" is turned around.',
        },
        {
            key: 'attachNotes',
            label: 'Attach notes to their highlights',
            detail: 'A note goes on the highlight it was written on instead of standing alone.',
        },
        {
            key: 'dropRepeats',
            label: 'Drop repeated passages',
            detail: 'A passage highlighted twice in one book is kept once.',
        },
        {
            key: 'places',
            label: 'Write places as Legium does',
            detail: 'Adds "p. 49", or "loc. 1114" for a book without page numbers.',
        },
    ];

    const ALL_TIDY = Object.fromEntries(TIDY.map((option) => [option.key, true]));

    /**
     * One book with the chosen switches applied. Records keep the page's own
     * shape — `kind`, `text`, `colour`, `page`, `location` — and gain `note`
     * (attachNotes: a highlight's note, '' if none; a note with no highlight
     * stays a `Note` record) and `place` (places). `authors` is there with
     * splitAuthors. `link` is the book's page in the store the notebook came
     * from, the way back to it by its ASIN; the page offers no ISBN.
     */
    function tidyBook(book, options = {}) {
        let records = book.records.map((record) => ({
            kind: record.kind, text: record.text, colour: record.colour,
            page: record.page, location: record.location,
        }));

        if (options.attachNotes) {
            records = passages(records).map((passage) => (passage.text
                ? { kind: 'Highlight', text: passage.text, note: passage.note, colour: passage.colour,
                    page: passage.page, location: passage.location }
                : { kind: 'Note', text: passage.note, colour: '', page: passage.page, location: passage.location }));
        }
        if (options.dropRepeats) {
            const seen = new Set();
            records = records.filter((record) => {
                const key = record.kind === 'Note' ? matchKey('', record.text) : matchKey(record.text, record.note);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
        if (options.places) {
            records.forEach((record) => { record.place = locator(record.page, record.location) || ''; });
        }

        const tidy = {
            asin: book.asin,
            link: `https://${book.store || 'www.amazon.com'}/dp/${book.asin}`,
            title: book.title,
            author: book.author,
        };
        if (options.splitAuthors) tidy.authors = splitAuthors(book.author);
        tidy.pages = book.pages;
        tidy.records = records;
        return tidy;
    }

    /**
     * The books worth writing: each ASIN once, since the rail lists some books
     * twice, and only those with something highlighted — as the Legium file has
     * always done.
     */
    function bookList(books) {
        const seen = new Set();
        return books.filter((book) => {
            if (!book.records.length || seen.has(book.asin)) return false;
            seen.add(book.asin);
            return true;
        });
    }

    /** A book's people for display: the split names, or the line as Amazon wrote it. */
    const byline = (book) => (book.authors ? book.authors.join(', ') : book.author || '');

    /** A record's place for display: Legium's form when asked for, else the page's. */
    function placeOf(record) {
        if (record.place !== undefined) return record.place;
        const parts = [];
        if (record.page) parts.push(`Page ${record.page}`);
        if (record.location) parts.push(`Location ${record.location}`);
        return parts.join(' · ');
    }

    /**
     * Books as plain JSON, tied to no app. With every switch off, this is the
     * same shape as `out/web-export.json`; `options` records which were
     * on, so a reader of the file knows what was done to it. `tools/compare.py`
     * and `tools/build_archive.py` read it either way. `shelf` counts the
     * library rail, books with no highlights included; `books` holds only those
     * with some.
     */
    function writePlain(books, shelf, options = {}, now = new Date()) {
        return {
            format: 'notebook-highlights',
            version: 1,
            scrapedAt: now.toISOString(),
            shelf,
            options: Object.fromEntries(TIDY.map((option) => [option.key, Boolean(options[option.key])])),
            books: bookList(books).map((book) => tidyBook(book, options)),
        };
    }

    /**
     * Books as CSV: one row per highlight or note, for a spreadsheet. Starts
     * with a byte-order mark, without which Excel reads UTF-8 as something
     * else and accents arrive mangled. `note` and `place` columns appear only
     * when their switch is on.
     */
    function writeCsv(books, options = {}) {
        const columns = ['title', 'authors', 'asin', 'link', 'kind', 'text'];
        if (options.attachNotes) columns.push('note');
        columns.push('colour', 'page', 'location');
        if (options.places) columns.push('place');

        const cell = (value) => {
            const text = value == null ? '' : String(value);
            return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const rows = [columns];
        bookList(books).map((book) => tidyBook(book, options)).forEach((book) => {
            const people = book.authors ? book.authors.join('; ') : book.author;
            book.records.forEach((record) => {
                const row = { ...record, title: book.title, authors: people, asin: book.asin, link: book.link };
                rows.push(columns.map((column) => row[column]));
            });
        });
        return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
    }

    /** Escapes what Markdown would otherwise read as formatting. */
    const md = (value) => String(value == null ? '' : value).replace(/([\\`*_[\]<>#|])/g, '\\$1');

    /**
     * The anchors GitHub-flavoured renderers give headings, in document order:
     * lower-cased, punctuation dropped, spaces as hyphens, and a repeat numbered
     * -1, -2…. Every heading has to pass through, the repeated "Highlights"
     * and "Notes" included, or a later book's number comes out wrong.
     */
    function slugger() {
        const used = new Map();
        return (heading) => {
            const base = heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
            const seen = used.get(base) || 0;
            used.set(base, seen + 1);
            return seen ? `${base}-${seen}` : base;
        };
    }

    /** The first dozen words of a passage, to say which one a note is on. */
    function excerpt(text) {
        const words = text.split(' ');
        return words.length > 12 ? `${words.slice(0, 12).join(' ')}…` : text;
    }

    const plural = (count, word) =>
        `${String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${word}${count === 1 ? '' : 's'}`;

    /**
     * Books as Markdown, to read. A contents list, then a section per book:
     * its people, its Amazon page and its counts, then **Highlights**, each a
     * quotation with its place, and **Notes**, each with its place and — when
     * notes are attached — the start of the passage it was written on.
     */
    function writeMarkdown(books, options = {}, now = new Date()) {
        const tidied = bookList(books).map((book) => {
            const tidy = tidyBook(book, options);
            const highlights = tidy.records.filter((record) => record.kind === 'Highlight');
            // In reading order: a note on a highlight, or one standing alone.
            const notes = [];
            tidy.records.forEach((record) => {
                if (record.kind === 'Note') notes.push({ text: record.text, place: placeOf(record), on: '' });
                else if (record.note) notes.push({ text: record.note, place: placeOf(record), on: record.text });
            });
            return { ...tidy, highlights, notes };
        });

        const slug = slugger();
        slug('highlights');
        slug('Contents');
        const anchors = tidied.map((book) => {
            const anchor = slug(book.title);
            if (book.highlights.length) slug('Highlights');
            if (book.notes.length) slug('Notes');
            return anchor;
        });

        const totalHighlights = tidied.reduce((sum, book) => sum + book.highlights.length, 0);
        const totalNotes = tidied.reduce((sum, book) => sum + book.notes.length, 0);
        const out = [
            '# highlights',
            '',
            `Exported ${localDay(now)} from the notebook: ${plural(tidied.length, 'book')}, ` +
                `${plural(totalHighlights, 'highlight')}, ${plural(totalNotes, 'note')}.`,
            '',
            '## Contents',
            '',
            ...tidied.map((book, index) =>
                `- [${md(book.title)}](#${anchors[index]})${byline(book) ? ` — ${md(byline(book))}` : ''}`),
        ];

        tidied.forEach((book) => {
            const counts = [];
            if (book.highlights.length) counts.push(plural(book.highlights.length, 'highlight'));
            if (book.notes.length) counts.push(plural(book.notes.length, 'note'));
            out.push('', '---', '', `## ${md(book.title)}`, '');
            if (byline(book)) out.push(`*by ${md(byline(book))}*  `);
            out.push(`${counts.join(' · ')} · [Amazon](${book.link}) · ASIN ${md(book.asin)}`);

            if (book.highlights.length) {
                out.push('', '### Highlights');
                book.highlights.forEach((record) => {
                    const place = placeOf(record);
                    out.push('', `> ${md(record.text)}`);
                    if (place) out.push('>', `> — *${md(place)}*`);
                });
            }
            if (book.notes.length) {
                out.push('', '### Notes', '');
                book.notes.forEach((note) => {
                    const line = `- ${note.place ? `**${md(note.place)}** — ` : ''}${md(note.text)}`;
                    out.push(note.on ? `${line}  ` : line);
                    if (note.on) out.push(`  *on “${md(excerpt(note.on))}”*`);
                });
            }
        });
        return `${out.join('\n')}\n`;
    }

    // ------------------------------------------------------------------- zip

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    /**
     * A zip of text files, stored without compression.
     *
     * Written here rather than taken from a library because an extension may not
     * load code from elsewhere, and a few hundred small HTML files gain little
     * from deflate. Names are flagged UTF-8 (bit 11), so a title in any script
     * unzips as itself. No ZIP64: fine below 65,535 files and 4 GB.
     */
    function writeZip(files, now = new Date()) {
        const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const locals = [];
        const centrals = [];
        let offset = 0;

        files.forEach((file) => {
            const name = utf8(file.name);
            const data = typeof file.data === 'string' ? utf8(file.data) : file.data;
            const crc = crc32(data);

            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true);
            local.setUint16(8, 0, true);
            local.setUint16(10, time, true);
            local.setUint16(12, date, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true);
            local.setUint32(22, data.length, true);
            local.setUint16(26, name.length, true);
            local.setUint16(28, 0, true);
            locals.push(new Uint8Array(local.buffer), name, data);

            const central = new DataView(new ArrayBuffer(46));
            central.setUint32(0, 0x02014b50, true);
            central.setUint16(4, 20, true);
            central.setUint16(6, 20, true);
            central.setUint16(8, 0x0800, true);
            central.setUint16(10, 0, true);
            central.setUint16(12, time, true);
            central.setUint16(14, date, true);
            central.setUint32(16, crc, true);
            central.setUint32(20, data.length, true);
            central.setUint32(24, data.length, true);
            central.setUint16(28, name.length, true);
            central.setUint32(42, offset, true);
            centrals.push(new Uint8Array(central.buffer), name);

            offset += 30 + name.length + data.length;
        });

        const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);

        const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
        const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        parts.forEach((part) => {
            out.set(part, at);
            at += part.length;
        });
        return out;
    }

    // ------------------------------------------------------------------- UI

    const PANEL_CSS = `
        #legium-export-panel {
            position: fixed; top: 16px; right: 16px; z-index: 2147483647;
            width: 320px; max-height: calc(100vh - 32px); overflow-y: auto;
            padding: 14px 16px; border-radius: 10px; box-sizing: border-box;
            background: #fff; color: #111; border: 1px solid #d5d9d9;
            box-shadow: 0 4px 16px rgba(0,0,0,.18);
            font: 13px/1.45 "Amazon Ember", Arial, sans-serif;
        }
        #legium-export-panel[hidden], #legium-export-panel [hidden] { display: none; }
        #legium-export-panel h4 { margin: 0 0 8px; padding-right: 28px; font-size: 14px; }
        #legium-export-panel .legium-export-button {
            width: 100%; padding: 8px 10px; margin-top: 10px; cursor: pointer;
            border-radius: 8px; border: 1px solid #adb1b8; background: #f7fafa;
            font: inherit; font-weight: 600;
        }
        #legium-export-panel .legium-export-button:disabled { opacity: .55; cursor: default; }
        #legium-export-close {
            position: absolute; top: 8px; right: 8px; width: 28px; height: 28px;
            border: 0; background: none; cursor: pointer; font-size: 18px; color: #555;
        }
        #legium-export-panel fieldset { border: 0; margin: 8px 0 0; padding: 0; }
        #legium-export-panel legend { padding: 0; font-size: 12px; font-weight: 600; }
        #legium-export-panel label { display: block; margin-top: 6px; font-size: 12px; }
        #legium-export-panel .legium-export-detail {
            display: block; margin: 1px 0 0 20px; font-size: 11px; color: #555;
        }
        #legium-export-tidy {
            margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #f3f5f5;
        }
        /* Floated so the heading sits inside the shaded box, not on its edge. */
        #legium-export-tidy legend { float: left; width: 100%; margin-bottom: 2px; }
        #legium-export-tidy legend + .legium-export-detail { clear: both; margin-left: 0; }
        #legium-export-done { margin-top: 10px; font-weight: 600; overflow-wrap: anywhere; }
        #legium-export-log {
            margin-top: 10px; max-height: 190px; overflow-y: auto;
            font-size: 11.5px; color: #444; white-space: pre-wrap;
            border-top: 1px solid #eee; padding-top: 8px;
        }
        #legium-export-log:empty { display: none; }
        #legium-export-log .bad { color: #b12704; }
    `;

    /**
     * The ways to save. `tidy` marks the three the switches apply to; the
     * Legium file always has them all, and the notebook files are the reading
     * app's format, which has no room for them.
     */
    const OUTPUTS = [
        {
            value: 'archive',
            label: 'One file for Legium (.json)',
            detail: 'Every book at once. In Legium: Settings → Archive → Import archive…. ' +
                'Safe to import again later; adds only what is new.',
            extension: 'json', type: 'application/json', name: 'highlights-legium',
        },
        {
            value: 'plain',
            label: 'Plain JSON (.json)',
            detail: 'Every book at once, for other apps or your own scripts. Legium does not import this one.',
            extension: 'json', type: 'application/json', name: 'highlights', tidy: true,
        },
        {
            value: 'csv',
            label: 'Spreadsheet (.csv)',
            detail: 'One row per highlight or note. Opens in Excel, Numbers or Google Sheets.',
            extension: 'csv', type: 'text/csv', name: 'highlights', tidy: true,
        },
        {
            value: 'markdown',
            label: 'Document to read (.md)',
            detail: 'A contents list, then a section per book with its highlights and its notes.',
            extension: 'md', type: 'text/markdown', name: 'highlights', tidy: true,
        },
        {
            value: 'notebooks',
            label: 'notebook files (.zip)',
            detail: 'One .zip holding an .html file per book, as the reading app exports them. ' +
                'Import a book at a time with Settings → Import → Import highlights…; ' +
                'use it for books Legium already has, which it adds to rather than copying.',
            extension: 'zip', type: 'application/zip', name: 'notebooks',
        },
    ];

    /** An element with properties set and children appended. */
    function el(tag, properties = {}, ...children) {
        const node = Object.assign(document.createElement(tag), properties);
        children.forEach((child) => node.append(child));
        return node;
    }

    /** A labelled radio or checkbox with a line of explanation beneath. */
    function choice(type, name, value, label, detail, checked) {
        return el('label', {},
            el('input', { type, name, value, checked }),
            ` ${label}`,
            el('span', { className: 'legium-export-detail', textContent: detail }));
    }

    function withRole(node, role) {
        node.setAttribute('role', role);
        return node;
    }

    // Built from elements rather than an HTML string, so nothing on the page is
    // ever parsed as markup in this context.
    function buildPanel(canAsk) {
        const close = el('button', { id: 'legium-export-close', type: 'button', textContent: '×' });
        close.setAttribute('aria-label', 'Close');

        const tidy = el('fieldset', { id: 'legium-export-tidy', hidden: true },
            el('legend', { textContent: 'Tidy up' }),
            el('span', {
                className: 'legium-export-detail',
                textContent: 'For JSON, CSV and Markdown: each does what the Legium file always does. ' +
                    'Turn them all off for the notebook page exactly as read.',
            }),
            ...TIDY.map((option) => choice('checkbox', 'legium-export-tidy', option.key, option.label, option.detail, true)));

        const ask = el('fieldset', { hidden: !canAsk },
            choice('checkbox', 'legium-export-ask', 'ask', 'Ask where to save',
                'Choose the file name and folder. Otherwise it goes to your downloads folder.', false));

        const panel = el('div', { id: 'legium-export-panel' },
            el('style', { textContent: PANEL_CSS }),
            el('h4', { textContent: 'Export highlights for Legium' }),
            close,
            withRole(el('div', { id: 'legium-export-count', textContent: 'Reading your library…' }), 'status'),
            el('fieldset', {},
                el('legend', { textContent: 'Save as' }),
                ...OUTPUTS.map((output, index) =>
                    choice('radio', 'legium-export-as', output.value, output.label, output.detail, index === 0))),
            tidy,
            ask,
            el('button', {
                id: 'legium-export-run', className: 'legium-export-button', type: 'button', textContent: 'Export all books',
            }),
            withRole(el('div', { id: 'legium-export-done' }), 'status'),
            el('button', {
                id: 'legium-export-retry', className: 'legium-export-button', type: 'button',
                textContent: 'Save again', hidden: true,
            }),
            el('div', { id: 'legium-export-log' }));
        document.body.appendChild(panel);

        // The switches only apply to some outputs, so they show only for those.
        const outputOf = () => OUTPUTS.find((output) =>
            output.value === panel.querySelector('input[name="legium-export-as"]:checked').value);
        panel.querySelectorAll('input[name="legium-export-as"]').forEach((radio) =>
            radio.addEventListener('change', () => { tidy.hidden = !outputOf().tidy; }));

        return { panel, outputOf };
    }

    function makeLogger(node) {
        return (message, bad) => {
            const line = document.createElement('div');
            if (bad) line.className = 'bad';
            line.textContent = message;
            node.appendChild(line);
            node.scrollTop = node.scrollHeight;
        };
    }

    const reason = (error) => (error && error.message ? error.message : String(error));

    async function run(ui, log, host) {
        const { panel, outputOf } = ui;
        const button = panel.querySelector('#legium-export-run');
        const retry = panel.querySelector('#legium-export-retry');
        const count = panel.querySelector('#legium-export-count');
        const done = panel.querySelector('#legium-export-done');
        const output = outputOf();
        const options = {};
        panel.querySelectorAll('input[name="legium-export-tidy"]').forEach((box) => {
            options[box.value] = box.checked;
        });
        const ask = host.canAsk && panel.querySelector('input[name="legium-export-ask"]').checked;
        const file = { filename: `${output.name}-${localDay()}.${output.extension}`, type: output.type, ask };

        button.disabled = true;
        retry.hidden = true;
        done.textContent = '';

        const library = readLibrary();
        if (!library.length) {
            log('No books found. Is the library rail on the left loaded?', true);
            button.disabled = false;
            return;
        }

        // Where a host can only ask straight after a click, it asks now,
        // before a few minutes of fetching rather than after.
        if (ask && host.choose) {
            try {
                file.target = await host.choose(file);
            } catch (error) {
                done.textContent = 'Not started: no place to save was chosen.';
                button.disabled = false;
                return;
            }
        }

        const books = [];
        let highlights = 0;
        let failed = 0;

        for (let index = 0; index < library.length; index += 1) {
            const entry = library[index];
            const label = entry.title || entry.asin;
            count.textContent = `Exporting book ${index + 1} of ${library.length}…`;
            log(`${index + 1}/${library.length}  ${label}`);

            let book;
            try {
                book = await fetchBook(entry);
            } catch (error) {
                failed += 1;
                log(`   failed: ${reason(error)}`, true);
                await sleep(CONFIG.fetchDelayMs);
                continue;
            }

            if (!book.records.length) {
                log('   no highlights, skipped');
            } else {
                books.push(book);
                highlights += book.records.length;
                log(`   ${book.records.length} annotations`);
            }
            await sleep(CONFIG.fetchDelayMs);
        }

        const failures = failed ? ` ${failed} book(s) failed; see the list below, and export again to retry them.` : '';
        count.textContent = `${library.length} book(s) on your shelf.`;
        log(`Done. ${books.length} book(s), ${highlights} annotations${failed ? `, ${failed} failed` : ''}.`);

        if (!books.length) {
            done.textContent = `No highlights found.${failures}`;
            button.disabled = false;
            return;
        }

        let summary;
        let next = '';
        if (output.value === 'archive') {
            const archive = writeArchive(books);
            file.data = JSON.stringify(archive, null, 2);
            summary = `${archive.sources.length} book(s), ${archive.entries.length} passages`;
            next = ' In Legium, open Settings → Archive → Import archive… and choose this file.';
        } else if (output.value === 'plain') {
            file.data = JSON.stringify(writePlain(books, library.length, options), null, 2);
        } else if (output.value === 'csv') {
            file.data = writeCsv(books, options);
        } else if (output.value === 'markdown') {
            file.data = writeMarkdown(books, options);
        } else {
            const used = new Set();
            file.data = writeZip(books.map((book) => {
                let name = `${safeFilename(book.author ? `${book.title} - ${book.author}` : book.title || book.asin)}.html`;
                if (used.has(name)) name = `${name.slice(0, -5)} (${book.asin}).html`;
                used.add(name);
                return { name, data: writeNotebook(book) };
            }));
            next = ' Unzip it, then in Legium import each file with Settings → Import → Import highlights….';
        }
        summary = summary || `${books.length} book(s), ${highlights} annotations`;

        // Kept until it is saved: a cancelled Save dialog costs a click, not
        // the whole export again.
        const attempt = async () => {
            retry.hidden = true;
            try {
                const result = await host.save(file);
                const where = (result && result.savedAs) || file.filename;
                done.textContent = `Saved ${where}: ${summary}.${next}${failures}`;
            } catch (error) {
                done.textContent = `Not saved: ${reason(error)}.`;
                retry.hidden = false;
            }
        };
        retry.onclick = attempt;
        await attempt();
        button.disabled = false;
    }

    /**
     * Puts the panel on the page and wires it to the host:
     *
     * - `save(file)` saves `{ filename, type, data, ask, target }` and may
     *   resolve to `{ savedAs }`, the path it went to;
     * - `canAsk`, whether the host can let the reader choose where it goes;
     * - `choose(file)`, optional, for a host that must ask at the click: it
     *   resolves to a `target` handed back to `save`.
     *
     * Returns `show`, which brings the panel back after it was closed.
     */
    function start(host) {
        const ui = buildPanel(Boolean(host.canAsk));
        const { panel } = ui;
        const log = makeLogger(panel.querySelector('#legium-export-log'));
        const count = panel.querySelector('#legium-export-count');
        const button = panel.querySelector('#legium-export-run');

        // Kept ticking rather than stopping at the first non-zero read: the rail
        // renders server-side and arrives complete, but a shelf still streaming
        // in would otherwise leave a stale, too-small number on display right
        // where it would be believed.
        const settle = setInterval(() => {
            const found = readLibrary().length;
            count.textContent = found
                ? `${found} book(s) on your shelf.`
                : 'Reading your library…';
        }, 500);
        setTimeout(() => clearInterval(settle), 20000);

        button.addEventListener('click', () => {
            clearInterval(settle);
            run(ui, log, host).catch((error) => {
                log(`Stopped: ${reason(error)}`, true);
                button.disabled = false;
            });
        });
        // Hides the panel. An export already running carries on and still saves
        // its file.
        panel.querySelector('#legium-export-close').addEventListener('click', () => {
            panel.hidden = true;
        });

        return {
            show() {
                panel.hidden = false;
                button.focus();
            },
        };
    }

    // Exposed for two reasons: checking a selector from the console when Amazon
    // redesigns the page, and letting the emitter be tested off-browser against
    // Legium's own parser. `start` is what needs a page; nothing else here does.
    globalThis.legiumExport = {
        start,
        readLibrary, fetchBook, fetchDocument, readAnnotations,
        readPlace, readColour, annotationsRoot, writeNotebook, writeRecord, safeFilename, esc,
        writeArchive, writePlain, writeCsv, writeMarkdown, tidyBook, slugger, writeZip,
        passages, matchKey, splitAuthors, uuid5, sha1, crc32,
        SELECTORS, CONFIG, ALL_TIDY,
    };
})();
