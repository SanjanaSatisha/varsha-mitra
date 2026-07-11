const form = document.getElementById('formPanel');
const els = {
  location: document.getElementById('locationInput'),
  useLocationBtn: document.getElementById('useLocationBtn'),
  household: document.getElementById('householdInput'),
  language: document.getElementById('languageSelect'),
  alertToggle: document.getElementById('alertToggle'),
  generateBtn: document.getElementById('generateBtn'),
  errorMsg: document.getElementById('errorMsg'),
  loading: document.getElementById('loading'),
  results: document.getElementById('results'),
  alertBanner: document.getElementById('alertBanner'),
  rainNow: document.getElementById('rainNow'),
  rainChance: document.getElementById('rainChance'),
  rainTotal: document.getElementById('rainTotal'),
  headlineText: document.getElementById('headlineText'),
  planList: document.getElementById('planList'),
  weatherGuidance: document.getElementById('weatherGuidance'),
  checklistList: document.getElementById('checklistList'),
  travelAdvisory: document.getElementById('travelAdvisory'),
  zoneTags: document.getElementById('zoneTags'),
  safetyList: document.getElementById('safetyList'),
  weatherIcon: document.getElementById('weatherIcon'),
  lightningOverlay: document.getElementById('lightningOverlay'),
  locationStripText: document.getElementById('locationStripText'),
};

// ---------------------------------------------------------------------
// Ambient rain canvas — a lightweight particle system that reacts to
// actual fetched rainfall intensity (more/faster drops = heavier rain).
// Respects prefers-reduced-motion by rendering a static, non-animated frame.
// ---------------------------------------------------------------------
const RainScene = (() => {
  const canvas = document.getElementById('rainCanvas');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let drops = [];
  let intensity = 0.15; // 0 (dry) - 1 (heavy storm)
  let rafId = null;
  let width = 0, height = 0;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function makeDrop() {
    return {
      x: Math.random() * width,
      y: Math.random() * -height,
      len: 10 + Math.random() * 20,
      speed: 4 + Math.random() * 6,
      opacity: 0.15 + Math.random() * 0.25,
    };
  }

  function seedDrops() {
    const count = Math.round(30 + intensity * 220);
    drops = Array.from({ length: count }, makeDrop);
  }

  function drawFrame() {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(160, 210, 230, 0.5)';
    ctx.lineWidth = 1;
    drops.forEach((d) => {
      ctx.globalAlpha = d.opacity;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 2, d.y + d.len);
      ctx.stroke();
      d.y += d.speed * (0.6 + intensity);
      d.x -= 0.6;
      if (d.y > height) {
        d.y = -d.len;
        d.x = Math.random() * width;
      }
    });
    ctx.globalAlpha = 1;
    if (!reduceMotion) rafId = requestAnimationFrame(drawFrame);
  }

  function start() {
    resize();
    seedDrops();
    if (rafId) cancelAnimationFrame(rafId);
    drawFrame();
    if (reduceMotion) drawFrame(); // draw one static frame only
  }

  function setIntensity(mmPerHour) {
    // Rough mapping: 0mm -> light ambient drizzle, 10mm+ -> heavy storm
    intensity = Math.max(0.1, Math.min(1, mmPerHour / 10));
    seedDrops();
  }

  window.addEventListener('resize', () => {
    resize();
    seedDrops();
  });

  return { start, setIntensity };
})();

RainScene.start();

function flashLightning() {
  if (!els.lightningOverlay) return;
  els.lightningOverlay.classList.remove('flash');
  // Force reflow so the animation can restart if triggered again
  void els.lightningOverlay.offsetWidth;
  els.lightningOverlay.classList.add('flash');
}

function updateWeatherIcon(rainNowMm, rainChancePct) {
  if (!els.weatherIcon) return;
  let icon = '🌤️';
  if (rainNowMm >= 4) icon = '⛈️';
  else if (rainNowMm > 0) icon = '🌧️';
  else if (rainChancePct >= 60) icon = '🌦️';
  else if (rainChancePct >= 25) icon = '⛅';
  els.weatherIcon.textContent = icon;
}

let coords = { lat: 12.9716, lon: 77.5946 }; // default: Bengaluru

async function refreshLocationStrip() {
  if (!els.locationStripText) return;
  els.locationStripText.textContent = 'Detecting your location…';
  try {
    const [locResp, weatherResp] = await Promise.all([
      fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lon: coords.lon }),
      }),
      fetch('/api/weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lon: coords.lon }),
      }),
    ]);

    const locData = await locResp.json();
    const weatherData = await weatherResp.json();

    const place = locResp.ok
      ? [locData.city, locData.region].filter(Boolean).join(', ')
      : 'your area';
    const temp = weatherResp.ok && weatherData.current?.temperature_2m !== undefined
      ? `${Math.round(weatherData.current.temperature_2m)}°C`
      : null;

    els.locationStripText.textContent = temp
      ? `You're in ${place} · ${temp} right now`
      : `You're in ${place}`;

    if (weatherResp.ok) {
      updateWeatherIcon(
        weatherData.current?.precipitation ?? 0,
        weatherData.daily?.precipitation_probability_max?.[0] ?? 0
      );
    }
  } catch (err) {
    els.locationStripText.textContent = "Couldn't detect your location";
  }
}

