# Feeding Log

A free, private, offline tracker for breastfeeding, bottles, pumping, diapers and sleep. It's a simple replacement for Nara Baby.

It's a **Progressive Web App (PWA)**: plain HTML, CSS and JS with no build step. It's hosted free on GitHub Pages and installed to your phone's home screen. You don't need an App Store developer account.

## Features

- **Nursing timer** with separate Left/Right sides. Tap a side to start, tap again to pause, or tap the other side to switch. It remembers which side you ended on last time. If you close the app mid-feed, the timer keeps running.
- **Bottle** (breast milk or formula). It starts from the last amount you entered.
- **Pumping** (left and right amounts).
- **Diaper**: wet, dirty, mixed or dry, with an optional rash flag.
- **Sleep** timer, or log a sleep after the fact.
- **Notes** for medicine, temperature, milestones and so on.
- **Home glance**: time since the last feed and the last diaper, plus today's totals.
- **History** grouped by day, with filters. Tap any entry to edit or delete it (deletes can be undone).
- **Trends**: 7-day charts and the average time between feeds.
- ml or oz units. Auto, light and dark themes, plus a dim, red-shifted **Night** theme for 3 a.m. feeds.
- JSON backup and import (import merges entries), and CSV export for the pediatrician.

## Deploy (one time, ~2 minutes)

1. Merge this branch into `main`.
2. On GitHub, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the site to
   `https://<your-user>.github.io/feeding/`.

> On a free GitHub plan, Pages only works for **public** repos. That's fine: the repo holds only app code. Your baby's data never leaves the phone.

## Install on your phone

- **iPhone:** open the URL in **Safari** → Share → **Add to Home Screen**. Always open it from the icon. Safari can clear data for sites you don't add to the Home Screen.
- **Android:** open it in Chrome → ⋮ → **Install app**.

## Where the data lives

Entries are stored in the browser's `localStorage` **on each device**. The app works fully offline. There are no accounts, no server and no tracking.

- Use **Settings → Export backup** now and then.
- To give a second caregiver the same history, export on phone A, send them the file (AirDrop or Messages), and **Import** it on phone B. Import merges by entry ID, so you can repeat it safely.
- Real-time sync between two phones would need a small backend. See below.

## Possible next step: live sync between parents

GitHub Pages only serves static files, so it can't store your data. If you both want to log on your own phones and see each other's entries, add a free hosted database:

- **Supabase** (free tier) or **Firebase Firestore** (free tier). Create one `events` table or collection and sign in with a magic link. All storage goes through `load()`, `save()` and `upsert()` in `app.js`, and every event already has a unique `id` and an `updated` timestamp, so syncing with last-write-wins only needs changes in those few places.

## Run locally

```sh
npx http-server -p 8080   # or: python3 -m http.server 8080
```

Then open http://localhost:8080.
