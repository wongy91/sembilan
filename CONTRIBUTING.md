# Contributing to Sembilan

Thanks for helping. Bug reports, data fixes and pull requests are all welcome.

## Set up

You need Node.js 22.13 or later. There is nothing to install.

```bash
npm run dev    # http://localhost:8787
npm test       # runs every test in tests/
```

To test on a phone you need HTTPS (browsers only give GPS to `https://` or `localhost`): deploy your own copy (see the README) or use a tunnel.

## How the code is organised

- The app is plain ES modules in `public/src/`, loaded directly by the browser. There is no bundler and no npm dependencies; MapLibre GL JS comes from a CDN. Please keep it that way.
- Logic that can be tested without a browser (geometry, route parsing, guidance, toll matching, fares, lanes) lives in its own module and has tests in `tests/`.
- `worker/index.js` is the Cloudflare Worker: API routes plus static files.
- Test fixtures in `tests/fixtures/` are real responses saved from Valhalla, OSRM and Photon. Prefer adding a real response over hand-writing one.

## Pull requests

- Keep each pull request to one change, and explain what it fixes and why.
- Add or update a test for any logic change, and make sure `npm test` passes. GitHub Actions runs it on every pull request.
- For UI changes, include before and after screenshots, in day and night themes if colours change.
- Match the style of the surrounding code.
- Never commit API keys or other secrets. Keys belong in Worker secrets (`npx wrangler secret put`), or in an environment variable for local development.

## Map data

Wrong roads, missing U-turns, speed cameras and toll plazas come from OpenStreetMap. Fixing them at [openstreetmap.org](https://www.openstreetmap.org) helps every app that uses it; run `npm run data` to pull fresh toll and camera data into Sembilan.

## License

By contributing you agree that your contribution is licensed under the [GNU AGPL-3.0-or-later](LICENSE), the same as the rest of the project.
