# Past interns

Interns from before the template repos (2026) — they have no repository of
their own, so their profile lives here instead. `scripts/aggregate.py` copies
each folder into `interns/` on every build, so they show up in the showcase,
cohort pages and sidebar exactly like everyone else.

## Adding one

1. Copy `_template/` to a new folder named with a lowercase slug, e.g.
   `jane-doe/`. The folder name becomes their URL: `/interns/jane-doe/`.
2. Fill in the front matter in `index.md`. `title` and `date` are required;
   `date` decides the cohort (Feb–Jul → S1, Aug–Jan → S2).
3. Optionally drop a `profile-photo.jpg` (or `.png`/`.jpeg`) next to
   `index.md`. Without one the card shows their initial.
4. Anything written below the front matter appears on their page — leave it
   empty for a profile with just their details and projects.

Folders starting with `_` or `.` (like `_template/`) are ignored.
