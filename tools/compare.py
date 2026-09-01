#!/usr/bin/env python3
"""
Checks a web-scraped export against Legium's own archive.

The archive is the better record — it came from the reading app, which knows the
book's table of contents — so where both hold a book the archive wins. This does
not merge; it reports whether the web export *agrees*, which is the question that
decides whether the web copy can be trusted for the books the archive lacks.

Passages are compared on Legium's own match key (HighlightImport.matchKey):
diacritic- and case-folded, whitespace collapsed. Using anything stricter would
report differences the app itself would forgive; anything looser would hide the
duplicates a mixed import actually creates.
"""

import argparse, json, re, sys, unicodedata
from collections import defaultdict
from difflib import SequenceMatcher


def fold(value):
    """Legium's fold: diacritic- and case-insensitive, whitespace collapsed."""
    decomposed = unicodedata.normalize("NFD", value or "")
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return " ".join(stripped.casefold().split())


def match_key(text, note=""):
    return fold(text) + "\x1f" + fold(note)


def title_key(title):
    """Loose enough to survive an edition's parenthetical, tight enough to be a title."""
    t = fold(title)
    t = re.sub(r"\((?:[^()]*)\)", " ", t)          # (Penguin Classics), (Third Edition)
    t = re.sub(r"[:;,–—-].*$", "", t)     # drop subtitle
    return " ".join(t.split())


# ---------------------------------------------------------------- the archive

def load_archive(path):
    a = json.load(open(path, encoding="utf-8"))
    people = {c["uuid"]: c.get("name", "") for c in a.get("contributors", [])}

    sources = {}
    for s in a.get("sources", []):
        names = []
        for c in sorted(s.get("contributions", []), key=lambda c: c.get("position", 0)):
            if c.get("role") in (None, "author"):
                names.append(people.get(c.get("contributorUUID"), ""))
        if not names and s.get("creator"):
            names = [s["creator"]]
        sources[s["uuid"]] = {
            "uuid": s["uuid"], "title": s.get("title", ""), "kind": s.get("kind", ""),
            "authors": ", ".join(n for n in names if n),
            "container": s.get("containerUUID"), "entries": [],
        }

    for e in a.get("entries", []):
        if e.get("deletedAt"):
            continue
        src = sources.get(e.get("sourceUUID"))
        if src is not None:
            src["entries"].append(e)

    # An anthology's pieces are sources of their own filed under a container;
    # a web export knows only the container, so roll descendants upward.
    def descendants(uuid, seen=None):
        seen = seen or set()
        out = list(sources[uuid]["entries"])
        for other in sources.values():
            if other["container"] == uuid and other["uuid"] not in seen:
                seen.add(other["uuid"])
                out += descendants(other["uuid"], seen)
        return out

    books = {}
    for s in sources.values():
        if s["container"]:
            continue
        books[s["uuid"]] = dict(s, all_entries=descendants(s["uuid"]))
    return books


# -------------------------------------------------------------------- the web

def load_web(path):
    data = json.load(open(path, encoding="utf-8"))
    return data["books"]


# ------------------------------------------------------------------ comparing

