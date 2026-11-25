# Happy Valley Housing

A static website that shows every place to live near Penn State University Park on one map.

## Files
- `index.html`, `styles.css`, `app.js`: the site
- `config.js`: settings (Google Maps key)
- `data/listings.json`: the buildings (name, address, type, beds, price, location, website, photos)
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
