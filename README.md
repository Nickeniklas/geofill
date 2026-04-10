# geofill

A static browser geography game. Fill the map by typing country or state names.
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

| Map | Regions | Notes |
|-----|---------|-------|
| Europe | 44 countries | 5 microstates rendered as point markers |
| European Capitals | 44 capitals | Same shapes as Europe |
| United States | 50 states | AlbersUSA projection |

## Game modes

| Mode | Description |
|------|-------------|
| Classic | Type names, timer counts up |
| Multiple Choice | Click the correct name from 4 options |

## URL format

```
game.html?map=europe&mode=classic
game.html?map=usa&mode=choice
```
