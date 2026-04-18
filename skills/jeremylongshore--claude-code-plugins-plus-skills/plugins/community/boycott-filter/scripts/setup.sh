#!/bin/bash
# Boycott Filter — Setup Script
#
# Starts the local sync server (with PID tracking, no zombie re-runs)
# and provides Chrome extension instructions.

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$PLUGIN_DIR/scripts/server.js"
LIST_FILE="$PLUGIN_DIR/boycott-list.json"
PID_FILE="$PLUGIN_DIR/.server.pid"
LOG_FILE="$PLUGIN_DIR/.server.log"

# Create empty boycott list if it doesn't exist
if [ ! -f "$LIST_FILE" ]; then
  echo '{"companies":[],"updated_at":null}' > "$LIST_FILE"
  echo "Created empty boycott list at $LIST_FILE"
fi

# If a PID file exists and the process is still alive, leave it alone
if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    if curl -s http://127.0.0.1:7847/health > /dev/null 2>&1; then
      echo "Boycott Filter server already running (pid $EXISTING_PID) on port 7847."
      SERVER_RUNNING=1
    else
      # PID alive but not responsive — kill and restart cleanly
      echo "Stale server process (pid $EXISTING_PID) not responding, restarting."
      kill "$EXISTING_PID" 2>/dev/null || true
      sleep 1
      rm -f "$PID_FILE"
    fi
  else
    # PID file is stale (process gone)
    rm -f "$PID_FILE"
  fi
fi

if [ -z "${SERVER_RUNNING:-}" ]; then
  # Health-check before starting in case another instance bound the port without leaving a PID file
  if curl -s http://127.0.0.1:7847/health > /dev/null 2>&1; then
    echo "Port 7847 is already serving — assuming this is our server (no PID file recorded)."
  else
    echo "Starting Boycott Filter server..."
    # nohup + redirect ensures no terminal-orphan; record PID for future runs
    nohup node "$SERVER" > "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    sleep 1
    if curl -s http://127.0.0.1:7847/health > /dev/null 2>&1; then
      echo "Server started successfully (pid $NEW_PID) on http://127.0.0.1:7847"
      echo "Logs: $LOG_FILE"
    else
      echo "ERROR: Server failed to start. Check $LOG_FILE for details."
      cat "$LOG_FILE" 2>/dev/null | tail -10
      exit 1
    fi
  fi
fi

echo ""
echo "=== Chrome Extension Setup ==="
echo ""
echo "Load the extension manually (one-time):"
echo "  1. Open chrome://extensions"
echo "  2. Enable 'Developer mode' (top right)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $PLUGIN_DIR/extension/"
echo ""
echo "To stop the server later: kill \$(cat $PID_FILE)"
echo "Done! Tell your Claude agent which brands to boycott."
