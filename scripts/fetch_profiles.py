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

def rewrite_image_urls(content, org, repo_name, branch="main"):
    base_url = f"https://raw.githubusercontent.com/{org}/{repo_name}/{branch}"
    
    # Rewrite markdown images: ![alt](relative/path.jpg)
    content = re.sub(
        r'!\[([^\]]*)\]\((?!http)([^)]+)\)',
        lambda m: f'![{m.group(1)}]({base_url}/{m.group(2).lstrip("/")})',
        content
    )
    
    # Rewrite HTML img tags: <img src="relative/path.jpg">
    content = re.sub(
        r'<img([^>]*?)src=["\'](?!http)([^"\']+)["\']',
        lambda m: f'<img{m.group(1)}src="{base_url}/{m.group(2).lstrip("/")}\"',
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
        
        with open(f"interns/{repo['name']}.md", "w") as f:
            f.write(content)
        print(f"Saved {repo['name']}.md")
    else:
        print(f"No profile.md in {repo['name']}, skipping")