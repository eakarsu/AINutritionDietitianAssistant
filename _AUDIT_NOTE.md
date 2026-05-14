# Audit Apply Note — AINutritionDietitianAssistant

Source: `_AUDIT/reports/batch_06.md` section 3.

## Original Recommendations
### Missing AI counterparts
- `/dietary-goal-forecast`
- `/allergy-detection`
- `/restaurant-nutrition-lookup`
- `/meal-prep-planner`

### Missing non-AI
- DB schema for core tables; fitness tracker sync; grocery list from meal plans; meal history/journaling; barcode scanner; social sharing

### Custom suggestions
- Voice food diary; nutrient gap identification; restaurant menu advisor; meal prep video tutorials; family nutrition sync

## Implemented
Added three endpoints in `server/index.js`:
- `POST /api/ai/dietary-goal-forecast`
- `POST /api/ai/allergy-detection`
- `POST /api/ai/meal-prep-planner`

Reused `queryAI`, `parseAIJson`, `auth`, `aiRateLimiter`, `persistAIResult`.

## Backlog
| Item | Tag |
|---|---|
| `/restaurant-nutrition-lookup` | MECHANICAL (would benefit from menu-photo upload variant) |
| Database schema (formal migrations) | MECHANICAL but multi-file |
| Fitbit/Apple Health sync | NEEDS-CREDS |
| Grocery list generator | MECHANICAL |
| Barcode scanner | NEEDS-PRODUCT-DECISION |
| Social sharing | NEEDS-PRODUCT-DECISION |
| Voice food diary | NEEDS-PRODUCT-DECISION |

## Apply pass 3 (frontend)

Action: **CREATED-FE**. The CRA client already had AICenterPage,
ChatPage, AIPredictivePage, AIHistoryPage, and per-feature AI forms,
but the three cross-resource endpoints added in pass 2
(`/api/ai/dietary-goal-forecast`, `/api/ai/allergy-detection`,
`/api/ai/meal-prep-planner`) were not surfaced anywhere. Added
`client/src/pages/AIAdvancedPage.js` with a 3-tool tab layout (form
per endpoint, 503/no-key error banner, reuses shared `api` axios
client + `AIOutput` renderer), registered the route `/ai-advanced`
in `App.js`, and added the sidebar link in `components/Layout.js`.
No new dependencies. Auth handled automatically by the existing
`api.js` request interceptor that attaches the Bearer token from
`localStorage`.

## Apply pass 4 (mechanical backlog)

Action: **IMPLEMENTED** two MECHANICAL backlog items.

Backend (`server/index.js`, two new routes appended before health check):
1. `POST /api/ai/restaurant-nutrition-lookup` — estimate the
   nutritional profile of a restaurant dish, with allergen flags and
   healthier alternatives. Body:
   `{ restaurant?, dish, modifications?, allergens_to_avoid?, user_goal? }`.
   Returns 503 when `OPENROUTER_API_KEY` is missing.
2. `POST /api/ai/grocery-list-from-meal-plans` — aggregate ingredients
   from a list of meal plans into a sectioned grocery list, accounting
   for pantry stock, household size, and budget. Same 503 behavior.

Both reuse `auth`, `aiRateLimiter`, `queryAI`, `parseAIJson`, and
`persistAIResult`. No schema changes, no new deps.

Frontend: extended existing `client/src/pages/AIAdvancedPage.js` with
two additional tools (`restaurant`, `grocery`) — added to the `tools`
array, added per-tab state, body builders, and form sections. The
existing 503/no-key amber banner already covers the new endpoints.

Syntax check: `node --check` PASS for `server/index.js`, babel JSX
parse PASS for `AIAdvancedPage.js`. Smoke test: started server on
port 3502, logged in as `demo@nutrition.com / password123`,
`/api/ai/restaurant-nutrition-lookup` returned a valid JSON nutrition
estimate.

Backlog (still not implemented): photo-based variants of
restaurant-nutrition (would need menu-photo upload pipeline),
formal DB migrations, Fitbit/Apple Health sync (NEEDS-CREDS), barcode
scanner / social sharing / voice food diary (NEEDS-PRODUCT-DECISION).

## Apply pass 5 (all backlog)

Action: **IMPLEMENTED** five remaining backlog items.
File touched: `server/index.js` (additive only).

1. `POST /api/ai/nutrient-gap-identifier` — **MECHANICAL** custom
   feature ("nutrient gap identification"). Estimates RDAs vs intake.
   503 + `missing: OPENROUTER_API_KEY` when unset.
2. `POST /api/ai/family-nutrition-sync` — **MECHANICAL** custom feature
   ("family nutrition sync"). Coordinates a per-member meal plan with
   shared grocery list.
3. `POST /api/ai/voice-food-diary-parse` — **NEEDS-PRODUCT-DECISION**.
   `// PRODUCT-DECISION:` accepts pre-transcribed text from the client
   (browser SpeechRecognition or Whisper) rather than wiring a
   server-side STT pipeline (heavy dep + infra). Persists into a new
   additive `food_logs` table (`CREATE TABLE IF NOT EXISTS`).
4. `POST /api/barcode-lookup` — **NEEDS-CREDS**. Documents env vars
   `BARCODE_API_KEY`, `BARCODE_API_URL`. Returns 503 + `missing:
   BARCODE_API_KEY` when unset; 501 when set (adapter not wired).
5. `POST /api/fitness-tracker-sync` — **NEEDS-CREDS**. Documents env
   vars `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, plus a comment
   noting Apple HealthKit requires a mobile companion app. Returns 503
   + `missing` when unset.

Syntax: `node --check index.js` PASS. Smoke test: started backend on
port 3619, demo login OK, both 503 endpoints returned the expected
`missing` fields, voice-food-diary-parse returned 400 on missing
transcript and the server stayed alive.

Backlog still untouched: photo-based menu-OCR variants (TOO-RISKY —
needs vision pipeline), formal DB migrations (out of scope —
multi-file), social sharing (NEEDS-PRODUCT-DECISION — privacy model),
real barcode/Fitbit vendor adapters (depends on chosen provider).
