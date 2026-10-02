# JV Deal-Submission CRM

Code-only build (2026-10-02). **Nothing here is deployed.** No console, repo, or
network service was touched — files only.

## What it is

A rebuild of jvwithluca.com as code (replacing the Canva export), modeled on the
GA Stacked/Zombies CRM:

- **Landing page** — black/champagne-gold theme matching the current site, Luca's
  cartoon avatar animated in the center, clickable **Georgia** (left) and
  **Texas** (right) state shapes. Clicking a state reveals the deal form embedded
  on the page with the state pre-filled.
- **Deal form** — all fields from his current GHL form (contact, property,
  pictures link, repairs, Zestimate, close date, contract amount, contract file
  upload, SMS consent). Public — no login. Writes to Firestore `jv_deals` and
  uploads the contract to Firebase Storage.
- **Admin CRM** (`admin.html`) — Luca-only Google sign-in (same auth pattern as
  the stacked/zombies CRM: `login_hint`, wrong-account banner, `requireAuth()`
  guard). Deal list newest-first with status filters, detail view, pipeline
  buttons (New → Reviewing → Vetted → Accepted/Rejected/Closed), timestamped
  notes, activity log, contract download, one-click CSV export.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page + embedded deal form |
| `admin.html` | Luca-only CRM |
| `assets/app.js` | Public form logic (validation, Firestore create, Storage upload) |
| `assets/admin.js` | Admin CRM logic (auth, list, detail, notes, activity, CSV) |
| `assets/avatar.png` | Luca's cartoon avatar, downloaded from the live jvwithluca.com |
| `firestore.rules` | Rules for `jv_deals` — public create only with strict field validation; read/update/delete Luca-only (plus the one public contract-attach update) |
| `storage.rules` | Rules for `jv_contracts/` — public create (PDF/JPG/PNG ≤ 10 MB); read Luca-only; no update/delete |

Firebase project: **rgr-crm-941ab** (config copied from the existing CRM source).
New cost: $0 (GitHub Pages + Firestore + Storage + Auth free tiers).

## Deploy steps (browser work, for later)

1. **GitHub repo** — create a new repo (suggested name `jv-deals-crm`), upload
   `index.html`, `admin.html`, and the `assets/` folder. Enable GitHub Pages on
   `main` branch. When ready, point `jvwithluca.com` DNS at GitHub Pages.
2. **Firebase Storage** — console: Storage > Get started (creates the default
   bucket). Required before any contract upload works.
3. **Firestore rules** — console: Firestore Database > Rules. **Merge** the
   `jv_deals` block from `firestore.rules` into the existing live ruleset — do
   NOT replace the whole file, or the stacked/zombies collections lose their
   rules.
4. **Storage rules** — console: Storage > Rules. Same merge caution if other
   paths already have rules.
5. **Verify** — submit a test deal from the live form as a signed-out visitor,
   confirm it appears in `admin.html` after signing in as
   luca.rebuffi@royalgroupsrealty.com, then delete the test deal.

## Notes / approximations

- The GA and TX SVG silhouettes are hand-drawn simplified polygons — clearly
  identifiable (panhandle on Texas, coastal jut on Georgia) and always labeled,
  but not cartographically exact.
- Firebase JS SDK: **compat build 10.12.2** (same as the existing CRM), not the
  modular build — chosen so the auth pattern could be reused verbatim.
- The SMS consent disclosure text is versioned (`v1-2026-10-02`) and stored with
  each submission for a TCPA paper trail.
- Orphan handling: if the contract upload fails after the Firestore doc is
  created, the client deletes the doc. (If the browser dies between upload and
  doc creation, a stray file can remain in Storage — Luca can delete via console.)
