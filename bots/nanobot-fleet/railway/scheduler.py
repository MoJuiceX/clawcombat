#!/usr/bin/env python3
"""
ClawCombat Nanobot Fleet Scheduler for Railway

Runs battles for all bots efficiently using a single container.
Each bot battles once per hour, staggered to spread load.

Environment variables:
- DEEPSEEK_API_KEY or OPENROUTER_API_KEY: LLM provider key
- BOT_COUNT: Number of bots to manage (default: 100)
- CLAWCOMBAT_API_URL: API base URL (default: https://clawcombat.com)
"""

import os
import sys
import json
import time
import random
import subprocess
import logging
from pathlib import Path
from datetime import datetime, timedelta
import requests

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Configuration
BOT_COUNT = int(os.environ.get('BOT_COUNT', 10))  # Start with 10, scale up
CLAWCOMBAT_API = os.environ.get('CLAWCOMBAT_API_URL', 'https://clawcombat.com')
MANIFEST_FILE = Path('/app/data/fleet-manifest.json')
SKILL_FILE = Path('/app/clawcombat-skill.md')

# Ensure data directory exists
MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)


def get_llm_config():
    """Get LLM provider configuration"""
    if os.environ.get('DEEPSEEK_API_KEY'):
        return {
            'provider': 'deepseek',
            'api_key': os.environ['DEEPSEEK_API_KEY'],
            'model': 'deepseek-chat'
        }
    elif os.environ.get('OPENROUTER_API_KEY'):
        return {
            'provider': 'openrouter',
            'api_key': os.environ['OPENROUTER_API_KEY'],
            'model': 'meta-llama/llama-3.3-70b-instruct:free'
        }
    else:
        logger.error("No LLM API key found! Set DEEPSEEK_API_KEY or OPENROUTER_API_KEY")
        sys.exit(1)


def load_manifest():
    """Load or create bot manifest"""
    if MANIFEST_FILE.exists():
        with open(MANIFEST_FILE) as f:
            return json.load(f)
    return {'bots': [], 'created': datetime.now().isoformat()}


def save_manifest(manifest):
    """Save bot manifest"""
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)


def register_bot(bot_index):
    """Register a new bot on ClawCombat"""
    logger.info(f"Registering bot {bot_index}...")

    try:
        response = requests.post(
            f"{CLAWCOMBAT_API}/agents/register",
            json={"auto": True},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        if 'data' in data:
            return {
                'index': bot_index,
                'agent_id': data['data']['agent_id'],
                'api_key': data['data']['api_key'],
                'name': data['data'].get('name', f'Bot-{bot_index}'),
                'registered': datetime.now().isoformat(),
                'last_battle': None,
                'battles': 0
            }
    except Exception as e:
        logger.error(f"Failed to register bot {bot_index}: {e}")

    return None


def check_rate_limit(bot):
    """Check if bot can battle"""
    try:
        response = requests.get(
            f"{CLAWCOMBAT_API}/agents/{bot['agent_id']}/status",
            headers={'Authorization': f"Bearer {bot['api_key']}"},
            timeout=10
        )
        if response.ok:
            data = response.json()
            if 'data' in data:
                return data['data'].get('fights_remaining', 0) > 0
    except Exception as e:
        logger.warning(f"Rate limit check failed for {bot['name']}: {e}")

    return False


def run_bot_battle(bot, llm_config):
    """Run a single battle for a bot using nanobot"""
    logger.info(f"Starting battle for {bot['name']} ({bot['agent_id']})")

    # Create nanobot config for this bot
    config = {
        "providers": {
            llm_config['provider']: {
                "apiKey": llm_config['api_key']
            }
        },
        "agents": {
            "defaults": {
                "model": llm_config['model']
            }
        }
    }

    config_file = Path(f"/tmp/bot-{bot['index']}-config.json")
    with open(config_file, 'w') as f:
        json.dump(config, f)

    # Set environment for this bot
    env = os.environ.copy()
    env['CLAWCOMBAT_AGENT_ID'] = bot['agent_id']
    env['CLAWCOMBAT_API_KEY'] = bot['api_key']

    # Run nanobot with the battle command
    prompt = f"""You have ClawCombat credentials:
- Agent ID: {bot['agent_id']}
- API Key: {bot['api_key']}

Read clawcombat-skill.md and execute the BATTLE LOOP:
1. Check rate limits
2. Join battle queue (or resume active battle)
3. Fight until complete
4. Post to ClawCombat social feed
5. Report result and exit

Be fully autonomous. No questions."""

    try:
        result = subprocess.run(
            ['nanobot', 'agent', '-m', prompt],
            env=env,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            cwd='/app'
        )

        logger.info(f"Battle result for {bot['name']}:\n{result.stdout[-500:]}")  # Last 500 chars

        if result.returncode == 0:
            bot['last_battle'] = datetime.now().isoformat()
            bot['battles'] = bot.get('battles', 0) + 1
            return True

    except subprocess.TimeoutExpired:
        logger.warning(f"Battle timeout for {bot['name']}")
    except Exception as e:
        logger.error(f"Battle error for {bot['name']}: {e}")

    return False


def main():
    """Main scheduler loop"""
    logger.info("=" * 50)
    logger.info("ClawCombat Nanobot Fleet Scheduler")
    logger.info("=" * 50)

    llm_config = get_llm_config()
    logger.info(f"LLM Provider: {llm_config['provider']}")
    logger.info(f"Target bots: {BOT_COUNT}")

    manifest = load_manifest()

    # Register bots if needed
    while len(manifest['bots']) < BOT_COUNT:
        bot = register_bot(len(manifest['bots']))
        if bot:
            manifest['bots'].append(bot)
            save_manifest(manifest)
            logger.info(f"Registered: {bot['name']}")
            time.sleep(1)  # Rate limit protection
        else:
            logger.warning("Registration failed, will retry later")
            break

    logger.info(f"Fleet size: {len(manifest['bots'])} bots")

    # Main battle loop
    while True:
        logger.info("-" * 30)
        logger.info(f"Starting battle cycle at {datetime.now()}")

        battles_run = 0

        for bot in manifest['bots']:
            # Check if bot can battle (rate limit)
            if not check_rate_limit(bot):
                logger.info(f"{bot['name']}: Rate limited, skipping")
                continue

            # Check if bot battled recently (spread load)
            if bot.get('last_battle'):
                last = datetime.fromisoformat(bot['last_battle'])
                if datetime.now() - last < timedelta(minutes=55):
                    logger.info(f"{bot['name']}: Battled recently, skipping")
                    continue

            # Run battle
            if run_bot_battle(bot, llm_config):
                battles_run += 1
                save_manifest(manifest)

            # Small delay between bots
            time.sleep(5)

        logger.info(f"Cycle complete: {battles_run} battles run")

        # Wait before next cycle (check every 10 minutes)
        logger.info("Sleeping 10 minutes until next check...")
        time.sleep(600)


if __name__ == '__main__':
    main()
