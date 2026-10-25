#!/usr/bin/env python3
"""Write one app version into version.json and index.html.

GitHub Pages serves this repo from main with no build step, so the running
page and version.json only stay in sync if both are updated together. The
stamp workflow on main passes the commit SHA. A hand run uses HEAD.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def version_id():
    if os.environ.get("APP_VERSION"):
        return os.environ["APP_VERSION"]
    if len(sys.argv) > 1:
        return sys.argv[1]
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def main():
    version = version_id()
    if not re.fullmatch(r"[A-Za-z0-9._-]+", version):
        raise SystemExit("version must be letters, numbers, dots, underscores, or hyphens")

    html_path = ROOT / "index.html"
    html = html_path.read_text()

    def meta(match):
        return match.group(1) + version + match.group(2)

    def script(match):
        return match.group(1) + version + match.group(2)

    html, n_meta = re.subn(
        r'(<meta name="app-version" content=")[^"]*(")',
        meta,
        html,
        count=1,
    )
    html, n_script = re.subn(
        r'(<script src="custom-cards\.js\?v=)[^"]*(")',
        script,
        html,
        count=1,
    )
    if n_meta != 1 or n_script != 1:
        raise SystemExit(f"could not stamp index.html (meta={n_meta}, script={n_script})")
    html_path.write_text(html)
    (ROOT / "version.json").write_text(json.dumps({"version": version}, indent=2) + "\n")
    print(version)


if __name__ == "__main__":
    main()
