# Feeding Log

A free, private, offline tracker for breastfeeding, bottles, pumping, diapers and sleep. It's a simple replacement for Nara Baby.

It's a **Progressive Web App (PWA)**: plain HTML, CSS and JS with no build step. It's hosted free on GitHub Pages and installed to your phone's home screen. You don't need an App Store developer account.

## Features

- **Nursing timer** with separate Left/Right sides. Tap a side to start, tap again to pause, or tap the other side to switch. Tap **✎ Edit** under a side to type in minutes or nudge it by ±1/±5. A running side keeps counting from the new time, so the same screen covers live timing, catching up a feed you forgot to start, and entering one after the fact. It remembers which side you ended on last time, and the timer keeps running if you close the app.
- **Bottle** (breast milk or formula). It starts from the last amount you entered.
- **Pumping** (left and right amounts).
- **Diaper**: wet, dirty, mixed or dry, with an optional rash flag.
- **Sleep** timer. You can backdate when the baby fell asleep and it counts from then, or set an earlier wake-up time when saving.
- **Notes** for medicine, temperature, milestones and so on.
- **Optional live sync** between both parents' phones (free Firebase backend, see below).
- **Home glance**: time since the last feed and the last diaper, plus today's totals.
- **History** as a day-by-day list or a scrollable **timeline** (days as columns, swipe sideways back through every day; time of day running down; durations shown as blocks), with filters. Tap any entry to edit or delete it (deletes can be undone).
- **Trends**: 7-day charts and the average time between feeds.
- ml or oz units. Auto, light and dark themes, plus a dim, red-shifted **Night** theme for 3 a.m. feeds.
- JSON backup and import (import merges entries), and CSV export for the pediatrician.
- **Import from Nara**: in Nara, go to Activity → tap the avatar next to the baby's name → **Export Data**, and save the CSV to Files. Then, in this app, go to **Settings → Import from Nara (CSV)**. A preview shows what will be added before anything is saved. Importing the same file again doesn't duplicate entries. Solids, growth, medicine and similar entries become notes.

## Deploy (one time, ~1 minute)

1. On GitHub, open **Settings → Pages → Build and deployment**.
2. Set **Source** to **Deploy from a branch**, choose the repo's default branch and the `/ (root)` folder, then **Save**.
3. After a minute or two the site is live at `https://<your-user>.github.io/feeding/`. Every later push to that branch updates it.

(Optional: `.github/workflows/pages.yml` deploys from a `main` branch via GitHub Actions instead. To use it, set Source to **GitHub Actions**.)

> On a free GitHub plan, Pages only works for **public** repos. That's fine: the repo holds only app code. Your baby's data never goes into it.

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