def compare(app_entries, web_records):
    app = {}
    for e in app_entries:
        app.setdefault(match_key(e.get("text", ""), e.get("note", "") or ""), e)
    # A web note rides on its highlight in Legium, so pair them the same way here.
    web = {}
    pending = None
    for r in web_records:
        if r["kind"] == "Highlight":
            if pending:
                web.setdefault(match_key(pending["text"]), pending)
            pending = r
        else:
            if pending and pending.get("location") == r.get("location"):
                web.setdefault(match_key(pending["text"], r["text"]), pending)
                pending = None
            else:
                web.setdefault(match_key(r["text"]), r)
    if pending:
        web.setdefault(match_key(pending["text"]), pending)

    both = set(app) & set(web)
    app_only = [app[k] for k in set(app) - set(web)]
    web_only = [web[k] for k in set(web) - set(app)]

    # Pair up what nearly matched, so text drift reads as drift and not as loss.
    near = []
    for a in list(app_only):
        at = fold(a.get("text", ""))
        best, score = None, 0.0
        for w in web_only:
            wt = fold(w["text"])
            if not at or not wt:
                continue
            if at.startswith(wt) or wt.startswith(at) or at in wt or wt in at:
                s = min(len(at), len(wt)) / max(len(at), len(wt))
            else:
                s = SequenceMatcher(None, at[:400], wt[:400]).ratio()
            if s > score:
                best, score = w, s
        if best is not None and score >= 0.80:
            near.append((a, best, score))
            app_only.remove(a)
            web_only.remove(best)
    return {"matched": len(both), "app_only": app_only, "web_only": web_only, "near": near}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("archive")
    p.add_argument("web_json")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--emit-new", metavar="FILE",
                   help="write the ASINs of web books the archive does not hold, "
                        "one per line — the set that is safe to import as-is")
    args = p.parse_args()

    books = load_archive(args.archive)
    web_books = load_web(args.web_json)
    by_title = defaultdict(list)
    for w in web_books:
        by_title[title_key(w["title"])].append(w)

    print(f"archive: {len(books)} top-level sources    web: {len(web_books)} books\n")

    overlap = totals = matched = 0
    drift = []
    missing_from_web = []
    unmatched_books = []

    for b in sorted(books.values(), key=lambda x: x["title"]):
        hits = by_title.get(title_key(b["title"]), [])
        if not hits:
            unmatched_books.append(b)
            continue
        w = max(hits, key=lambda x: len(x["records"]))
        overlap += 1
        r = compare(b["all_entries"], w["records"])
        totals += len(b["all_entries"])
        matched += r["matched"]
        flag = "ok " if not r["app_only"] and not r["near"] else "DIFF"
        print(f"[{flag}] {b['title'][:52]:<52} app={len(b['all_entries']):>3} "
              f"web={len(w['records']):>3} same={r['matched']:>3} "
              f"drift={len(r['near'])} app-only={len(r['app_only'])} web-only={len(r['web_only'])}")
        for a, wr, s in r["near"]:
            drift.append((b["title"], a, wr, s))
        for a in r["app_only"]:
            missing_from_web.append((b["title"], a))

    print(f"\n{'='*70}\nbooks in both: {overlap}   archive passages there: {totals}   "
          f"identical: {matched}   drifted: {len(drift)}   absent from web: {len(missing_from_web)}")
    print(f"archive books with no web counterpart: {len(unmatched_books)}")
    for b in unmatched_books:
        print(f"    - {b['title'][:60]} ({b['kind']}, {len(b['all_entries'])} passages)")

    if drift:
        print(f"\n--- text drift (web differs from the app's wording) ---")
        for title, a, w, s in drift[:20] if not args.verbose else drift:
            print(f"\n  {title[:50]}  similarity {s:.3f}")
            print(f"    app: {a.get('text','')[:150]!r}")
            print(f"    web: {w['text'][:150]!r}")

    if args.emit_new:
        held = {title_key(b["title"]) for b in books.values()}
        fresh = [w for w in web_books if title_key(w["title"]) not in held and w["records"]]
        with open(args.emit_new, "w", encoding="utf-8") as fh:
            for w in fresh:
                fh.write(w["asin"] + "\n")
        print(f"\nsafe to import ({len(fresh)} books, "
              f"{sum(len(w['records']) for w in fresh)} annotations) -> {args.emit_new}")

    if missing_from_web:
        print(f"\n--- in the archive, absent from the web export ---")
        for title, a in (missing_from_web[:20] if not args.verbose else missing_from_web):
            print(f"  {title[:45]:<45} {a.get('locator','-'):<10} {a.get('text','')[:70]!r}")


if __name__ == "__main__":
    main()
