# geofill — Project Notes for Claude Code

## Overview

Static browser geography game hosted on GitHub Pages.
No build step, no npm, no framework. Pure HTML + CSS + JS.

Player fills a map by typing country/state names (or clicking in Multiple Choice mode).
Three game modes. Leaderboard stored in Supabase.

---

## Architecture

```
index.html          Home screen — map picker
game.html           Game screen — map + input + leaderboard modal
config.js           Supabase URL + anon key (safe to commit, anon key is public)
style/main.css      Shared theme, custom properties, home screen styles
style/game.css      Game-specific styles, SVG rules, animations, modal
js/game.js          Core engine: D3 map rendering, all 3 game modes, completion flow
js/leaderboard.js   Supabase read/write, table renderer
js/fuzzy.js         Levenshtein distance, normalize(), findNearMiss(), findExactMatch()
maps/europe.json    44 European countries (39 polygons + 5 point markers)
maps/usa.json       50 US states
assets/favicon.ico
```

## Key invariants

- All asset paths are **relative** (no leading `/`) so GitHub Pages works without a base URL
- `game.html` must serve over HTTP — it fetches JSON and CDN TopoJSON (no `file://`)
- CDN script load order: D3 → topojson-client → supabase-js → config.js → fuzzy.js → leaderboard.js → game.js
- `game.js` reads `window.d3`, `window.topojson`, `window.supabase` (UMD globals from CDNs)
- `config.js` sets `window.GEOFILL_CONFIG = { supabaseUrl, supabaseKey }` — never hardcode credentials elsewhere

## CDN versions pinned

| Library | Version | Purpose |
|---------|---------|---------|
| D3 | 7.9.0 | Map projection, SVG rendering, zoom/pan |
| topojson-client | 3.1.0 | Decode TopoJSON → GeoJSON features |
| supabase-js | 2.x (latest minor) | Leaderboard database |

---

## TopoJSON data sources

| Map | URL | Object key | Feature ID format |
|-----|-----|-----------|-------------------|
| Europe | `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json` | `countries` | 3-digit zero-padded ISO numeric string, e.g. `"008"` |
| USA | `https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json` | `states` | 2-digit zero-padded FIPS string, e.g. `"01"` |

**Critical:** The `isoNumeric` / `fips` fields in map JSON must exactly match the feature IDs —
they are strings, zero-padded. `"008"` ≠ `"8"`. `"01"` ≠ `"1"`.

---

## Map JSON schema

```json
{
  "id": "europe",
  "label": "Europe",
  "description": "44 sovereign countries of Europe",
  "topoJsonUrl": "...",
  "topoJsonObjectKey": "countries",
  "viewBox": "0 0 960 600",
  "projectionConfig": {
    "type": "mercator",
    "center": [15, 54],
    "scale": 500
  },
  "countries": [
    { "id": "germany", "name": "Germany", "isoNumeric": "276", "aliases": ["deutschland"] },
    { "id": "monaco",  "name": "Monaco",  "isoNumeric": "492", "isMarker": true, "lat": 43.7384, "lng": 7.4246, "aliases": [] }
  ]
}
```

- `id` — unique lowercase slug, used as `data-country-id` on SVG elements
- `isoNumeric` — for Europe (must match world-atlas feature.id exactly)
- `fips` — for USA (must match us-atlas feature.id exactly)
- `isMarker: true` + `lat`/`lng` — renders as a `<circle>` instead of a `<path>` (for microstates)

For USA, replace `isoNumeric` with `fips`.

### Projection types

- `"mercator"` — requires `center: [lng, lat]` and `scale`
- `"albersUsa"` — requires only `scale`; **do NOT add `center`** (AlbersUsa doesn't support it)

---

## Microstates / missing features

Five entries in `europe.json` are rendered as point markers (`isMarker: true`) because
they have no visible polygon in the 110m resolution dataset:
Andorra, Kosovo, Liechtenstein, Monaco, San Marino.

If a country has `isMarker: true`, the engine renders a `<circle r="5">` projected
from `[lng, lat]` rather than a `<path>`.

---

## How to add a new map

1. Create `maps/yourmap.json` following the schema above
2. Pick a TopoJSON source — world-atlas, natural-earth-1, or another CDN-hosted file
3. Find the correct feature ID format for that dataset (check a feature's `.id` in the browser console)
4. Add all regions with their feature IDs in `isoNumeric` or `fips`
5. Mark tiny/absent regions as `"isMarker": true` with `lat`/`lng`
6. Choose a projection: `mercator` (with `center` + `scale`) or another D3 projection name
   — to support a new projection type, add a case to `makeProjection()` in `js/game.js`
7. Add a map card to `index.html` with links to `game.html?map=yourmap&mode=classic` etc.

---

## Supabase setup

### Table schema (run in Supabase SQL editor)

```sql
create table scores (
  id uuid default gen_random_uuid() primary key,
  player_name text not null,
  map_id text not null,
  mode text not null,
  time_seconds integer not null,
  found_count integer not null,
  total_count integer not null,
  created_at timestamp with time zone default now()
);

alter table scores enable row level security;

create policy "Anyone can read scores"
  on scores for select using (true);

create policy "Anyone can insert scores"
  on scores for insert with check (true);
```

### Credentials

Edit `config.js`:
```js
window.GEOFILL_CONFIG = {
  supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
  supabaseKey: 'eyJhbGci...'   // anon/public key — safe to commit
};
```

The leaderboard gracefully shows "unavailable" when credentials are placeholder values.

---

## Running locally

```bash
# Python 3
python -m http.server 8080
# open http://localhost:8080
```

Must use HTTP — not `file://` — because the game fetches JSON files and CDN resources.

---

## Game modes

| mode param | Name | Behaviour |
|-----------|------|-----------|
| `classic` | Classic | Free typing, timer counts up from first keystroke |
| `timer` | Timer Challenge | Same as classic + personal best stored in localStorage |
| `choice` | Multiple Choice | Map highlights a random region, 4 buttons appear |

URL format: `game.html?map=europe&mode=classic`

---

## Personal best storage

Key: `geofill_pb_{mapId}_{mode}` — value is elapsed seconds as a string.
Only `classic` and `timer` modes track personal best.

---

## Future maps (not yet built)

- Africa
- Asia
- Nordics / Scandinavia
- South America

Add by following the "How to add a new map" steps above.
