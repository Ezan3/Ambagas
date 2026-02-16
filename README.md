# AmbaGas

Public, frontend-only web app for splitting fuel costs across multiple trips.  
Built with React + Vite. No backend, no database, no accounts, and no external APIs.

## Features

- Global inputs:
  - Gas price (PHP/L)
  - Split count
- Multiple trip entries:
  - Date (YYYY-MM-DD)
  - Optional label
  - km/L
  - Distance (km)
- Per-trip calculations:
  - Liters used
  - Trip cost
  - PHP/km
- Totals:
  - Total distance
  - Total liters
  - Total cost
  - Overall PHP/km (weighted)
  - Large "Each person pays"
- Actions:
  - Add trip
  - Duplicate trip
  - Remove trip
  - Reset all (with confirmation)
- Share via URL:
  - Encodes full app state as JSON -> Base64URL in `?data=...`
  - Loads state from shared URL on page load
  - Copy link button with Clipboard API
  - Warns if link is long
- Persistence:
  - Uses `localStorage`
  - Shared URL state overrides local saved state
- OCR import from dashboard photo:
  - Uses `tesseract.js` client-side
  - No uploads
  - Grayscale + contrast preprocessing
  - OCR review modal with extracted candidates and editable values
  - Raw text debug section
  - Manual confirmation required before applying

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The build output is in `dist/`.

## Deploy to GitHub Pages (Static)

1. Push this project to a GitHub repository.
2. Build locally:
   ```bash
   npm install
   npm run build
   ```
3. Deploy `dist/` to GitHub Pages (choose one):
   - Option A: Use `gh-pages` branch manually.
   - Option B: Use GitHub Actions to upload `dist` artifact and deploy Pages.
4. In GitHub repo settings:
   - `Settings` -> `Pages`
   - Set source based on your chosen method.

This app is fully static and does not require any server.
