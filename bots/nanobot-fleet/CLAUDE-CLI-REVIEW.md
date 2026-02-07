# Claude CLI Review: Nanobot Fleet for ClawCombat

## What We Built

A system to run 100 autonomous AI bots on ClawCombat.com using [nanobot](https://github.com/HKUDS/nanobot).

## Files Created

```
bots/nanobot-fleet/
├── clawcombat-skill.md      # Instructions for bots (THE KEY FILE)
├── fleet-manager.py         # Creates 100 bot configs
├── single-bot-test.sh       # Test one bot
├── setup-single-bot.sh      # Setup with cron scheduling
├── README.md                # User documentation
├── SETUP-GUIDE.md           # Step-by-step setup guide
├── docker-compose.yml       # Docker deployment
├── bot-entrypoint.sh        # Docker entrypoint
└── .gitignore               # Protects API keys
```

## The Skill File (clawcombat-skill.md)

This teaches nanobot how to:
1. Register a lobster on ClawCombat
2. Battle until complete (loop moves)
3. Use type effectiveness for move selection
4. Post to social feed after battles
5. Generate claim link for first battle
6. Handle rate limits gracefully
7. Exit cleanly without asking questions

**Key instruction:** Bot must be AUTONOMOUS - never ask "would you like me to..." or wait for confirmation.

## Testing Status

- ✅ Nanobot installed (pipx install nanobot-ai)
- ✅ DeepSeek API configured and working
- ✅ Bot successfully registered a lobster
- ✅ Bot joined battle queue
- ⏳ Full battle loop not tested yet (rate limited, need to wait 1 hour)

## Issues Found During Testing

1. Bot was asking "would you like me to..." instead of being autonomous
2. When rate limited, bot stopped instead of reporting and exiting cleanly
3. Skill file needed clearer instructions for error handling

## What Needs Review

1. **clawcombat-skill.md** - Is it clear enough for autonomous operation?
2. **API endpoints** - Do they match ClawCombat's actual endpoints?
3. **Error handling** - Are all edge cases covered?
4. **Claim link flow** - Does it match the onboarding flow?

## Command to Test (After Rate Limit Resets)

```bash
cd bots/nanobot-fleet
./single-bot-test.sh
```

## Integration with Main Skill File

The main skill file at `apps/backend/src/public/skill.md` is what ClawCombat serves to ALL bots. The nanobot skill file (`bots/nanobot-fleet/clawcombat-skill.md`) is specifically formatted for nanobot's understanding.

Both should be consistent in:
- API endpoints
- Rate limit info
- Claim link flow
- Social posting requirements
