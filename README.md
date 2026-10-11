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
- **Optional live sync** between both parents' phones (free Firebase backend, see below).
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

Entries are saved on each phone, and the app works fully offline. There are no accounts and no tracking. With live sync turned on, each phone also mirrors its entries to your own free Firebase database. Both phones update within a second or two. Changes made offline upload when the phone is back online.

The dot next to the clock shows sync status: **green** means synced, **amber** means uploading, **hollow** means offline, and **red** means an error (details in Settings).

## Live sync between phones (one-time setup, ~5 minutes)

The site stays on GitHub Pages. Firebase only stores the data. The free "Spark" plan needs no credit card and covers this app many times over.

1. Go to https://console.firebase.google.com → **Create a project** (you can turn Google Analytics off).
2. **Build → Firestore Database → Create database**. Choose a location near you and start in **production mode**.
3. On the Firestore **Rules** tab, replace the contents with [`firestore.rules`](firestore.rules) from this repo, then **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
5. **Project settings** (gear icon) → **Your apps** → the web icon `</>` → register an app (no hosting needed). Copy the `firebaseConfig` values.
6. Put those values into [`sync-config.js`](sync-config.js) (edit it on GitHub and commit), replacing `null`.
7. Open the app on phone A → **Settings → Start syncing**. Tap **Share code** to send the code to phone B. On phone B, go to **Settings**, paste the code and tap **Join**. Entries already on each phone are merged.

Notes:
- Firebase web config values aren't secrets. Access is controlled by `firestore.rules`. The family code is the real key: anyone with it can read and edit the log, so only share it with your partner. GitHub may still flag the `apiKey` as a "secret". That alert is safe to close. Optionally, in Google Cloud Console → Credentials, restrict the key to the referrer `https://ryanwjohnston.github.io/*`.
- Nursing and sleep timers that are *running* stay on the phone that started them. Each one syncs when it's saved.
- **Delete all data** only clears this phone and stops syncing on it. The shared log isn't affected.
- Keep an occasional **Export backup** anyway.

## Run locally

```sh
npx http-server -p 8080   # or: python3 -m http.server 8080
```

Then open http://localhost:8080.
