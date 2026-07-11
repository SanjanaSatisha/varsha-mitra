require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();

// --- Security hardening ---
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors({ origin: false })); // same-origin only; no cross-site API use
app.use(express.json({ limit: '20kb' })); // small, bounded payloads only

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// A tiny hardcoded set of Bengaluru waterlogging-prone spots so the
// "travel advisory" feature feels hyperlocal without needing a GIS dataset.
const FLOOD_PRONE_ZONES = [
  { name: 'Silk Board Junction', risk: 'high' },
  { name: 'Bellandur', risk: 'high' },
  { name: 'KR Puram', risk: 'high' },
  { name: 'Yelahanka', risk: 'medium' },
  { name: 'Koramangala 80 Feet Road', risk: 'medium' },
  { name: 'Hebbal Underpass', risk: 'high' },
];

const ALLOWED_LANGUAGES = ['English', 'Kannada', 'Hindi'];
const ALLOWED_PHASES = ['before', 'during', 'after'];

// --- Efficiency: tiny in-memory TTL caches ---
// Rounds coordinates to ~1km precision so nearby requests share a cache entry,
// and avoids hammering upstream APIs on repeat demo clicks.
const weatherCache = new Map();
const locationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

// --- Weather: Open-Meteo (no API key required) ---
app.post(
  '/api/weather',
  [
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),
    body('lon').isFloat({ min: -180, max: 180 }).withMessage('lon must be between -180 and 180'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid coordinates', details: errors.array() });
    }

    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);
    const key = cacheKey(lat, lon);

    const cached = getCached(weatherCache, key);
    if (cached) {
      return res.json(cached);
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m&hourly=precipitation_probability,precipitation&daily=precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=3`;
      const resp = await fetch(url, { timeout: 8000 });
      if (!resp.ok) {
        return res.status(502).json({ error: 'Weather provider unavailable' });
      }
      const data = await resp.json();
      weatherCache.set(key, { data, time: Date.now() });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch weather data' });
    }
  }
);

// --- Reverse geocoding: resolve lat/lon to a human-readable place name ---
// Proxied server-side (rather than called from the browser) so it stays inside
// our CSP connect-src 'self' policy and doesn't need a client-exposed API key.
app.post(
  '/api/location',
  [
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),
    body('lon').isFloat({ min: -180, max: 180 }).withMessage('lon must be between -180 and 180'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid coordinates', details: errors.array() });
    }

    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);
    const key = cacheKey(lat, lon);

    const cached = getCached(locationCache, key);
    if (cached) {
      return res.json(cached);
    }

    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const resp = await fetch(url, { timeout: 8000 });
      if (!resp.ok) {
        return res.status(502).json({ error: 'Location provider unavailable' });
      }
      const raw = await resp.json();
      const result = {
        city: raw.city || raw.locality || raw.principalSubdivision || 'Unknown location',
        region: raw.principalSubdivision || '',
        country: raw.countryName || '',
      };
      locationCache.set(key, { data: result, time: Date.now() });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to resolve location' });
    }
  }
);

// --- Core: Gemini-generated personalized plan ---
app.post(
  '/api/plan',
  [
    body('location').trim().isLength({ min: 2, max: 200 }).escape(),
    body('household').trim().isLength({ min: 2, max: 500 }).escape(),
    body('weatherSummary').trim().isLength({ min: 2, max: 500 }),
    body('language').trim().isIn(ALLOWED_LANGUAGES).withMessage('Unsupported language'),
    body('phase').optional().trim().isIn(ALLOWED_PHASES).withMessage('Invalid phase'),
    body('simulateAlert').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid input', details: errors.array() });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server is not configured with an API key.' });
    }

    const { location, household, weatherSummary, language, simulateAlert } = req.body;
    const phase = req.body.phase || 'before';

    const phaseGuidance = {
      before: 'The monsoon/severe weather event has NOT yet arrived. Focus on preparation and readiness.',
      during: 'A severe weather event is happening RIGHT NOW. Focus on immediate safety actions.',
      after: 'The severe weather event has just passed. Focus on recovery, damage checks, and health/hygiene.',
    }[phase];

    const prompt = `You are Varsha Mitra, a monsoon preparedness assistant for citizens in India.

Household profile: ${household}
Location: ${location}
Current/forecast weather summary: ${weatherSummary}
Event phase: ${phase} — ${phaseGuidance}
Response language: ${language}
Simulated severe weather alert active: ${simulateAlert ? 'YES - a severe weather / flood alert has just been issued for this area' : 'No'}

Generate a personalized monsoon response as STRICT JSON ONLY (no markdown fences, no preamble, no explanation) matching exactly this schema:

{
  "headline": "short 1-sentence summary of today's situation for this household, appropriate to the event phase",
  "preparedness_plan": ["3-5 specific, personalized checklist items based on the household profile and event phase"],
  "weather_guidance": "2-3 sentences translating the weather data into plain-language, practical guidance for this specific household",
  "emergency_checklist": ["4-6 items, adjusted for household composition e.g. infants, elderly, pets, and for the event phase"],
  "travel_advisory": "1-2 sentences of travel/commute guidance",
  "safety_recommendations": ["3-4 concise safety tips relevant to the alert level and event phase"],
  "alert_message": "If a severe alert is active, write an urgent but calm 1-2 sentence alert in the requested language. If no alert, write null."
}

Respond ONLY in ${language} for all text values (keys must stay in English). Output raw JSON only.`;

    const body_ = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    };

    try {
      const resp = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body_),
        timeout: 15000,
      });

      const data = await resp.json();

      if (!resp.ok) {
        console.error('Gemini API error (status ' + resp.status + '):', JSON.stringify(data));
        return res.status(502).json({ error: 'Upstream generation error' });
      }

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleaned = rawText.replace(/```json|```/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return res.status(502).json({ error: 'Could not parse model output' });
      }

      res.json({ plan: parsed, floodProneZones: FLOOD_PRONE_ZONES });
    } catch (err) {
      console.error('Plan generation network/parse error:', err);
      res.status(500).json({ error: 'Server error generating plan' });
    }
  }
);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Generic error handler: never leak stack traces to the client
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

// Only start listening when run directly (keeps this importable in tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Varsha Mitra running at http://localhost:${PORT}`);
  });
}

module.exports = app;
