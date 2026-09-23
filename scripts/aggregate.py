import os
import re
import subprocess
import json
import shutil
import yaml
from datetime import datetime
from pathlib import Path
import urllib.request
import urllib.error

try:
    from dotenv import load_dotenv
    load_dotenv()  # no-op if .env doesn't exist; never overrides existing env vars
except ImportError:
    pass

ORG       = os.environ["ORG"]
PAT       = os.environ["GH_TOKEN"]
PREFIX    = "intern-"
INTERNS_DIR = Path("interns")
COHORTS_DIR = Path("cohorts")
DATA_DIR    = Path("_data")
# Hand-maintained profiles for interns who predate the template repos.
# Underscore-prefixed so Jekyll never renders it directly — we copy each
# entry into INTERNS_DIR below, same as a cloned repo.
PAST_INTERNS_DIR = Path("_past_interns")
PHOTO_EXTENSIONS = (".png", ".jpg", ".jpeg")

# Resolved relative to this file, not the current working directory, so it
# works the same whether run locally from anywhere or from the GitHub runner.
CONFIG_PATH = Path(__file__).resolve().parent / "config.yml"


def load_config():
    if not CONFIG_PATH.exists():
        return {}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


config = load_config()
EXCLUDED_GH_USERNAMES = {u.lower() for u in config.get("exclude_github_usernames", [])}
REPO_DETECTION = config.get("repo_detection", "prefix")
TEMPLATE_REPO = config.get("template_repo", "")

if REPO_DETECTION not in ("prefix", "template"):
    raise SystemExit(f"config.yml: repo_detection must be 'prefix' or 'template', got {REPO_DETECTION!r}")
if REPO_DETECTION == "template" and not TEMPLATE_REPO:
    raise SystemExit("config.yml: repo_detection is 'template' but template_repo is not set")


def gh_api(path, allow_404=False):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {PAT}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if allow_404 and e.code == 404:
            return None
        raise


def get_gh_username(repo_name: str) -> str:
    # The API's repo.owner is the org itself for org-owned repos, not the
    # intern who actually created/pushed it. The repo's top contributor
    # (skipping bots and the org account) is the closest we can get to
    # "whose repo is this" without extra setup.
    contributors = gh_api(f"/repos/{ORG}/{repo_name}/contributors?per_page=10", allow_404=True) or []
    for c in contributors:
        if c.get("type") == "Bot":
            continue
        login = c.get("login", "")
        if login and login.lower() != ORG.lower():
            return login
    return ""


def is_generated_from_template(repo_name: str) -> bool:
    # Only the single-repo GET exposes this — the bulk org list doesn't —
    # so this costs one extra API call per repo when repo_detection: template.
    full = gh_api(f"/repos/{ORG}/{repo_name}", allow_404=True) or {}
    template = full.get("template_repository") or {}
    return template.get("full_name", "").lower() == TEMPLATE_REPO.lower()


def semester(dt: datetime) -> str:
    # S1 = February–July, S2 = August–January
    return "S1" if 2 <= dt.month <= 7 else "S2"


def semester_year(dt: datetime) -> int:
    # S2 that starts in August is attributed to that calendar year
    # S2 that ends in January is attributed to the previous year
    return dt.year if dt.month >= 2 else dt.year - 1


# ── Fetch all intern repos ────────────────────────────────────────────────────

all_repos = []
page = 1
while True:
    batch = gh_api(f"/orgs/{ORG}/repos?type=private&per_page=100&page={page}")
    if not batch:
        break
    all_repos.extend(batch)
    page += 1

TEMPLATE_RE = re.compile(r"template", re.IGNORECASE)

def is_template(repo: dict) -> bool:
    if repo.get("is_template"):
        return True
    return bool(TEMPLATE_RE.search(repo["name"]))


def has_prefix(name: str) -> bool:
    return name.lower().startswith(PREFIX.lower())


def strip_prefix(name: str) -> str:
    # Case-insensitive equivalent of str.removeprefix(PREFIX)
    return name[len(PREFIX):] if has_prefix(name) else name


def slugify(text: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower())
    return text.strip("-")


print(f"Found {len(all_repos)} total repo(s) in {ORG}")
if REPO_DETECTION == "template":
    print(f"Repo detection: template (matching generated-from '{TEMPLATE_REPO}')")
else:
    print(f"Repo detection: prefix (name starts with '{PREFIX}')")

intern_repos = []
skipped = []

