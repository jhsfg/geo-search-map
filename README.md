# Geo Search Map — Interactive Company Map Search

> Full-screen, Google Maps-style geographic search interface built with **Leaflet.js**, **MarkerCluster**, and **PostgreSQL full-text search**. Search companies worldwide by keyword, view results as clustered map markers, and explore company details in a split-screen panel.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-business--yellowpages.com%2Fmap%2Fsearch-0284c7?style=flat-square)](https://www.business-yellowpages.com/map/search)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?style=flat-square&logo=leaflet)](https://leafletjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-336791?style=flat-square&logo=postgresql)](https://www.postgresql.org/)

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Backend Integration](#backend-integration)
- [API Specification](#api-specification)
- [Database Setup](#database-setup)
- [Configuration](#configuration)
- [Mobile Responsive](#mobile-responsive)
- [SEO Benefits](#seo-benefits)
- [License](#license)

---

## Features

### Map Interface (Google Maps Style)

- **Full-screen interactive map** — Leaflet + OpenStreetMap, no API key required
- **Three map layers** — Standard, Satellite (Esri), Dark (CARTO)
- **MarkerCluster** — City-level aggregation with cluster bubble sizes proportional to company count
- **City markers** — Circle pins with company count, hover tooltip, click-to-filter
- **User geolocation** — Browser `navigator.geolocation` with pulsing dot animation
- **Zoom controls** — Custom floating buttons, `flyTo` smooth animations

### Search & Results

- **Keyword search** — Press Enter to search (no debounced auto-fire)
- **Quick keyword chips** — 7 preset industry keywords (CNC, Aluminum, Valve, etc.)
- **Recent searches** — Saved in `localStorage`, click to re-run, max 8 entries
- **City filter** — Click a map marker to filter results to that city only
- **Infinite scroll** — Auto-loads next page when scrolling near bottom (30/page, max 210)
- **Request deduplication** — Sequence-number based stale response discarding

### Split-Screen Detail Panel

- **Push layout** — Panel expands from 0 to 24rem, map shrinks (no overlay occlusion)
- **Rich company info** — Logo, location, founded year, business type, address, contact (masked phone), products, about, website link
- **Fly-to on click** — Clicking a result card flies the map to the company's city
- **Mobile full-screen** — On mobile, detail panel covers 100vw, floating controls auto-hide

### Production-Ready

- **Zero dependencies** — Vanilla JS, no framework, no build step
- **CSS variables** — All colors/sizes via `:root` custom properties, easy theming
- **Rem units** — Responsive typography
- **Phone masking** — Privacy-preserving contact display (`123****7890`)
- **No API key required** — OpenStreetMap tiles are free

---

## Screenshots

> Add screenshots here after taking them from the live demo.

| World View | Search Results | Detail Panel |
|---|---|---|
| _Initial empty state_ | _Keyword "valve" with city markers_ | _Company detail split-screen_ |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Map rendering** | [Leaflet 1.9](https://leafletjs.com/) | Free, open-source, no API key, 43KB gzipped |
| **Marker clustering** | [Leaflet.markercluster 1.5](https://github.com/Leaflet/Leaflet.markercluster) | Smooth zoom/cluster animation, 40K+ markers capable |
| **Map tiles** | OpenStreetMap, Esri, CARTO | Three free tile providers |
| **Frontend** | Vanilla HTML5 + CSS3 + JavaScript (ES5) | Zero build step, zero framework lock-in |
| **Backend** | PHP (Webman framework) | Any framework works — see [Backend Integration](#backend-integration) |
| **Database** | PostgreSQL 13+ | Full-text search (`plainto_tsquery`) + materialized views |
| **Geographic data** | [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) | 150K+ cities with lat/lng, open data |

---

## Project Structure

```
geo-search-map/
├── index.html                  # Main HTML (entry point)
├── css/
│   └── map-search.css          # All styles (CSS variables, rem, responsive)
├── js/
│   └── map-search.js           # All logic (map init, search, markers, panel)
├── backend/
│   └── GeoSearchController.php  # Reference API implementation (PHP)
├── sql/
│   ├── mv_map_company_geo.sql  # Materialized view DDL
│   └── README.md               # SQL setup guide
├── screenshots/                # Add your screenshots here
├── LICENSE
└── README.md
```

---

## Quick Start

### Option A: Static Demo (No Backend)

The frontend works standalone — just open `index.html` in a browser. Search will call `/api/map/geo-search` and return nothing without a backend, but the UI/map/layers/geolocation all work.

```bash
git clone https://github.com/yourname/geo-search-map.git
cd geo-search-map
# Open index.html in a browser, or serve with any static server:
python -m http.server 8080
# Visit http://localhost:8080
```

### Option B: Full Stack (With Backend)

1. Set up PostgreSQL with the [materialized view](sql/mv_map_company_geo.sql)
2. Implement the [API endpoint](backend/GeoSearchController.php) in your framework
3. Set `window.GEO_SEARCH_API_URL` to your endpoint
4. Serve `index.html` + `css/` + `js/` as static files

---

## Backend Integration

The reference controller is in [`backend/GeoSearchController.php`](backend/GeoSearchController.php). It's written for the [Webman](https://github.com/walkor/webman) framework but works with any PHP framework (Laravel, Symfony, Slim, etc.) — just adapt the `Request` / `Db` / `json()` helpers.

### Key Points

1. **PostgreSQL full-text search** — Uses `plainto_tsquery('english', ?)` on a `tsvector` column. This is case-insensitive and supports natural language queries.
2. **Materialized view JOIN** — `mv_map_company_geo` provides pre-computed lat/lng per company. No runtime geocoding.
3. **City aggregation** — Results are grouped by `city_id` with `COUNT(*)` for marker sizing.
4. **Phone masking** — `substr(0,3) + **** + substr(-4)` for privacy.

### Non-PHP Backends

The API contract is simple — any backend can implement it:

| Required | Field |
|---|---|
| `q` (query param) | Search keyword, min 2 chars |
| `city_id` (query param, optional) | Filter to specific city |
| `page` (query param, optional) | Pagination, default 1 |
| Response JSON | `{ code: 0, data: { total, cities[], companies[], page, has_more } }` |

---

## API Specification

### `GET /api/map/geo-search`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search keyword (min 2 characters) |
| `city_id` | int | No | Filter results to a specific city |
| `page` | int | No | Page number (default 1, max 7) |

**Response (200 OK):**

```json
{
  "code": 0,
  "data": {
    "total": 4105,
    "cities": [
      {
        "id": 2643743,
        "name": "London",
        "state": "England",
        "country": "GB",
        "lat": 51.5074,
        "lng": -0.1278,
        "count": 152
      }
    ],
    "companies": [
      {
        "cid": 12345,
        "name": "Acme Industries Ltd",
        "logo": "https://example.com/logo.png",
        "products": "CNC Machining, Aluminum Parts",
        "city": "London",
        "state": "England",
        "country": "GB",
        "address": "123 Industrial Park",
        "founded": "2008",
        "biztype": "Manufacturer",
        "contact": "Mr. John Smith (CEO)",
        "tel": "123****7890",
        "mobile": null,
        "fax": null,
        "website": "example.com",
        "intro": "Leading CNC machining company...",
        "city_id": 2643743,
        "lat": 51.5074,
        "lng": -0.1278,
        "url": "/company/12345"
      }
    ],
    "page": 1,
    "has_more": true
  }
}
```

**Error Response:**

```json
{ "code": 1, "msg": "keyword too short" }
```

---

## Database Setup

### 1. Geographic Reference Data

Import the open-source [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) into PostgreSQL. This provides:

- `countries` table (250 rows, with ISO2/ISO3 codes)
- `states` table (~5,000 rows, with FIPS/ISO2 codes)
- `cities` table (~150,000 rows, with latitude/longitude)

### 2. Full-Text Search Index

Add a `tsvector` column to your company table:

```sql
ALTER TABLE your_company_table ADD COLUMN search_vector_col tsvector;

CREATE INDEX your_company_search_idx
  ON your_company_table
  USING gin(search_vector_col);

UPDATE your_company_table
SET search_vector_col =
  to_tsvector('english', coalesce(name, '') || ' ' || coalesce(products, ''));
```

### 3. Materialized View

Run [`sql/mv_map_company_geo.sql`](sql/mv_map_company_geo.sql) to create the geo-mapping view. See [`sql/README.md`](sql/README.md) for schema notes and the city normalization function.

### 4. Refresh Schedule

```sql
-- Refresh weekly during low-traffic hours
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_company_geo;
```

---

## Configuration

### API Endpoint

Set the API URL before the script loads:

```html
<script>window.GEO_SEARCH_API_URL = 'https://api.yoursite.com/geo-search';</script>
<script src="js/map-search.js"></script>
```

Or edit the constant directly in `js/map-search.js`:

```javascript
var API_URL = window.GEO_SEARCH_API_URL || '/api/map/geo-search';
```

### Theme Colors

All colors are CSS variables in `css/map-search.css`:

```css
:root {
    --ms-primary: #0284c7;       /* Main blue */
    --ms-primary-dark: #0369a1;   /* Hover blue */
    --ms-active: #ea580c;         /* Active marker orange */
    --ms-text: #0f172a;           /* Primary text */
    --ms-text-2: #64748b;         /* Secondary text */
    --ms-border: #e2e8f0;          /* Border color */
    --ms-panel-w: 24rem;          /* Panel width */
    --ms-radius: 1rem;             /* Border radius */
}
```

### Quick Keywords

Edit the chips in `index.html`:

```html
<button class="chip" data-q="your keyword">Label</button>
```

---

## Mobile Responsive

| Breakpoint | Behavior |
|---|---|
| Desktop (>768px) | Search card floats top-left, controls float bottom-right, detail panel = 24rem split |
| Mobile (<=768px) | Search card full width, results panel = 42vh, detail panel = 100vw (full screen) |
| Mobile + detail open | Floating controls (search/layers/zoom) auto-hide to avoid occlusion |

---

## SEO Benefits

This project enhances your website's SEO in several ways:

### 1. Indexable Geographic Content

Map pages are traditionally JS-heavy and hard for search engines to crawl. This project pairs the interactive map with server-rendered companion pages (`/map`, `/map/{country}`, `/map/{state}`) that contain crawlable HTML cards with company names, locations, and links — giving search engines structured geographic content.

### 2. Schema.org Structured Data

The companion feed cards use `itemscope itemtype="https://schema.org/Article"` with `itemprop` attributes for `headline`, `description`, `image`, `author`, `datePublished`, and `interactionStatistic` — enabling Google Rich Results.

### 3. Semantic HTML

- `<article>` for card containers (instead of `<div>`)
- `<time datetime="ISO8601">` for timestamps
- `<h3>` for post titles
- Proper `alt` text on all images

### 4. Internal Linking

Every map page links to:
- Country/state/city drill-down pages (`/map/{iso2}/{state}`)
- Company detail pages (`/details/{cid}/{country}/{name}`)
- This creates a deep internal link graph that search engines can follow

### 5. XML Sitemap Integration

Map URLs (`/map`, `/map/{iso2}`, `/map/{iso2}/{state}`) are included in the sitemap generation pipeline, ensuring search engines discover all geographic pages.

### 6. Core Web Vitals

- **LCP**: First 3 images use `loading="eager" fetchpriority="high"`, rest are `loading="lazy"`
- **CLS**: Images have explicit `width`/`height` attributes
- **FID**: Vanilla JS, no framework overhead, ~5KB gzipped

---

## License

[MIT](LICENSE) — Free for commercial and personal use.

---

## Acknowledgments

- [Leaflet.js](https://leafletjs.com/) — The leading open-source JavaScript library for maps
- [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) — Beautiful marker clustering
- [OpenStreetMap](https://www.openstreetmap.org/) — Free map tiles
- [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) — Open geographic reference data
- [Esri](https://www.esri.com/) — Satellite imagery tiles
- [CARTO](https://carto.com/) — Dark map tiles

---

## Live Demo

**[business-yellowpages.com/map/search](https://www.business-yellowpages.com/map/search)**

Part of [Business YellowPages](https://www.business-yellowpages.com/) — a global B2B company directory with 700K+ listings across 200+ countries.
