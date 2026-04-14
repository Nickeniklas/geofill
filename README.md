# geofill

A static browser geography game. Fill the map by typing region names.
Hosted on GitHub Pages — no build step, no npm, no framework.

## Play

Open `index.html` in a browser, or visit the live site on GitHub Pages.

## Run locally

```bash
# Python 3
python -m http.server 8080
# then open http://localhost:8080
```

> You must serve the files over HTTP (not `file://`) because the game fetches JSON and TopoJSON from CDNs.

## Deploy to GitHub Pages

1. Push the repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **Deploy from a branch**, branch `main`, folder `/` (root)
4. Save — the site will be live at `https://<username>.github.io/<repo>/`

## Set up Supabase (leaderboard)

1. Create a free project at [supabase.com](https://supabase.com)
2. Run the SQL in `CLAUDE.md` in the Supabase SQL editor
3. Copy your project URL and anon key into `config.js`

## Add a new map

See `CLAUDE.md` for step-by-step instructions.

## Maps

| Map | Regions | Description |
|-----|---------|-------------|
| Europe | 44 | Sovereign countries of Europe |
| European Capitals | 44 | Capital cities of Europe |
| European Seas | 8 | Major seas and bodies of water around Europe |
| United States | 50 | US states |

## Game modes

| Mode | Description |
|------|-------------|
| Classic | Type region names, timer counts up from first keystroke |
| Multiple Choice | Click the correct name from 4 options |

## URL format

```
game.html?map=europe&mode=classic
game.html?map=europe-capitals&mode=choice
game.html?map=europe-seas&mode=classic
game.html?map=usa&mode=choice
```
