# Strokes Gained Tracker

A phone-first, offline-first web app for logging every shot of a round and computing strokes gained
(Broadie method) per shot, per category and per round. Each golfer's data is private; friends can
opt in to a shared leaderboard that only ever exposes round-level totals.

- `docs/` — the app. Plain HTML/CSS/JS modules, no build step. Deploy as a static site.
- `supabase/` — Postgres schema, row-level security, SG views and the baseline seed.
- `tests/` — engine tests (`node --test tests/sg.test.mjs`), SQL tests (`tests/run_schema_test.sh`,
  needs a local Postgres on port 5433) and a headless UI smoke test (`node tests/ui.smoke.mjs`).

## One-time setup

1. **Database.** In the Supabase dashboard open *SQL Editor*, paste the whole of `supabase/setup.sql`
   and run it. That creates every table, the security policies, the SG functions and loads the PGA Tour
   baseline. (`setup.sql` is just the migration and seed files concatenated.)
2. **Auth.** In *Authentication → Providers* make sure Email is enabled. For a friends-only app you can
   turn off "Confirm email" under *Authentication → Settings* so sign-up is instant.
3. **Config.** `docs/config.js` holds the project URL and the publishable (anon) key. These are safe to
   commit: row-level security is the access control, not the key.
4. **Hosting.** Serve `docs/` from any static host. For GitHub Pages: *Settings → Pages → Deploy from a
   branch*, branch `main`, folder `/docs`. The site is then at `https://<user>.github.io/<repo>/`.
5. **Install on the phone.** Open the site in Safari (iOS) or Chrome (Android) and *Add to Home Screen*.
   After the first load the app opens and logs shots with no signal.

## How it works

Shots are written to the phone's local store first and the round is marked dirty. A background sync
upserts dirty rounds to Postgres keyed on client-generated ids, so retries never duplicate. On sign-in the
phone pulls the user's rounds down, so history and trends also work offline.

Strokes gained is computed in two places from the same baseline table: in `docs/sg.js` on the phone
(instant, offline) and in the `shot_sg` / `round_summary` SQL views (for the leaderboard and for your own
queries). `tests/sg.test.mjs` and `tests/schema.test.sql` check the two agree, including the telescoping
identity: the SG on a hole always sums to the first shot's baseline minus the strokes taken.

Categories follow the PGA Tour convention: off the tee is tee shots on par 4s and 5s; approach is par-3
tee shots and any non-putt more than 30 yards out; around the green is any non-putt within 30 yards;
putting is anything from the green (distances in feet). A penalty is charged to the shot that incurred it.

Baseline: Broadie (2012), *Assessing Golfer Performance on the PGA TOUR*, Table 9, plus the Every Shot
Counts putting tables. Regenerate the SQL seed from `docs/baselines.js` with `node tests/gen_seed.mjs`.

## Roadmap

1. Core logger and SG engine — this release.
2. Trends: rolling averages, skill profile, approach by distance band, putting by distance, dispersion.
3. Friends: groups, invite codes with approval, leaderboard (database side already in place).
4. Personal baseline fitted from your own shots after 20+ rounds; handicap benchmark layer.
