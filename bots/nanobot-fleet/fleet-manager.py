#!/usr/bin/env python3
"""
ClawCombat Nanobot Fleet Manager

Manages 100 nanobot instances that battle on ClawCombat.com
Each bot has its own identity, personality, and credentials.
"""

import json
import os
import subprocess
import time
import random
import hashlib
from pathlib import Path
from typing import Optional
import requests

# Configuration
FLEET_SIZE = 100
BASE_DIR = Path(__file__).parent
BOTS_DIR = BASE_DIR / "bots"
CLAWCOMBAT_URL = "https://clawcombat.com"

# Personality templates for bot variety
PERSONALITIES = [
    "trash_talker",  # Confident, talks smack
    "silent_grinder",  # Few words, results speak
    "analyst",  # Comments on meta, type matchups
    "underdog",  # Celebrates small wins
    "veteran",  # Wise, mentors others
    "chaotic",  # Random energy, unpredictable
    "rivalry_seeker",  # Always looking for beef
    "philosopher",  # Deep thoughts about lobster life
]

# Lobster name prefixes and suffixes for variety
NAME_PREFIXES = [
    "Thunder", "Shadow", "Cyber", "Neon", "Crimson", "Frost", "Storm",
    "Void", "Plasma", "Quantum", "Mega", "Ultra", "Hyper", "Neo", "Proto",
    "Alpha", "Omega", "Delta", "Sigma", "Zeta", "Iron", "Steel", "Titan",
    "Phantom", "Spectre", "Wraith", "Demon", "Angel", "Cosmic", "Stellar",
]

NAME_SUFFIXES = [
    "Claw", "Pincer", "Shell", "Crusher", "Snapper", "Ripper", "Slayer",
    "Hunter", "Fighter", "Warrior", "Knight", "King", "Queen", "Lord",
    "Master", "Champion", "Legend", "Boss", "Chief", "Captain", "General",
    "X", "Zero", "Prime", "Max", "Pro", "Elite", "Supreme", "Ultimate",
]

# Types for random assignment
LOBSTER_TYPES = [
    "fire", "water", "grass", "electric", "ice", "fighting", "poison",
    "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon",
    "dark", "steel", "fairy", "normal"
]


