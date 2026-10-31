# Changelog

All notable changes to Sembilan are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.27.2] - 2026-10-31

### Fixed

- **The wrong traffic light was highlighted when turning across a dual carriageway.** The route passes two lights there: the one you stop at, then the other carriageway's a few metres later. The app now highlights the first one, where you actually wait, instead of whichever sat closer to the route line.

## [0.27.1] - 2026-10-31

### Fixed

- **A traffic light was highlighted on a free-left slip road** that skips the junction. Only lights the route actually drives through are highlighted now: within 5 m of the route line instead of 20 m. Across four test drives, wrong highlights dropped from 10 to 2. The trade-off is that 3 of 19 junctions where the light is mapped a little away from the road are no longer highlighted.

## [0.27.0] - 2026-10-31

### Changed

- **Toll stretches are jade instead of yellow dashes**: the part of your route on a toll road is now a calm jade green, blending smoothly from the blue over 150 m where it starts and ends, with a small TOL label where it begins and every kilometre. The yellow dashes were distracting and looked like slow traffic next to the orange jam band. It works the same on the route-choice screen and at night.

## [0.26.1] - 2026-10-31

### Changed

- **The road you've driven stays on the map, faded**: while navigating, the route behind the car is now drawn as a faded blue line instead of disappearing, like Waze's trail.

## [0.26.0] - 2026-10-31

### Changed

- **Traffic lights on your route stand out**: while navigating, the map shows one bigger traffic light for each junction your route goes through, and fades every other light. Before, every light looked the same, so a busy junction like Jalan Sultan Ismail showed 4 identical lights; now it shows 1 on your route and 3 faded. Lights you have passed fade too. Lights under a flyover your route crosses may still be highlighted, because OpenStreetMap doesn't say which level they're on.

## [0.25.1] - 2026-10-31

### Changed

- **Thinner traffic band**: the orange or red band around your route is now a thin edge, about 3 px each side instead of 7, so the blue route stays the main thing you see.

## [0.25.0] - 2026-10-31

### Changed

- **Jams on your route look like Waze**: the blue route line now stays on top, with an orange or red band around it where traffic is slow. Before, the jam colour covered the route and only a thin blue edge was left, which was hard to see on yellow highways.
- **Fewer unnecessary reroutes**: the app now waits until you're actually moving away from the route. GPS drift beside the road, a GPS jump while you're stopped in a jam, and driving through a wide toll plaza no longer reroute you. A real missed turn still reroutes in about 5 seconds at 50 km/h (4 before).
- **Steadier car arrow**: while you're on the route, the arrow and the map turn with the road instead of with every small GPS wobble. With the GPS heading swinging ±12°, the arrow used to tilt 8 to 12° off the road; now it stays within 1°.

### Fixed

- **Highway exits showed a straight arrow** with live traffic on, for example "Take the exit" for Exit 231 Ayer Keroh. They now show which side the exit is on: a left-exit arrow and "Take the exit on the left".

## [0.24.0] - 2026-10-31

### Added

- **Motorcycle mode**: turn on 🏍️ **Motorcycle** on the routes screen or in Settings, and routes avoid roads closed to motorcycles, like the SMART Tunnel (Kuchai Lama → KLCC goes via SPE and AKLEH instead, 15 km, about 1 minute longer). Motorcycle routes come from OpenStreetMap through Valhalla, so they don't use live traffic, don't show car toll fares and don't offer faster routes while you ride. A road only counts as closed if OpenStreetMap marks it so.

## [0.23.0] - 2026-10-31

### Changed

- **Faster reroute after a missed turn**: when you drive away from the route, the app now notices in about 3 seconds at 50 km/h instead of about 6, so the new route is ready around 50 m past the turn instead of 100 m. Small GPS wobbles and a missed highway exit still use the slower, careful check, so you don't get rerouted by mistake.

### Added

- **Spoken "Rerouting"**: you now hear "Rerouting" as soon as the app leaves your old route, then the first instruction of the new one ("In 500 meters, turn left onto Jalan Raja Chulan"). Before, it said nothing until the next turn of the new route came close.

## [0.22.1] - 2026-10-30

### Fixed

