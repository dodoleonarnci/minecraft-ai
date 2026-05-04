#!/bin/bash
# scripts/run_frontier.sh
#
# Run only the frontier_full experiment condition. Same logic as
# run_experiments.sh but with a single profile.
#
# Usage:
#   bash scripts/run_frontier.sh
#
# Prerequisites:
#   - Minecraft server is running on the host/port from settings.js
#   - OPENAI_API_KEY is set in keys.json

set -u

# --- Configuration ----------------------------------------------------------

cd "$(dirname "$0")/.."

PROFILE="profiles/experiments/frontier_full.json"
BOT_NAME="exp_frontier"
PROFILE_NAME="frontier_full"
RESULTS_DIR="bots/${BOT_NAME}/test_results"

mkdir -p results

echo ""
echo "============================================================"
echo "  Running experiment: ${PROFILE_NAME}  (bot: ${BOT_NAME})"
echo "============================================================"

# Snapshot batch files that already exist so we can detect new ones
BEFORE_COUNT=0
if [ -d "$RESULTS_DIR" ]; then
    BEFORE_COUNT=$(find "$RESULTS_DIR" -maxdepth 1 -name 'batch_*.json' 2>/dev/null | wc -l | tr -d ' ')
fi

# Spawn the agent. PROFILES env var is read by settings.js (line 48).
PROFILES="[\"./${PROFILE}\"]" node main.js > "results/${PROFILE_NAME}.log" 2>&1 &
AGENT_PID=$!
echo "Agent PID: ${AGENT_PID}  (logs: results/${PROFILE_NAME}.log)"

# Wait until a new batch_*.json appears or the agent dies
echo "Waiting for batch to complete..."
WAIT_SECONDS=0
while true; do
    AFTER_COUNT=0
    if [ -d "$RESULTS_DIR" ]; then
        AFTER_COUNT=$(find "$RESULTS_DIR" -maxdepth 1 -name 'batch_*.json' 2>/dev/null | wc -l | tr -d ' ')
    fi

    if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
        echo "Detected new batch result for ${PROFILE_NAME} after ${WAIT_SECONDS}s"
        break
    fi

    # Detect crashed agent
    if ! kill -0 "$AGENT_PID" 2>/dev/null; then
        echo "ERROR: Agent process ${AGENT_PID} died before producing a batch result." >&2
        echo "Check results/${PROFILE_NAME}.log for details." >&2
        break
    fi

    sleep 10
    WAIT_SECONDS=$((WAIT_SECONDS + 10))
done

# Stop the agent
if kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "Stopping agent ${AGENT_PID}..."
    kill "$AGENT_PID" 2>/dev/null
    sleep 2
    if kill -0 "$AGENT_PID" 2>/dev/null; then
        kill -9 "$AGENT_PID" 2>/dev/null
    fi
    wait "$AGENT_PID" 2>/dev/null
fi

# Copy the latest batch result into results/
if [ -d "$RESULTS_DIR" ]; then
    LATEST=$(ls -t "$RESULTS_DIR"/batch_*.json 2>/dev/null | head -1)
    if [ -n "$LATEST" ] && [ -f "$LATEST" ]; then
        cp "$LATEST" "results/${PROFILE_NAME}.json"
        echo "Saved: results/${PROFILE_NAME}.json"
    else
        echo "WARNING: No batch result found for ${PROFILE_NAME}" >&2
    fi
fi

echo ""
echo "============================================================"
echo "  Experiment complete"
echo "============================================================"
echo "Results in: results/"
ls -la results/${PROFILE_NAME}*.json 2>/dev/null || echo "(no result files)"