for r in all_repos:
    name = r["name"]

    if is_template(r):
        skipped.append((name, "looks like a template repo (name or is_template flag)"))
        continue

    if REPO_DETECTION == "template":
        if not is_generated_from_template(name):
            skipped.append((name, f"not generated from template '{TEMPLATE_REPO}'"))
            continue
    else:
        if not has_prefix(name):
            skipped.append((name, f"name doesn't start with '{PREFIX}' (case-insensitive)"))
            continue

    # Resolved once here and cached on the repo dict, so it's reused below —
    # both for the config.yml exclusion check and the gh_username field
    # written to cohorts.yml — without a second API call.
    r["_gh_username"] = get_gh_username(name)

    if r["_gh_username"].lower() in EXCLUDED_GH_USERNAMES:
        skipped.append((name, f"owner '{r['_gh_username']}' is in config.yml's exclude_github_usernames"))
        continue

    intern_repos.append(r)

print(f"\n{len(intern_repos)} repo(s) will be processed:")
for r in intern_repos:
    print(f"  + {r['name']}  (github: {r['_gh_username'] or 'unknown'})")

print(f"\n{len(skipped)} repo(s) skipped:")
for name, reason in skipped:
    print(f"  - {name}: {reason}")

# ── Clear previous build content (but keep .gitkeep) ─────────────────────────

for item in INTERNS_DIR.iterdir():
    if item.name == ".gitkeep":
        continue
    shutil.rmtree(item) if item.is_dir() else item.unlink()

COHORTS_DIR.mkdir(exist_ok=True)
for item in COHORTS_DIR.iterdir():
    if item.name == ".gitkeep":
        continue
    shutil.rmtree(item) if item.is_dir() else item.unlink()

DATA_DIR.mkdir(exist_ok=True)

# ── Clone and process each intern repo ───────────────────────────────────────

cohorts = {}
clone_failures = []

