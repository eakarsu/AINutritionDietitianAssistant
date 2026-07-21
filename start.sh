#!/usr/bin/env bash
set -euo pipefail

LAUNCH_ROOT="$(cd "$(dirname "$0")" && pwd)"
ROOT="$LAUNCH_ROOT"
if [ "${NODE_ENV:-}" = test ] && [ -n "${RUNTIME_PROJECT_SOURCE:-}" ] && [ -d "$RUNTIME_PROJECT_SOURCE" ]; then
  ROOT="$(cd "$RUNTIME_PROJECT_SOURCE" && pwd)"
fi

load_env_file() {
  local file="$1" line key value
  [ -f "$file" ] || { echo "Missing .env; configure it before starting." >&2; exit 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$value" == \"*\" && "$value" == *\" ]] || [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [ -z "${!key+x}" ]; then printf -v "$key" '%s' "$value"; export "$key"; fi
  done < "$file"
}

load_env_file "$LAUNCH_ROOT/.env"
BACKEND_PORT="${BACKEND_PORT:-${PORT:-3001}}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"

if [ ! -d "$ROOT/server/node_modules" ] || [ ! -d "$ROOT/web/node_modules" ]; then
  echo "Dependencies missing; run scripts/bootstrap.sh explicitly." >&2
  exit 1
fi
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if command -v lsof >/dev/null && lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use." >&2
    exit 1
  fi
done

(cd "$ROOT/server" && BACKEND_PORT="$BACKEND_PORT" CLIENT_URL="${CLIENT_URL:-http://$FRONTEND_HOST:$FRONTEND_PORT}" node index.js) & BACKEND_PID=$!
(cd "$ROOT/web" && HOST="$FRONTEND_HOST" PORT="$FRONTEND_PORT" REACT_APP_API_URL="${REACT_APP_API_URL:-http://$BACKEND_HOST:$BACKEND_PORT}" BROWSER=none npm start) & FRONTEND_PID=$!
cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait
