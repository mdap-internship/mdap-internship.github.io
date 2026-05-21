import os
import re
import subprocess
import json
import shutil
import yaml
from datetime import datetime
from pathlib import Path
import urllib.request

ORG       = os.environ["ORG"]
PAT       = os.environ["GH_TOKEN"]
PREFIX    = "intern-"
INTERNS_DIR = Path("interns")
DATA_DIR    = Path("_data")


def gh_api(path):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {PAT}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


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

intern_repos = [r for r in all_repos if r["name"].startswith(PREFIX) and not is_template(r)]
print(f"Found {len(intern_repos)} intern repos (templates excluded)")

# ── Clear previous build content (but keep .gitkeep) ─────────────────────────

for item in INTERNS_DIR.iterdir():
    if item.name == ".gitkeep":
        continue
    shutil.rmtree(item) if item.is_dir() else item.unlink()

DATA_DIR.mkdir(exist_ok=True)

# ── Clone and process each intern repo ───────────────────────────────────────

cohorts = {}

for repo in intern_repos:
    username = repo["name"].removeprefix(PREFIX)
    print(f"Processing: {username}")

    cloned_at = datetime.fromisoformat(repo["created_at"].replace("Z", "+00:00"))
    sem = semester(cloned_at)
    yr  = semester_year(cloned_at)

    dest = INTERNS_DIR / username

    # Clone via authenticated HTTPS
    clone_url = repo["clone_url"].replace("https://", f"https://x-access-token:{PAT}@")
    result = subprocess.run(
        ["git", "clone", "--depth=1", clone_url, str(dest)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  ERROR cloning {username}: {result.stderr}")
        continue

    # Strip git internals and CI config — never expose these
    shutil.rmtree(dest / ".git",    ignore_errors=True)
    shutil.rmtree(dest / ".github", ignore_errors=True)

    # Ensure the intern's profile/index.md has a layout set
    # We only add layout — we never touch their actual content
    index = dest / "index.md"
    if index.exists():
        content = index.read_text(encoding="utf-8")
        if content.startswith("---"):
            # Front matter exists — inject layout if missing
            if "layout:" not in content.split("---")[1]:
                content = content.replace("---\n", "---\nlayout: intern\n", 1)
                index.write_text(content, encoding="utf-8")
        else:
            # No front matter at all — prepend it
            index.write_text(f"---\nlayout: intern\n---\n{content}", encoding="utf-8")

    # Build metadata entry — sourced entirely from GitHub API
    cohorts[username] = {
        "username":     username,
        "display_name": repo.get("description") or username,
        "repo":         repo["name"],
        "cloned_at":    repo["created_at"],   # ISO 8601, immutable GitHub record
        "year":         yr,
        "semester":     sem,
        "cohort":       f"{yr}-{sem}",
    }

    print(f"  OK — cohort {yr}-{sem}")

# ── Write hidden metadata ─────────────────────────────────────────────────────

cohorts_path = DATA_DIR / "cohorts.yml"
with open(cohorts_path, "w", encoding="utf-8") as f:
    yaml.dump(cohorts, f, default_flow_style=False, allow_unicode=True, sort_keys=True)

print(f"\nWrote {cohorts_path}")
print(f"Done. Processed {len(cohorts)}/{len(intern_repos)} repos successfully.")
