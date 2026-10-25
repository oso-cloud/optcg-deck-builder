# OPTCG Deck Builder

Static One Piece Card Game deck builder. GitHub Pages publishes the `main` branch at <https://oso-cloud.github.io/optcg-deck-builder/> (no separate build). Pages caches files for about ten minutes, and an installed home-screen copy can keep showing that cached copy.

## App version

The app compares its build id with `version.json` on load and when it returns to the foreground. When they differ, it shows “A new update is available”. **Refresh** and **Update** clear Cache Storage, unregister any service worker, and reload. They do not touch `localStorage` or IndexedDB, so decks, notes, and win/loss records stay on the device.

The same id is stored in three places:

- `version.json` — `{ "version": "<id>" }`
- `index.html` — `<meta name="app-version" content="<id>">`
- `index.html` — the `custom-cards.js?v=<id>` script URL, so the card file is not reused from the HTTP cache after an update

A push to `main` runs `.github/workflows/stamp-version.yml`, which sets that id to the commit SHA and commits it. The stamp commit message includes `[skip ci]` so it does not stamp itself again.

To stamp a checkout by hand (if that workflow cannot push, for example because `main` rejects direct pushes), run this and commit the two files it changes:

```bash
python3 stamp_version.py
```

That writes the current commit SHA into `version.json` and `index.html`. The two ids have to match, or the update banner stays up.
