# OB Tunes — Combined Web + Backend

This version removes the broken `SEARCH_UPSTREAM` / `STREAM_UPSTREAM` adapter configuration. There is **one project and one `npm run dev` command**.

## Requirements
- Node.js 20+
- npm
- Internet connection

No Deno and no API key are required.

## Development

```powershell
npm install
npm run dev
```

This starts:
- Vite frontend: `http://localhost:5173`
- OB Tunes API: `http://localhost:8000`

Vite proxies `/api/*` to port 8000.

## Production

```powershell
npm install
npm run build
npm start
```

Then open:

`http://localhost:8000`

The Node server serves the built frontend and API from the same process.

## API

```text
GET /api/health
GET /api/search?q=The%20Weeknd&filter=songs
GET /api/stream?id=J7p4bzqLvCw
```

The backend rotates through public Piped and Invidious instances. These services are third-party and can be unavailable or rate-limited. Invidious' current documentation warns that the public instance list is short because of ongoing YouTube issues, so provider failure cannot be completely eliminated with public instances. The backend therefore tries several providers instead of relying on one hard-coded instance.

## Why the previous project failed

The previous `backend/server.ts` was only an adapter. It required:

```text
SEARCH_UPSTREAM
STREAM_UPSTREAM
```

When those environment variables were empty, `/api/search` intentionally returned:

```json
{"success":false,"error":"Upstream API is not configured."}
```

This combined build removes that dependency and implements the provider layer directly.

## Legal note

OB Tunes is a client/application layer and does not own third-party music. Users are responsible for complying with copyright, provider terms, and applicable law. Public provider availability and playback are not guaranteed.
