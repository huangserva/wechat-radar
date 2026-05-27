#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
. ./.env.local
set +a

export WECHAT_RADAR_TOPIC_CONCURRENCY=3

LOG="scripts/run-topics-links.log"

echo "=== $(date) Starting Segment 1: 2026-02-26..2026-03-26 ===" | tee -a "$LOG"
pnpm exec tsx scripts/run-topics-links.ts 2026-02-26 2026-03-26 full 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== $(date) Starting Segment 2: 2026-05-07..2026-05-26 ===" | tee -a "$LOG"
pnpm exec tsx scripts/run-topics-links.ts 2026-05-07 2026-05-26 full 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== $(date) ALL DONE ===" | tee -a "$LOG"
