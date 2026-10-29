# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue. On GitHub, open the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it and what an attacker could do with it. You should get a reply within a week.

## Scope

In scope:

- The Cloudflare Worker in `worker/`: the API routes, input validation, rate limits, and handling of the TomTom key and other secrets.
- The web app in `public/`: anything that lets a page or a community report run code, or leak a user's location.

Out of scope: problems in third-party services Sembilan calls (OpenStreetMap, Valhalla, OSRM, Photon, TomTom, PLUS). Please report those to their owners.