refreshLocationStrip();

// Best-effort silent auto-locate on load: if the browser already has permission
// (or the OS/browser prompts natively), update the strip with the real city.
// Falls back to the default Bengaluru coordinates already shown above if denied/unsupported.
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      refreshLocationStrip();
    },
    () => {
      /* silently keep default city - user can still click "Use my location" */
    },
    { timeout: 6000 }
  );
}

els.useLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setError('Geolocation not supported in this browser.');
    return;
  }
  els.useLocationBtn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      els.location.value = `My current location (${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)})`;
      els.useLocationBtn.textContent = 'Use my location';
      refreshLocationStrip();
    },
    () => {
      setError('Could not get your location. Using default city.');
      els.useLocationBtn.textContent = 'Use my location';
    }
  );
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  generatePlan();
});

function setError(msg) {
  els.errorMsg.textContent = msg || '';
}

function setLoading(isLoading) {
  els.loading.hidden = !isLoading;
  els.generateBtn.disabled = isLoading;
  els.generateBtn.setAttribute('aria-busy', String(isLoading));
  if (isLoading) els.results.hidden = true;
}

function getSelectedPhase() {
  const checked = form.querySelector('input[name="phase"]:checked');
  return checked ? checked.value : 'before';
}

async function generatePlan() {
  setError('');

  if (!els.location.value.trim() || !els.household.value.trim()) {
    setError('Please fill in both location and household profile.');
    return;
  }

  setLoading(true);

  try {
    // 1. Fetch live weather
    const weatherResp = await fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.lat, lon: coords.lon }),
    });
    const weatherData = await weatherResp.json();
    if (!weatherResp.ok) throw new Error(weatherData.error || 'Weather fetch failed');

    const current = weatherData.current || {};
    const daily = weatherData.daily || {};
    const rainNowMm = current.precipitation ?? 0;
    const rainChancePct = daily.precipitation_probability_max?.[0] ?? 0;
    const rainTotalMm = (daily.precipitation_sum || []).reduce((a, b) => a + (b || 0), 0).toFixed(1);

    els.rainNow.textContent = `${rainNowMm} mm/h`;
    els.rainChance.textContent = `${rainChancePct}%`;
    els.rainTotal.textContent = `${rainTotalMm} mm`;

    RainScene.setIntensity(rainNowMm);
    updateWeatherIcon(rainNowMm, rainChancePct);

    const weatherSummary = `Current precipitation: ${rainNowMm}mm/h, temperature ${current.temperature_2m ?? '—'}°C, wind ${current.wind_speed_10m ?? '—'}km/h. Next 24h rain chance: ${rainChancePct}%. 3-day total forecast rainfall: ${rainTotalMm}mm.`;

    // 2. Generate personalized plan via Gemini
    const planResp = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: els.location.value,
        household: els.household.value,
        weatherSummary,
        language: els.language.value,
        phase: getSelectedPhase(),
        simulateAlert: els.alertToggle.checked,
      }),
    });
    const planData = await planResp.json();
    if (!planResp.ok) throw new Error(planData.error || 'Plan generation failed');

    renderPlan(planData.plan, planData.floodProneZones);
  } catch (err) {
    setError(err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

function renderPlan(plan, zones) {
  els.results.hidden = false;

  if (plan.alert_message && plan.alert_message !== 'null') {
    els.alertBanner.hidden = false;
    els.alertBanner.textContent = `⚠ ${plan.alert_message}`;
    RainScene.setIntensity(9);
    if (els.weatherIcon) els.weatherIcon.textContent = '⛈️';
    flashLightning();
    setTimeout(flashLightning, 900);
  } else {
    els.alertBanner.hidden = true;
  }

  els.headlineText.textContent = plan.headline || '';
  els.weatherGuidance.textContent = plan.weather_guidance || '';
  els.travelAdvisory.textContent = plan.travel_advisory || '';

  fillList(els.planList, plan.preparedness_plan);
  fillList(els.checklistList, plan.emergency_checklist);
  fillList(els.safetyList, plan.safety_recommendations);

  els.zoneTags.innerHTML = '';
  (zones || []).forEach((z) => {
    const tag = document.createElement('span');
    tag.className = `zone-tag ${z.risk}`;
    tag.textContent = `${z.name} · ${z.risk} risk`;
    els.zoneTags.appendChild(tag);
  });

  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillList(el, items) {
  el.innerHTML = '';
  (items || []).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}
