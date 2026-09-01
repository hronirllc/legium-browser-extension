// ==UserScript==
// @name         Highlights → Legium notebook export
// @namespace    dev.hronir.legium
// @version      1.0.0
// @description  Exports every book's highlights from the notebook page as the same per-book HTML that the reading app's own "Export notebook" produces, so Legium's NotebookExportParser can read them unchanged.
// @author       Hronir LLC
// @match        https://read.amazon.com/notebook*
// @match        https://read.amazon.co.uk/notebook*
// @match        https://read.amazon.co.jp/notebook*
// @match        https://read.amazon.de/notebook*
// @match        https://read.amazon.fr/notebook*
// @match        https://read.amazon.es/notebook*
// @match        https://read.amazon.it/notebook*
// @match        https://read.amazon.ca/notebook*
// @match        https://read.amazon.com.au/notebook*
// @match        https://read.amazon.in/notebook*
// @match        https://read.amazon.com.br/notebook*
// @match        https://read.amazon.com.mx/notebook*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

//
// What this produces
// -----------------
// One HTML file per book, byte-shaped like the reading app's own notebook export:
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
        /** Pause between individual file downloads, when not zipping. */
        downloadDelayMs: 250,
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

    /** Fetches one notebook page and hands back a parsed document. */
    async function fetchDocument(url) {
        let lastError;
        for (let attempt = 0; attempt <= CONFIG.retries; attempt += 1) {
            try {
                const response = await fetch(url, {
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

    /** Every book on the shelf, from the library rail on the left. */
    function readLibrary() {
        return Array.from(document.querySelectorAll(SELECTORS.libraryBook))
            .map((row) => ({
                asin: row.id || '',
                title: textOf(firstMatch(row, SELECTORS.bookTitle)),
                author: textOf(firstMatch(row, SELECTORS.bookAuthor)),
            }))
            .filter((book) => book.asin);
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

    /** The highlight colour, from the class the pane paints the box with. */
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
            title: book.title,
            author: book.author.replace(/^By:\s*/i, ''),
            citation: '',
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

    // ------------------------------------------------------------ delivering

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // ------------------------------------------------------------------- UI

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'legium-export-panel';
        panel.innerHTML = `
            <style>
                #legium-export-panel {
                    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
                    width: 300px; padding: 14px 16px; border-radius: 10px;
                    background: #fff; color: #111; border: 1px solid #d5d9d9;
                    box-shadow: 0 4px 16px rgba(0,0,0,.18);
                    font: 13px/1.45 "Amazon Ember", Arial, sans-serif;
                }
                #legium-export-panel h4 { margin: 0 0 8px; font-size: 14px; }
                #legium-export-panel button {
                    width: 100%; padding: 8px 10px; margin-top: 8px; cursor: pointer;
                    border-radius: 8px; border: 1px solid #adb1b8; background: #f7fafa;
                    font: inherit; font-weight: 600;
                }
                #legium-export-panel button:disabled { opacity: .55; cursor: default; }
                #legium-export-panel label { display: block; margin-top: 8px; font-size: 12px; }
                #legium-export-log {
                    margin-top: 10px; max-height: 190px; overflow-y: auto;
                    font-size: 11.5px; color: #444; white-space: pre-wrap;
                    border-top: 1px solid #eee; padding-top: 8px;
                }
                #legium-export-log .bad { color: #b12704; }
            </style>
            <h4>Export highlights for Legium</h4>
            <div id="legium-export-count">Reading your library…</div>
            <label><input type="checkbox" id="legium-export-zip" checked> Bundle into one .zip</label>
            <label><input type="checkbox" id="legium-export-skip" checked> Skip books with no highlights</label>
            <button id="legium-export-run">Export all books</button>
            <div id="legium-export-log"></div>
        `;
        document.body.appendChild(panel);
        return panel;
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

    async function run(panel, log) {
        const button = panel.querySelector('#legium-export-run');
        const asZip = panel.querySelector('#legium-export-zip').checked;
        const skipEmpty = panel.querySelector('#legium-export-skip').checked;
        button.disabled = true;

        const library = readLibrary();
        if (!library.length) {
            log('No books found. Is the library rail on the left loaded?', true);
            button.disabled = false;
            return;
        }

        const zip = asZip && typeof JSZip !== 'undefined' ? new JSZip() : null;
        if (asZip && !zip) log('JSZip unavailable — falling back to single files.', true);

        const used = new Set();
        let exported = 0;
        let highlights = 0;
        let failed = 0;

        for (let index = 0; index < library.length; index += 1) {
            const entry = library[index];
            const label = entry.title || entry.asin;
            log(`${index + 1}/${library.length}  ${label}`);

            let book;
            try {
                book = await fetchBook(entry);
            } catch (error) {
                failed += 1;
                log(`   failed: ${error && error.message ? error.message : error}`, true);
                await sleep(CONFIG.fetchDelayMs);
                continue;
            }

            if (skipEmpty && !book.records.length) {
                log('   no highlights, skipped');
                await sleep(CONFIG.fetchDelayMs);
                continue;
            }

            let filename = `${safeFilename(
                book.author ? `${book.title} - ${book.author}` : book.title || entry.asin
            )}.html`;
            if (used.has(filename)) filename = `${filename.slice(0, -5)} (${entry.asin}).html`;
            used.add(filename);

            const html = writeNotebook(book);
            exported += 1;
            highlights += book.records.length;
            log(`   ${book.records.length} annotations`);

            if (zip) {
                zip.file(filename, html);
            } else {
                downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
                await sleep(CONFIG.downloadDelayMs);
            }

            await sleep(CONFIG.fetchDelayMs);
        }

        if (zip && exported) {
            log('Building the zip…');
            const blob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(blob, `notebooks-${new Date().toISOString().slice(0, 10)}.zip`);
        }

        log(`Done. ${exported} book(s), ${highlights} annotations${failed ? `, ${failed} failed` : ''}.`);
        button.disabled = false;
    }

    function start() {
        const panel = buildPanel();
        const log = makeLogger(panel.querySelector('#legium-export-log'));
        const count = panel.querySelector('#legium-export-count');

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

        panel.querySelector('#legium-export-run').addEventListener('click', () => {
            run(panel, log).catch((error) => log(`Stopped: ${error}`, true));
        });

    }

    // Exposed for two reasons: checking a selector from the console when Amazon
    // redesigns the page, and letting the emitter be tested off-browser against
    // Legium's own parser. `start` is what needs a page; nothing else here does.
    globalThis.legiumExport = {
        readLibrary, fetchBook, fetchDocument, readAnnotations,
        readPlace, readColour, annotationsRoot, writeNotebook, writeRecord, safeFilename, esc,
        SELECTORS, CONFIG,
    };

    if (typeof document !== 'undefined' && document.body) start();
})();
