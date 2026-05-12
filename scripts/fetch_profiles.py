import requests, os, base64

token = os.environ["GH_TOKEN"]
headers = {"Authorization": f"token {token}"}
org = "mdap-internship"

os.makedirs("dist/interns", exist_ok=True)

# Find all intern repos
repos = requests.get(
    f"https://api.github.com/orgs/{org}/repos?per_page=100",
    headers=headers
).json()

intern_repos = [r for r in repos if r["name"].startswith("intern-")]

for repo in intern_repos:
    r = requests.get(
        f"https://api.github.com/repos/{org}/{repo['name']}/contents/profile.md",
        headers=headers
    )
    if r.status_code == 200:
        content = base64.b64decode(r.json()["content"]).decode()
        
        # Save as intern-john.md inside dist/interns/
        filename = f"dist/interns/{repo['name']}.md"
        with open(filename, "w") as f:
            f.write(content)
        print(f"Saved {filename}")
    else:
        print(f"No profile.md found in {repo['name']}, skipping")