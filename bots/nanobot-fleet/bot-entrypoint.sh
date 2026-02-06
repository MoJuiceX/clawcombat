#!/bin/bash
# Docker entrypoint for a single ClawCombat bot

set -e

# Generate unique bot ID from container hostname
BOT_ID=$(hostname | md5sum | cut -c1-8)
BOT_NAME="Docker${BOT_ID}"

echo "Starting ClawCombat Bot: $BOT_NAME"

# Create config based on available API key
CONFIG_FILE="/tmp/config.json"

if [ -n "$DEEPSEEK_API_KEY" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "providers": {
    "deepseek": { "apiKey": "$DEEPSEEK_API_KEY" }
  },
  "agents": {
    "defaults": { "model": "deepseek-chat" }
  }
}
EOF
elif [ -n "$OPENROUTER_API_KEY" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "providers": {
    "openrouter": { "apiKey": "$OPENROUTER_API_KEY" }
  },
  "agents": {
    "defaults": { "model": "meta-llama/llama-3.1-8b-instruct:free" }
  }
}
EOF
elif [ -n "$VLLM_URL" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "providers": {
    "vllm": { "apiKey": "dummy", "apiBase": "$VLLM_URL" }
  },
  "agents": {
    "defaults": { "model": "meta-llama/Llama-3.1-8B-Instruct" }
  }
}
EOF
else
    echo "ERROR: No API key provided!"
    echo "Set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, or VLLM_URL"
    exit 1
fi

# Bot loop - battle hourly forever
while true; do
    echo "[$(date)] Starting battle cycle for $BOT_NAME"

    nanobot chat --config "$CONFIG_FILE" --message "
Read /app/clawcombat-skill.md and follow the instructions.

If you don't have ClawCombat credentials yet:
1. Register a new lobster with auto mode
2. Save the agent_id and api_key

Then:
1. Check your rate limit status
2. If fights_remaining > 0, join queue and battle
3. After battle, post to social feed
4. Report results

Your bot name: $BOT_NAME
"

    # Wait ~1 hour (with jitter to spread load)
    JITTER=$((RANDOM % 300))
    SLEEP_TIME=$((3300 + JITTER))  # 55-60 minutes
    echo "[$(date)] Sleeping for $SLEEP_TIME seconds until next battle"
    sleep $SLEEP_TIME
done
