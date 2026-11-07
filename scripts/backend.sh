#!/usr/bin/env bash
# Public backend for Faultline Studio (docs/BACKEND.md): merchant service :8787, agent console :8788 (127.0.0.1),
# Tailscale Funnel https://<node>.ts.net -> 127.0.0.1:8788. Survives the shell/agent ending (setsid + nohup).
#   scripts/backend.sh start|stop|status|restart
#   FAULTLINE_PUBLIC_ORIGINS="https://<app>.vercel.app,http://localhost:5173" scripts/backend.sh restart
set -u
cd "$(dirname "$0")/.."
LOG=runs/backend; mkdir -p "$LOG"
ORIGINS_FILE=$LOG/origins          # remembers the last FAULTLINE_PUBLIC_ORIGINS passed to start
PUBLIC_URL=${FAULTLINE_PUBLIC_URL:-https://sedrica-w.tail1b988f.ts.net}
. ~/.nvm/nvm.sh >/dev/null

pidof_port() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2; }

start_one() { # name port cmd...
  local name=$1 port=$2; shift 2
  if [ -n "$(pidof_port "$port")" ]; then echo "$name already on :$port"; return; fi
  setsid nohup "$@" >>"$LOG/$name.log" 2>&1 < /dev/null &
  for _ in $(seq 1 40); do [ -n "$(pidof_port "$port")" ] && break; sleep 0.5; done
  [ -n "$(pidof_port "$port")" ] && echo "$name up on :$port" || { echo "$name FAILED, see $LOG/$name.log"; tail -5 "$LOG/$name.log"; }
}

case "${1:-status}" in
  start)
    [ -n "${FAULTLINE_PUBLIC_ORIGINS:-}" ] && echo "$FAULTLINE_PUBLIC_ORIGINS" > "$ORIGINS_FILE"
    export FAULTLINE_PUBLIC_ORIGINS=$(cat "$ORIGINS_FILE" 2>/dev/null || echo "http://localhost:5173")
    export FAULTLINE_PUBLIC_HOST=${PUBLIC_URL#https://}
    start_one merchant 8787 ./node_modules/.bin/tsx packages/hedera/src/paid-ping-server.ts
    start_one console 8788 ./node_modules/.bin/tsx packages/hedera/src/agent-console.ts
    echo "CORS origins: $FAULTLINE_PUBLIC_ORIGINS"
    tailscale funnel --bg 8788 2>&1 | tail -3 || true
    ;;
  stop)
    for p in 8788 8787; do pid=$(pidof_port $p); [ -n "$pid" ] && kill "$pid" && echo "stopped :$p (pid $pid)"; done
    echo "funnel left as is (turn off: tailscale funnel --https=443 off)"
    ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  status)
    for p in 8787 8788; do echo ":$p pid $(pidof_port $p)"; done
    tailscale funnel status 2>&1 | grep -A2 "Funnel on" || echo "funnel: off"
    echo "local:  $(curl -s -m 5 http://127.0.0.1:8788/api/health)"
    echo "public: $(curl -s -m 10 "$PUBLIC_URL/api/health")"
    ;;
  *) echo "usage: $0 start|stop|status|restart"; exit 2 ;;
esac
