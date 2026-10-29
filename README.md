# Sembilan

[![Test](https://github.com/wongy91/sembilan/actions/workflows/test.yml/badge.svg)](https://github.com/wongy91/sembilan/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Free, open-source turn-by-turn navigation for Malaysia that runs in the browser. Voice guidance in English and Bahasa Melayu, PLUS toll fares, speed-camera and R&R alerts, live traffic, lane guidance and community reports. No app store and no sign-up.

## Features

| Area | What you get |
| -- | -- |
| Voice guidance | English or Bahasa Melayu, generated in the app: "Dalam 2 kilometer, ambil susur keluar 137 ke arah Simpang Pulai, Batu Gajah" |
| Routing | Up to 3 alternatives, avoid tolls or highways, automatic reroute when you leave the route. Mid-drive **Routes** shows your current route next to fresh alternatives, with time saved, tolls and a traffic strip, and switches in one tap. With live traffic, the app checks every 5 minutes for a faster way and offers it ("10 min faster · via Jalan Syed Putra", spoken too): **Switch**, **Keep**, or let it close after 20 seconds |
| Live traffic | Traffic-aware routes and a traffic layer from TomTom. The key stays on the server |
| Lane guidance | Lane arrows under the turn instruction, with the lanes to use lit up, wherever OpenStreetMap has lane markings |
| Toll fares | PLUS Class 1 fare for each route (KLCC → Simpang Pulai: RM 20.34), the amount due at each plaza, and the plazas the route actually drives through |
| Alerts | Speed cameras with their limit, toll plazas, traffic jams and community reports, spoken ahead of time |
| R&R | The next rest area on your side of the highway |
| Community reports | Accident, police, hazard, jam, road closed, flood, pothole. Other drivers confirm or clear them |
| Search | Places and street addresses with the distance to each. Nearby ⛽ petrol, 🍜 food, 🅿️ parking and 🔌 EV charging, also while driving. Addresses use TomTom when a key is set |
| Map | Day and night themes (automatic by time), 2D or 3D buildings, long-press to drop a pin |
| While driving | Arrival time that follows live traffic (refreshed every 5 minutes), speedometer with speed-limit sign, current street name, quick mute, search and settings, share ETA, arrival screen, screen stays awake |
| Saved places | Home, Work, your own named places (⭐ Save on any place) and recent places, kept on your phone. **Copy my places** makes a private link that adds them on another phone or in the home-screen app |
| Offline and install | Opens instantly from an offline copy. An **Install app** card installs it in one tap where the browser allows it, and otherwise shows step-by-step instructions for iPhone Safari, other iPhone browsers, Android, Mac Safari and in-app browsers. When a new version is ready, a small Restart prompt appears; it never interrupts navigation |

## Quick start

You need Node.js 22.13 or later. There are no npm dependencies to install.

```bash
git clone https://github.com/wongy91/sembilan.git
cd sembilan
npm run dev    # http://localhost:8787
npm test       # 64 tests
```

- **Business and shop search (optional).** Build the places index once with [DuckDB](https://duckdb.org) (`brew install duckdb`). It takes about 30 seconds. Without it, search uses Photon and TomTom only.

  ```bash
  npm run data:places   # writes public/data/places/ (~170 MB, ~1,700 files, not in git)
  ```

`npm run dev` serves the app and the API on one port, with community reports stored in an in-memory SQLite database. Use the **Demo** button on a route to drive it without moving.

- **Live traffic locally (optional).** Put a TomTom key in an environment variable; don't write it into a file.

  ```bash
  read -rs TOMTOM_API_KEY && export TOMTOM_API_KEY   # paste the key; it isn't shown or saved
  npm run dev
  ```

- **Reload twice after editing a file.** The app opens from its offline copy, so the first reload fetches your change and the second shows it.
- **On a phone** you need HTTPS, because browsers only give GPS to `https://` or `localhost`. Deploy your own copy (below) or use a tunnel.

## How it works

```
 Browser (public/)                                     Cloudflare Worker (worker/)
 ┌───────────────────────────────────────┐   /api/*    ┌──────────────────────────────────────┐
 │ MapLibre map · guidance engine ·      │────────────▶│ /api/route    TomTom routing         │
 │ voice · alerts · offline copy (sw.js) │             │ /api/traffic  TomTom traffic tiles   │
 └───┬──────────────┬─────────────┬──────┘             │ /api/reports  community reports (D1) │
     │              │             │                    │ /api/fares    PLUS toll fares        │
     ▼              ▼             ▼                    │ /api/search   TomTom search, nearby  │
 Valhalla /      Photon       OpenFreeMap              │ /api/places   Overture places index  │
 OSRM            (search)     (map tiles)              │ /api/log      browser error reports  │
 (routes, lanes)                                       └──────────────────────────────────────┘
```

1. **Routes.** The app asks TomTom through the Worker when a TomTom key is set, then falls back to Valhalla (FOSSGIS), then to the OSRM demo server. All three are converted to one route format in `public/src/providers.js`.
2. **Search.** Photon (OpenStreetMap) finds landmarks and streets; TomTom, through the Worker, finds house addresses; and `/api/places` searches about 880,000 shops, restaurants and other businesses in Malaysia and Singapore from [Overture Maps](https://overturemaps.org). Results that match every word you typed come first, then by distance.
3. **Extras on each route.** Toll plazas, speed cameras and R&R come from a bundled OpenStreetMap extract (`public/data/pois.json`). PLUS fares come from `/api/fares`. When you start driving, Valhalla traces the route you chose (whichever provider planned it) and returns the OpenStreetMap lane markings along it, 190 km at a time.
4. **Guidance.** `public/src/navigator.js` snaps each GPS fix to the route, decides what to say and when, and detects when you leave the route.
5. **Traffic check while driving.** Every 5 minutes with live traffic, the app sends the rest of your route (thinned to at most 1,500 points) to `/api/route`. The Worker asks TomTom to rebuild that route from those points and return only alternatives that beat it (`supportingPoints` with `alternativeType=betterRoute`), so both times use the same live traffic. The rebuilt route's timing replaces the one from the start of the trip, so the arrival time follows traffic. A faster route is offered when it saves at least 3 minutes and 5% of the time left, and not within 2 minutes of a route change, 10 minutes of a "Keep", or the last 10 minutes of the trip.
6. **Without the Worker** the app still routes, guides and alerts. Live traffic, reports and fares switch on only when `/api/health` reports them.
7. **Errors.** `public/src/errors.js` sends uncaught browser errors to `/api/log`, at most five per visit. The Worker writes them to [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) (`observability` in `wrangler.jsonc`), where they appear as `client-error` events. Per-request logs are switched off (`invocation_logs: false`), because request URLs carry search text and positions. Numbers with decimals (coordinates, IP addresses) and the query part of web addresses are removed on the phone and again in the Worker, and the browser is logged as a coarse name such as "Safari 26 on iOS 26".

### Project layout

| Path | What it is |
| -- | -- |
| `public/` | The web app, served as static files |
| `public/src/app.js` | Screens, state and wiring |
| `public/src/errors.js` | Sends browser errors to `/api/log` |
| `public/src/map.js` | Map view, route drawing, smooth driving camera |
| `public/src/navigator.js` | Guidance engine: snapping, announcements, off-route detection |
| `public/src/providers.js`, `routing.js` | Route requests and conversion from Valhalla, OSRM and TomTom |
| `public/src/pois.js`, `fares.js`, `lanes.js` | Tolls, cameras and R&R along a route; PLUS fares; lane guidance |
| `public/src/instructions.js`, `i18n.js`, `voice.js` | Spoken and written instructions in English and Malay |
| `public/data/` | Bundled toll plaza, camera and R&R data, and PLUS plaza codes |
| `worker/index.js` | Cloudflare Worker: API routes plus the static files |
| `migrations/` | D1 schema for community reports |
| `worker/places.js` | Builds and searches the Overture places index |
| `scripts/` | Dev server, data builders (including `build-places.mjs`), service-worker template and stamper |
| `tests/` | Unit tests (`node:test`) and saved API responses |

## Deploy your own

Sembilan runs on the Cloudflare Workers free plan.

```bash
npx wrangler login
npx wrangler d1 create sembilan                      # then put the new database_id in wrangler.jsonc
npx wrangler d1 migrations apply sembilan --remote
openssl rand -hex 32 | npx wrangler secret put REPORT_SALT
npx wrangler deploy
```

`npx wrangler deploy` first runs `scripts/stamp-sw.mjs`, which generates `public/sw.js` and `public/src/version.js` from the version in `package.json` and a fingerprint of the app files, so phones pick up each release and Settings shows which one is running.

For live traffic, create a free key at [developer.tomtom.com](https://developer.tomtom.com/) and run `npx wrangler secret put TOMTOM_API_KEY`; it prompts for the key.

Run `npm run data:places` before your first deploy if you want business search; the first upload of the index is about 170 MB, and later deploys only upload files that changed.

Shared links show a preview card from the `og:` tags in `public/index.html`. In a fork, change `og:url` and `og:image` to your own address; `scripts/social-preview.html` is the source of the preview image.

To host on any static host instead, run `node scripts/stamp-sw.mjs` and upload `public/`. Live traffic, reports, fares and business search need the Worker.

## Configuration

Everything secret is a Worker secret, set with `npx wrangler secret put <NAME>`. Never put keys in `wrangler.jsonc` or anywhere else in the repo.

| Name | Type | Used for |
| -- | -- | -- |
| `TOMTOM_API_KEY` | Secret, optional | Live-traffic routing, the traffic layer, speed limits, address search and nearby places. Without it, routing uses Valhalla and OSRM, and search uses Photon only |
| `REPORT_SALT` | Secret, recommended | Keeps reporter hashes from being traced back to IP addresses. Set it to a long random value |
| `DB` | D1 binding | Community reports. Without it, reports are switched off |
| `API_LIMIT`, `TILE_LIMIT` | [Rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) | Per-visitor limits on the endpoints that call TomTom and PLUS: 120 requests a minute for each of search, routing, fares and error reports, and 600 traffic tiles a minute. Over the limit the Worker answers 429 and the app falls back to its free providers. Many phones on a mobile network can share one IP address, so the limits are generous. Without the bindings, nothing is limited. Forks: each `namespace_id` must be unique in your Cloudflare account |

**Security headers.** `public/_headers` gives every static file a Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`; `npm run dev` applies the same file. When you add a provider the app fetches from, add its host to `connect-src`: `tests/headers.test.mjs` fails until you do. API responses come from the Worker and don't get these headers.

**Privacy.** The app's **Settings → Privacy** screen says the same in plain English and Malay; keep the two in step. Sembilan has no accounts and doesn't store anyone's location. Saved places stay on your phone; a **Copy my places** link carries them after the `#`, which browsers never send to a server. Your start point and destination go to the routing provider to plan the trip. A community report stores its type, position, heading, times and votes. To rate-limit reports and votes without storing IP addresses, it also stores a hash of the reporter's IP that changes daily. Error reports carry the error message, the app version, the screen it happened on and a coarse browser name, with coordinates and IP addresses removed; Workers Logs keeps them for 3 days on the free plan. To enforce the request limits, Cloudflare counts each IP address's requests over a minute; Sembilan doesn't store those counts or addresses.

## Data

`npm run data` rebuilds both bundled data files:

- `public/data/plus-plazas.json`: the 94 PLUS plaza codes and names, read from the fare calculator on www.plus.com.my.
- `public/data/pois.json`: toll plazas, speed cameras and R&R from OpenStreetMap, with PLUS codes matched by name (91 of 94).

### Places index (DuckDB)

`npm run data:places` builds the business search index from the latest monthly [Overture Maps](https://overturemaps.org) release. It needs the [DuckDB](https://duckdb.org) command-line tool (`brew install duckdb`, or a download from duckdb.org) and an internet connection; nothing to sign up for.

1. DuckDB reads Overture's public Parquet files straight from Amazon S3 and downloads only the Malaysia and Singapore rows it needs: named places with confidence 0.5 or higher that aren't marked closed (about 880,000).
2. `worker/places.js` turns them into an index sorted by word: about 1,700 files of 1,500 rows (around 100 KB each) plus a small `index.json` with the list of very common words that are not indexed.
3. The Worker answers `/api/places` by loading only the 1 to 3 files that hold the rarest word of a query, so a search costs about 1 to 3 ms of CPU, inside the free plan's 10 ms limit.

The output goes to `public/data/places/`, which is git-ignored and excluded from the app's offline copy. Re-run it monthly to pick up new Overture releases, then deploy. Set `OVERTURE_RELEASE=2026-10-21.0` to pin a release.

Fares are looked up live through `POST /api/fares`, which calls PLUS's fare service and caches each plaza pair for 12 hours. Each run of PLUS plazas is priced from its first plaza to its last. A run is split when the route passes another operator's plaza or leaves the expressways. Per-plaza amounts are shown only when they add up to the whole-trip fare.

Wrong roads, missing U-turns and missing cameras are OpenStreetMap data. Fix them at [openstreetmap.org](https://www.openstreetmap.org) and every app benefits.

## Limitations

- **Traffic and coverage.** Traffic comes from TomTom, not from millions of drivers like Waze, and community reports start with zero users. The OpenStreetMap extract (28 Oct 2026) has only 79 speed cameras for Malaysia.
- **Browser limits.** Guidance stops when the screen is off, and there is no CarPlay or Android Auto. That needs a native app. The map needs WebGL; without it, Sembilan offers search and saved places and hands the trip to Waze or Google Maps.
- **Lanes and speed limits.** Lanes appear only where OpenStreetMap mappers have tagged them, and arrive a few seconds after you start driving, longer when the free Valhalla server is busy. Speed limits need a TomTom key.
- **Toll fares** use PLUS's own fare service, the one its website calculator calls. It is undocumented and can change or block outside callers at any time; fares then disappear while navigation keeps working. Only PLUS is priced, Class 1 only, without discounts. Bandar Baru Nilai and Port Dickson Utara/Selatan have no clear OpenStreetMap match and show "fare unavailable".
- **Business search quality** follows Overture's data: some places have outdated names or positions, and a search matches word beginnings, so typos are not forgiven.
- **Search without a TomTom key** uses Photon only. It misses many house addresses, and its nearby results only include places whose names match the category (for example Petron for petrol).
- **Free public servers.** Valhalla (FOSSGIS), the OSRM demo server and Photon have fair-use policies and pick up map edits after a delay. Self-host Valhalla before real traffic arrives; a Malaysia–Singapore extract is small.
- **Voices** depend on the phone. Without a Malay voice it falls back to Indonesian, then the default voice.
- A toll plaza mapped as a single booth beside the lanes can be missed, for example the Second Penang Bridge plaza.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, follow [SECURITY.md](SECURITY.md). What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## License

Sembilan's code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). You can use, change and share it. If you run a modified version for other people, including as a website, you must offer them its source code.

Bundled data and assets keep their own licenses:

| What | License |
| -- | -- |
| `public/data/pois.json` and the saved route and search responses in `tests/fixtures/` | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) |
| `public/data/places/` (generated, not in git) | Overture Maps Foundation, [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/) |
| `public/fonts/` (Nunito) | [SIL Open Font License 1.1](public/fonts/OFL.txt) |
| MapLibre GL JS, loaded from a CDN | BSD-3-Clause |

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · tiles [OpenFreeMap](https://openfreemap.org) / OpenMapTiles · [MapLibre GL JS](https://maplibre.org) · routing [Valhalla](https://github.com/valhalla/valhalla) (FOSSGIS), [OSRM](https://project-osrm.org), [TomTom](https://developer.tomtom.com) · search [Photon](https://photon.komoot.io) (komoot) and [Overture Maps](https://overturemaps.org) places · toll fares PLUS Malaysia · font [Nunito](https://github.com/googlefonts/nunito).
