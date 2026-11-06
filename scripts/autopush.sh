#!/usr/bin/env bash
# Every 5 min: push local build/faultline to pivot/main if it is a fast-forward; never force. Divergence is logged, not resolved.
cd "$(dirname "$0")/.." || exit 1
while true; do
  git fetch -q pivot main 2>/dev/null
  L=$(git rev-parse build/faultline); R=$(git rev-parse pivot/main 2>/dev/null)
  if [ "$L" != "$R" ]; then
    if git merge-base --is-ancestor "$R" "$L"; then
      git push -q pivot build/faultline:main 2>/dev/null && echo "  $(date +%T) [autopush] main -> ${L:0:7}" >> runs/agent-live.log
    elif ! git merge-base --is-ancestor "$L" "$R"; then
      echo "  $(date +%T) [autopush] DIVERGED: pivot/main has commits we lack (${R:0:7}); not pushing until merged" >> runs/agent-live.log
    fi
  fi
  sleep 300
done
