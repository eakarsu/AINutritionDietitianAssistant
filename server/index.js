const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const { queryAI, parseAIJson } = require('./ai');
const { aiRateLimiter } = require('./middleware/rateLimiter');
require('dotenv').config({ path: '../.env' });

const app = express();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.BACKEND_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// Ensure ai_results table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS ai_results (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    endpoint VARCHAR(100),
    feature_table VARCHAR(100),
    feature_id INTEGER,
    result TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(() => {});

// Ensure result_json columns on feature tables
const featureTablesWithJson = [
  'meal_plans',
  'recipes',
  'nutrient_analyses',
];
featureTablesWithJson.forEach(t => {
  pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS result_json JSONB`).catch(() => {});
});

// Helper: persist AI result to ai_results table
async function persistAIResult(userId, endpoint, featureTable, featureId, result) {
  try {
    await pool.query(
      'INSERT INTO ai_results (user_id, endpoint, feature_table, feature_id, result) VALUES ($1, $2, $3, $4, $5)',
      [userId, endpoint, featureTable, featureId, typeof result === 'string' ? result : JSON.stringify(result)]
    );
  } catch {}
}

// Multer setup for image uploads
const imageUpload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashed, name]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ==================== GENERIC CRUD HELPER (with pagination) ====================
function createCRUD(table, columns, aiField) {
  return {
    getAll: async (req, res) => {
      try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE user_id = $1`, [req.userId]);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
          `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [req.userId, limit, offset]
        );
        res.json({
          data: result.rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
      } catch (err) { res.status(500).json({ error: err.message }); }
    },
    getOne: async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    },
    create: async (req, res) => {
      try {
        const values = columns.map(c => {
          const val = req.body[c];
          return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val;
        });
        const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
        const result = await pool.query(
          `INSERT INTO ${table} (user_id, ${columns.join(', ')}) VALUES ($1, ${placeholders}) RETURNING *`,
          [req.userId, ...values]
        );
        res.json(result.rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    },
    update: async (req, res) => {
      try {
        const sets = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
        const values = columns.map(c => {
          const val = req.body[c];
          return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val;
        });
        const result = await pool.query(
          `UPDATE ${table} SET ${sets} WHERE id = $1 AND user_id = $2 RETURNING *`,
          [req.params.id, req.userId, ...values]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    },
    delete: async (req, res) => {
      try {
        const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2 RETURNING *`, [req.params.id, req.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted successfully' });
      } catch (err) { res.status(500).json({ error: err.message }); }
    }
  };
}

