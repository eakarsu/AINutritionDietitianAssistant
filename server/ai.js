require('dotenv').config({ path: '../.env' });

const DEFAULT_MODEL = 'anthropic/claude-3-5-sonnet-20241022';

async function queryAI(prompt, systemMessage = 'You are an expert nutritionist and dietitian assistant. Provide detailed, professional, and helpful advice.', conversationHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const openRouterUrl = `${(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  // Build messages array: system + history + current user message
  const messages = [
    { role: 'system', content: systemMessage },
    ...conversationHistory,
    { role: 'user', content: prompt },
  ];

  const response = await fetch(openRouterUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'AI Nutrition Dietitian Assistant',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no message content');
  return content;
}

/**
 * 3-strategy JSON parser:
 * 1. Direct JSON.parse
 * 2. Strip markdown fences then parse
 * 3. Regex extract first {...} or [...] block
 */
function parseAIJson(content) {
  try {
    return JSON.parse(content);
  } catch {}

  try {
    const stripped = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    return JSON.parse(stripped);
  } catch {}

  try {
    const match = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[1]);
  } catch {}

  return { raw_text: content };
}

module.exports = { queryAI, parseAIJson };
