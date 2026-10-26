#!/usr/bin/env python3
"""
Builds a `legium.archive` JSON from the scraped web export.

One file instead of 245 imports. The archive path matches sources by uuid and
never by title, and unlike the notebook-HTML path it does no text-level
de-duplication — so this must only ever be handed books Legium does not already
hold, which is what `compare.py --emit-new` decides.

Everything below mirrors what the notebook-HTML import would have produced from
the same records, so a book brought in this way is indistinguishable from one
imported the ordinary way: the same locator spelling, the same folding of a note
onto its passage, the same `import.notebook-html` origin, and a note made
without a highlight kept as a note with no passage.

UUIDs are derived from the ASIN rather than random, so regenerating this file
produces byte-identical ids and a second import updates nothing instead of
duplicating everything.
"""

import argparse, hashlib, json, re, unicodedata, uuid

NAMESPACE = uuid.UUID("6f9e5b3a-2c41-4d8e-9a17-5b0c8e2d4f36")
# Named for the format the records were read from, following EntryOrigin's own
# rule that a case names a format rather than the app that emitted it. These came
# off the notebook *web page*, which is a thinner thing than the notebook export
# an e-reader writes — no chapters, no bookmarks — so it earns its own lane.
#
# Legium has no matching case, and does not need one: originRaw is plain text and
# "everything imported" is answered by the `import.` prefix, which is exactly the
# unknown-lane case that design anticipates.
ORIGIN = "import.notebook-web"
NOTE_ANCHOR_SPAN = 10   # HighlightImport.noteAnchorSpan


def det(*parts):
    return str(uuid.uuid5(NAMESPACE, "\x1f".join(str(p) for p in parts))).upper()


def fold(value):
    d = unicodedata.normalize("NFD", value or "")
    return " ".join("".join(c for c in d if unicodedata.category(c) != "Mn").casefold().split())


def match_key(text, note):
    """HighlightImport.matchKey — what counts as the same passage."""
    return fold(text) + "\x1f" + fold(note)


NAME_SUFFIX = re.compile(r"^(jr|sr|ii|iii|iv|phd|md)\.?$", re.I)


def author_display(name):
    """ImportedBook.authorDisplayName — a single comma means 'Surname, Given',
    unless what follows it is a suffix ("Martin Luther King, Jr.")."""
    t = (name or "").strip()
    parts = [p.strip() for p in t.split(",")]
    if len(parts) == 2 and parts[0] and parts[1] and not NAME_SUFFIX.match(parts[1]):
        return f"{parts[1]} {parts[0]}"
    return t


def split_authors(line):
    """The people in one rail author line, in order — the userscript's
    splitAuthors. "A and B" and "A, B, and C" are lists; credited whole, the
    line became one person named all of them. A semicolon marks Amazon's own
    scrambled metadata, kept exactly as found."""
    text = " ".join((line or "").split())
    if not text:
        return []
    is_list = re.search(r" and | & ", text) or text.count(",") >= 2
    if ";" in text:
        return [text]
    if not is_list:
        return [author_display(text)]
    names = []
    for part in re.split(r",| and | & ", text):
        part = re.sub(r"^(and|&) ", "", part.strip())
        if not part:
            continue
        if NAME_SUFFIX.match(part) and names:
            names[-1] += f", {part}"
        else:
            names.append(part)
    return names


def locator(page, location):
    """HighlightImport.locator — a page when the book has one, else a location."""
    if page:
        return f"p. {page}"
    if location:
        return f"loc. {location}"
    return None


