# Varsha Mitra 🌧️ — Monsoon Preparedness & Citizen Assistance

Built for **PromptWars (Google for Developers x Hack2skill)** — Challenge: Monsoon Preparedness & Citizen Assistance.

A GenAI-powered companion that turns live weather data + a household's profile into a **personalized** monsoon preparedness plan — checklists, weather-aware guidance, travel advisories, safety recommendations, and multilingual real-time alerts, tailored to **before, during, and after** a severe weather event.

## How it works
1. User enters location, household profile, and selects the event phase (before / during / after).
2. The app fetches live/forecast rainfall data from **Open-Meteo** (no key needed).
3. That data + the profile is sent to **Gemini 2.5 Flash**, which returns a structured JSON plan — checklist, weather guidance, emergency checklist, travel advisory, safety tips, and (if simulated) an urgent alert — translated into the user's chosen language (English / Kannada / Hindi).
4. A small hardcoded list of Bengaluru waterlogging-prone zones adds a hyperlocal travel-risk layer.

## Gen AI usage
- **Google Gemini 2.5 Flash** (`gemini-2.5-flash`) is used server-side in `server.js` (`/api/plan`) to generate the personalized preparedness plan, translate output into the selected language, and adapt guidance to the event phase — all returned as structured JSON via `responseMimeType: application/json`.

## Tech stack
- Node.js + Express (backend)
- Vanilla HTML/CSS/JS (frontend, no build step, accessible semantic markup)
- Gemini API for generation + translation
- Open-Meteo API for live weather

## Security measures
- `helmet` for secure HTTP headers + a Content-Security-Policy
- `express-rate-limit` on all `/api/*` routes (20 req/min per IP)
- `express-validator` for strict server-side input validation (coordinate ranges, language/phase allow-lists, payload length bounds)
- Bounded JSON payload size (20kb)
- API key stays server-side only (`.env`, gitignored) — never exposed to the client
- Generic error handler that never leaks stack traces
- `cors` locked to same-origin

## Testing
Run the automated test suite (Jest + Supertest):
```bash
npm test
```
Covers input validation, security headers, rate limiting, and health checks.

## Local setup
```bash
npm install
cp .env.example .env
# edit .env and paste your Gemini API key from https://aistudio.google.com/apikey
npm start
```
Visit `http://localhost:3000`.

## Deploying (Render)
1. Push this repo to GitHub (public, under 10MB).
2. Go to https://render.com → sign in with GitHub.
3. **New +** → **Blueprint** → select this repo (Render will read `render.yaml` automatically).
   - Alternatively: **New +** → **Web Service** → select repo → Build command `npm install`, Start command `npm start`.
4. Under **Environment**, add `GEMINI_API_KEY` with your real key (never commit it).
5. Deploy. Render gives you a public URL like `https://varsha-mitra.onrender.com` — that's your **Deployed Link**.

## Notes
- `.env` is gitignored — never commit your real API key.
- Repo is dependency-light and stays well under submission size limits.


## Vertical & Problem Alignment

**Chosen vertical: Societal Benefit — Monsoon Preparedness & Citizen Assistance.**

Every feature maps directly to the problem statement:
- **Personalization** → household profile + live weather + event phase are the three inputs to every generated plan, so no two households get the same output.
- **"Before / during / after"** → explicitly modeled as `phase`, with distinct AI guidance for each (preparation vs. real-time safety vs. recovery).
- **Real-world usability** → multilingual output (English/Kannada/Hindi) so the assistant is usable by non-English-speaking citizens in Bengaluru.
- **Practical, local relevance** → hyperlocal flood-zone travel advisory layered on top of AI guidance.

## Assumptions

- Household profile is self-reported free text (not a structured form) — the AI is trusted to parse composition (infants, elderly, pets) from natural language.
- Flood-prone zones are a fixed, hardcoded Bengaluru dataset (not live municipal data) — a deliberate scope decision for the hackathon timeframe, documented in `data/floodZones.js`.
- "Simulated alert" is a manual toggle standing in for a real government alert-feed integration, to demonstrate the alert-generation UX without needing live emergency API access.
- Weather data (Open-Meteo) is treated as authoritative; no cross-validation against a second weather source.