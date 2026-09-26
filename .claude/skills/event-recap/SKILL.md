---
name: event-recap
description: End-of-event recap for Gradient Descent Golf. Pulls every round of an event from Firestore, summarizes who played the most, and renders a shareable 1080x1350 "Hall of Fame" PNG (WhatsApp-ready) praising the top 3 players by rounds played. Use when the user asks for an event recap, event summary, podium/hall-of-fame image, or "who played the most" for an event.
---

# Event recap

Run the script; it does everything deterministically so every event gets the same card:

```bash
python3 scripts/event-recap/recap.py <event> [--lang en|it] [--out recaps/<event>]
```

- `<event>` is the event code players used (the `?e=` in the play link, e.g. `ndr2026`). If the user
  doesn't name one, ask — don't guess.
- `--lang` defaults to `en`; use `it` when the user asks for Italian.
- Output lands in `recaps/<event>/` (gitignored): `podium.png` (the image to share),
  `podium.html` (its source) and `summary.json` (full per-player table).
- Reads need no credentials (Firestore rules allow public reads). The project id defaults to
  `gradientdescentgolf`, or `VITE_FIREBASE_PROJECT_ID` if set.
- Rendering uses the globally installed `playwright` + Chromium via `node`.

## After running

1. Look at `recaps/<event>/podium.png` to confirm it rendered cleanly.
2. Send it to the user (SendUserFile, display `render`).
3. Reply with the stdout summary: totals, top players, and the three podium captions.
   Don't restyle or hand-edit the card per event — change `template.html` / `recap.py` only when
   the user asks for a different design, so the output stays consistent across events.

## How the podium captions are chosen

Each podium player gets the first caption from this list that fits them and that no higher-ranked
player already took (see `praise_candidates` in `recap.py`):

| Caption | When |
|---|---|
| The marathon descender — X% of all rounds | #1 only |
| Sharpest shot — top score | holds the event's best single score |
| The all-rounder — conquered all N levels | played every level that was played at the event |
| {Level} addict — N rounds on {Level} | ≥3 rounds and ≥60% of their rounds on one level |
| Rock solid — avg X points per round | best average on the podium (≥3 rounds) |
| Getting sharper — +X% | last rounds average ≥20% above first rounds |
| Never gave up — best score | fallback |

Ranking: most rounds, ties broken by best score. Names are merged case-insensitively (like the
leaderboard). Fewer than 3 players → a 2- or 1-step podium.
