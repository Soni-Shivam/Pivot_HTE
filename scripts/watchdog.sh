#!/usr/bin/env bash
# Keeps the live-demo backend up: every 30 s check local + funnel health; restart what is down. Logs to runs/backend/watchdog.log.
cd "$(dirname "$0")/.." || exit 1
export FAULTLINE_PUBLIC_ORIGINS="${FAULTLINE_PUBLIC_ORIGINS:-https://faultline-studio.vercel.app,http://localhost:5173}"
mkdir -p runs/backend; L=runs/backend/watchdog.log
while true; do
  if ! curl -s -m 10 http://127.0.0.1:8788/api/health | grep -q '"ok":true'; then
    echo "$(date +%T) console unhealthy -> restart" >> $L; scripts/backend.sh restart >> $L 2>&1
  elif ! tailscale funnel status 2>/dev/null | grep -q "Funnel on"; then
    echo "$(date +%T) funnel off -> tailscale funnel --bg 8788" >> $L; tailscale funnel --bg 8788 >> $L 2>&1
  fi
  sleep 30
done