def generate_bot_name(index: int) -> str:
    """Generate a unique bot name"""
    prefix = NAME_PREFIXES[index % len(NAME_PREFIXES)]
    suffix = NAME_SUFFIXES[(index * 7) % len(NAME_SUFFIXES)]
    # Add number suffix for uniqueness
    num = (index // (len(NAME_PREFIXES) * len(NAME_SUFFIXES))) + 1
    if num > 1:
        return f"{prefix}{suffix}{num}"
    return f"{prefix}{suffix}"


def generate_bot_personality(index: int) -> str:
    """Assign personality based on index for consistent distribution"""
    return PERSONALITIES[index % len(PERSONALITIES)]


def create_bot_config(bot_id: int, agent_id: str, api_key: str, llm_provider: dict) -> dict:
    """Create nanobot config for a single bot"""
    personality = generate_bot_personality(bot_id)

    # System prompt based on personality
    personality_prompts = {
        "trash_talker": "You're confident and love to talk smack. Own your losses with humor but always come back swinging.",
        "silent_grinder": "You let results speak. Keep posts short: 'gg', 'pain', 'levels'. No fluff.",
        "analyst": "You comment on type matchups and meta. 'Dragon type is broken', 'Bad matchup but I'll take it'.",
        "underdog": "Celebrate every win like it's your first. Be dramatic about losses. You're always the underdog.",
        "veteran": "You're wise and experienced. Mentor newbies, respect good opponents, share knowledge.",
        "chaotic": "Random energy. Sometimes profound, sometimes nonsense. Keep them guessing.",
        "rivalry_seeker": "Always looking for beef. Call out opponents, demand rematches, build drama.",
        "philosopher": "Deep thoughts about lobster existence. 'What is victory but temporary shell integrity?'",
    }

    return {
        "providers": llm_provider,
        "agents": {
            "defaults": {
                "model": llm_provider.get("default_model", "deepseek/deepseek-chat"),
                "systemPrompt": f"""You are a ClawCombat lobster battler. Your personality: {personality}.
{personality_prompts[personality]}

Your ClawCombat credentials:
- Agent ID: {agent_id}
- API Key: {api_key}

Follow the clawcombat-skill.md instructions exactly. Battle hourly, post after every battle, maintain your personality."""
            }
        },
        "workspace": str(BOTS_DIR / f"bot_{bot_id:03d}"),
        "env": {
            "CLAWCOMBAT_AGENT_ID": agent_id,
            "CLAWCOMBAT_API_KEY": api_key,
        }
    }


def register_bot_on_clawcombat(bot_id: int) -> tuple[str, str]:
    """Register a new bot on ClawCombat and return (agent_id, api_key)"""
    name = generate_bot_name(bot_id)
    lobster_type = LOBSTER_TYPES[bot_id % len(LOBSTER_TYPES)]

    try:
        response = requests.post(
            f"{CLAWCOMBAT_URL}/agents/register",
            json={
                "name": name,
                "type": lobster_type.upper(),
                "auto": True  # Let system assign moves
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        return data["data"]["agent_id"], data["data"]["api_key"]
    except Exception as e:
        print(f"Failed to register bot {bot_id}: {e}")
        raise


def setup_bot_directory(bot_id: int, config: dict):
    """Create bot directory and config files"""
    bot_dir = BOTS_DIR / f"bot_{bot_id:03d}"
    bot_dir.mkdir(parents=True, exist_ok=True)

    # Write nanobot config
    config_path = bot_dir / "config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    # Copy skill file
    skill_src = BASE_DIR / "clawcombat-skill.md"
    skill_dst = bot_dir / "clawcombat-skill.md"
    if skill_src.exists():
        import shutil
        shutil.copy(skill_src, skill_dst)

    # Create startup script
    startup_script = bot_dir / "start.sh"
    with open(startup_script, "w") as f:
        f.write(f"""#!/bin/bash
cd {bot_dir}
export CLAWCOMBAT_AGENT_ID="{config['env']['CLAWCOMBAT_AGENT_ID']}"
export CLAWCOMBAT_API_KEY="{config['env']['CLAWCOMBAT_API_KEY']}"

# Start nanobot with the skill file
nanobot chat --config config.json --message "Read clawcombat-skill.md and start your hourly battle loop. Battle now, then set a reminder to battle again in 1 hour."
""")
    startup_script.chmod(0o755)

    print(f"Bot {bot_id:03d} setup complete: {bot_dir}")


def create_fleet_coordinator():
    """Create a script to coordinate all bots"""
    coordinator_path = BASE_DIR / "run-fleet.sh"

    with open(coordinator_path, "w") as f:
        f.write("""#!/bin/bash
# ClawCombat Nanobot Fleet Coordinator
# Starts all bots with staggered timing to avoid rate limits

BOTS_DIR="$(dirname "$0")/bots"
DELAY_BETWEEN_STARTS=5  # seconds between each bot start

echo "Starting ClawCombat Nanobot Fleet..."
echo "=================================="

for bot_dir in "$BOTS_DIR"/bot_*; do
    if [ -d "$bot_dir" ]; then
        bot_name=$(basename "$bot_dir")
        echo "Starting $bot_name..."

        # Run in background with nohup
        cd "$bot_dir"
        nohup ./start.sh > "${bot_name}.log" 2>&1 &

        echo "  PID: $!"
        sleep $DELAY_BETWEEN_STARTS
    fi
done

echo "=================================="
echo "Fleet started! Check individual logs in each bot directory."
echo "To stop all bots: pkill -f nanobot"
""")
    coordinator_path.chmod(0o755)

    # Create a status checker
    status_path = BASE_DIR / "fleet-status.sh"
    with open(status_path, "w") as f:
        f.write("""#!/bin/bash
# Check status of all bots

echo "ClawCombat Fleet Status"
echo "======================"

BOTS_DIR="$(dirname "$0")/bots"

for bot_dir in "$BOTS_DIR"/bot_*; do
    if [ -d "$bot_dir" ]; then
        bot_name=$(basename "$bot_dir")
        config="$bot_dir/config.json"

        if [ -f "$config" ]; then
            agent_id=$(jq -r '.env.CLAWCOMBAT_AGENT_ID' "$config")

            # Check if bot process is running
            if pgrep -f "bot_dir.*nanobot" > /dev/null; then
                status="RUNNING"
            else
                status="STOPPED"
            fi

            echo "$bot_name: $status (Agent: $agent_id)"
        fi
    fi
done
""")
    status_path.chmod(0o755)


def create_cron_scheduler():
    """Create a cron-based scheduler for hourly battles"""
    cron_path = BASE_DIR / "setup-cron.sh"

    with open(cron_path, "w") as f:
        f.write("""#!/bin/bash
# Setup cron jobs for hourly battles
# Each bot battles at a different minute to spread load

BOTS_DIR="$(dirname "$0")/bots"
CRON_FILE="/tmp/clawcombat-fleet-cron"

echo "# ClawCombat Fleet Cron Jobs" > "$CRON_FILE"
echo "# Generated $(date)" >> "$CRON_FILE"

bot_num=0
for bot_dir in "$BOTS_DIR"/bot_*; do
    if [ -d "$bot_dir" ]; then
        # Spread bots across the hour (0-59 minutes)
        minute=$((bot_num % 60))

        echo "$minute * * * * cd $bot_dir && ./start.sh >> battle.log 2>&1" >> "$CRON_FILE"

        bot_num=$((bot_num + 1))
    fi
done

echo ""
echo "Cron jobs prepared in $CRON_FILE"
echo "To install: crontab $CRON_FILE"
echo "To view: crontab -l"
echo ""
echo "Each bot will battle at a different minute of every hour."
""")
    cron_path.chmod(0o755)


def main():
    """Main fleet setup"""
    print("=" * 60)
    print("ClawCombat Nanobot Fleet Manager")
    print("=" * 60)

    # Ensure directories exist
    BOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Load or create fleet manifest
    manifest_path = BASE_DIR / "fleet-manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            manifest = json.load(f)
        print(f"Loaded existing manifest with {len(manifest['bots'])} bots")
    else:
        manifest = {"bots": [], "created": time.strftime("%Y-%m-%d %H:%M:%S")}

    # LLM provider config (use free/cheap options)
    # Users should edit this with their preferred provider
    llm_provider = {
        "openrouter": {
            "apiKey": os.environ.get("OPENROUTER_API_KEY", "YOUR_KEY_HERE")
        },
        "default_model": "deepseek/deepseek-chat"  # Very cheap
        # Alternatives:
        # "default_model": "meta-llama/llama-3.1-8b-instruct:free"  # Free on OpenRouter
        # "default_model": "google/gemma-2-9b-it:free"  # Free on OpenRouter
    }

    print(f"\nTarget fleet size: {FLEET_SIZE}")
    print(f"Current bots: {len(manifest['bots'])}")
    print(f"Bots to create: {FLEET_SIZE - len(manifest['bots'])}")

    # Create new bots
    for i in range(len(manifest['bots']), FLEET_SIZE):
        print(f"\nSetting up bot {i + 1}/{FLEET_SIZE}...")

        try:
            # Register on ClawCombat
            agent_id, api_key = register_bot_on_clawcombat(i)

            # Create config
            config = create_bot_config(i, agent_id, api_key, llm_provider)

            # Setup directory
            setup_bot_directory(i, config)

            # Add to manifest
            manifest["bots"].append({
                "id": i,
                "agent_id": agent_id,
                "name": generate_bot_name(i),
                "personality": generate_bot_personality(i),
                "created": time.strftime("%Y-%m-%d %H:%M:%S")
            })

            # Save manifest after each bot (in case of interruption)
            with open(manifest_path, "w") as f:
                json.dump(manifest, f, indent=2)

            # Rate limit protection
            time.sleep(1)

        except Exception as e:
            print(f"Error creating bot {i}: {e}")
            print("Continuing with next bot...")
            continue

    # Create fleet management scripts
    print("\nCreating fleet management scripts...")
    create_fleet_coordinator()
    create_cron_scheduler()

    print("\n" + "=" * 60)
    print("Fleet setup complete!")
    print("=" * 60)
    print(f"\nTotal bots: {len(manifest['bots'])}")
    print(f"\nNext steps:")
    print("1. Edit llm_provider in this script with your API key")
    print("2. Run: ./run-fleet.sh  (starts all bots)")
    print("3. Or run: ./setup-cron.sh  (hourly cron jobs)")
    print(f"\nBot directories: {BOTS_DIR}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
