#!/usr/bin/env python3
"""
Checks the exporter's own writers: the archive against `build_archive.py`,
the zip against Python's `zipfile`, and that the userscript is built from the
current `extension/notebook.js`.

The userscript builds the Legium archive in the browser; `build_archive.py`
builds it from a saved scrape. They must agree on everything except the two
things the userscript changes on purpose — a passage's uuid comes from its text
rather than its position, and `updatedAt` is fixed — so this runs the userscript
under `jsc` on an invented shelf and compares the two field by field.

    python3 tools/test_archive.py
"""

import base64, csv, hashlib, io, json, os, subprocess, sys, tempfile, unittest, uuid, zipfile, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "extension", "notebook.js")
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
STAMP = "2026-10-25T12:00:00Z"

sys.path.insert(0, HERE)
import build_archive  # noqa: E402


def hl(text, location, page="", colour="yellow"):
    return {"kind": "Highlight", "text": text, "colour": colour, "page": page, "location": location}


def note(text, location, page=""):
    return {"kind": "Note", "text": text, "colour": "", "page": page, "location": location}


# Invented, like test_compare.py's fixture: no one's real highlights.
SHELF = {
    "scrapedAt": STAMP,
    "shelf": 5,
    "books": [
        {"asin": "B000TEST01", "title": "The Lantern Keeper", "author": "Okafor, Adaeze", "pages": 1,
         "records": [
             hl("The light was kept because someone kept it.", "120"),
             note("Maintenance as an act of faith.", "125"),
             hl("Tides do not ask permission.", "300", colour="blue"),
             note("Far from any highlight.", "900"),
             hl("The light was kept because someone kept it.", "1,500".replace(",", "")),
             hl("Café au lait, naïveté, and “quotes”.", "1600"),
         ]},
        {"asin": "B000TEST02", "title": "Paged Things", "author": "Ruth Ibarra and Tomas Lind", "pages": 2,
         "records": [hl("A page, not a place.", "2119", page="xi"), hl("Second page.", "2200", page="12")]},
        # The rail lists some books twice.
        {"asin": "B000TEST02", "title": "Paged Things", "author": "Ruth Ibarra and Tomas Lind", "pages": 2,
         "records": [hl("A page, not a place.", "2119", page="xi")]},
        {"asin": "B000TEST03", "title": "Nothing Marked", "author": "Okafor, Adaeze", "pages": 1, "records": []},
        {"asin": "B000TEST04", "title": "Notes Only", "author": "", "pages": 1,
         "records": [note("A thought with no passage.", "")]},
    ],
}