for repo in intern_repos:
    repo_slug = strip_prefix(repo["name"])
    print(f"Processing: {repo_slug}")

    cloned_at = datetime.fromisoformat(repo["created_at"].replace("Z", "+00:00"))
    sem = semester(cloned_at)
    yr  = semester_year(cloned_at)

    # Cloned to a scratch name first — the final directory name needs the
    # intern's display name, which only becomes known once we've cloned
    # and read their index.md title.
    scratch_dest = INTERNS_DIR / f".scratch-{repo_slug}"

    # Clone via authenticated HTTPS
    clone_url = repo["clone_url"].replace("https://", f"https://x-access-token:{PAT}@")
    result = subprocess.run(
        ["git", "clone", "--depth=1", clone_url, str(scratch_dest)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  ERROR cloning {repo_slug}: {result.stderr}")
        clone_failures.append((repo["name"], result.stderr.strip()))
        continue

    # Strip git internals and CI config — never expose these
    shutil.rmtree(scratch_dest / ".git",    ignore_errors=True)
    shutil.rmtree(scratch_dest / ".github", ignore_errors=True)

    # Ensure the intern's profile/index.md has a layout set
    # We only add layout — we never touch their actual content
    index = scratch_dest / "index.md"
    display_name = repo_slug
    if index.exists():
        content = index.read_text(encoding="utf-8")
        if content.startswith("---"):
            front_matter = content.split("---")[1]
            # Front matter exists — inject layout if missing
            if "layout:" not in front_matter:
                content = content.replace("---\n", "---\nlayout: intern\n", 1)
                index.write_text(content, encoding="utf-8")
                front_matter = "layout: intern\n" + front_matter
            title_match = re.search(r"^title:\s*(.+)$", front_matter, re.MULTILINE)
            if title_match:
                display_name = title_match.group(1).strip().strip("'\"")
        else:
            # No front matter at all — prepend it
            index.write_text(f"---\nlayout: intern\n---\n{content}", encoding="utf-8")

    # Directory/URL slug is <intern name>-<github username>. GitHub usernames
    # are unique org-wide, so this stays unique even when two interns (in the
    # same or different cohorts) share a name or picked the same repo suffix.
    gh_username = repo["_gh_username"]
    name_slug = slugify(display_name) or slugify(repo_slug) or "intern"
    slug = f"{name_slug}-{slugify(gh_username)}" if gh_username else f"{name_slug}-{slugify(repo_slug)}"

    dest = INTERNS_DIR / slug
    if dest.exists():
        shutil.rmtree(dest)
    scratch_dest.rename(dest)

    # Build metadata entry — display name comes from the intern's own
    # index.md title (what they set for themselves), not the GitHub repo
    # description, which is often left as an unedited placeholder.
    entry = {
        "username":     slug,
        "display_name": display_name,
        "repo":         repo["name"],
        "cloned_at":    repo["created_at"],   # ISO 8601, immutable GitHub record
        "year":         yr,
        "semester":     sem,
        "cohort":       f"{yr}-{sem}",
    }
    if gh_username:
        entry["gh_username"] = gh_username
    cohorts[slug] = entry

    print(f"  OK — slug {slug}, cohort {yr}-{sem}, github: {gh_username or 'unknown'}")

# ── Add past interns (no repo) ────────────────────────────────────────────────
# Each _past_interns/<slug>/ holds an index.md whose front matter carries the
# same fields as a template repo's, plus a `date:` that stands in for the repo
# creation date when working out the cohort. An optional profile-photo.<ext>
# next to it is moved to assets/img/, where intern-card.html looks for it.

repo_count = len(cohorts)
past_failures = []

def read_front_matter(path: Path) -> dict:
    content = path.read_text(encoding="utf-8")
    if not content.startswith("---"):
        return {}
    return yaml.safe_load(content.split("---")[1]) or {}


past_dirs = sorted(
    d for d in PAST_INTERNS_DIR.iterdir()
    if d.is_dir() and not d.name.startswith(("_", "."))
) if PAST_INTERNS_DIR.exists() else []

print(f"\nProcessing {len(past_dirs)} past intern(s) from {PAST_INTERNS_DIR}/")

for src in past_dirs:
    slug = src.name
    index = src / "index.md"
    if not index.exists():
        past_failures.append((slug, "missing index.md"))
        continue
    if slug != slugify(slug):
        past_failures.append((slug, f"folder name must be a lowercase slug, e.g. '{slugify(slug)}'"))
        continue
    if slug in cohorts:
        past_failures.append((slug, "slug already used by an intern repo"))
        continue

    meta = read_front_matter(index)
    display_name = str(meta.get("title") or "").strip()
    date = meta.get("date")
    if isinstance(date, str):
        try:
            date = datetime.fromisoformat(date)
        except ValueError:
            date = None
    if not display_name or not date:
        past_failures.append((slug, "front matter needs both 'title' and 'date' (YYYY-MM-DD)"))
        continue

    dest = INTERNS_DIR / slug
    shutil.copytree(src, dest)
    for photo in dest.iterdir():
        if photo.stem == "profile-photo" and photo.suffix.lower() in PHOTO_EXTENSIONS:
            (dest / "assets" / "img").mkdir(parents=True, exist_ok=True)
            photo.rename(dest / "assets" / "img" / photo.name)

    sem = semester(date)
    yr  = semester_year(date)
    entry = {
        "username":     slug,
        "display_name": display_name,
        "date":         date.isoformat(),
        "year":         yr,
        "semester":     sem,
        "cohort":       f"{yr}-{sem}",
        "past":         True,
    }
    if meta.get("gh_username"):
        entry["gh_username"] = str(meta["gh_username"])
    cohorts[slug] = entry

    print(f"  OK — slug {slug}, cohort {yr}-{sem}")

# ── Write hidden metadata ─────────────────────────────────────────────────────

cohorts_path = DATA_DIR / "cohorts.yml"
with open(cohorts_path, "w", encoding="utf-8") as f:
    yaml.dump(cohorts, f, default_flow_style=False, allow_unicode=True, sort_keys=True)

print(f"\nWrote {cohorts_path}")

# ── Generate one static page per cohort ───────────────────────────────────────
# These are thin stubs — layout: cohort pulls the actual intern list from
# _data/cohorts.yml at build time, so all we need here is which cohorts exist.

unique_cohorts = {entry["cohort"]: (entry["year"], entry["semester"]) for entry in cohorts.values()}

for cohort_key, (yr, sem) in unique_cohorts.items():
    cohort_dir = COHORTS_DIR / cohort_key.lower()
    cohort_dir.mkdir(parents=True, exist_ok=True)
    (cohort_dir / "index.md").write_text(
        "---\n"
        "layout: cohort\n"
        f'cohort: "{cohort_key}"\n'
        f"year: {yr}\n"
        f'semester: "{sem}"\n'
        f'title: "{cohort_key.replace("-", " ")}"\n'
        "---\n",
        encoding="utf-8",
    )

print(f"Wrote {len(unique_cohorts)} cohort page(s) under {COHORTS_DIR}/")

if clone_failures:
    print(f"\n{len(clone_failures)} repo(s) failed to clone and were skipped:")
    for name, err in clone_failures:
        print(f"  - {name}: {err}")

if past_failures:
    print(f"\n{len(past_failures)} past intern(s) skipped:")
    for name, reason in past_failures:
        print(f"  - {name}: {reason}")

print(f"\nDone. Processed {repo_count}/{len(intern_repos)} repos and "
      f"{len(cohorts) - repo_count}/{len(past_dirs)} past interns successfully.")
