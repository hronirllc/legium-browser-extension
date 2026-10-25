#!/usr/bin/env python3
"""
Checks the userscript's own archive writer against `build_archive.py`.

The userscript builds the Legium archive in the browser; `build_archive.py`
builds it from a saved scrape. They must agree on everything except the two
things the userscript changes on purpose — a passage's uuid comes from its text
rather than its position, and `updatedAt` is fixed — so this runs the userscript
under `jsc` on an invented shelf and compares the two field by field.

    python3 tools/test_archive.py
"""

import hashlib, json, os, subprocess, sys, tempfile, unittest, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "legium.user.js")
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
            f"print(JSON.stringify(X.writePlain({json.dumps(SHELF['books'])}, 5, new Date({json.dumps(STAMP)}))));"
        )
        self.assertEqual(plain["books"][0]["records"], SHELF["books"][0]["records"])
        rebuilt = py_archive(plain)
        self.assertEqual(rebuilt["sources"], self.py["sources"])
        self.assertEqual(len(rebuilt["entries"]), len(self.py["entries"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
