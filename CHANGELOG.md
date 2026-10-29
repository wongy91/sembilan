# Changelog

All notable changes to Sembilan are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Errors that happen in the app are reported to the Worker's logs, so problems show up without a screenshot. Coordinates, IP addresses and web-address details are removed first, and at most five reports are sent per visit.

## [0.10.0] - 2026-10-29

### Added

- Search finds about 880,000 shops, restaurants and other businesses in Malaysia and Singapore from Overture Maps, including ones missing from OpenStreetMap and TomTom, such as "Signature Ayu Borneo @ Bloomsvale". The index is built with `npm run data:places` (needs DuckDB) and searched by the Worker.

### Changed

- Search results that match every word you typed come first. "mcdonalds" now also matches "McDonald's".

## [0.9.1] - 2026-10-29

### Changed

- A polished report button: an orange circle with a white speech-bubble icon.
- The navigation panel has four one-line actions (Routes, Overview, Sound, Share) and a separate, full-width **End trip** button.

## [0.9.0] - 2026-10-29

### Added

- The Go button on a place shows the drive time, for example "Go · 22 min".

### Changed

- Route planning starts as soon as you open a place, so tapping Go shows the routes almost instantly: 1.3 s to 0.03 s on fast 4G, 1.2 s to 0.03 s on a weak signal (median, KLCC to Mid Valley).

## [0.8.1] - 2026-10-29

### Fixed

- New versions are detected when you switch back to the app and every 30 minutes, not only when it is opened from scratch, so the Restart prompt shows up sooner on iPhone.
- The Restart prompt now also appears when an update arrives during your very first visit.

## [0.8.0] - 2026-10-29

### Changed

- Installing the app is now a clear call to action: a branded card with a big **Install app** button. It installs in one tap where the browser allows it, and otherwise shows step-by-step instructions for iPhone Safari, other iPhone browsers, Android, Mac Safari and in-app browsers (with a Copy link button, since those can't install). **Not now** hides it for 7 days instead of forever.

## [0.7.0] - 2026-10-29

### Added

- Saved places: tap ☆ Save on any place and give it your own name, such as "Mum's house". They appear under **Saved** on the home panel and in search with a ⭐, and tapping ★ Saved lets you rename or remove one. **Copy my places** links include them.
- When a new version is ready, a small prompt offers **Restart**. It never blocks anything and waits until navigation ends. Choosing Later keeps the current version until you next open the app.

## [0.6.0] - 2026-10-29

### Added

- Change route while navigating: **Routes** in the ⋯ panel lists your current route (Resume) and fresh alternatives from where you are (Go), each with time, ETA, distance, time saved, toll fare and a traffic strip. The alternatives are drawn on the map while the list is open, and switching keeps guidance running.

## [0.5.0] - 2026-10-29

### Added

- Nearby chips under the search bar: ⛽ Petrol, 🍜 Food, 🅿️ Parking and 🔌 EV charging, listed by distance. They also work from search while navigating.
- Every search result shows how far away it is.

### Changed

- Address search is much better with a TomTom key: queries that look like addresses (house numbers, Jalan, Taman, Lot…) also ask TomTom through the Worker, and TomTom fills in when the free search finds fewer than 3 places. The key never reaches the browser, and results are cached for 6 hours.

## [0.4.2] - 2026-10-29

### Changed

- The home panel slides with your finger instead of jumping between open and collapsed. Let go and it glides to whichever is closer, or follows a quick flick. The map buttons move with it.

## [0.4.1] - 2026-10-29

### Fixed

- The home panel can be collapsed: swipe it down to leave only the search bar, swipe up or tap the handle to bring back Home, Work and recent places. The choice is remembered, and search still shows your places while collapsed.

## [0.4.0] - 2026-10-29

### Added

- **Copy my places** in Settings: a private link with your Home, Work and recent places. Open it, or paste it into search, to add them on another phone or in the iPhone home-screen app, whose storage is separate from Safari's. The places travel after the `#`, so they never reach a server.
- Saving Home or Work asks the browser to keep the app's storage, so the phone is less likely to clear it.

### Fixed

- Settings and Report no longer slide under the status bar in the iPhone home-screen app, and the close button no longer shows a blue focus ring when a dialog opens.

## [0.3.2] - 2026-10-29

### Fixed

- In the iPhone home-screen app on iOS 26, a strip of empty background showed under the bottom panel. The app now fills the screen. This works around WebKit bug 301108 and changes nothing on Android or in a browser tab.
- Less empty space under the bottom panel: it now leaves room only for the home indicator.

## [0.3.1] - 2026-10-29

### Fixed

- Settings now always shows the version. On some iPhones the line was blank, because the version came from a message that could arrive late or not at all.

## [0.3.0] - 2026-10-29

### Added

- New app icon: the 9's loop holds a navigation arrow, on a blue map-style gradient. Full-bleed icons for iPhone and for Android's round masks.

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

[Unreleased]: https://github.com/wongy91/sembilan/compare/0.10.0...HEAD
[0.10.0]: https://github.com/wongy91/sembilan/compare/0.9.1...0.10.0
[0.9.1]: https://github.com/wongy91/sembilan/compare/0.9.0...0.9.1
[0.9.0]: https://github.com/wongy91/sembilan/compare/0.8.1...0.9.0
[0.8.1]: https://github.com/wongy91/sembilan/compare/0.8.0...0.8.1
[0.8.0]: https://github.com/wongy91/sembilan/compare/0.7.0...0.8.0
[0.7.0]: https://github.com/wongy91/sembilan/compare/0.6.0...0.7.0
[0.6.0]: https://github.com/wongy91/sembilan/compare/0.5.0...0.6.0
[0.5.0]: https://github.com/wongy91/sembilan/compare/0.4.2...0.5.0
[0.4.2]: https://github.com/wongy91/sembilan/compare/0.4.1...0.4.2
[0.4.1]: https://github.com/wongy91/sembilan/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/wongy91/sembilan/compare/0.3.2...0.4.0
[0.3.2]: https://github.com/wongy91/sembilan/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/wongy91/sembilan/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/wongy91/sembilan/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/wongy91/sembilan/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/wongy91/sembilan/releases/tag/0.1.0