def passages(records):
    """Records as Legium would file them: notes folded onto the passage they annotate."""
    out = []
    for r in records:
        if r["kind"] == "Highlight":
            # A tidied plain JSON may already carry the note on its highlight.
            out.append({"text": r["text"], "note": r.get("note", ""), "page": r.get("page", ""),
                        "location": r.get("location", "")})
            continue
        # A note lands on the passage just above when it sits within the span the
        # parser allows; otherwise it is a note the reader made on its own.
        here = int(r["location"]) if (r.get("location") or "").isdigit() else None
        placed = False
        if out and out[-1]["text"] and not out[-1]["note"] and here is not None:
            anchor = int(out[-1]["location"]) if out[-1]["location"].isdigit() else None
            if anchor is not None and anchor <= here <= anchor + NOTE_ANCHOR_SPAN:
                out[-1]["note"] = r["text"]
                placed = True
        if not placed:
            out.append({"text": "", "note": r["text"], "page": r.get("page", ""),
                        "location": r.get("location", "")})
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("web_json")
    p.add_argument("out_json")
    p.add_argument("--only", help="file of ASINs to include, one per line")
    args = p.parse_args()

    data = json.load(open(args.web_json, encoding="utf-8"))
    stamp = data.get("scrapedAt", "").replace(".000Z", "Z")
    if "." in stamp:                       # Legium decodes plain ISO8601, no fractions
        stamp = stamp.split(".")[0] + "Z"

    allow = None
    if args.only:
        allow = {l.strip() for l in open(args.only) if l.strip()}

    sources, contributors, entries = [], [], []
    seen_people = {}
    books = skipped = 0

    # The library rail lists some books twice; the scrape faithfully records the
    # repeat, and two sources sharing an ASIN would derive the same uuid.
    seen_asins = set()
    for b in data["books"]:
        if allow is not None and b["asin"] not in allow:
            continue
        if b["asin"] in seen_asins:
            continue
        seen_asins.add(b["asin"])
        recs = passages(b.get("records", []))
        recs = [r for r in recs if r["text"] or r["note"]]
        if not recs:
            skipped += 1
            continue

        src_uuid = det("source", b["asin"])
        contributions = []
        for position, name in enumerate(split_authors(b.get("author", ""))):
            if name not in seen_people:
                cid = det("contributor", name)
                seen_people[name] = cid
                contributors.append({
                    "uuid": cid, "name": name,
                    # Left blank so Legium derives its own sort name, rather than
                    # this file asserting one for a person it may already know.
                    "sortName": "", "createdAt": stamp,
                })
            contributions.append({
                "contributorUUID": seen_people[name],
                "role": "author", "position": position, "marcCode": "aut",
            })

        sources.append({
            "uuid": src_uuid, "title": b["title"], "kind": "book",
            "createdAt": stamp, "tagUUIDs": [], "contributions": contributions,
        })

        # Same passage twice in one book is one passage, as the ordinary import
        # would decide via `admit`.
        held = set()
        for i, r in enumerate(recs):
            key = match_key(r["text"], r["note"])
            if key in held:
                continue
            held.add(key)
            entries.append({
                "uuid": det("entry", b["asin"], i, hashlib.sha1(
                    (r["text"] + "\x1f" + r["note"]).encode()).hexdigest()),
                "text": r["text"], "note": r["note"],
                "locator": locator(r["page"], r["location"]),
                "isFavorite": False, "createdAt": stamp, "updatedAt": stamp,
                "sourceUUID": src_uuid, "tagUUIDs": [], "attachments": [],
                "origin": ORIGIN,
            })
        books += 1

    archive = {
        "format": "legium.archive", "version": 1, "exportedAt": stamp,
        "sources": sources, "contributors": contributors, "tags": [], "entries": entries,
    }
    with open(args.out_json, "w", encoding="utf-8") as fh:
        json.dump(archive, fh, ensure_ascii=False, indent=2, sort_keys=True)

    with_note = sum(1 for e in entries if e["note"] and e["text"])
    note_only = sum(1 for e in entries if not e["text"])
    print(json.dumps({
        "books": books, "skippedEmpty": skipped, "sources": len(sources),
        "contributors": len(contributors), "entries": len(entries),
        "passagesWithNote": with_note, "notesWithoutPassage": note_only,
    }, indent=1))


if __name__ == "__main__":
    main()
