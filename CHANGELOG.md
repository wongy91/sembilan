# Changelog

All notable changes to Sembilan are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The 3D buildings setting now also applies while navigating: the driving view tilts and shows buildings in 3D. Turning it on or off mid-drive takes effect immediately.
- The route line is slimmer and grows with zoom, like the major map apps: about 7 px at street level instead of 13, with a crisp outline, a fainter glow, and traffic colours covering the full line width.

## [0.2.0] - 2026-10-29

### Added

- Settings shows the running version and build, for example "Version 0.2.0 (9f1c5f6)", so you can check that a phone has picked up a deploy.

### Changed

- Lane guidance now traces the route you are driving, whichever provider planned it, 190 km at a time. TomTom routes get lanes along their own path: 3 of 22 turns on KLCC → Mid Valley, up from 1.
- Planning a route no longer makes an extra request for lane data; the trace runs once you start driving.

## [0.1.0] - 2026-10-29

First public release.

### Added

- Turn-by-turn navigation in the browser with English and Bahasa Melayu voice guidance.
- Routing through TomTom (live traffic), Valhalla and OSRM, with up to 3 alternatives, avoid tolls or highways, and automatic rerouting.
- PLUS Class 1 toll fares per route and per plaza.
- Alerts for speed cameras, toll plazas, traffic jams and community reports, and the next R&R on your side of the highway.
- Lane guidance from OpenStreetMap lane markings.
- Community reports stored in Cloudflare D1, confirmed or cleared by other drivers.
- Day and night map themes, 2D or 3D buildings, speed-limit sign, share ETA and a demo drive.
- Offline copy of the app, install prompts for Android, iPhone and Mac Safari, and full screen on Android while navigating.

[Unreleased]: https://github.com/wongy91/sembilan/compare/0.2.0...HEAD
[0.2.0]: https://github.com/wongy91/sembilan/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/wongy91/sembilan/releases/tag/0.1.0
