# scripts/aggregate.py
import os, subprocess, json, shutil
from datetime import datetime, timezone
from pathlib import Path
import urllib.request

ORG       = os.environ["ORG"]
PAT       = os.environ["GH_TOKEN"]
PREFIX    = "intern-"          # all intern repos follow this naming convention
BUILD_DIR = Path("_interns")
DATA_DIR  = Path("_data")

def gh_api(path):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {PAT}", "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def semester(dt: datetime) -> str:
    # Define your semester boundaries here
    # S1 = February–July, S2 = August–January
    return "S1" if 2 <= dt.month <= 7 else "S2"

def semester_year(dt: datetime) -> int:
    # S2 spans two calendar years — attribute it to the year it started
    return dt.year if dt.month >= 2 else dt.year - 1

# Fetch all repos in the org, filter by prefix
all_repos = []
page = 1
while True:
    page_repos = gh_api(f"/orgs/{ORG}/repos?type=private&per_page=100&page={page}")
    if not page_repos:
        break
    all_repos.extend(page_repos)
    page += 1

intern_repos = [r for r in all_repos if r["name"].startswith(PREFIX)]

BUILD_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

cohorts = {}

for repo in intern_repos:
    username = repo["name"].removeprefix(PREFIX)
    cloned_at = datetime.fromisoformat(repo["created_at"].replace("Z", "+00:00"))
    sem = semester(cloned_at)
    yr  = semester_year(cloned_at)

    dest = BUILD_DIR / username
    if dest.exists():
        shutil.rmtree(dest)

    clone_url = repo["clone_url"].replace(
        "https://", f"https://x-access-token:{PAT}@"
    )
    subprocess.run(["git", "clone", "--depth=1", clone_url, str(dest)], check=True)

    # Remove the .git folder — no need for it in the build
    shutil.rmtree(dest / ".git", ignore_errors=True)

    # Inject front matter into the intern's index.md so Jekyll
    # picks up the collection correctly, without exposing metadata
    index = dest / "profile" / "index.md"
    if index.exists():
        content = index.read_text()
        # Only prepend if there's no front matter yet
        if not content.startswith("---"):
            index.write_text(f"---\nlayout: intern\n---\n{content}")

    # Store metadata separately — never written into the intern's files
    cohorts[username] = {
        "display_name": repo.get("description") or username,  # or pull from meta.json
        "repo": repo["name"],
        "cloned_at": repo["created_at"],
        "year": yr,
        "semester": sem,
        "cohort": f"{yr}-{sem}",
        "active": True,   # you can update this logic as needed
    }

# Write the hidden metadata file
with open(DATA_DIR / "cohorts.yml", "w") as f:
    import yaml
    yaml.dump(cohorts, f, default_flow_style=False, allow_unicode=True)

print(f"Aggregated {len(intern_repos)} intern repos")