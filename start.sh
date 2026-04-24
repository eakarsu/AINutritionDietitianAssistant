#!/bin/bash

# ============================================
# AI Nutrition & Dietitian Assistant - Startup
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${PURPLE}"
echo "╔══════════════════════════════════════════════╗"
echo "║   🥗 AI Nutrition & Dietitian Assistant      ║"
echo "║   Starting application...                    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo -e "${GREEN}✓ Environment variables loaded${NC}"
else
  echo -e "${RED}✗ .env file not found! Please create one.${NC}"
  exit 1
fi

BACKEND_PORT=${BACKEND_PORT:-3001}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# ==================== Kill existing processes on ports ====================
echo -e "\n${YELLOW}Cleaning up ports...${NC}"

kill_port() {
  local port=$1
  local pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo -e "  Killing process on port $port (PID: $pid)"
    kill -9 $pid 2>/dev/null || true
    sleep 1
  fi
}

kill_port $BACKEND_PORT
kill_port $FRONTEND_PORT
echo -e "${GREEN}✓ Ports cleaned${NC}"

# ==================== Check PostgreSQL ====================
echo -e "\n${YELLOW}Checking PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
  echo -e "${RED}✗ PostgreSQL not found. Please install it.${NC}"
  exit 1
fi

# Try to start PostgreSQL if not running
if ! pg_isready -q 2>/dev/null; then
  echo -e "  Starting PostgreSQL..."
  brew services start postgresql@14 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 2
fi

if pg_isready -q 2>/dev/null; then
  echo -e "${GREEN}✓ PostgreSQL is running${NC}"
else
  echo -e "${RED}✗ PostgreSQL is not running. Please start it manually.${NC}"
  exit 1
fi

# ==================== Create Database ====================
echo -e "\n${YELLOW}Setting up database...${NC}"
DB_NAME="ai_nutrition_db"

if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo -e "  Database '$DB_NAME' already exists"
else
  createdb "$DB_NAME" 2>/dev/null || psql -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || true
  echo -e "  Database '$DB_NAME' created"
fi
echo -e "${GREEN}✓ Database ready${NC}"

# ==================== Install Dependencies ====================
echo -e "\n${YELLOW}Installing dependencies...${NC}"

# Backend
echo -e "  ${CYAN}Installing backend dependencies...${NC}"
cd "$PROJECT_DIR/server"
npm install --silent 2>&1 | tail -1
echo -e "  ${GREEN}✓ Backend dependencies installed${NC}"

# Frontend
echo -e "  ${CYAN}Installing frontend dependencies...${NC}"
cd "$PROJECT_DIR/client"
npm install --silent 2>&1 | tail -1
echo -e "  ${GREEN}✓ Frontend dependencies installed${NC}"

cd "$PROJECT_DIR"

# ==================== Seed Database ====================
echo -e "\n${YELLOW}Seeding database...${NC}"
cd "$PROJECT_DIR/server"
node seed.js
echo -e "${GREEN}✓ Database seeded successfully${NC}"

# ==================== Start Services ====================
echo -e "\n${YELLOW}Starting services...${NC}"

# Start backend with nodemon (hot reload)
echo -e "  ${CYAN}Starting backend on port $BACKEND_PORT with hot reload...${NC}"
cd "$PROJECT_DIR/server"
npx nodemon --watch '.' --ext 'js,json' index.js &
BACKEND_PID=$!
echo -e "  ${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# Wait for backend to be ready
sleep 2

# Start frontend with hot reload (built-in with React scripts)
echo -e "  ${CYAN}Starting frontend on port $FRONTEND_PORT with hot reload...${NC}"
cd "$PROJECT_DIR/client"
PORT=$FRONTEND_PORT BROWSER=none npm start &
FRONTEND_PID=$!
echo -e "  ${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# ==================== Ready ====================
sleep 3
echo -e "\n${PURPLE}"
echo "╔══════════════════════════════════════════════╗"
echo "║   🥗 Application is ready!                   ║"
echo "║                                              ║"
echo "║   Frontend: http://localhost:$FRONTEND_PORT          ║"
echo "║   Backend:  http://localhost:$BACKEND_PORT          ║"
echo "║                                              ║"
echo "║   Demo Login:                                ║"
echo "║   Email:    demo@nutrition.com               ║"
echo "║   Password: password123                      ║"
echo "║                                              ║"
echo "║   Press Ctrl+C to stop all services          ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# Cleanup on exit
cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  kill_port $BACKEND_PORT
  kill_port $FRONTEND_PORT
  echo -e "${GREEN}✓ All services stopped${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait
