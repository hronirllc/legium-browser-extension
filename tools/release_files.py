#!/usr/bin/env python3
"""
Readies a signed extension for a GitHub release, and tells copies already
installed about it.

    python3 tools/release_files.py dist/<whatever web-ext named it>.xpi

Leaves in `dist/`:

    legium-<version>.xpi   the signed file, under a name that says its version
    legium.xpi             the same file, for a link that always installs the
                           newest: .../releases/latest/download/legium.xpi
    updates.json           what Firefox reads at the manifest's `update_url`

Firefox checks `update_url` about once a day. It points at the newest
release's `updates.json`, which names that release's own `.xpi`, so an update
is a tag and nothing else.
"""

import hashlib, json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "extension", "manifest.json")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    signed = sys.argv[1]
    out = os.path.dirname(signed)
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    version = manifest["version"]
    gecko = manifest["browser_specific_settings"]["gecko"]
    # The release that `update_url` points into, for the address of this file.
    releases = gecko["update_url"].split("/latest/")[0]

    versioned = os.path.join(out, f"legium-{version}.xpi")
    if os.path.abspath(signed) != os.path.abspath(versioned):
        os.replace(signed, versioned)
    shutil.copyfile(versioned, os.path.join(out, "legium.xpi"))

    with open(versioned, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    updates = {
        "addons": {
            gecko["id"]: {
                "updates": [{
                    "version": version,
                    "update_link": f"{releases}/download/v{version}/legium-{version}.xpi",
                    "update_hash": f"sha256:{digest}",
                    "applications": {"gecko": {"strict_min_version": gecko["strict_min_version"]}},
                }],
            },
        },
    }
    with open(os.path.join(out, "updates.json"), "w", encoding="utf-8") as fh:
        json.dump(updates, fh, indent=2)
        fh.write("\n")
    print(f"legium-{version}.xpi, legium.xpi and updates.json in {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    main()
