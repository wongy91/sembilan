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

## Releasing

Sembilan uses [Semantic Versioning](https://semver.org). The version in `package.json` is the one the app shows in Settings, next to the build fingerprint. Before 1.0, bump the minor version for new features and the patch version for fixes.

1. In `CHANGELOG.md`, move the entries under **Unreleased** into a new `## [x.y.z] - YYYY-MM-DD` section and update the compare links at the bottom.
2. Set `"version"` in `package.json` to `x.y.z`.
3. Commit, tag and push. Tags are bare version numbers, with no `v` prefix:

   ```bash
   git commit -am "Release x.y.z"
   git tag -a x.y.z -m "x.y.z"
   git push --follow-tags
   ```

4. Deploy with `npx wrangler deploy`.
5. Publish the GitHub release, using the changelog section as the notes: `gh release create x.y.z --title x.y.z --notes-file <notes>`.

## License

By contributing you agree that your contribution is licensed under the [GNU AGPL-3.0-or-later](LICENSE), the same as the rest of the project.
