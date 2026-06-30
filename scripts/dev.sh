#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HOST=${HOST:-127.0.0.1}
PORT=${PORT:-4173}

for arg in "$@"; do
  case "$arg" in
    --host=*)
      HOST=${arg#--host=}
      ;;
    --port=*)
      PORT=${arg#--port=}
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: scripts/dev.sh [--host=127.0.0.1] [--port=4173]" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18 or newer first." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "wepub requires Node.js 18 or newer. Current version: $(node -v)" >&2
  exit 1
fi

case "$PORT" in
  ''|*[!0-9]*)
    echo "Port must be a positive integer." >&2
    exit 1
    ;;
esac

if [ ! -d "$ROOT_DIR/node_modules/marked" ]; then
  echo "Dependencies are not installed. Run npm install first." >&2
  exit 1
fi

is_port_available() {
  node -e "
const net = require('node:net');
const host = process.argv[1];
const port = Number(process.argv[2]);
const server = net.createServer();
server.once('error', () => process.exit(1));
server.once('listening', () => server.close(() => process.exit(0)));
server.listen(port, host);
" "$1" "$2" >/dev/null 2>&1
}

REQUESTED_PORT=$PORT
END_PORT=$((REQUESTED_PORT + 19))

while [ "$PORT" -le "$END_PORT" ]; do
  if is_port_available "$HOST" "$PORT"; then
    break
  fi
  PORT=$((PORT + 1))
done

if [ "$PORT" -gt "$END_PORT" ]; then
  echo "No available port found from $REQUESTED_PORT to $END_PORT." >&2
  exit 1
fi

if [ "$PORT" -ne "$REQUESTED_PORT" ]; then
  echo "Port $REQUESTED_PORT is busy; using $PORT instead."
fi

URL="http://$HOST:$PORT"
echo "Starting wepub frontend and backend..."
echo "Frontend: $URL"
echo "Backend API: $URL/api"

cd "$ROOT_DIR"
HOST=$HOST exec node ./bin/wepub-web.mjs --port="$PORT"