def run_jsc(body):
    """Loads the userscript under jsc, then runs `body`, which prints JSON."""
    with tempfile.TemporaryDirectory() as tmp:
        driver = os.path.join(tmp, "driver.js")
        with open(driver, "w", encoding="utf-8") as fh:
            fh.write(f"load({json.dumps(SCRIPT)});\nconst X = globalThis.legiumExport;\n{body}\n")
        out = subprocess.run([JSC, driver], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def js_archive(shelf):
    return run_jsc(f"print(JSON.stringify(X.writeArchive({json.dumps(shelf['books'])}, new Date({json.dumps(STAMP)}))));")


def py_archive(shelf):
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.json"), os.path.join(tmp, "out.json")
        with open(src, "w", encoding="utf-8") as fh:
            json.dump(shelf, fh)
        subprocess.run([sys.executable, os.path.join(HERE, "build_archive.py"), src, dst],
                       capture_output=True, check=True)
        with open(dst, encoding="utf-8") as fh:
            return json.load(fh)


@unittest.skipUnless(os.path.exists(JSC), "needs macOS's jsc")
class ArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = js_archive(SHELF)
        cls.py = py_archive(SHELF)

    def test_hashes_match_python(self):
        names = ["", "abc", "source\x1fB000TEST01", "Café “quoted” — 日本語", "x" * 200]
        got = run_jsc(
            f"const names = {json.dumps(names)};"
            "print(JSON.stringify(names.map(n => [Array.from(X.sha1("
            "Uint8Array.from(unescape(encodeURIComponent(n)), c => c.charCodeAt(0))),"
            " b => b.toString(16).padStart(2, '0')).join(''),"
            " X.uuid5('6f9e5b3a-2c41-4d8e-9a17-5b0c8e2d4f36', n)])));"
        )
        for name, (sha, uid) in zip(names, got):
            self.assertEqual(sha, hashlib.sha1(name.encode()).hexdigest(), name)
            self.assertEqual(uid, str(uuid.uuid5(build_archive.NAMESPACE, name)).upper(), name)

    def test_header(self):
        for key in ("format", "version", "exportedAt", "tags"):
            self.assertEqual(self.js[key], self.py[key], key)

    def test_sources_and_contributors_match(self):
        self.assertEqual(self.js["sources"], self.py["sources"])
        self.assertEqual(self.js["contributors"], self.py["contributors"])
        # Empty books are left out, duplicates kept once.
        self.assertEqual([s["title"] for s in self.js["sources"]],
                         ["The Lantern Keeper", "Paged Things", "Notes Only"])

    def test_entries_match_but_for_uuid_and_updated_at(self):
        strip = lambda es: [{k: v for k, v in e.items() if k not in ("uuid", "updatedAt")} for e in es]
        self.assertEqual(strip(self.js["entries"]), strip(self.py["entries"]))
        self.assertTrue(all(e["updatedAt"] == "1970-01-01T00:00:00Z" for e in self.js["entries"]))

    def test_folding(self):
        lantern = [e for e in self.js["entries"] if e["sourceUUID"] == self.js["sources"][0]["uuid"]]
        self.assertEqual(lantern[0]["note"], "Maintenance as an act of faith.")
        self.assertEqual([e["text"] for e in lantern if not e["text"]], [""])   # the far note stands alone
        # The repeat at 1500 stays: the first copy carries a note, and the key is
        # text and note together.
        self.assertEqual(len(lantern), 5)
        self.assertEqual(self.js["entries"][-3]["locator"], "p. xi")

    def test_uuids_survive_a_new_highlight_mid_book(self):
        later = json.loads(json.dumps(SHELF))
        later["books"][0]["records"].insert(3, hl("Added on a second read.", "500"))
        before = {e["uuid"] for e in self.js["entries"]}
        after = {e["uuid"] for e in js_archive(later)["entries"]}
        self.assertEqual(len(after - before), 1)
        self.assertEqual(before - after, set())

    def test_plain_json_feeds_build_archive(self):
        plain = run_jsc(
            f"print(JSON.stringify(X.writePlain({json.dumps(SHELF['books'])}, 5, {{}}, new Date({json.dumps(STAMP)}))));"
        )
        self.assertEqual(plain["books"][0]["records"], SHELF["books"][0]["records"])
        rebuilt = py_archive(plain)
        self.assertEqual(rebuilt["sources"], self.py["sources"])
        self.assertEqual(len(rebuilt["entries"]), len(self.py["entries"]))


    def test_zip_opens_and_holds_the_files(self):
        files = [{"name": "Plain - Author.html", "data": "<p>one</p>"},
                 {"name": "Café “Title” - 日本語.html", "data": "two ✓ " * 500}]
        got = run_jsc(
            f"const z = X.writeZip({json.dumps(files)}, new Date(2026, 9, 25, 12, 30, 10));"
            "let s = ''; z.forEach(b => s += String.fromCharCode(b));"
            "print(JSON.stringify({zip: btoa(s)}));"
        )
        archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(got["zip"])))
        self.assertIsNone(archive.testzip())
        self.assertEqual(archive.namelist(), [f["name"] for f in files])
        for f in files:
            self.assertEqual(archive.read(f["name"]).decode(), f["data"])
        self.assertEqual(archive.infolist()[0].date_time, (2026, 10, 25, 12, 30, 10))

    def test_crc32_matches_zlib(self):
        samples = ["", "a", "Café “quoted” — 日本語" * 40]
        got = run_jsc(
            f"print(JSON.stringify({json.dumps(samples)}.map(s =>"
            " X.crc32(Uint8Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0))))));"
        )
        self.assertEqual(got, [zlib.crc32(s.encode()) for s in samples])


    def test_author_lines_split_into_people(self):
        # The rail's author line, and who it names. Invented names.
        cases = {
            "Ada Marsh and Ben Ellery": ["Ada Marsh", "Ben Ellery"],
            "Ada Marsh, Ben Ellery, and Cy Dunn": ["Ada Marsh", "Ben Ellery", "Cy Dunn"],
            "Ada Marsh, Ben Ellery and Cy Dunn": ["Ada Marsh", "Ben Ellery", "Cy Dunn"],
            "Ada Marsh & Ben Ellery": ["Ada Marsh", "Ben Ellery"],
            "Okafor, Adaeze": ["Adaeze Okafor"],
            "Sam Reyes, Jr.": ["Sam Reyes, Jr."],
            "Ada Marsh, Sam Reyes, Jr., and Cy Dunn": ["Ada Marsh", "Sam Reyes, Jr.", "Cy Dunn"],
            "Lee Ortiz and Kim;Novak A Park, Jo;Reyes": ["Lee Ortiz and Kim;Novak A Park, Jo;Reyes"],
            "Andrea Anderson": ["Andrea Anderson"],
            "  Ines   Varga ": ["Ines Varga"],
            "": [],
        }
        lines = list(cases)
        js = run_jsc(f"print(JSON.stringify({json.dumps(lines)}.map(X.splitAuthors)));")
        self.assertEqual(js, [cases[l] for l in lines])
        self.assertEqual([build_archive.split_authors(l) for l in lines], [cases[l] for l in lines])

    def test_each_author_is_a_contributor_in_order(self):
        paged = next(s for s in self.js["sources"] if s["title"] == "Paged Things")
        names = {c["uuid"]: c["name"] for c in self.js["contributors"]}
        self.assertEqual([(names[c["contributorUUID"]], c["position"]) for c in paged["contributions"]],
                         [("Ruth Ibarra", 0), ("Tomas Lind", 1)])


    # ---------------------------------------------------------- readable outputs

    def plain(self, options):
        return run_jsc(f"print(JSON.stringify(X.writePlain({json.dumps(SHELF['books'])}, 5, "
                       f"{json.dumps(options)}, new Date({json.dumps(STAMP)}))));")

    def test_plain_with_every_switch_off_is_the_page_as_read(self):
        plain = self.plain({})
        self.assertEqual(plain["options"], {"splitAuthors": False, "attachNotes": False,
                                            "dropRepeats": False, "places": False})
        # The repeated ASIN and the book with nothing in it are left out.
        self.assertEqual([b["title"] for b in plain["books"]], ["The Lantern Keeper", "Paged Things", "Notes Only"])
        for got, given in zip(plain["books"], [SHELF["books"][i] for i in (0, 1, 4)]):
            self.assertEqual(got["records"], given["records"])
            self.assertNotIn("authors", got)
            self.assertEqual(got["link"], f"https://www.amazon.com/dp/{given['asin']}")

    def test_plain_with_every_switch_on(self):
        plain = self.plain({"splitAuthors": True, "attachNotes": True, "dropRepeats": True, "places": True})
        lantern, paged = plain["books"][0], plain["books"][1]
        self.assertEqual(lantern["authors"], ["Adaeze Okafor"])
        self.assertEqual(paged["authors"], ["Ruth Ibarra", "Tomas Lind"])
        first = lantern["records"][0]
        self.assertEqual((first["kind"], first["note"], first["place"]),
                         ("Highlight", "Maintenance as an act of faith.", "loc. 120"))
        self.assertEqual([r["kind"] for r in lantern["records"]],
                         ["Highlight", "Highlight", "Note", "Highlight", "Highlight"])
        self.assertEqual(paged["records"][0]["place"], "p. xi")
        # Folded notes still reach the same archive.
        strip = lambda es: [{k: v for k, v in e.items() if k != "uuid"} for e in es]
        rebuilt = py_archive(plain)
        self.assertEqual(rebuilt["sources"], self.py["sources"])
        self.assertEqual(strip(rebuilt["entries"]), strip(self.py["entries"]))

    def test_repeats_are_dropped(self):
        book = {"asin": "B9", "title": "T", "author": "", "pages": 1,
                "records": [hl("Twice over.", "10"), hl("twice  over.", "20"), hl("Once.", "30")]}
        got = run_jsc(f"print(JSON.stringify(X.tidyBook({json.dumps(book)}, {{dropRepeats: true}})));")
        self.assertEqual([r["text"] for r in got["records"]], ["Twice over.", "Once."])

    def test_csv_reads_back(self):
        out = run_jsc(f"print(JSON.stringify(X.writeCsv({json.dumps(SHELF['books'])}, X.ALL_TIDY)));")
        self.assertTrue(out.startswith("\ufeff"))
        rows = list(csv.DictReader(io.StringIO(out[1:], newline="")))
        self.assertEqual(list(rows[0]), ["title", "authors", "asin", "link", "kind", "text", "note",
                                         "colour", "page", "location", "place"])
        self.assertEqual(rows[0]["note"], "Maintenance as an act of faith.")
        self.assertIn("Café au lait, naïveté, and “quotes”.", [r["text"] for r in rows])
        self.assertEqual([r["authors"] for r in rows if r["title"] == "Paged Things"][0], "Ruth Ibarra; Tomas Lind")
        bare = run_jsc(f"print(JSON.stringify(X.writeCsv({json.dumps(SHELF['books'])}, {{}})));")
        header = next(csv.reader(io.StringIO(bare[1:])))
        self.assertNotIn("note", header)
        self.assertNotIn("place", header)

    def test_markdown_reads_as_a_document(self):
        books = json.loads(json.dumps(SHELF["books"]))
        books[0]["title"] = "The *Lantern* Keeper"
        out = run_jsc(f"print(JSON.stringify(X.writeMarkdown({json.dumps(books)}, X.ALL_TIDY, new Date({json.dumps(STAMP)}))));")
        self.assertIn("Exported 2026-10-25 from the notebook: 3 books, 6 highlights, 3 notes.", out)
        # Contents links match the anchors renderers give the headings.
        self.assertIn("- [The \\*Lantern\\* Keeper](#the-lantern-keeper) — Adaeze Okafor\n"
                      "- [Paged Things](#paged-things) — Ruth Ibarra, Tomas Lind\n"
                      "- [Notes Only](#notes-only)\n", out)
        self.assertIn("## The \\*Lantern\\* Keeper\n\n*by Adaeze Okafor*  \n4 highlights · 2 notes · "
                      "[Amazon](https://www.amazon.com/dp/B000TEST01) · ASIN B000TEST01", out)
        self.assertIn("### Highlights\n\n> The light was kept because someone kept it.\n>\n> — *loc. 120*", out)
        self.assertIn("### Notes\n\n- **loc. 120** — Maintenance as an act of faith.  \n"
                      "  *on “The light was kept because someone kept it.”*\n"
                      "- **loc. 900** — Far from any highlight.", out)
        self.assertIn("## Notes Only\n\n1 note · [Amazon]", out)
        self.assertNotIn("Nothing Marked", out)
        raw = run_jsc(f"print(JSON.stringify(X.writeMarkdown({json.dumps(books)}, {{}}, new Date({json.dumps(STAMP)}))));")
        self.assertIn("> — *Location 120*", raw)
        self.assertIn("- **Location 125** — Maintenance as an act of faith.\n", raw)

    def test_heading_anchors_count_repeats(self):
        got = run_jsc("const s = X.slugger(); print(JSON.stringify(['Notes', 'Café & Crème: A Life!', 'Notes', 'notes'].map(s)));")
        self.assertEqual(got, ["notes", "café--crème-a-life", "notes-1", "notes-2"])


class UserscriptTests(unittest.TestCase):
    def test_userscript_is_built_from_the_current_core(self):
        subprocess.run([sys.executable, os.path.join(HERE, "build_userscript.py"), "--check"],
                       capture_output=True, check=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
