require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const TTLCache = require('./utils/cache');
const FLOOD_PRONE_ZONES = require('./data/floodZones');
const { generatePlan } = require('./services/geminiService');

const app = express();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY && require.main === module) {
  console.warn('WARNING: GEMINI_API_KEY is not set. /api/plan will return 500 until configured.');
}

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
app.use(cors({ origin: false }));
app.use(express.json({ limit: '20kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const ALLOWED_LANGUAGES = ['English', 'Kannada', 'Hindi'];
const ALLOWED_PHASES = ['before', 'during', 'after'];
const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const weatherCache = new TTLCache(CACHE_TTL_MS);
const locationCache = new TTLCache(CACHE_TTL_MS);

/** Sends a standard {error} JSON response; logs the cause server-side only. */
function sendError(res, status, message, err) {
  if (err) console.error(message, err);
  res.status(status).json({ error: message });
}

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
    const key = TTLCache.keyFor(lat, lon);

    const cached = weatherCache.get(key);
    if (cached) return res.json(cached);

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m&hourly=precipitation_probability,precipitation&daily=precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=3`;
      const resp = await fetch(url, { timeout: UPSTREAM_TIMEOUT_MS });
      if (!resp.ok) return sendError(res, 502, 'Weather provider unavailable');

      const data = await resp.json();
      weatherCache.set(key, data);
      res.json(data);
    } catch (err) {
      sendError(res, 500, 'Failed to fetch weather data', err);
    }
  }
);

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
    const key = TTLCache.keyFor(lat, lon);

    const cached = locationCache.get(key);
    if (cached) return res.json(cached);

    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const resp = await fetch(url, { timeout: UPSTREAM_TIMEOUT_MS });
      if (!resp.ok) return sendError(res, 502, 'Location provider unavailable');

      const raw = await resp.json();
      const result = {
        city: raw.city || raw.locality || raw.principalSubdivision || 'Unknown location',
        region: raw.principalSubdivision || '',
        country: raw.countryName || '',
      };
      locationCache.set(key, result);
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to resolve location', err);
    }
  }
);

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

    const { location, household, weatherSummary, language, simulateAlert } = req.body;
    const phase = req.body.phase || 'before';

    try {
      const plan = await generatePlan(GEMINI_API_KEY, { location, household, weatherSummary, language, phase, simulateAlert });
      res.json({ plan, floodProneZones: FLOOD_PRONE_ZONES });
    } catch (err) {
      sendError(res, err.status || 500, err.message || 'Server error generating plan', err);
    }
  }
);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Varsha Mitra running at http://localhost:${PORT}`);
  });
}

module.exports = app;