- **Petrol on your route found almost nothing.** In 0.22.0, ⛽ while driving often said "None ahead" even with stations right in front of you (Kuchai Lama → KLCC: 0 of the 7 on the route). It now uses every petrol station on the map (OpenStreetMap) along the next 50 km of your route, and works out each detour with Valhalla, so the same drive lists 6 stations from 250 m ahead, +0 to +6 min. Stations more than a 10-minute detour away, such as ones on the other side of a highway, are left out. It also works without signal, from the app's offline copy.

## [0.22.0] - 2026-10-30

### Added

- **Add a stop while driving**: tap a search result, or a petrol station or EV charger on the map, then **Add stop**. The route goes through the stop and carries on to your destination, and the voice tells you when it's coming up ("Your stop is on the left"). The stop shows under the arrival time with the distance to it; tap ✕ to remove it. **Go here instead** still replaces the destination. Before, tapping a place while driving always replaced the destination.
- **Petrol on your route**: while driving, ⛽ lists the stations ahead on your route, in the order you reach them, with how far ahead each is and the extra minutes it adds ("1.2 km · +1 min"). It looks up to 100 km ahead and leaves out stations more than a 10-minute detour away. If that search is unavailable, it shows nearby stations, as before.

## [0.21.0] - 2026-10-30

### Changed

- **Search tells branches apart, like Waze**: when several results share a name, each gets its neighbourhood ("Bubble Gum Wax (Bukit Jalil)", "Petronas (Salak South)"), and the nearest branch comes first. Different places that happen to share a name stay where they were, and two points of one landmark (like KLCC) aren't renamed.
- Businesses now show their street address ("No 1-21, Residensi Park, Persiaran Jalil Utama, Petaling") instead of only the town and the kind of business.

## [0.20.0] - 2026-10-30

### Added

- **EV chargers on the map**: from street-level zoom, chargers show as a green ⚡ icon with the operator underneath: Tesla, Gentari, ChargeSini, JomCharge, ChargEV, DC Handal or Shell Recharge. Tap one on the home screen to get directions. They come from OpenStreetMap, which lists far fewer chargers than petrol stations, so some chargers will be missing.

## [0.19.0] - 2026-10-30

### Added

- **Petrol stations on the map**: from street-level zoom, every petrol station shows as a pump icon with its brand underneath: Petronas, Shell, Petron, BHPetrol or Caltex. Tap one on the home screen to get directions. The stations come with the map itself, so there's nothing extra to download and they still show offline along a saved route.

## [0.18.1] - 2026-10-30

### Fixed

- In Safari (not the home-screen app), the menu and sound buttons could sit partly under the turn banner while driving. They now stay below it when the space Safari leaves for the status bar changes.

## [0.18.0] - 2026-10-30

### Added

- **Remove a recent place from search**: recent places in search, including the list you see when you tap search while driving, now have the same **⋯** button as on the home screen. Tap it, then **Remove from recent**. Search stays open.

## [0.17.3] - 2026-10-30

### Fixed

- Tapping search while driving opened a blank screen. It now lists your Home, Work, saved places and recent places, as the home screen does. Tap one to drive there.

## [0.17.2] - 2026-10-30

### Fixed

- Searching while driving still put the search box under the status bar on iPhone. 0.17.1 didn't fix it: the cause was the navigation panel's top spacing replacing the search screen's. The search box now sits below the status bar, as it does on the home screen.

## [0.17.1] - 2026-10-30

### Fixed

- On iPhone, tapping search while driving opened the keyboard with the search box pushed up under the status bar. The box now stays below the status bar.

## [0.17.0] - 2026-10-30

### Added

- **Traffic lights on the map**: when you zoom in to street level, traffic lights show as small icons at junctions (14,000+ across Malaysia, from OpenStreetMap). They're downloaded once, the first time you zoom in that far.

### Changed

- **Live traffic is on by default, like Waze**: the map shows only slow roads. Yellow means below 75% of normal speed, red below 35%, and dark red below 15% or closed. Free-flowing roads are no longer painted green. If you turned traffic off in Settings yourself, it stays off.
- The **Privacy** screen explains that, with live traffic on, the map area you're looking at goes to TomTom through Sembilan's server.

### Fixed

- Turning on live traffic while the map was still loading could leave the traffic layer missing until the day/night theme changed.

## [0.16.0] - 2026-10-30

