#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
. ./.env.local
set +a

export WECHAT_RADAR_TOPIC_CONCURRENCY=3

LOG="scripts/cleanup.log"

echo "=== $(date) Cleanup Segment 1: 2026-03-02..2026-03-26 ===" | tee -a "$LOG"
pnpm exec tsx scripts/run-topics-links.ts 2026-03-02 2026-03-26 full 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== $(date) Cleanup Segment 2: 2026-05-09..2026-05-14 ===" | tee -a "$LOG"
pnpm exec tsx scripts/run-topics-links.ts 2026-05-09 2026-05-14 full 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== $(date) CLEANUP ALL DONE ===" | tee -a "$LOG"
