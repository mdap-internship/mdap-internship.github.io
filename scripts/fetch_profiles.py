import requests, os, json

token = os.environ["GH_TOKEN"]
headers = {"Authorization": f"token {token}"}
org = "mdap-internship"

# Find all repos starting with "intern-"
repos = requests.get(
    f"https://api.github.com/orgs/{org}/repos?per_page=100",
    headers=headers
).json()

intern_repos = [r for r in repos if r["name"].startswith("intern-")]

profiles = []
for repo in intern_repos:
    r = requests.get(
        f"https://api.github.com/repos/{org}/{repo['name']}/contents/profile.md",
        headers=headers
    )
    if r.status_code == 200:
        import base64
        content = base64.b64decode(r.json()["content"]).decode()
        profiles.append({
            "repo": repo["name"],
            "url": f"https://{org}.github.io/{repo['name']}",
            "content": content
        })

# Write to a JSON file your main site's HTML/JS can consume
with open("dist/profiles.json", "w") as f:
   json.dump(profiles, f)