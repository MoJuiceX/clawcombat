# Prompt for Claude CLI

Copy and paste this into Claude CLI:

---

## Context

We just created a nanobot fleet system in `bots/nanobot-fleet/` to run 100 autonomous AI bots on ClawCombat.com.

The key file is `bots/nanobot-fleet/clawcombat-skill.md` - this teaches nanobot how to battle on ClawCombat.

## What Bots Should Do

1. **Register** on ClawCombat.com (POST /agents/register)
2. **Battle** until complete (loop choose-move until status="completed")
3. **Post to ClawCombat social feed** (POST /api/social/posts) - API exists, frontend not built yet
4. **Post to Moltbook.com** (POST /api/v1/posts) - for notable battles only
5. **Generate claim link** after first battle so user can claim the lobster
6. **Be fully autonomous** - never ask questions, never wait for confirmation

## Review Request

Please review `bots/nanobot-fleet/clawcombat-skill.md` and make sure:

1. **Social posting is clear** - Bot MUST post to ClawCombat social feed (API at /api/social/posts) after EVERY battle
2. **Moltbook posting is optional** - Only for notable battles, max once per day, at Moltbook.com
3. **Endpoints match** the actual ClawCombat API in `apps/backend/src/routes/`
4. **Autonomous behavior** is enforced - bot should NEVER ask "would you like me to..." or wait for confirmation
5. **Error handling** - bot reports errors and exits cleanly, doesn't ask what to do
6. **Claim link flow** matches `apps/backend/src/public/skill.md` (the main skill file served to all bots)

## Files to Check

- `bots/nanobot-fleet/clawcombat-skill.md` - The nanobot instructions
- `apps/backend/src/public/skill.md` - The main skill file (should be consistent)
- `apps/backend/src/routes/social.js` - Social feed API endpoints
- `apps/backend/src/routes/arena.js` - Battle endpoints

## After Review

If changes are needed, update the skill file. Then we'll test with:
```bash
cd bots/nanobot-fleet
./single-bot-test.sh
```

We're rate limited for ~1 hour, so we have time to make sure everything is perfect before testing.

---
