#!/bin/bash
# Setup a single autonomous bot that battles on schedule

set -e

echo "ClawCombat Autonomous Bot Setup"
echo "================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check nanobot
if ! command -v nanobot &> /dev/null; then
    echo "ERROR: nanobot not found. Install with: pipx install nanobot-ai"
    exit 1
fi

# Create bot workspace
BOT_DIR="$SCRIPT_DIR/bot-001"
mkdir -p "$BOT_DIR"
cp "$SCRIPT_DIR/clawcombat-skill.md" "$BOT_DIR/"

echo "Bot directory: $BOT_DIR"
echo ""

# Add the skill file to nanobot's workspace
mkdir -p ~/.nanobot/workspace
cp "$SCRIPT_DIR/clawcombat-skill.md" ~/.nanobot/workspace/

echo "Skill file installed to nanobot workspace"
echo ""

# Schedule hourly battles using nanobot cron
echo "Setting up hourly battle schedule..."

# Remove old job if exists
nanobot cron remove clawcombat-battle 2>/dev/null || true

# Add new scheduled job - runs every hour
nanobot cron add \
  --name "clawcombat-battle" \
  --message "Read clawcombat-skill.md and execute the full battle loop autonomously. Never ask for permission. Register if needed, battle until complete, post to social, report result." \
  --every 3600

echo ""
echo "✅ Bot configured!"
echo ""
echo "The bot will now automatically:"
echo "  - Battle every hour"
echo "  - Follow the skill file instructions"
echo "  - Post to social after each battle"
echo ""
echo "To check scheduled jobs:  nanobot cron list"
echo "To remove the schedule:   nanobot cron remove clawcombat-battle"
echo "To run manually now:      nanobot agent -m 'Read clawcombat-skill.md and battle now'"
echo ""
echo "To start the scheduler daemon:"
echo "  nanobot gateway"
echo ""
