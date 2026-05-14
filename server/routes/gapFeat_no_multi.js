// === Batch 06 Gaps & Frontend Mounts ===
// Gap Feature: No multi
// No multi-user/household support
// Project: AINutritionDietitianAssistant
// Auto-generated v0 scaffold — review before production use.

const express = require('express');
const router = express.Router();
const auth = null;
let aiRateLimiter = null; try { aiRateLimiter = require('../middleware/rateLimiter').aiRateLimiter; } catch (_) {}
let _pool = null; try { _pool = require('../schema').pool; } catch (_) { try { _pool = require('../db').pool; } catch (_) {} }


let fetchFn = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : (typeof global !== 'undefined' ? global.fetch : null);
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch (_) { fetchFn = null; }
}

async function callLLM(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
  if (!fetchFn) throw new Error('fetch not available — install node-fetch or use Node 18+');
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'AINutritionDietitianAssistant / gap-no-multi',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens || 0,
    model: data.model || null,
  };
}

let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  if (!_pool) return;
  try {
    await _pool.query(`CREATE TABLE IF NOT EXISTS gap_features (
      id SERIAL PRIMARY KEY,
      feature_slug VARCHAR(120),
      user_id INTEGER,
      input JSONB,
      result TEXT,
      tokens_used INTEGER,
      model VARCHAR(120),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    _tableReady = true;
  } catch (e) {
    console.warn('gap_features table init failed:', e.message);
  }
}

router.post('/run', (req, res, next) => (aiRateLimiter ? aiRateLimiter(req, res, next) : next()), async (req, res) => {
  try {
    const payload = req.body || {};
    const systemPrompt = `You are an expert assistant for the gap feature: 'No multi'.\nProject: AINutritionDietitianAssistant.\nContext: No multi-user/household support\nReturn structured JSON with keys: { summary: string, recommendations: string[], risks: string[], next_steps: string[] }.`;
    const userPrompt = `Input payload:\n${JSON.stringify(payload, null, 2)}`;
    const out = await callLLM(systemPrompt, userPrompt);

    await ensureTable();
    let savedId = null;
    if (_pool && _tableReady) {
      try {
        const r = await _pool.query(
          'INSERT INTO gap_features (feature_slug, user_id, input, result, tokens_used, model) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          ['no-multi', req.user?.id || null, JSON.stringify(payload), out.content, out.tokensUsed, out.model]
        );
        savedId = r.rows[0]?.id || null;
      } catch (e) {
        console.warn('gap_features insert failed:', e.message);
      }
    }

    res.json({ ok: true, id: savedId, feature: 'no-multi', result: out.content, tokens_used: out.tokensUsed, model: out.model });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

router.get('/history', (req, res, next) => (aiRateLimiter ? aiRateLimiter(req, res, next) : next()), async (req, res) => {
  try {
    await ensureTable();
    if (!_pool || !_tableReady) return res.json({ items: [] });
    const r = await _pool.query(
      "SELECT id, input, result, tokens_used, model, created_at FROM gap_features WHERE feature_slug = $1 ORDER BY id DESC LIMIT 25",
      ['no-multi']
    );
    res.json({ items: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

module.exports = router;
