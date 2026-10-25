# OPTCG Deck Builder

Static One Piece Card Game deck builder. GitHub Pages publishes the `main` branch at <https://oso-cloud.github.io/optcg-deck-builder/> (no separate build). Pages caches files for about ten minutes, and an installed home-screen copy can keep showing that cached copy.

## App version

The app compares its build id with `version.json` on load and when it returns to the foreground. When they differ, it shows “A new update is available”. **Refresh** and **Update** clear Cache Storage, unregister any service worker, and reload. They do not touch `localStorage` or IndexedDB, so decks, notes, and win/loss records stay on the device.

The same id is stored in three places:

- `version.json` — `{ "version": "<id>" }`
- `index.html` — `<meta name="app-version" content="<id>">`
- `index.html` — the `custom-cards.js?v=<id>` and `card-news.js?v=<id>` script URLs, so those files are not reused from the HTTP cache after an update

A push to `main` runs `.github/workflows/stamp-version.yml`, which sets that id to the commit SHA and commits it. The stamp commit message includes `[skip ci]` so it does not stamp itself again.

To stamp a checkout by hand (if that workflow cannot push, for example because `main` rejects direct pushes), run this and commit the two files it changes:

```bash
python3 stamp_version.py
```

That writes the current commit SHA into `version.json` and `index.html`. The two ids have to match, or the update banner stays up.

## New-card announcement

`card-news.js` lists batches of card ids. The app opens that list on every page load. After it is closed, the **News** button in the top bar opens the same list again. Coming back to the app without a reload does not open it by itself.

Closing the list stores those batch ids in `localStorage` under `optcg_seen_card_news`. That only marks a batch as already noticed (a "New" label on a batch you have not closed yet, when more than one batch is listed). It does not hide the list. The key is not part of the deck save, so it does not change decks, notes, or win/loss records.

When you add cards, append a new object at the end of the array. The last object is the newest batch. Use a new `id` every time so that batch can be marked New:

```javascript
window.CARD_NEWS.push({
  id: "2026-11-op18-more",
  title: "More OP18 cards",
  ids: ["OP18-002", "OP18-004"]
});
```

The card data itself still goes in `custom-cards.js` (or arrives from the API). The announcement only lists ids that actually loaded, with each card's name, color, and number. The scripts that rewrite `custom-cards.js` leave `card-news.js` alone, so add the batch there by hand in the same change.
