const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { queryAI } = require('./ai');
require('dotenv').config({ path: '../.env' });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.BACKEND_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

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

// ==================== GENERIC CRUD HELPER ====================
function createCRUD(table, columns, aiField) {
  return {
    getAll: async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM ${table} WHERE user_id = $1 ORDER BY created_at DESC`, [req.userId]);
        res.json(result.rows);
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
app.post('/api/meal-plans/ai-generate', auth, async (req, res) => {
  try {
    const { goal, calories_target, dietary_preferences } = req.body;
    const prompt = `Create a detailed daily meal plan with the following requirements:
    - Goal: ${goal}
    - Target calories: ${calories_target}
    - Dietary preferences: ${dietary_preferences || 'None'}

    Please provide:
    1. A meal plan title
    2. Breakfast, lunch, dinner, and snacks with specific foods and portions
    3. Estimated calories per meal
    4. Key nutritional highlights
    5. Tips for following this plan`;
    const aiResponse = await queryAI(prompt);
    res.json({ ai_suggestions: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== CALORIE TRACKER ====================
const caloriesCRUD = createCRUD('calorie_entries', ['food_name', 'portion_size', 'calories', 'protein', 'carbs', 'fat', 'meal_type', 'ai_analysis']);
app.get('/api/calories', auth, caloriesCRUD.getAll);
app.get('/api/calories/:id', auth, caloriesCRUD.getOne);
app.post('/api/calories', auth, caloriesCRUD.create);
app.put('/api/calories/:id', auth, caloriesCRUD.update);
app.delete('/api/calories/:id', auth, caloriesCRUD.delete);
app.post('/api/calories/ai-analyze', auth, async (req, res) => {
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
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== RECIPES ====================
const recipesCRUD = createCRUD('recipes', ['title', 'description', 'ingredients', 'instructions', 'prep_time', 'cook_time', 'servings', 'cuisine', 'dietary_tags']);
app.get('/api/recipes', auth, recipesCRUD.getAll);
app.get('/api/recipes/:id', auth, recipesCRUD.getOne);
app.post('/api/recipes', auth, recipesCRUD.create);
app.put('/api/recipes/:id', auth, recipesCRUD.update);
app.delete('/api/recipes/:id', auth, recipesCRUD.delete);
app.post('/api/recipes/ai-generate', auth, async (req, res) => {
  try {
    const { ingredients, dietary_preferences, cuisine } = req.body;
    const prompt = `Create a detailed recipe using these ingredients: ${ingredients}.
    Preferences: ${dietary_preferences || 'None'}
    Cuisine: ${cuisine || 'Any'}

    Provide: title, description, full ingredient list with measurements, step-by-step instructions, prep time, cook time, servings, nutritional highlights, and dietary tags.`;
    const aiResponse = await queryAI(prompt);
    res.json({ ai_recipe: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== NUTRIENT ANALYSIS ====================
const nutrientsCRUD = createCRUD('nutrient_analyses', ['food_items', 'total_calories', 'vitamins', 'minerals', 'macros', 'ai_analysis']);
app.get('/api/nutrients', auth, nutrientsCRUD.getAll);
app.get('/api/nutrients/:id', auth, nutrientsCRUD.getOne);
app.post('/api/nutrients', auth, nutrientsCRUD.create);
app.put('/api/nutrients/:id', auth, nutrientsCRUD.update);
app.delete('/api/nutrients/:id', auth, nutrientsCRUD.delete);
app.post('/api/nutrients/ai-analyze', auth, async (req, res) => {
  try {
    const { food_items } = req.body;
    const prompt = `Perform a detailed nutritional analysis for this meal: ${JSON.stringify(food_items)}.
    Provide:
    1. Total estimated calories
    2. Complete vitamin breakdown (%DV)
    3. Mineral content (%DV)
    4. Macronutrient breakdown (protein, carbs, fat in grams)
    5. Nutritional strengths and gaps
    6. Suggestions to improve nutritional balance`;
    const aiResponse = await queryAI(prompt);
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== DIET RECOMMENDATIONS ====================
const dietRecsCRUD = createCRUD('diet_recommendations', ['goal', 'current_weight', 'target_weight', 'activity_level', 'dietary_preference', 'restrictions', 'ai_recommendation']);
app.get('/api/diet-recs', auth, dietRecsCRUD.getAll);
app.get('/api/diet-recs/:id', auth, dietRecsCRUD.getOne);
app.post('/api/diet-recs', auth, dietRecsCRUD.create);
app.put('/api/diet-recs/:id', auth, dietRecsCRUD.update);
app.delete('/api/diet-recs/:id', auth, dietRecsCRUD.delete);
app.post('/api/diet-recs/ai-recommend', auth, async (req, res) => {
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
app.post('/api/allergies/ai-check', auth, async (req, res) => {
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
app.post('/api/grocery/ai-optimize', auth, async (req, res) => {
  try {
    const { meal_plan, budget, store_preference, dietary_needs } = req.body;
    const prompt = `Create an optimized grocery shopping list:
    - Meal plan/goals: ${meal_plan}
    - Budget: $${budget}
    - Store preference: ${store_preference || 'Any'}
    - Dietary needs: ${dietary_needs || 'None'}

    Provide: organized list by category, estimated prices, budget-saving tips, seasonal alternatives, and storage tips for freshness.`;
    const aiResponse = await queryAI(prompt);
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
app.post('/api/bmi/ai-analyze', auth, async (req, res) => {
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
app.post('/api/water/ai-recommend', auth, async (req, res) => {
  try {
    const { weight_kg, activity_level, climate, current_intake } = req.body;
    const prompt = `Provide personalized hydration recommendations:
    - Weight: ${weight_kg}kg
    - Activity level: ${activity_level}
    - Climate: ${climate || 'Temperate'}
    - Current daily intake: ${current_intake || 'Unknown'}ml

    Include: recommended daily intake, timing suggestions, signs of dehydration, hydration-boosting foods, and electrolyte needs.`;
    const aiResponse = await queryAI(prompt);
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
app.post('/api/supplements/ai-advise', auth, async (req, res) => {
  try {
    const { health_goals, current_diet, medications, age } = req.body;
    const prompt = `Recommend supplements based on:
    - Health goals: ${health_goals}
    - Current diet: ${current_diet}
    - Medications: ${medications || 'None'}
    - Age: ${age || 'Not specified'}

    Provide: recommended supplements with dosages, timing, interactions to avoid, food sources of the same nutrients, and when to get blood work.`;
    const aiResponse = await queryAI(prompt);
    res.json({ ai_advice: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FITNESS MEAL PREP ====================
const fitnessCRUD = createCRUD('fitness_meal_preps', ['title', 'fitness_goal', 'meals_per_day', 'prep_day', 'meals', 'total_calories', 'total_protein', 'ai_plan']);
app.get('/api/fitness-meals', auth, fitnessCRUD.getAll);
app.get('/api/fitness-meals/:id', auth, fitnessCRUD.getOne);
app.post('/api/fitness-meals', auth, fitnessCRUD.create);
app.put('/api/fitness-meals/:id', auth, fitnessCRUD.update);
app.delete('/api/fitness-meals/:id', auth, fitnessCRUD.delete);
app.post('/api/fitness-meals/ai-plan', auth, async (req, res) => {
  try {
    const { fitness_goal, weight, training_type, meals_per_day } = req.body;
    const prompt = `Create a fitness-focused meal prep plan:
    - Fitness goal: ${fitness_goal}
    - Weight: ${weight}lbs
    - Training type: ${training_type}
    - Meals per day: ${meals_per_day}

    Provide: complete meal prep plan with specific foods and portions, macro breakdown per meal, total daily macros, pre/post workout nutrition, prep instructions, and storage tips.`;
    const aiResponse = await queryAI(prompt);
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
app.post('/api/substitutions/ai-suggest', auth, async (req, res) => {
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
app.post('/api/fasting/ai-guide', auth, async (req, res) => {
  try {
    const { goal, experience_level, schedule, health_conditions } = req.body;
    const prompt = `Create a personalized intermittent fasting guide:
    - Goal: ${goal}
    - Experience level: ${experience_level}
    - Schedule/lifestyle: ${schedule}
    - Health conditions: ${health_conditions || 'None'}

    Provide: recommended fasting protocol, eating window times, what to eat/drink during fasting, how to break your fast, expected timeline, and who should avoid fasting.`;
    const aiResponse = await queryAI(prompt);
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
app.post('/api/vitamins/ai-check', auth, async (req, res) => {
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
    res.json({ ai_analysis: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AI CHAT ====================
const chatCRUD = createCRUD('ai_chat_history', ['topic', 'messages']);
app.get('/api/chat', auth, chatCRUD.getAll);
app.get('/api/chat/:id', auth, chatCRUD.getOne);
app.post('/api/chat', auth, chatCRUD.create);
app.put('/api/chat/:id', auth, chatCRUD.update);
app.delete('/api/chat/:id', auth, chatCRUD.delete);
app.post('/api/chat/ai-message', auth, async (req, res) => {
  try {
    const { message, context } = req.body;
    const systemMsg = `You are an expert AI nutritionist and dietitian assistant. You provide evidence-based nutrition advice, meal planning help, and dietary guidance. ${context ? 'Context: ' + context : ''} Always be helpful, specific, and professional. Include actionable recommendations.`;
    const aiResponse = await queryAI(message, systemMsg);
    res.json({ response: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== AI CENTER (aggregated AI features) ====================
app.post('/api/ai-center/quick-analyze', auth, async (req, res) => {
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
    res.json({ response: aiResponse, type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
