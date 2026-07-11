/**
 * geminiService.js — builds the prompt and calls Gemini 2.5 Flash to
 * generate a personalized monsoon preparedness plan as structured JSON.
 */
const fetch = require('node-fetch');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 15000;

const PHASE_GUIDANCE = {
  before: 'The monsoon/severe weather event has NOT yet arrived. Focus on preparation and readiness.',
  during: 'A severe weather event is happening RIGHT NOW. Focus on immediate safety actions.',
  after: 'The severe weather event has just passed. Focus on recovery, damage checks, and health/hygiene.',
};

/** Builds the full instruction prompt sent to Gemini for a given request. */
function buildPrompt({ location, household, weatherSummary, language, phase, simulateAlert }) {
  const guidance = PHASE_GUIDANCE[phase];

  return `You are Varsha Mitra, a monsoon preparedness assistant for citizens in India.

Household profile: ${household}
Location: ${location}
Current/forecast weather summary: ${weatherSummary}
Event phase: ${phase} — ${guidance}
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
}

/** Strips markdown code fences a model may wrap around JSON output. */
function stripCodeFences(text) {
  return text.replace(/```json|```/g, '').trim();
}

/**
 * Calls Gemini with the given params and returns the parsed JSON plan.
 * Throws an error with a `.status` property so route handlers can map it
 * straight to an HTTP response, keeping routes thin.
 */
async function generatePlan(apiKey, params) {
  if (!apiKey) {
    const err = new Error('Server is not configured with an API key.');
    err.status = 500;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(params) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    timeout: GEMINI_TIMEOUT_MS,
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error(`Gemini API error (status ${resp.status}):`, JSON.stringify(data));
    const err = new Error('Upstream generation error');
    err.status = 502;
    throw err;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    return JSON.parse(stripCodeFences(rawText));
  } catch {
    const err = new Error('Could not parse model output');
    err.status = 502;
    throw err;
  }
}

module.exports = { generatePlan };
