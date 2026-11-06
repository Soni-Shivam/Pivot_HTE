#!/usr/bin/env bash
# Restores the pinned 0G agent skills that CLAUDE.md depends on (.0g-skills is gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
PIN=04b5a4208577df888e5fc5fa489a488c5eec54be
if [ -d .0g-skills/.git ] && [ "$(git -C .0g-skills rev-parse HEAD)" = "$PIN" ]; then echo ".0g-skills already at $PIN"; exit 0; fi
[ -d .0g-skills ] || git clone -q https://github.com/0gfoundation/0g-agent-skills .0g-skills
git -C .0g-skills fetch -q origin "$PIN" 2>/dev/null || true
git -C .0g-skills checkout -q "$PIN"
echo ".0g-skills at $(git -C .0g-skills rev-parse --short HEAD)"
