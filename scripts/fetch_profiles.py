import requests, os, base64, re

token = os.environ["GH_TOKEN"]
headers = {"Authorization": f"token {token}"}
org = "mdap-internship"

os.makedirs("interns", exist_ok=True)

repos = requests.get(
    f"https://api.github.com/orgs/{org}/repos?per_page=100",
    headers=headers
).json()

intern_repos = [r for r in repos if r["name"].startswith("intern-")]
print(f"Found {len(intern_repos)} intern repos: {[r['name'] for r in intern_repos]}")

new_interns = []
updated_interns = []
skipped_interns = []

def rewrite_image_urls(content, org, repo_name, branch="main"):
    base_url = f"https://raw.githubusercontent.com/{org}/{repo_name}/{branch}"
    content = re.sub(
        r'!\[([^\]]*)\]\((?!http)([^)]+)\)',
        lambda m: f'![{m.group(1)}]({base_url}/{m.group(2).lstrip("/")})',
        content
    )
    content = re.sub(
        r'<img([^>]*?)src=["\'](?!http)([^"\']+)["\']',
        lambda m: f'<img{m.group(1)}src="{base_url}/{m.group(2).lstrip("/")}"',
        content
    )
    return content

for repo in intern_repos:
    r = requests.get(
        f"https://api.github.com/repos/{org}/{repo['name']}/contents/profile.md",
        headers=headers
    )
    if r.status_code == 200:
        content = base64.b64decode(r.json()["content"]).decode()
        content = rewrite_image_urls(content, org, repo["name"])
        
        filepath = f"interns/{repo['name']}.md"
        is_new = not os.path.exists(filepath)
        
        # Check if content actually changed
        if not is_new:
            with open(filepath, "r") as f:
                existing = f.read()
            if existing == content:
                skipped_interns.append(repo["name"])
                continue

        with open(filepath, "w") as f:
            f.write(content)

        if is_new:
            new_interns.append(repo["name"])
        else:
            updated_interns.append(repo["name"])
    else:
        print(f"⚠️  No profile.md found in {repo['name']}, skipping")

print(f"\n✅ New interns:     {new_interns if new_interns else 'none'}")
print(f"🔄 Updated interns: {updated_interns if updated_interns else 'none'}")
print(f"⏭️  Unchanged:       {skipped_interns if skipped_interns else 'none'}")