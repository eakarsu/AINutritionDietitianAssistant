-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Meal Plans
CREATE TABLE IF NOT EXISTS meal_plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  goal VARCHAR(100),
  calories_target INTEGER,
  meals JSONB,
  ai_suggestions TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Calorie Tracker
CREATE TABLE IF NOT EXISTS calorie_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  food_name VARCHAR(255) NOT NULL,
  portion_size VARCHAR(100),
  calories INTEGER,
  protein DECIMAL(10,2),
  carbs DECIMAL(10,2),
  fat DECIMAL(10,2),
  meal_type VARCHAR(50),
  date DATE DEFAULT CURRENT_DATE,
  ai_analysis TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Recipes
CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  ingredients JSONB,
  instructions TEXT,
  prep_time INTEGER,
  cook_time INTEGER,
  servings INTEGER,
  cuisine VARCHAR(100),
  dietary_tags JSONB,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Nutrient Analysis
CREATE TABLE IF NOT EXISTS nutrient_analyses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  food_items JSONB NOT NULL,
  total_calories INTEGER,
  vitamins JSONB,
  minerals JSONB,
  macros JSONB,
  ai_analysis TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Diet Recommendations
CREATE TABLE IF NOT EXISTS diet_recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  goal VARCHAR(255) NOT NULL,
  current_weight DECIMAL(10,2),
  target_weight DECIMAL(10,2),
  activity_level VARCHAR(50),
  dietary_preference VARCHAR(100),
  restrictions TEXT,
  ai_recommendation TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Food Allergies
CREATE TABLE IF NOT EXISTS food_allergies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  food_name VARCHAR(255) NOT NULL,
  allergens JSONB,
  severity VARCHAR(50),
  alternatives JSONB,
  ai_analysis TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Grocery Lists
CREATE TABLE IF NOT EXISTS grocery_lists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  items JSONB NOT NULL,
  budget DECIMAL(10,2),
  store_preference VARCHAR(100),
  ai_optimized BOOLEAN DEFAULT FALSE,
  ai_suggestions TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- BMI Records
CREATE TABLE IF NOT EXISTS bmi_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  height_cm DECIMAL(10,2) NOT NULL,
  weight_kg DECIMAL(10,2) NOT NULL,
  bmi DECIMAL(10,2),
  category VARCHAR(50),
  ai_health_tips TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Water Intake
CREATE TABLE IF NOT EXISTS water_intake (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount_ml INTEGER NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  time TIME DEFAULT CURRENT_TIME,
  daily_goal_ml INTEGER DEFAULT 2500,
  ai_recommendation TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Supplements
CREATE TABLE IF NOT EXISTS supplements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100),
  frequency VARCHAR(100),
  purpose TEXT,
  warnings TEXT,
  ai_advice TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fitness Meal Prep
CREATE TABLE IF NOT EXISTS fitness_meal_preps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  fitness_goal VARCHAR(100),
  meals_per_day INTEGER,
  prep_day VARCHAR(20),
  meals JSONB,
  total_calories INTEGER,
  total_protein DECIMAL(10,2),
  ai_plan TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Food Substitutions
CREATE TABLE IF NOT EXISTS food_substitutions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  original_food VARCHAR(255) NOT NULL,
  reason VARCHAR(255),
  substitutes JSONB,
  nutritional_comparison JSONB,
  ai_suggestion TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fasting Schedules
CREATE TABLE IF NOT EXISTS fasting_schedules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fasting_type VARCHAR(100) NOT NULL,
  start_time TIME,
  end_time TIME,
  eating_window_hours DECIMAL(4,1),
  fasting_hours DECIMAL(4,1),
  days JSONB,
  ai_guide TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Vitamin Deficiency Checks
CREATE TABLE IF NOT EXISTS vitamin_checks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  symptoms JSONB NOT NULL,
  diet_description TEXT,
  possible_deficiencies JSONB,
  recommended_foods JSONB,
  ai_analysis TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- AI Chat History
CREATE TABLE IF NOT EXISTS ai_chat_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  topic VARCHAR(255),
  messages JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
