#!/usr/bin/env python3
"""Rebuild index.html from every page in the repo.

Every .html page (and every folder with an index.html) gets a card, so nothing
pushed by hand or by a skill can go missing. Titles and tags come from
catalog.json when set there, else from the page <title> and the filename.
Dates come from git (first commit = published, last commit = updated).

Usage: python3 build-index.py            (rebuild)
       python3 build-index.py --seed     (one time: copy titles/tags from old index cards)
"""
import html, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(ROOT, "catalog.json")
SKIP_DIRS = {".git", "assets", "node_modules", ".vercel"}


def git_dates(path):
    out = subprocess.run(
        ["git", "log", "--follow", "--format=%cI", "--", path],
        cwd=ROOT, capture_output=True, text=True).stdout.split()
    if not out:
        return None, None
    return out[-1][:10], out[0][:10]


def page_title(fp):
    try:
        with open(fp, encoding="utf-8", errors="ignore") as f:
            head = f.read(200_000)
    except OSError:
        return ""
    for pat in (r"<title[^>]*>(.*?)</title>", r"<h1[^>]*>(.*?)</h1>"):
        m = re.search(pat, head, re.S | re.I)
        if m:
            t = html.unescape(re.sub(r"<[^>]+>|\s+", " ", m.group(1))).strip()
            if t and t.lower() not in {"document", "untitled"}:
                return t
    return ""


def guess_tag(href):
    h = href.lower()
    if h.startswith("eng/"):
        return "eng"
    for tag, words in (
        ("pitch", ("pitch", "monthly-quota")),
        ("design", ("screen", "mockup", "drawer", "tab-draft", "-ui")),
        ("flow", ("diagram", "flow", "graph", "chain")),
        ("prd", ("prd",)),
        ("demo", ("sprint-demo", "webinar", "walkthrough", "deck")),
        ("review", ("review", "brief", "gap", "vs-", "cheatsheet")),
    ):
        if any(w in h for w in words):
            return tag
    return "other"


def pretty(href):
    base = href.rstrip("/").split("/")[-1].removesuffix(".html")
    return re.sub(r"[-_]+", " ", base).strip().capitalize()


def scan():
    pages = []
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        rel = os.path.relpath(d, ROOT)
        for fn in sorted(files):
            if not fn.endswith(".html"):
                continue
            if rel == "." and fn in ("index.html", "index.template.html"):
                continue
            if fn == "index.html":
                pages.append((rel + "/", os.path.join(rel, fn)))
            else:
                p = fn if rel == "." else f"{rel}/{fn}"
                pages.append((p, p))
    return pages


def seed():
    """Copy curated title/tag/meta from the hand-made cards in the old index."""
    src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    cat = load_catalog()
    for m in re.finditer(r'<a class="card" href="([^"]+)">(.*?)</a>', src, re.S):
        href, body = m.group(1), m.group(2)
        tag = re.search(r'card-tag (\w+)', body)
        title = re.search(r'card-title">(.*?)</div>', body, re.S)
        meta = re.search(r'card-meta">(.*?)</div>', body, re.S)
        e = cat.setdefault(href, {})
        if tag: e.setdefault("tag", tag.group(1))
        if title: e.setdefault("title", html.unescape(title.group(1).strip()))
        if meta: e.setdefault("meta", html.unescape(meta.group(1).strip()))
    save_catalog(cat)
    print(f"seeded {len(cat)} entries into catalog.json")


def load_catalog():
    if os.path.exists(CATALOG):
        return json.load(open(CATALOG, encoding="utf-8"))
    return {}


def save_catalog(cat):
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(cat.items())), f, indent=2, ensure_ascii=False)
        f.write("\n")


def build():
    cat = load_catalog()
    items = []
    for href, fp in scan():
        c = cat.get(href, {})
        if c.get("hidden"):
            continue
        published, updated = git_dates(fp)
        items.append({
            "href": href.replace(" ", "%20"),
            "title": c.get("title") or page_title(os.path.join(ROOT, fp)) or pretty(href),
            "tag": c.get("tag") or guess_tag(href),
            "meta": c.get("meta", ""),
            "file": href,
            "published": published or "",
            "updated": updated or "",
        })
    items.sort(key=lambda x: (x["published"] or "9999", x["href"]), reverse=True)
    tpl = open(os.path.join(ROOT, "index.template.html"), encoding="utf-8").read()
    data = json.dumps(items, ensure_ascii=False).replace("</", "<\\/")
    out = tpl.replace("/*__DATA__*/[]", data)
    open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(out)
    print(f"index.html: {len(items)} deliverables")


if __name__ == "__main__":
    if "--seed" in sys.argv:
        seed()
    else:
        build()
