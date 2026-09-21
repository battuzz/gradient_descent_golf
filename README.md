# ⛳ Gradient Descent Golf

A fast, mobile-friendly party game: you're an optimizer trying to minimize a hidden,
noisy loss landscape in a limited number of "shots" (direction = gradient step,
drag length = learning rate). Built as a fully static, client-side React app so it
can be hosted for free on GitHub Pages, with scores published live to Firestore.

**Two screens, one shared session ("event"):**
- **Home / Leaderboard** — open on a laptop/TV. Shows a live-polling leaderboard and a
  QR code. Everyone scans it with their phone to jump straight into a new round.
- **Play** — the game itself, opened via the QR code. At the end of a round the score
  is written to Firestore and the leaderboard updates within a few seconds.

## How it plays

- Pick a name and a difficulty (Batch GD / SGD / Hyper-SGD 4D — noise, fog-of-war
  radius, and decoy valleys increase with difficulty).
- Each level's landscape is procedurally generated from a seed of
  `event name + difficulty`, so **everyone playing the same event on the same
  difficulty competes on the identical course** — fair leaderboard comparisons.
- **Drag** anywhere on the map to shoot: direction = descent direction, drag
  length = learning rate. On Batch GD the direction auto-follows the gradient hint
  (you just choose the learning rate); on the noisier levels you aim manually.
  Hyper-SGD 4D adds a slider for the hidden 4th parameter `w`.
- Fog of war only reveals terrain you've actually visited — you're optimizing
  nearly blind, like a real optimizer only sees local gradients.
- When shots run out, the full landscape is revealed, points are computed from how
  much of the gap between your starting loss and the true global minimum you closed,
  and the score is published to the leaderboard under your name.

## Local development

```bash
npm install
npm run dev
```

Without a Firebase config the app transparently falls back to a per-browser demo
leaderboard (stored in `localStorage`), so you can develop and test the whole flow
with zero setup.

## Setting up the live Firebase leaderboard

1. Create a Firebase project at <https://console.firebase.google.com>, then add a
   **Web app** to it (no Firebase Hosting needed — GitHub Pages serves the app).
2. Enable **Firestore Database** (Native mode), any region.
3. Publish the security rules in [`firestore.rules`](firestore.rules) (Firestore
   console → Rules), which allow anyone to **read** the `scores` collection and to
   **create** a score document with validated fields, but never update/delete —
   good enough for a party game with no login.
4. Copy the web app's SDK config into `.env.local` (see
   [`.env.local.example`](.env.local.example)) for local dev.
5. For the deployed site, add the same six values as **GitHub Actions repo secrets**
   (Settings → Secrets and variables → Actions) with the names used in
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID`.

These values are not secret (every client-side Firebase app ships them to the
browser) — access control is entirely handled by `firestore.rules`.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. Push to `main` (or run the workflow manually) — `.github/workflows/deploy.yml`
   builds the app and deploys `dist/` to Pages automatically.
4. Open the published URL on your laptop for the leaderboard screen; the QR code
   it shows encodes that same URL with `#/play`, so it works from any device
   without hardcoding a domain.

### Running an event

The leaderboard page has an **Event** field (defaults to `demo`). Set it to
something unique per session (e.g. `meetup-2026-09`) before you start — the QR
code and the query used to fetch scores both key off it, so different sessions
never mix. Changing it also reseeds the landscape for a fresh course.

## Project structure

```
src/
  game/landscape.ts   procedural loss landscape, difficulty presets, scoring
  game/render.ts      heat-map colour scale + fog-of-war painter
  components/         Leaderboard, Game (setup/round), GameCanvas (input + draw loop)
  lib/scores.ts        Firestore (or localStorage fallback) read/write
  lib/route.ts          tiny hash router + shareable play URL
```
