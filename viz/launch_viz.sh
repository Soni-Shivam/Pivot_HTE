#!/usr/bin/env bash
# Faultline live displays on the VNC desktop :2.   viz/launch_viz.sh start | stop | status
#   chase camera (from the run, top-left 1280x784) | HMI (Lichtblick in Firefox, right column)
#   RViz (bottom-left strip)                       | live agent terminal (bottom-right)
# Processes run in their own sessions; pids in runs/viz/*.pid. ROS domain 42, localhost only (viz/env.sh).
set -u
cd "$(dirname "$0")/.."
VIZ=viz RUN=runs/viz
export DISPLAY=${VIZ_DISPLAY:-:2}
FF_PROFILE="$HOME/snap/firefox/common/faultline-hmi"  # snap Firefox can only read its own dirs

spawn() {  # name cmd...
  setsid "${@:2}" > "$RUN/$1.log" 2>&1 < /dev/null &
  echo $! > "$RUN/$1.pid"
}

stop() {
  for f in "$RUN"/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    rm -f "$f"
  done
  python3 "$VIZ/xplace.py" "Lichtblick" --close > /dev/null  # snap Firefox ignores our signals
  echo "viz stopped"
}

start() {
  mkdir -p "$RUN"
  stop > /dev/null
  set +u; source "$VIZ/env.sh"; set -u
  # read-only bridge (no client publish/params/services): display only, and Lichtblick's client-advertised
  # /initialpose channel id otherwise collided with a server channel and silenced it (seen on /faultline/mode)
  spawn bridge ros2 run foxglove_bridge foxglove_bridge --ros-args -p port:=8765 -p address:=127.0.0.1 \
    -p "capabilities:=[connectionGraph,assets]"
  spawn latch .venv/bin/python "$VIZ/hmi_latch.py"
  spawn rviz rviz2 -d "$VIZ/faultline.rviz" --ros-args -p use_sim_time:=true
  spawn hmi_web python3 "$VIZ/hmi_web.py"
  rm -rf "$FF_PROFILE" && mkdir -p "$FF_PROFILE"  # fresh: Lichtblick UI state always starts from its defaults
  cat > "$FF_PROFILE/user.js" <<'JS'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("layout.css.devPixelsPerPx", "0.8");
user_pref("general.useragent.override", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
JS
  # Lichtblick's Indicator panels bind only topics advertised when the layout loads: wait for hmi_latch's
  for _ in $(seq 30); do grep -q 'topic "/faultline/mode"' "$RUN/bridge.log" && break; sleep 0.5; done
  spawn hmi firefox --no-remote --new-instance --profile "$FF_PROFILE" --new-window "http://localhost:8780/"
  python3 "$VIZ/xplace.py" " - RViz" 1280x416+0+784 --wait 30
  python3 "$VIZ/xplace.py" "Lichtblick" 640x842+1280+28 --wait 30
  python3 "$VIZ/xplace.py" "Faultline agent (live)" 640x330+1280+870 || true
  echo "viz started: foxglove_bridge ws://localhost:8765, HMI http://localhost:8780/, RViz; logs in $RUN/"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) for f in "$RUN"/*.pid; do [ -e "$f" ] && { n=$(basename "$f" .pid); kill -0 "$(cat "$f")" 2>/dev/null && echo "$n up" || echo "$n down"; }; done ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
