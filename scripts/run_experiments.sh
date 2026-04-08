#!/bin/bash
# scripts/run_experiments.sh
#
# Run all experiment conditions sequentially. For each experiment profile, this
# script:
#   1. Spawns the agent in batch auto-start mode via PROFILES env var
#   2. Waits until the batch_*.json file is written by AgentTesting
#   3. Kills the agent
#   4. Copies the latest batch result into results/<experiment_name>.json
#
# Usage:
#   bash scripts/run_experiments.sh
#
# Prerequisites:
#   - Minecraft server is running on the host/port from settings.js
#   - For 8b experiments: Ollama is serving qwen2:7b at http://127.0.0.1:11434
#   - For frontier experiments: OPENAI_API_KEY is set in keys.json

set -u

# --- Configuration ----------------------------------------------------------

# Run from the repo root
cd "$(dirname "$0")/.."

PROFILES=(
    "profiles/experiments/8b_unenhanced.json"
    "profiles/experiments/8b_softcluster.json"
    "profiles/experiments/8b_semantic_only.json"
    "profiles/experiments/frontier_full.json"
)

# Maps each profile path to its profile.name (which is also the bot name and
# the directory under bots/ where AgentTesting writes test_results/).
declare -A PROFILE_TO_BOT
PROFILE_TO_BOT["profiles/experiments/8b_unenhanced.json"]="experiment_baseline"
PROFILE_TO_BOT["profiles/experiments/8b_softcluster.json"]="experiment_softcluster"
PROFILE_TO_BOT["profiles/experiments/8b_semantic_only.json"]="experiment_semantic_only"
PROFILE_TO_BOT["profiles/experiments/frontier_full.json"]="experiment_frontier"

mkdir -p results

# --- Run loop --------------------------------------------------------------

for PROFILE in "${PROFILES[@]}"; do
    BOT_NAME="${PROFILE_TO_BOT[$PROFILE]}"
    PROFILE_NAME=$(basename "$PROFILE" .json)
    RESULTS_DIR="bots/${BOT_NAME}/test_results"

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

    # Wait until a new batch_*.json appears
    echo "Waiting for batch to complete..."
    WAIT_SECONDS=0
    MAX_WAIT=14400  # 4 hours hard cap
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

        if [ "$WAIT_SECONDS" -ge "$MAX_WAIT" ]; then
            echo "ERROR: Timed out waiting for ${PROFILE_NAME} after ${MAX_WAIT}s" >&2
            break
        fi

        sleep 10
        WAIT_SECONDS=$((WAIT_SECONDS + 10))
    done

    # Stop the agent
    if kill -0 "$AGENT_PID" 2>/dev/null; then
        echo "Stopping agent ${AGENT_PID}..."
        kill "$AGENT_PID" 2>/dev/null
        # Give it a moment to shut down cleanly
        sleep 2
        if kill -0 "$AGENT_PID" 2>/dev/null; then
            kill -9 "$AGENT_PID" 2>/dev/null
        fi
        wait "$AGENT_PID" 2>/dev/null
    fi

    # Copy the latest batch result for this experiment into results/
    if [ -d "$RESULTS_DIR" ]; then
        LATEST=$(ls -t "$RESULTS_DIR"/batch_*.json 2>/dev/null | head -1)
        if [ -n "$LATEST" ] && [ -f "$LATEST" ]; then
            cp "$LATEST" "results/${PROFILE_NAME}.json"
            echo "Saved: results/${PROFILE_NAME}.json"
        else
            echo "WARNING: No batch result found for ${PROFILE_NAME}" >&2
        fi
    fi

    # Brief pause between experiments so the Minecraft server can settle
    sleep 5
done

echo ""
echo "============================================================"
echo "  All experiments complete"
echo "============================================================"
echo "Results in: results/"
ls -la results/*.json 2>/dev/null || echo "(no result files)"
