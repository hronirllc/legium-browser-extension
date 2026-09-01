#!/usr/bin/env python3
"""Exercises compare.py against the disagreements that actually occur."""
import json, subprocess, sys, tempfile, os, uuid

HERE = os.path.dirname(os.path.abspath(__file__))

def u(n): return str(uuid.UUID(int=n))

# An archive with an anthology (container + piece) and a plain book.
archive = {
    "format": "legium.archive", "version": 1, "exportedAt": "2026-08-31T00:00:00Z",
    "contributors": [{"uuid": u(1), "name": "Ada Marsh", "sortName": "Marsh, Ada", "createdAt": "2026-01-01T00:00:00Z"}],
    "tags": [],
    "sources": [
        {"uuid": u(10), "title": "Harbour Lights: A Critical Edition", "kind": "book", "createdAt": "2026-01-01T00:00:00Z",
         "contributions": [{"contributorUUID": u(1), "role": "author", "position": 0}]},
        # a piece filed inside the anthology — must roll up into its container
        {"uuid": u(11), "title": "An Essay on the Harbour", "kind": "essay", "containerUUID": u(10),
         "createdAt": "2026-01-01T00:00:00Z", "contributions": []},
        {"uuid": u(20), "title": "A Book The Web Has Never Heard Of", "kind": "book",
         "createdAt": "2026-01-01T00:00:00Z", "contributions": []},
    ],
    "entries": [
        # identical on both sides
        {"uuid": u(100), "text": "The first line.", "note": "", "locator": "p. 1", "sourceUUID": u(10),
         "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        # differs only by folding — Legium would call these the same passage
        {"uuid": u(101), "text": "The  ship   sailed", "note": "", "locator": "p. 2", "sourceUUID": u(10),
         "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        # the app bled in preceding text: real drift
        {"uuid": u(102), "text": "underneath-“ The Harbour Inn:—Open Late.”", "note": "", "locator": "p. 3",
         "sourceUUID": u(10), "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        # a highlight carrying a note, which the web reports as two records
        {"uuid": u(103), "text": "A passage that was annotated.", "note": "A note on it.", "locator": "p. 53", "sourceUUID": u(10),
         "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        # lives on the piece, must still be found under the container
        {"uuid": u(104), "text": "A passage inside the anthology piece.", "note": "", "locator": "p. 504",
         "sourceUUID": u(11), "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        # a bookmark-ish app-only passage the web never lists
        {"uuid": u(105), "text": "Only the app knows this one.", "note": "", "locator": "p. 9", "sourceUUID": u(10),
         "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
        {"uuid": u(106), "text": "Nothing on the web matches this book at all.", "note": "", "locator": "p. 1",
         "sourceUUID": u(20), "isFavorite": False, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "tagUUIDs": [], "attachments": []},
    ],
}

web = {"books": [{
    "asin": "B000TEST", "title": "Harbour Lights: A Critical Edition (Third Edition)",
    "author": "Ada Marsh and Ben Ellery", "pages": 1,
    "records": [
        {"kind": "Highlight", "text": "The first line.", "colour": "yellow", "page": "1", "location": "10"},
        {"kind": "Highlight", "text": "The ship sailed", "colour": "yellow", "page": "2", "location": "20"},
        {"kind": "Highlight", "text": "“The Harbour Inn:—Open Late.”", "colour": "yellow", "page": "3", "location": "30"},
        {"kind": "Highlight", "text": "A passage that was annotated.", "colour": "yellow", "page": "53", "location": "1089"},
        {"kind": "Note", "text": "A note on it.", "colour": "", "page": "53", "location": "1089"},
        {"kind": "Highlight", "text": "A passage inside the anthology piece.", "colour": "yellow", "page": "504", "location": "13949"},
        {"kind": "Highlight", "text": "A web-only passage the app never had.", "colour": "aqua", "page": "77", "location": "7700"},
    ],
}]}

with tempfile.TemporaryDirectory() as d:
    ap, wp = os.path.join(d, "a.json"), os.path.join(d, "w.json")
    json.dump(archive, open(ap, "w")); json.dump(web, open(wp, "w"))
    out = subprocess.run([sys.executable, os.path.join(HERE, "compare.py"), ap, wp],
                         capture_output=True, text=True)
    print(out.stdout, out.stderr)

    checks = [
        ("whitespace-only difference forgiven", "same=  4" in out.stdout or "same=4" in out.stdout.replace("  ", " ")),
        ("anthology piece rolled into its container", "A passage inside the anthology piece" not in out.stdout.split("absent from the web")[-1]),
        ("note paired onto its highlight", "'A note on it.'" not in out.stdout),
        ("real drift reported", "drift=1" in out.stdout),
        ("app-only passage reported", "Only the app knows this one" in out.stdout),
        ("web-only counted, not fatal", "web-only=1" in out.stdout),
        ("book absent from web named", "A Book The Web Has Never Heard Of" in out.stdout),
    ]
    bad = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(("  PASS  " if ok else "  FAIL  ") + n)
    sys.exit(1 if bad else 0)
