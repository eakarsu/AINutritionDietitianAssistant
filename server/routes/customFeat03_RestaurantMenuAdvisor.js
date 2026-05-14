// Custom Feature: Restaurant menu advisor
// Upload restaurant menu PDF; AI parses and ranks dishes by nutrition match to user goals
// Auto-generated v0 scaffold — review before production use.

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');

let fetchFn = global.fetch;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch (_) { fetchFn = null; }
}

// Minimal JWT auth — mirrors host inline server's expectation
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.userId || decoded.id;
    next();
  } catch (_) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

async function callLLM(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // TODO: configure credentials — set OPENROUTER_API_KEY in your .env
    throw new Error('OPENROUTER_API_KEY not configured');
  }
  if (!fetchFn) throw new Error('fetch not available — install node-fetch or use Node 18+');
  const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'AINutritionDietitianAssistant / cf-restaurant-menu-advisor',
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

function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const m = stripped.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

const TABLE_NAME = `custom_feat_cf_restaurant_menu_advisor`;
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        input JSONB,
        result TEXT,
        result_json JSONB,
        tokens_used INTEGER,
        model VARCHAR(120),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) { console.warn(`Could not ensure ${TABLE_NAME}:`, e.message); }
})();

router.post('/run', auth, async (req, res) => {
  try {
    const payload = req.body || {};
    const systemPrompt = `You are an expert assistant helping with the feature: 'Restaurant menu advisor'.
Context: Upload restaurant menu PDF; AI parses and ranks dishes by nutrition match to user goals
Project: AINutritionDietitianAssistant.
Return concise, actionable JSON with keys: { summary: string, recommendations: string[], risks: string[], next_steps: string[] }.
If input is insufficient, populate sensible defaults and note assumptions in summary.`;
    const userPrompt = `Input payload:\n${JSON.stringify(payload, null, 2)}`;
    const { content, tokensUsed, model } = await callLLM(systemPrompt, userPrompt);
    const parsed = parseJsonLoose(content);
    let savedId = null;
    try {
      const userId = req.user?.id || req.user?.userId || req.userId || null;
      const insert = await pool.query(
        `INSERT INTO ${TABLE_NAME} (user_id, input, result, result_json, tokens_used, model)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, payload, content, parsed, tokensUsed, model]
      );
      savedId = insert.rows[0]?.id || null;
    } catch (e) { console.warn(`Persist failed for ${TABLE_NAME}:`, e.message); }
    res.json({ ok: true, id: savedId, summary: parsed?.summary || content.slice(0, 600), result_json: parsed, raw: content, tokens_used: tokensUsed, model });
  } catch (err) {
    console.error('cf-restaurant-menu-advisor/run error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.userId || null;
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const rows = await pool.query(
      `SELECT id, input, result_json, tokens_used, model, created_at
       FROM ${TABLE_NAME}
       WHERE user_id IS NOT DISTINCT FROM $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    res.json({ ok: true, items: rows.rows });
  } catch (err) {
    console.error('history error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

module.exports = router;
