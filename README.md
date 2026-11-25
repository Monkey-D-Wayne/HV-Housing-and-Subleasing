# Happy Valley Housing

A static website that shows every place to live near Penn State University Park on one map.

## Files
- `index.html`, `styles.css`, `app.js`: the site
- `config.js`: settings (Google Maps key)
- `data/listings.json`: the buildings (name, address, type, beds, price, location, website, photos)
- `sublets.html`, `sublets.css`, `sublets.js`: the student Sublets page (post, browse, verify)
- `supabase/setup.sql`: the sublets database; see `SUBLETS-SETUP.md` to turn it on
- `photos/`: free-license Penn State dorm photos from Wikimedia Commons (CC BY-SA)

## Map
With `googleMapsApiKey` set in `config.js`, the site uses Google Maps (Maps JavaScript API, with grouped price pins).
With it empty, it uses an OpenStreetMap street map instead.

Lock the key in Google Cloud Console: Credentials, then the key, then "Websites" restriction set to the site address (for example `https://USERNAME.github.io/*`), and API restriction set to Maps JavaScript API.

## Hosting
GitHub Pages: push these files to a repository, then Settings, Pages, "Deploy from a branch", `main`, `/ (root)`.

## Data notes
- Prices come from Penn State's Off-Campus Housing site, public listing sites and Penn State Housing 2026–27 rates, checked Nov 25, 2026.
- `ppm` is the lowest monthly cost per person. When `est` is true it was worked out from a whole-unit price divided by the most bedrooms.
- Building photos load from each building's own website and are credited there. Get the owner's permission before a public launch.

## Sublets
`sublets.html` lists student sublets and lease takeovers on the same kind of map.
- Posting and contacting need a confirmed @psu.edu email (one-time code, no password).
- Checks on each listing: Penn State student (all), Known building (picked from our building list and price fits), Real photos (4+ uploaded), Lease checked (an admin approved a private proof of residence). Listings with more checks rank higher.
- Scam checks: wording about wire transfers, gift cards, crypto, WhatsApp, "I'm away, I'll mail the keys" or pay-to-hold sends a listing to review; 3 reports hide it; 3 active listings per student; the poster's email and unit number are only shown to signed-in students.
- With `supabaseUrl` and `supabaseKey` empty in `config.js`, the page runs in demo mode. Setup steps: `SUBLETS-SETUP.md`.