### Added

- **Remove a recent place**: each recent place on the home screen has a **⋯** button. Tap it, then **Remove from recent**. The next recent place moves up.

### Fixed

- On the home screen, a list taller than the panel was cut off at the bottom and couldn't be scrolled. The list now scrolls under the search box, and dragging the handle or search box still moves the panel up and down.

## [0.15.2] - 2026-10-30

### Fixed

- The **Routes** list during a trip couldn't be scrolled, so routes below the screen were out of reach. It now scrolls, and so do search results while driving. Swiping the bottom panel up or down still opens and closes the trip menu.
- The menu button covered the **Routes** title. It's now hidden while the list is open, and the list stays below the turn banner on smaller phones.

## [0.15.1] - 2026-10-30

### Fixed

- Changing route while stopped looked broken: after **Go** in **Routes** (or **Switch** on a faster route), the map kept the old route and the arrival time showed "–" until the phone sent a new GPS position, which can take a while at a standstill. The new route, its instructions and the arrival time now appear straight away. The alternatives in **Routes** and a faster-route suggestion are also drawn on the map as soon as they arrive, instead of after the next GPS position.

## [0.15.0] - 2026-10-30

### Added

- **Highway exit signs**: for an exit or a fork with signposts, the turn banner shows a short instruction ("Keep right") with a green sign under it, like the one on the road: the exit number, the road number and up to three destinations ("Exit 3305B · E33 · Ipoh · Klang · Petaling Jaya"). Before, the banner read "E33 Keep right toward Ipoh / Klang", with no exit number.
- **Speeding ding**: a single ding when you go more than 5 km/h over the speed limit, at the same point where the speedometer turns red. It sounds once until you slow down to the limit, and at most once a minute. Muting the sound mutes it too.
- **Parking near your destination**: 1 km before you arrive, a card lists up to three car parks within 800 m of your destination. Tap **Go** to drive to one; the card closes by itself after 30 seconds. It isn't shown when you're already heading to a car park or the trip is shorter than 2 km.
- **Drive times on Home and Work**: the home panel shows how long it takes to drive there from where you are, with live traffic when it's available ("Home · 20 min"). It refreshes at most every 10 minutes, and tapping Home or Work reuses it, so routes appear without a second wait.
- **Map saved along your route**: when you start a trip, the map along the route is saved on your phone (up to 15 MB of map tiles), so tunnels and stretches without signal no longer show a blank map. Skipped when the phone's data saver is on.

### Changed

- The **Privacy** screen explains the new drive-time and parking lookups and the saved map.

## [0.14.1] - 2026-10-29

### Changed

- A bigger turn banner while driving, like Waze. The arrow, distance and road name are larger, and the road name is bright white on up to two lines instead of being cut off after one (17 → 24 px). Lane arrows are about 1.5 times the size (30 → 44 px), and on wide roads the lanes shrink to fit the screen. The menu and sound buttons and the alerts move down to stay clear of the taller banner.

## [0.14.0] - 2026-10-29

### Added

- **中文 (Simplified Chinese)**: the whole app, the turn-by-turn guidance ("500米后，左转，进入 Jalan Tun Razak") and the spoken alerts ("前方800米有测速相机，限速90"), with a Mandarin voice where the phone has one. Pick it in Settings → Language; a first visit starts in Chinese, Malay or English to match the phone.

### Changed

- The voice list in Settings shows only voices for the chosen language, and a voice picked for another language is no longer used to read this one.

### Fixed

- The settings dialog could be wider than the screen, with the close button off the edge, on phones with many voices.

## [0.13.0] - 2026-10-29

### Changed

- The arrival time and time left while driving now follow live traffic. Every 5 minutes TomTom re-times the rest of your route, so a jam that builds up after you set off shows in the ETA (for example 28 → 43 min), as do Share ETA and the current route in **Routes**.

## [0.12.0] - 2026-10-29

### Added

- **Faster route available**, like Waze. With live traffic, the app checks every 5 minutes whether a faster way has opened up. When one saves at least 3 minutes (and 5% of the time left), a card shows "10 min faster · via Jalan Syed Putra" and the voice says so. Tap **Switch** to take it or **Keep** to stay; the card closes by itself after 20 seconds and keeps your route. Both times come from TomTom at the same moment, so the saving compares like with like.

