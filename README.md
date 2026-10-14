# Games

A home-screen shelf for games published from GitHub. Open [games.timtsu.com](https://games.timtsu.com) in Safari, tap **Share**, then **Add to Home Screen**. Each tile opens that game on its own site, so its saves and offline play stay with the game.

## Add a game

1. Put a square PNG in [`catalog/icons/`](catalog/icons/).
2. Append an object to `games` in [`catalog/games.json`](catalog/games.json). To use a new category, add it to `categories` first, then list its `id` on the game. A game can belong to more than one category.
3. Push to `main`. The Pages workflow checks the catalog, builds, and publishes.

Chips show a category only when at least one game uses it.

```json
{
  "id": "mathtactics",
  "title": "Math vs. Robots",
  "tagline": "Fire the number that knocks the robot down.",
  "categories": ["learning"],
  "href": "https://mathtactics.timtsu.com",
  "repo": "ttsu/mathtactics",
  "icon": "mathtactics.png",
  "color": "#2f3e57"
}
```

`npm test` fails if an id is duplicated, a category id is unknown, the icon file is missing, or `href` is not `https`.

## Develop

Requires Node 22 (`nvm use`).

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

## Deploy (one time)

The workflow publishes `dist/` to the `gh-pages` branch. It cannot change repository settings.

1. Merge to `main` and let **Deploy to GitHub Pages** create the `gh-pages` branch. Do not create that branch by hand.
2. In **Settings → Pages**, set **Source** to **Deploy from a branch**, branch `gh-pages`, folder `/` (root).
3. Set **Custom domain** to `games.timtsu.com` and turn on **Enforce HTTPS**. [`public/CNAME`](public/CNAME) ships with every build.
4. Point DNS for `games.timtsu.com` at `ttsu.github.io` with a `CNAME` record.
5. In **Settings → Actions → General → Workflow permissions**, allow workflows to **read and write**.
