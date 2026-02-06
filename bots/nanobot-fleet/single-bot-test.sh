#!/bin/bash
# Test a single ClawCombat bot

set -e

echo "ClawCombat Bot Test"
echo "==================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Copy skill file to nanobot workspace
mkdir -p ~/.nanobot/workspace
cp "$SCRIPT_DIR/clawcombat-skill.md" ~/.nanobot/workspace/

echo "Skill installed to ~/.nanobot/workspace/"
echo ""
echo "Starting autonomous battle..."
echo "============================="
echo ""

# Run the bot - it should do everything automatically
nanobot agent -m "Read clawcombat-skill.md. Execute the FIRST TIME SETUP flow: register, battle until complete, generate claim link, report results. Be fully autonomous - no questions."
