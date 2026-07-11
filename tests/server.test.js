const request = require('supertest');

// Ensure a dummy key exists so the app boots the same way it would in prod
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-for-unit-tests';

const app = require('../server');

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/weather - input validation', () => {
  it('rejects missing coordinates', async () => {
    const res = await request(app).post('/api/weather').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects out-of-range latitude', async () => {
    const res = await request(app).post('/api/weather').send({ lat: 999, lon: 77 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects out-of-range longitude', async () => {
    const res = await request(app).post('/api/weather').send({ lat: 12, lon: 999 });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid Bengaluru coordinates', async () => {
    const res = await request(app).post('/api/weather').send({ lat: 12.9716, lon: 77.5946 });
    // Either succeeds (200) or the upstream provider is unreachable in CI (502/500) -
    // what matters here is that valid input passes validation, not the network call itself.
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe('POST /api/plan - input validation', () => {
  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/plan').send({});
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unsupported language', async () => {
    const res = await request(app).post('/api/plan').send({
      location: 'Bengaluru',
      household: 'Family of 4',
      weatherSummary: 'Light rain expected',
      language: 'Klingon',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid event phase', async () => {
    const res = await request(app).post('/api/plan').send({
      location: 'Bengaluru',
      household: 'Family of 4',
      weatherSummary: 'Light rain expected',
      language: 'English',
      phase: 'yesterday',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects overly long household descriptions (payload bounds)', async () => {
    const res = await request(app).post('/api/plan').send({
      location: 'Bengaluru',
      household: 'x'.repeat(1000),
      weatherSummary: 'Light rain expected',
      language: 'English',
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a well-formed request (schema-valid, network call may vary)', async () => {
    const res = await request(app).post('/api/plan').send({
      location: 'Bengaluru',
      household: 'Family of 4 with a toddler',
      weatherSummary: 'Light rain expected, 40% chance',
      language: 'English',
      phase: 'before',
    });
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe('POST /api/location - input validation', () => {
  it('rejects missing coordinates', async () => {
    const res = await request(app).post('/api/location').send({});
    expect(res.statusCode).toBe(400);
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await request(app).post('/api/location').send({ lat: 999, lon: 999 });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid coordinates', async () => {
    const res = await request(app).post('/api/location').send({ lat: 12.9716, lon: 77.5946 });
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe('Security headers', () => {
  it('does not expose the x-powered-by header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets a content-security-policy header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('Rate limiting', () => {
  it('eventually rate-limits repeated requests', async () => {
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get('/api/health');
      if (res.statusCode === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