// ==================== MEAL PLANS ====================
const mealPlansCRUD = createCRUD('meal_plans', ['title', 'goal', 'calories_target', 'meals', 'ai_suggestions']);
app.get('/api/meal-plans', auth, mealPlansCRUD.getAll);
app.get('/api/meal-plans/:id', auth, mealPlansCRUD.getOne);
app.post('/api/meal-plans', auth, mealPlansCRUD.create);
app.put('/api/meal-plans/:id', auth, mealPlansCRUD.update);
app.delete('/api/meal-plans/:id', auth, mealPlansCRUD.delete);
app.post('/api/meal-plans/ai-generate', auth, aiRateLimiter, async (req, res) => {
  try {
    const { goal, calories_target, dietary_preferences } = req.body;
    const prompt = `Create a detailed daily meal plan with the following requirements:
    - Goal: ${goal}
    - Target calories: ${calories_target}
    - Dietary preferences: ${dietary_preferences || 'None'}

    Return a JSON object with:
    {
      "title": "Plan title",
      "meals": {
        "breakfast": {"foods": [], "calories": 0},
        "lunch": {"foods": [], "calories": 0},
        "dinner": {"foods": [], "calories": 0},
        "snacks": {"foods": [], "calories": 0}
      },
      "total_calories": 0,
      "nutritional_highlights": [],
      "tips": []
    }
    Respond ONLY with valid JSON.`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/meal-plans/ai-generate', 'meal_plans', null, parsed);
    res.json({ ai_suggestions: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== CALORIE TRACKER ====================
const caloriesCRUD = createCRUD('calorie_entries', ['food_name', 'portion_size', 'calories', 'protein', 'carbs', 'fat', 'meal_type', 'ai_analysis']);
app.get('/api/calories', auth, caloriesCRUD.getAll);
app.get('/api/calories/:id', auth, caloriesCRUD.getOne);
app.post('/api/calories', auth, caloriesCRUD.create);
app.put('/api/calories/:id', auth, caloriesCRUD.update);
app.delete('/api/calories/:id', auth, caloriesCRUD.delete);
app.post('/api/calories/ai-analyze', auth, aiRateLimiter, async (req, res) => {
  try {
    const { food_name, portion_size } = req.body;
    const prompt = `Analyze the nutritional content of: ${food_name} (${portion_size}).
    Provide:
    1. Estimated calories
    2. Protein (g), Carbs (g), Fat (g)
    3. Key vitamins and minerals
    4. Health benefits and concerns
    5. Healthier preparation tips`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/calories/ai-analyze', 'calorie_entries', null, aiResponse);
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/calories/ai-photo-analyze - vision AI for food photos
app.post('/api/calories/ai-photo-analyze', auth, aiRateLimiter, imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch {}

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet-20241022';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'AI Nutrition Dietitian Assistant',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
              {
                type: 'text',
                text: 'Identify all foods visible in this image and estimate calories, protein, carbs, fat for each item. Return a JSON array of objects: [{"food": "name", "quantity": "estimated quantity", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}]. Respond ONLY with valid JSON array.',
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';
    const foodItems = parseAIJson(content);

    // Calculate totals
    const items = Array.isArray(foodItems) ? foodItems : (foodItems.raw_text ? [] : [foodItems]);
    const totalCalories = items.reduce((sum, i) => sum + (i.calories || 0), 0);
    const totalProtein = items.reduce((sum, i) => sum + (i.protein_g || 0), 0);
    const totalCarbs = items.reduce((sum, i) => sum + (i.carbs_g || 0), 0);
    const totalFat = items.reduce((sum, i) => sum + (i.fat_g || 0), 0);

    // Create a calorie entry record
    let entryRow = null;
    if (items.length > 0) {
      const insertResult = await pool.query(
        `INSERT INTO calorie_entries (user_id, food_name, portion_size, calories, protein, carbs, fat, meal_type, ai_analysis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.userId, `Photo: ${items.map(i => i.food).join(', ')}`, 'estimated from photo',
          totalCalories, totalProtein, totalCarbs, totalFat, 'Other', JSON.stringify(items)]
      );
      entryRow = insertResult.rows[0];
    }

    await persistAIResult(req.userId, '/calories/ai-photo-analyze', 'calorie_entries', entryRow?.id, items);

    res.json({
      foods: items,
      totals: { calories: totalCalories, protein_g: totalProtein, carbs_g: totalCarbs, fat_g: totalFat },
      calorie_entry: entryRow,
    });
  } catch (err) {
    console.error('Photo analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== RECIPES ====================
const recipesCRUD = createCRUD('recipes', ['title', 'description', 'ingredients', 'instructions', 'prep_time', 'cook_time', 'servings', 'cuisine', 'dietary_tags']);
app.get('/api/recipes', auth, recipesCRUD.getAll);
app.get('/api/recipes/:id', auth, recipesCRUD.getOne);
app.post('/api/recipes', auth, recipesCRUD.create);
app.put('/api/recipes/:id', auth, recipesCRUD.update);
app.delete('/api/recipes/:id', auth, recipesCRUD.delete);
app.post('/api/recipes/ai-generate', auth, aiRateLimiter, async (req, res) => {
  try {
    const { ingredients, dietary_preferences, cuisine } = req.body;
    const prompt = `Create a detailed recipe using these ingredients: ${ingredients}.
    Preferences: ${dietary_preferences || 'None'}
    Cuisine: ${cuisine || 'Any'}

    Return a JSON object:
    {
      "title": "Recipe name",
      "description": "Brief description",
      "ingredients": [{"item": "...", "amount": "..."}],
      "instructions": ["step 1", "step 2"],
      "prep_time": 0,
      "cook_time": 0,
      "servings": 0,
      "cuisine": "...",
      "dietary_tags": [],
      "nutritional_highlights": []
    }
    Respond ONLY with valid JSON.`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/recipes/ai-generate', 'recipes', null, parsed);
    res.json({ ai_recipe: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== NUTRIENT ANALYSIS ====================
const nutrientsCRUD = createCRUD('nutrient_analyses', ['food_items', 'total_calories', 'vitamins', 'minerals', 'macros', 'ai_analysis']);
app.get('/api/nutrients', auth, nutrientsCRUD.getAll);
app.get('/api/nutrients/:id', auth, nutrientsCRUD.getOne);
app.post('/api/nutrients', auth, nutrientsCRUD.create);
app.put('/api/nutrients/:id', auth, nutrientsCRUD.update);
app.delete('/api/nutrients/:id', auth, nutrientsCRUD.delete);
app.post('/api/nutrients/ai-analyze', auth, aiRateLimiter, async (req, res) => {
  try {
    const { food_items } = req.body;
    const prompt = `Perform a detailed nutritional analysis for this meal: ${JSON.stringify(food_items)}.
    Return a JSON object:
    {
      "total_calories": 0,
      "vitamins": {"vitamin_a": {"amount": "...", "dv_percent": 0}, "vitamin_c": {"amount": "...", "dv_percent": 0}},
      "minerals": {"calcium": {"amount": "...", "dv_percent": 0}},
      "macros": {"protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0},
      "strengths": [],
      "gaps": [],
      "suggestions": []
    }
    Respond ONLY with valid JSON.`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/nutrients/ai-analyze', 'nutrient_analyses', null, parsed);
    // Update result_json on any existing record if an id was passed
    if (req.body.record_id) {
      await pool.query('UPDATE nutrient_analyses SET result_json = $1 WHERE id = $2 AND user_id = $3', [parsed, req.body.record_id, req.userId]).catch(() => {});
    }
    res.json({ ai_analysis: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== DIET RECOMMENDATIONS ====================
const dietRecsCRUD = createCRUD('diet_recommendations', ['goal', 'current_weight', 'target_weight', 'activity_level', 'dietary_preference', 'restrictions', 'ai_recommendation']);
app.get('/api/diet-recs', auth, dietRecsCRUD.getAll);
app.get('/api/diet-recs/:id', auth, dietRecsCRUD.getOne);
app.post('/api/diet-recs', auth, dietRecsCRUD.create);
app.put('/api/diet-recs/:id', auth, dietRecsCRUD.update);
app.delete('/api/diet-recs/:id', auth, dietRecsCRUD.delete);
app.post('/api/diet-recs/ai-recommend', auth, aiRateLimiter, async (req, res) => {
  try {
    const { goal, current_weight, target_weight, activity_level, dietary_preference, restrictions } = req.body;
    const prompt = `Provide a personalized diet recommendation:
    - Goal: ${goal}
    - Current weight: ${current_weight} lbs
    - Target weight: ${target_weight} lbs
    - Activity level: ${activity_level}
    - Dietary preference: ${dietary_preference}
    - Restrictions: ${restrictions || 'None'}

    Include: daily calorie target, macro breakdown, specific food recommendations, meal timing, supplements if needed, and timeline expectations.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/diet-recs/ai-recommend', 'diet_recommendations', null, aiResponse);
    res.json({ ai_recommendation: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FOOD ALLERGIES ====================
const allergiesCRUD = createCRUD('food_allergies', ['food_name', 'allergens', 'severity', 'alternatives', 'ai_analysis']);
app.get('/api/allergies', auth, allergiesCRUD.getAll);
app.get('/api/allergies/:id', auth, allergiesCRUD.getOne);
app.post('/api/allergies', auth, allergiesCRUD.create);
app.put('/api/allergies/:id', auth, allergiesCRUD.update);
app.delete('/api/allergies/:id', auth, allergiesCRUD.delete);
app.post('/api/allergies/ai-check', auth, aiRateLimiter, async (req, res) => {
  try {
    const { food_name, known_allergies } = req.body;
    const prompt = `Analyze this food for allergens: "${food_name}"
    Known allergies: ${known_allergies || 'None specified'}

    Provide:
    1. All potential allergens in this food
    2. Hidden allergens to watch for
    3. Cross-contamination risks
    4. Safe alternatives
    5. Severity assessment
    6. Tips for dining out safely`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/allergies/ai-check', 'food_allergies', null, aiResponse);
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== GROCERY LISTS ====================
const groceryCRUD = createCRUD('grocery_lists', ['title', 'items', 'budget', 'store_preference', 'ai_optimized', 'ai_suggestions']);
app.get('/api/grocery', auth, groceryCRUD.getAll);
app.get('/api/grocery/:id', auth, groceryCRUD.getOne);
app.post('/api/grocery', auth, groceryCRUD.create);
app.put('/api/grocery/:id', auth, groceryCRUD.update);
app.delete('/api/grocery/:id', auth, groceryCRUD.delete);
app.post('/api/grocery/ai-optimize', auth, aiRateLimiter, async (req, res) => {
  try {
    const { meal_plan, budget, store_preference, dietary_needs } = req.body;
    const prompt = `Create an optimized grocery shopping list:
    - Meal plan/goals: ${meal_plan}
    - Budget: $${budget}
    - Store preference: ${store_preference || 'Any'}
    - Dietary needs: ${dietary_needs || 'None'}

    Provide: organized list by category, estimated prices, budget-saving tips, seasonal alternatives, and storage tips for freshness.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/grocery/ai-optimize', 'grocery_lists', null, aiResponse);
    res.json({ ai_suggestions: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== BMI RECORDS ====================
const bmiCRUD = createCRUD('bmi_records', ['height_cm', 'weight_kg', 'bmi', 'category', 'ai_health_tips']);
app.get('/api/bmi', auth, bmiCRUD.getAll);
app.get('/api/bmi/:id', auth, bmiCRUD.getOne);
app.post('/api/bmi', auth, bmiCRUD.create);
app.put('/api/bmi/:id', auth, bmiCRUD.update);
app.delete('/api/bmi/:id', auth, bmiCRUD.delete);
app.post('/api/bmi/ai-analyze', auth, aiRateLimiter, async (req, res) => {
  try {
    const { height_cm, weight_kg, age, gender, activity_level } = req.body;
    const bmi = (weight_kg / ((height_cm / 100) ** 2)).toFixed(1);
    const prompt = `Provide health analysis for:
    - BMI: ${bmi}
    - Height: ${height_cm}cm, Weight: ${weight_kg}kg
    - Age: ${age || 'Not specified'}, Gender: ${gender || 'Not specified'}
    - Activity level: ${activity_level || 'Not specified'}

    Include: BMI category, health risks, personalized tips, ideal weight range, and actionable recommendations.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/bmi/ai-analyze', 'bmi_records', null, aiResponse);
    res.json({ bmi: parseFloat(bmi), ai_health_tips: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== WATER INTAKE ====================
const waterCRUD = createCRUD('water_intake', ['amount_ml', 'daily_goal_ml', 'ai_recommendation']);
app.get('/api/water', auth, waterCRUD.getAll);
app.get('/api/water/:id', auth, waterCRUD.getOne);
app.post('/api/water', auth, waterCRUD.create);
app.put('/api/water/:id', auth, waterCRUD.update);
app.delete('/api/water/:id', auth, waterCRUD.delete);
app.post('/api/water/ai-recommend', auth, aiRateLimiter, async (req, res) => {
  try {
    const { weight_kg, activity_level, climate, current_intake } = req.body;
    const prompt = `Provide personalized hydration recommendations:
    - Weight: ${weight_kg}kg
    - Activity level: ${activity_level}
    - Climate: ${climate || 'Temperate'}
    - Current daily intake: ${current_intake || 'Unknown'}ml

    Include: recommended daily intake, timing suggestions, signs of dehydration, hydration-boosting foods, and electrolyte needs.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/water/ai-recommend', 'water_intake', null, aiResponse);
    res.json({ ai_recommendation: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== SUPPLEMENTS ====================
const supplementsCRUD = createCRUD('supplements', ['name', 'dosage', 'frequency', 'purpose', 'warnings', 'ai_advice']);
app.get('/api/supplements', auth, supplementsCRUD.getAll);
app.get('/api/supplements/:id', auth, supplementsCRUD.getOne);
app.post('/api/supplements', auth, supplementsCRUD.create);
app.put('/api/supplements/:id', auth, supplementsCRUD.update);
app.delete('/api/supplements/:id', auth, supplementsCRUD.delete);
app.post('/api/supplements/ai-advise', auth, aiRateLimiter, async (req, res) => {
  try {
    const { health_goals, current_diet, medications, age } = req.body;
    const prompt = `Recommend supplements based on:
    - Health goals: ${health_goals}
    - Current diet: ${current_diet}
    - Medications: ${medications || 'None'}
    - Age: ${age || 'Not specified'}

    Provide: recommended supplements with dosages, timing, interactions to avoid, food sources of the same nutrients, and when to get blood work.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/supplements/ai-advise', 'supplements', null, aiResponse);
    res.json({ ai_advice: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/supplements/ai-interaction-check - drug-nutrient interaction check
app.post('/api/supplements/ai-interaction-check', auth, aiRateLimiter, async (req, res) => {
  try {
    const { supplement_names, medication_names } = req.body;
    if (!supplement_names || !medication_names) {
      return res.status(400).json({ error: 'supplement_names and medication_names are required' });
    }

    const prompt = `Check for dangerous interactions between these supplements and medications.
    Supplements: ${Array.isArray(supplement_names) ? supplement_names.join(', ') : supplement_names}
    Medications: ${Array.isArray(medication_names) ? medication_names.join(', ') : medication_names}

    Return JSON with:
    {
      "interactions": [
        {
          "supplement": "...",
          "medication": "...",
          "severity": "mild/moderate/severe",
          "description": "...",
          "recommendation": "..."
        }
      ],
      "safe": true/false,
      "overall_risk": "low/medium/high",
      "general_advice": "..."
    }
    Respond ONLY with valid JSON. Note: this is educational information, not medical advice.`;

    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/supplements/ai-interaction-check', 'supplements', null, parsed);
    res.json({ interaction_check: parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FITNESS MEAL PREP ====================
const fitnessCRUD = createCRUD('fitness_meal_preps', ['title', 'fitness_goal', 'meals_per_day', 'prep_day', 'meals', 'total_calories', 'total_protein', 'ai_plan']);
app.get('/api/fitness-meals', auth, fitnessCRUD.getAll);
app.get('/api/fitness-meals/:id', auth, fitnessCRUD.getOne);
app.post('/api/fitness-meals', auth, fitnessCRUD.create);
app.put('/api/fitness-meals/:id', auth, fitnessCRUD.update);
app.delete('/api/fitness-meals/:id', auth, fitnessCRUD.delete);
app.post('/api/fitness-meals/ai-plan', auth, aiRateLimiter, async (req, res) => {
  try {
    const { fitness_goal, weight, training_type, meals_per_day } = req.body;
    const prompt = `Create a fitness-focused meal prep plan:
    - Fitness goal: ${fitness_goal}
    - Weight: ${weight}lbs
    - Training type: ${training_type}
    - Meals per day: ${meals_per_day}

    Provide: complete meal prep plan with specific foods and portions, macro breakdown per meal, total daily macros, pre/post workout nutrition, prep instructions, and storage tips.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/fitness-meals/ai-plan', 'fitness_meal_preps', null, aiResponse);
    res.json({ ai_plan: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FOOD SUBSTITUTIONS ====================
const subsCRUD = createCRUD('food_substitutions', ['original_food', 'reason', 'substitutes', 'nutritional_comparison', 'ai_suggestion']);
app.get('/api/substitutions', auth, subsCRUD.getAll);
app.get('/api/substitutions/:id', auth, subsCRUD.getOne);
app.post('/api/substitutions', auth, subsCRUD.create);
app.put('/api/substitutions/:id', auth, subsCRUD.update);
app.delete('/api/substitutions/:id', auth, subsCRUD.delete);
app.post('/api/substitutions/ai-suggest', auth, aiRateLimiter, async (req, res) => {
  try {
    const { original_food, reason } = req.body;
    const prompt = `Suggest healthy substitutes for: "${original_food}"
    Reason for substitution: ${reason}

    Provide:
    1. Top 4 substitutes ranked by similarity
    2. Nutritional comparison with the original
    3. How to use each substitute in cooking
    4. Taste and texture differences
    5. Cost comparison`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/substitutions/ai-suggest', 'food_substitutions', null, aiResponse);
    res.json({ ai_suggestion: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FASTING SCHEDULES ====================
const fastingCRUD = createCRUD('fasting_schedules', ['fasting_type', 'start_time', 'end_time', 'eating_window_hours', 'fasting_hours', 'days', 'ai_guide']);
app.get('/api/fasting', auth, fastingCRUD.getAll);
app.get('/api/fasting/:id', auth, fastingCRUD.getOne);
app.post('/api/fasting', auth, fastingCRUD.create);
app.put('/api/fasting/:id', auth, fastingCRUD.update);
app.delete('/api/fasting/:id', auth, fastingCRUD.delete);
app.post('/api/fasting/ai-guide', auth, aiRateLimiter, async (req, res) => {
  try {
    const { goal, experience_level, schedule, health_conditions } = req.body;
    const prompt = `Create a personalized intermittent fasting guide:
    - Goal: ${goal}
    - Experience level: ${experience_level}
    - Schedule/lifestyle: ${schedule}
    - Health conditions: ${health_conditions || 'None'}

    Provide: recommended fasting protocol, eating window times, what to eat/drink during fasting, how to break your fast, expected timeline, and who should avoid fasting.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/fasting/ai-guide', 'fasting_schedules', null, aiResponse);
    res.json({ ai_guide: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== VITAMIN CHECKS ====================
const vitaminCRUD = createCRUD('vitamin_checks', ['symptoms', 'diet_description', 'possible_deficiencies', 'recommended_foods', 'ai_analysis']);
app.get('/api/vitamins', auth, vitaminCRUD.getAll);
app.get('/api/vitamins/:id', auth, vitaminCRUD.getOne);
app.post('/api/vitamins', auth, vitaminCRUD.create);
app.put('/api/vitamins/:id', auth, vitaminCRUD.update);
app.delete('/api/vitamins/:id', auth, vitaminCRUD.delete);
app.post('/api/vitamins/ai-check', auth, aiRateLimiter, async (req, res) => {
  try {
    const { symptoms, diet_description } = req.body;
    const prompt = `Analyze potential vitamin/mineral deficiencies:
    - Symptoms: ${JSON.stringify(symptoms)}
    - Current diet: ${diet_description}

    Provide:
    1. Most likely deficiencies based on symptoms
    2. Foods rich in those nutrients
    3. Recommended supplements and dosages
    4. How long until improvement
    5. When to see a doctor
    Note: This is educational information, not medical advice.`;
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/vitamins/ai-check', 'vitamin_checks', null, aiResponse);
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AI CHAT (multi-turn) ====================
const chatCRUD = createCRUD('ai_chat_history', ['topic', 'messages']);
app.get('/api/chat', auth, chatCRUD.getAll);
app.get('/api/chat/:id', auth, chatCRUD.getOne);
app.post('/api/chat', auth, chatCRUD.create);
app.put('/api/chat/:id', auth, chatCRUD.update);
app.delete('/api/chat/:id', auth, chatCRUD.delete);
app.post('/api/chat/ai-message', auth, aiRateLimiter, async (req, res) => {
  try {
    const { message, context, session_id } = req.body;

    // Fetch last 10 messages for this user to build conversation history
    let conversationHistory = [];
    try {
      const histResult = await pool.query(
        `SELECT messages FROM ai_chat_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [req.userId]
      );
      // Flatten messages from all recent chat sessions
      for (const row of histResult.rows.reverse()) {
        const msgs = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (m.role && m.content) {
              conversationHistory.push({ role: m.role, content: m.content });
            }
          }
        }
      }
      // Keep last 10 messages max for context
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }
    } catch {}

    const systemMsg = `You are an expert AI nutritionist and dietitian assistant. You provide evidence-based nutrition advice, meal planning help, and dietary guidance. ${context ? 'Context: ' + context : ''} Always be helpful, specific, and professional. Include actionable recommendations.`;
    const aiResponse = await queryAI(message, systemMsg, conversationHistory);

    // Save this exchange to chat history
    const newMessages = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: aiResponse },
    ];
    await pool.query(
      `INSERT INTO ai_chat_history (user_id, topic, messages) VALUES ($1, $2, $3)`,
      [req.userId, context || 'General nutrition chat', JSON.stringify(newMessages.slice(-20))]
    ).catch(() => {});

    await persistAIResult(req.userId, '/chat/ai-message', 'ai_chat_history', null, aiResponse);
    res.json({ response: aiResponse, history: conversationHistory });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AI CENTER (aggregated AI features) ====================
app.post('/api/ai-center/quick-analyze', auth, aiRateLimiter, async (req, res) => {
  try {
    const { query, type } = req.body;
    const prompts = {
      'meal-suggestion': `Suggest a healthy meal for someone who wants: ${query}. Include ingredients, calories, and preparation tips.`,
      'food-fact': `Share an interesting and useful nutritional fact about: ${query}. Include scientific evidence.`,
      'diet-tip': `Provide an expert diet tip related to: ${query}. Make it actionable and evidence-based.`,
      'recipe-idea': `Suggest a quick healthy recipe idea for: ${query}. Include ingredients and basic steps.`,
      'nutrition-question': `Answer this nutrition question professionally: ${query}`,
      'health-assessment': `Provide a brief health assessment/recommendation for: ${query}. Note this is educational, not medical advice.`,
    };
    const prompt = prompts[type] || prompts['nutrition-question'];
    const aiResponse = await queryAI(prompt);
    await persistAIResult(req.userId, '/ai-center/quick-analyze', null, null, aiResponse);
    res.json({ response: aiResponse, type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AI HISTORY ====================
app.get('/api/ai/history', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM ai_results WHERE user_id = $1', [req.userId]);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM ai_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.userId, limit, offset]
    );
    res.json({
      data: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/dietary-goal-forecast - predict outcomes for a goal over N weeks
app.post('/api/ai/dietary-goal-forecast', auth, aiRateLimiter, async (req, res) => {
  try {
    const { goal, current_weight_kg, target_weight_kg, daily_calories, weeks, activity_level, dietary_restrictions } = req.body || {};
    const prompt = `Forecast a dietitian-style outcome for the following plan over ${weeks || 12} weeks.
Goal: ${goal || 'general health'}
Current weight (kg): ${current_weight_kg || 'unknown'}
Target weight (kg): ${target_weight_kg || 'unknown'}
Daily calories: ${daily_calories || 'unknown'}
Activity level: ${activity_level || 'moderate'}
Dietary restrictions: ${dietary_restrictions || 'none'}

Return JSON only:
{ "weeks": ${weeks || 12}, "weekly_projection": [{"week": number, "expected_weight_kg": number, "energy_level": string, "notes": string}], "expected_outcome": string, "key_risks": [string], "recommendations": [string], "confidence": "low|medium|high" }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/dietary-goal-forecast', 'meal_plans', null, parsed);
    res.json({ ai_forecast: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ai/allergy-detection - scan recipes for allergen risks
app.post('/api/ai/allergy-detection', auth, aiRateLimiter, async (req, res) => {
  try {
    const { ingredients, allergies } = req.body || {};
    if (!ingredients) return res.status(400).json({ error: 'ingredients required' });
    const prompt = `Analyze the following recipe ingredients for allergen risks.
Ingredients: ${JSON.stringify(ingredients)}
User allergies: ${JSON.stringify(allergies || [])}

Return JSON only:
{ "allergens_detected": [{"allergen": string, "source_ingredient": string, "severity": "low|medium|high", "cross_contamination_risk": boolean}], "user_allergy_matches": [string], "safe_substitutes": [{"ingredient": string, "substitute": string}], "verdict": "safe|caution|unsafe", "notes": [string] }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/allergy-detection', 'recipes', null, parsed);
    res.json({ ai_analysis: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ai/meal-prep-planner - schedule multi-day prep
app.post('/api/ai/meal-prep-planner', auth, aiRateLimiter, async (req, res) => {
  try {
    const { meals, days, available_time_per_day_minutes, equipment, dietary_restrictions } = req.body || {};
    const prompt = `Plan a multi-day meal prep schedule.
Meals to prep: ${JSON.stringify(meals || [])}
Days: ${days || 7}
Available prep time per day (minutes): ${available_time_per_day_minutes || 60}
Equipment: ${JSON.stringify(equipment || [])}
Dietary restrictions: ${dietary_restrictions || 'none'}

Return JSON only:
{ "prep_sessions": [{"day": string, "tasks": [{"task": string, "duration_minutes": number, "technique": string}], "session_total_minutes": number}], "shopping_list": [{"item": string, "quantity": string}], "storage_instructions": [string], "reheating_tips": [string] }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/meal-prep-planner', 'meal_plans', null, parsed);
    res.json({ ai_plan: aiResponse, parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ai/restaurant-nutrition-lookup - estimate nutrition for a restaurant menu item
app.post('/api/ai/restaurant-nutrition-lookup', auth, aiRateLimiter, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: 'AI not configured. Set OPENROUTER_API_KEY on the server.' });
    }
    const { restaurant, dish, modifications, allergens_to_avoid, user_goal } = req.body || {};
    if (!dish) return res.status(400).json({ error: 'dish required' });
    const prompt = `Estimate the nutritional profile of a restaurant dish. Be conservative and label uncertainty.
Restaurant: ${restaurant || 'unspecified'}
Dish: ${dish}
Customer modifications: ${modifications || 'none'}
Allergens to avoid: ${JSON.stringify(allergens_to_avoid || [])}
User goal: ${user_goal || 'general health'}

Return JSON only:
{ "dish": string, "restaurant": string, "estimated_serving_size_g": number, "calories_kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "sodium_mg": number, "ingredients_likely_present": [string], "allergen_flags": [{"allergen": string, "likelihood": "low|medium|high"}], "healthier_alternatives": [string], "goal_alignment": "good|ok|poor", "confidence": "low|medium|high", "disclaimer": string }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/restaurant-nutrition-lookup', 'recipes', null, parsed);
    res.json({ ai_lookup: aiResponse, parsed });
  } catch (err) {
    if (/OPENROUTER_API_KEY|api[_ ]?key/i.test(err.message || '')) {
      return res.status(503).json({ error: 'AI not configured. Set OPENROUTER_API_KEY on the server.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/grocery-list-from-meal-plans - aggregate ingredients across meal plans into a smart grocery list
app.post('/api/ai/grocery-list-from-meal-plans', auth, aiRateLimiter, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: 'AI not configured. Set OPENROUTER_API_KEY on the server.' });
    }
    const { meal_plans, household_size, pantry_items, dietary_restrictions, budget_usd } = req.body || {};
    if (!meal_plans || (Array.isArray(meal_plans) && meal_plans.length === 0)) {
      return res.status(400).json({ error: 'meal_plans required' });
    }
    const prompt = `Generate a consolidated grocery list from the following meal plans, accounting for pantry stock and household size.
Meal plans: ${JSON.stringify(meal_plans)}
Household size: ${household_size || 1}
Pantry items already on hand: ${JSON.stringify(pantry_items || [])}
Dietary restrictions: ${dietary_restrictions || 'none'}
Budget (USD): ${budget_usd || 'unspecified'}

Return JSON only:
{ "grocery_sections": [{"section": "produce|dairy|meat|pantry|frozen|other", "items": [{"item": string, "quantity": string, "estimated_cost_usd": number, "purpose": string}]}], "total_estimated_cost_usd": number, "items_skipped_in_pantry": [string], "substitution_suggestions": [{"original": string, "substitute": string, "reason": string}], "shopping_tips": [string] }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/grocery-list-from-meal-plans', 'grocery_lists', null, parsed);
    res.json({ ai_list: aiResponse, parsed });
  } catch (err) {
    if (/OPENROUTER_API_KEY|api[_ ]?key/i.test(err.message || '')) {
      return res.status(503).json({ error: 'AI not configured. Set OPENROUTER_API_KEY on the server.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ===== Apply-pass-5 additions =====

// POST /api/ai/nutrient-gap-identifier
// MECHANICAL — Identifies likely nutrient deficiencies given a multi-day food log.
app.post('/api/ai/nutrient-gap-identifier', auth, aiRateLimiter, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    const { food_log, days, demographics, dietary_pattern, supplements } = req.body || {};
    if (!food_log) return res.status(400).json({ error: 'food_log required' });
    const prompt = `Analyze the following multi-day food intake for nutrient gaps. Be specific and reference RDAs.
Food log: ${JSON.stringify(food_log)}
Days covered: ${days || 'unspecified'}
Demographics: ${JSON.stringify(demographics || {})}
Dietary pattern: ${dietary_pattern || 'omnivore'}
Current supplements: ${JSON.stringify(supplements || [])}

Return JSON only:
{ "estimated_intake": [{"nutrient": string, "estimated_daily_amount": string, "rda_percent": number}], "gaps": [{"nutrient": string, "severity": "mild|moderate|severe", "explanation": string, "food_sources_to_add": [string], "supplement_consideration": "yes|no|optional"}], "surpluses": [{"nutrient": string, "concern_level": "low|medium|high"}], "top_recommendations": [string], "confidence": "low|medium|high", "disclaimer": string }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/nutrient-gap-identifier', 'nutrient_analyses', null, parsed);
    res.json({ ai_analysis: aiResponse, parsed });
  } catch (err) {
    if (/OPENROUTER_API_KEY|api[_ ]?key/i.test(err.message || '')) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/family-nutrition-sync
// MECHANICAL — Builds a unified family meal plan reconciling per-member needs.
app.post('/api/ai/family-nutrition-sync', auth, aiRateLimiter, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    const { members, days, budget_usd, kitchen_constraints, shared_meals_only } = req.body || {};
    if (!members || (Array.isArray(members) && members.length === 0)) {
      return res.status(400).json({ error: 'members required' });
    }
    const prompt = `Build a coordinated family meal plan that reconciles each member's dietary needs, allergies, and preferences while minimising distinct prep.
Members (with goals/restrictions/allergies/age): ${JSON.stringify(members)}
Days: ${days || 7}
Budget USD: ${budget_usd || 'unspecified'}
Kitchen constraints: ${JSON.stringify(kitchen_constraints || {})}
Shared meals only: ${shared_meals_only ? 'yes' : 'mixed allowed'}

Return JSON only:
{ "plan": [{"day": string, "meals": [{"slot": "breakfast|lunch|dinner|snack", "shared": boolean, "base_recipe": string, "per_member_modifications": [{"member": string, "change": string}], "estimated_calories_per_serving": number}]}], "shared_grocery_list": [{"item": string, "quantity": string, "for_members": [string]}], "conflicts_resolved": [{"members": [string], "issue": string, "resolution": string}], "estimated_cost_usd": number, "notes": [string] }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/family-nutrition-sync', 'meal_plans', null, parsed);
    res.json({ ai_plan: aiResponse, parsed });
  } catch (err) {
    if (/OPENROUTER_API_KEY|api[_ ]?key/i.test(err.message || '')) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/voice-food-diary-parse
// PRODUCT-DECISION: rather than wire a Whisper/STT pipeline (heavy dep, infra),
// this endpoint accepts pre-transcribed text from the client (browser
// SpeechRecognition API or Whisper). Body: { transcript, meal_time? }
app.post('/api/ai/voice-food-diary-parse', auth, aiRateLimiter, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    const { transcript, meal_time } = req.body || {};
    if (!transcript) return res.status(400).json({ error: 'transcript required (text from STT)' });
    const prompt = `Parse a free-form spoken food-diary entry into structured items with quantities and estimated nutrition.
Transcript: """${transcript}"""
Meal time: ${meal_time || 'unspecified'}

Return JSON only:
{ "meal_time": string, "items": [{"food": string, "quantity": string, "unit": string, "estimated_calories": number, "estimated_protein_g": number, "estimated_carbs_g": number, "estimated_fat_g": number, "confidence": "low|medium|high"}], "total_calories": number, "ambiguities": [string], "follow_up_questions": [string] }`;
    const aiResponse = await queryAI(prompt);
    const parsed = parseAIJson(aiResponse);
    await persistAIResult(req.userId, '/ai/voice-food-diary-parse', 'food_logs', null, parsed);
    res.json({ ai_parse: aiResponse, parsed });
  } catch (err) {
    if (/OPENROUTER_API_KEY|api[_ ]?key/i.test(err.message || '')) {
      return res.status(503).json({ error: 'AI not configured.', missing: 'OPENROUTER_API_KEY' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/barcode-lookup
// NEEDS-CREDS — env vars:
//   - BARCODE_API_KEY: vendor key (e.g. Open Food Facts is free; UPCitemdb / Edamam need keys)
//   - BARCODE_API_URL: vendor base URL (defaults documented)
// Returns 503 + `missing: BARCODE_API_KEY` when unset.
app.post('/api/barcode-lookup', auth, async (req, res) => {
  if (!process.env.BARCODE_API_KEY) {
    return res.status(503).json({
      error: 'Barcode lookup not configured.',
      missing: 'BARCODE_API_KEY',
      documentation: 'Set BARCODE_API_KEY (and optionally BARCODE_API_URL) — e.g. UPCitemdb or Edamam.'
    });
  }
  const { barcode } = req.body || {};
  if (!barcode || typeof barcode !== 'string') return res.status(400).json({ error: 'barcode required' });
  // Vendor adapter intentionally not wired in this pass.
  res.status(501).json({ error: 'Barcode adapter not implemented; credential is set but vendor call has not been wired.', barcode });
});

// POST /api/fitness-tracker-sync
// NEEDS-CREDS — env vars:
//   - FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET (Fitbit OAuth)
//   - APPLE_HEALTH_KIT_CONFIG (Apple HealthKit only via mobile app — server is a no-op stub)
// Returns 503 + `missing` when unset.
app.post('/api/fitness-tracker-sync', auth, async (req, res) => {
  const required = ['FITBIT_CLIENT_ID', 'FITBIT_CLIENT_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    return res.status(503).json({
      error: 'Fitness tracker sync not configured.',
      missing: missing.join(','),
      documentation: 'Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET. Apple Health requires a mobile companion app (HealthKit is iOS-only).'
    });
  }
  res.status(501).json({ error: 'Fitness tracker adapter not implemented; credentials present but vendor OAuth flow has not been wired.' });
});

// Additive food_logs table (TOO-RISKY-only-additive)
pool.query(`
  CREATE TABLE IF NOT EXISTS food_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    logged_at TIMESTAMP DEFAULT NOW(),
    meal_time VARCHAR(50),
    transcript TEXT,
    parsed_json JSONB,
    total_calories NUMERIC
  )
`).catch(() => {});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// === Custom Feature Mounts (batch_06) ===
app.use('/api/cf-food-diary-voice-input', require('./routes/customFeat01_FoodDiaryVoiceInput'));
app.use('/api/cf-nutrient-gap-identification', require('./routes/customFeat02_NutrientGapIdentification'));
app.use('/api/cf-restaurant-menu-advisor', require('./routes/customFeat03_RestaurantMenuAdvisor'));
app.use('/api/cf-meal-prep-video-tutorials', require('./routes/customFeat04_MealPrepVideoTutorials'));
app.use('/api/cf-family-nutrition-sync', require('./routes/customFeat05_FamilyNutritionSync'));


// === Batch 06 Gaps & Frontend Mounts ===
app.use('/api/gap-no-dietary', require('./routes/gapFeat_no_dietary'));
app.use('/api/gap-no-restaurant', require('./routes/gapFeat_no_restaurant'));
app.use('/api/gap-no-meal', require('./routes/gapFeat_no_meal'));
app.use('/api/gap-no-macro', require('./routes/gapFeat_no_macro'));
app.use('/api/gap-no-dedicated-routes-directory-all-logic-inline-in-', require('./routes/gapFeat_no_dedicated_routes_directory_all_logic_inline_in_'));
app.use('/api/gap-no-proper-database-schema-migrations-visible', require('./routes/gapFeat_no_proper_database_schema_migrations_visible'));
app.use('/api/gap-limited-social-sharing-meal-ideas-progress', require('./routes/gapFeat_limited_social_sharing_meal_ideas_progress'));
app.use('/api/gap-no-notifications-layer-meal-reminders-hydration-nu', require('./routes/gapFeat_no_notifications_layer_meal_reminders_hydration_nu'));
app.use('/api/gap-no-webhooks-or-external-integrations', require('./routes/gapFeat_no_webhooks_or_external_integrations'));
app.use('/api/gap-no-audit-logging', require('./routes/gapFeat_no_audit_logging'));
app.use('/api/gap-no-multi', require('./routes/gapFeat_no_multi'));
app.use('/api/gap-no-rbac-single-user-role', require('./routes/gapFeat_no_rbac_single_user_role'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