## [0.11.0] - 2026-10-29

### Added

- Errors that happen in the app are reported to the Worker's logs, so problems show up without a screenshot. Coordinates, IP addresses and web-address details are removed first, and at most five reports are sent per visit.
- Links shared on WhatsApp and social apps show a preview card with the Sembilan logo and "Free navigation for Malaysia".
- A **Privacy** screen in Settings, in English and Malay, explains what stays on your phone, what is sent to which service, and how long anything is kept.

### Changed

- The Worker limits how often one visitor can call the endpoints that use TomTom and PLUS (120 a minute for search, routing, fares and error reports; 600 traffic tiles a minute), so a single script can't use up the shared TomTom allowance.

### Fixed

- A browser that can't draw the map (WebGL turned off or unsupported, or the map library failed to download) showed a blank app with no text. Sembilan now explains why and still lets you search, use Home, Work and saved places, and open a place in Waze or Google Maps.

### Security

- The Worker no longer keeps a log line for every request. Those lines held the request address, which for search includes what you typed and your position; Cloudflare kept them for 3 days. Only error reports and Worker crashes are logged now.
- Security headers on every page and file: a Content-Security-Policy that allows only the services Sembilan uses, plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. Anything the policy blocks is reported like other errors.

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

[Unreleased]: https://github.com/wongy91/sembilan/compare/0.27.2...HEAD
[0.27.2]: https://github.com/wongy91/sembilan/compare/0.27.1...0.27.2
[0.27.1]: https://github.com/wongy91/sembilan/compare/0.27.0...0.27.1
[0.27.0]: https://github.com/wongy91/sembilan/compare/0.26.1...0.27.0
[0.26.1]: https://github.com/wongy91/sembilan/compare/0.26.0...0.26.1
[0.26.0]: https://github.com/wongy91/sembilan/compare/0.25.1...0.26.0
[0.25.1]: https://github.com/wongy91/sembilan/compare/0.25.0...0.25.1
[0.25.0]: https://github.com/wongy91/sembilan/compare/0.24.0...0.25.0
[0.24.0]: https://github.com/wongy91/sembilan/compare/0.23.0...0.24.0
[0.23.0]: https://github.com/wongy91/sembilan/compare/0.22.1...0.23.0
[0.22.1]: https://github.com/wongy91/sembilan/compare/0.22.0...0.22.1
[0.22.0]: https://github.com/wongy91/sembilan/compare/0.21.0...0.22.0
[0.21.0]: https://github.com/wongy91/sembilan/compare/0.20.0...0.21.0
[0.20.0]: https://github.com/wongy91/sembilan/compare/0.19.0...0.20.0
[0.19.0]: https://github.com/wongy91/sembilan/compare/0.18.1...0.19.0
[0.18.1]: https://github.com/wongy91/sembilan/compare/0.18.0...0.18.1
[0.18.0]: https://github.com/wongy91/sembilan/compare/0.17.3...0.18.0
[0.17.3]: https://github.com/wongy91/sembilan/compare/0.17.2...0.17.3
[0.17.2]: https://github.com/wongy91/sembilan/compare/0.17.1...0.17.2
[0.17.1]: https://github.com/wongy91/sembilan/compare/0.17.0...0.17.1
[0.17.0]: https://github.com/wongy91/sembilan/compare/0.16.0...0.17.0
[0.16.0]: https://github.com/wongy91/sembilan/compare/0.15.2...0.16.0
[0.15.2]: https://github.com/wongy91/sembilan/compare/0.15.1...0.15.2
[0.15.1]: https://github.com/wongy91/sembilan/compare/0.15.0...0.15.1
[0.15.0]: https://github.com/wongy91/sembilan/compare/0.14.1...0.15.0
[0.14.1]: https://github.com/wongy91/sembilan/compare/0.14.0...0.14.1
[0.14.0]: https://github.com/wongy91/sembilan/compare/0.13.0...0.14.0
[0.13.0]: https://github.com/wongy91/sembilan/compare/0.12.0...0.13.0
[0.12.0]: https://github.com/wongy91/sembilan/compare/0.11.0...0.12.0
[0.11.0]: https://github.com/wongy91/sembilan/compare/0.10.0...0.11.0
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
