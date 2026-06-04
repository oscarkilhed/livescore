#!/usr/bin/env bash
#
# Control the mock API's virtual competition time without typing curl.
#
# Usage:
#   scripts/mock-time.sh            advance 60 minutes (default)
#   scripts/mock-time.sh 30         advance 30 minutes
#   scripts/mock-time.sh +30        advance 30 minutes
#   scripts/mock-time.sh at <ISO>   jump to an absolute timestamp (e.g. 2026-05-17T08:00:00Z)
#   scripts/mock-time.sh end        jump to the end of the competition (fast-forward)
#   scripts/mock-time.sh reset      reset to competition start
#   scripts/mock-time.sh state      show current virtual time (read-only)
#
# Env overrides (defaults match the current dev event):
#   MOCK_PORT=3001  CT=22  EVENT=24850
#
set -u

PORT="${MOCK_PORT:-3001}"
CT="${CT:-22}"
EVENT="${EVENT:-24850}"
BASE="http://localhost:${PORT}"

# Pretty-print a mock response (works for /mock/time, /mock/reset and /mock/state)
show() {
  PORT="$PORT" node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      if (!s.trim()) {
        process.stdout.write("No response — is the mock API running on :" + process.env.PORT + "?  (npm run mock-api)\n");
        return;
      }
      try {
        const j = JSON.parse(s);
        const ev = j.events && j.events[0];
        const vt = j.virtualTime || (ev && ev.virtualTime);
        const sc = j.scorecards || (ev && ev.scorecards);
        let line = "virtualTime: " + (vt || "?");
        if (sc) line += "  (" + sc.visible + "/" + sc.total + " scorecards visible)";
        process.stdout.write(line + "\n");
      } catch (e) {
        process.stdout.write(s + "\n");
      }
    });
  '
}

post() { # $1=path  $2=json body
  curl -s -X POST "${BASE}$1" -H "Content-Type: application/json" -d "$2"
}

cmd="${1:-60}"
case "$cmd" in
  state)
    curl -s "${BASE}/mock/state" | show
    ;;
  reset)
    post /mock/reset "{\"contentType\":${CT},\"eventId\":\"${EVENT}\"}" | show
    ;;
  end|ff|fastforward)
    post /mock/time "{\"contentType\":${CT},\"eventId\":\"${EVENT}\",\"fastForward\":true}" | show
    ;;
  at)
    ts="${2:-}"
    if [ -z "$ts" ]; then
      echo "usage: scripts/mock-time.sh at <ISO timestamp>" >&2
      exit 1
    fi
    post /mock/time "{\"contentType\":${CT},\"eventId\":\"${EVENT}\",\"time\":\"${ts}\"}" | show
    ;;
  *)
    mins="${cmd#+}"  # allow a leading "+"
    if ! [[ "$mins" =~ ^[0-9]+$ ]]; then
      echo "Unknown command: $cmd" >&2
      echo "Usage: scripts/mock-time.sh [N | +N | at <ISO> | end | reset | state]" >&2
      exit 1
    fi
    post /mock/time "{\"contentType\":${CT},\"eventId\":\"${EVENT}\",\"advanceMinutes\":${mins}}" | show
    ;;
esac
