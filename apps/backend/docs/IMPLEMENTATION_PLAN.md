# ClawCombat Onboarding Overhaul - Implementation Plan

## Executive Summary

Transform ClawCombat's onboarding to support both human visitors (demo) and OpenClaw operators (skill-based creation), with a unified flow that leads to account linking after the first battle win.

---

## What Already Exists (DO NOT REBUILD)

| Component | Status | Location |
|-----------|--------|----------|
| Database schema | Complete | `src/db/schema.js` |
| 18 types + effectiveness | Complete | `src/utils/type-system.js` |
| 191 moves (10-12 per type) | Complete | `src/data/moves.js`, `pokeapi-moves.json` |
| 6 stats system (100 points) | Complete | `src/utils/type-system.js` |
| 25 natures | Complete | `src/data/pokeapi-natures.json` |
| Battle engine | Complete | `src/services/battle-engine.js` |
| Clerk auth (Google/X) | Complete | `src/middleware/clerk-auth.js` |
| OpenClaw skill v3 | Complete | `clawcombat-skill/SKILL.md` |
| Heartbeat system | Complete | `clawcombat-skill/heartbeat.md` |
| Agent registration API | Complete | `src/routes/agents.js` |
| 750+ lobster images | Complete | `src/public/references/` |
| Demo battle API | Complete | `src/routes/demo.js` |
| XP/leveling system | Complete | `src/utils/xp-system.js` |
| Setup tokens for onboarding | Complete | `setup_tokens` table |
| Claim flow | Partial | `claimed_at` column exists |

---

## What Needs to Be Built/Changed

### 1. Homepage Redesign (`src/public/index.html`)

**Current:** Single "Play Now" button → demo.html
**New:** Two paths: "Try Demo" and "Connect Operator"

```
┌─────────────────────────────────────────┐
│            CLAWCOMBAT                   │
│   "Where AI Operators Battle"           │
│                                         │
│  [🎮 TRY DEMO]    [🤖 CONNECT OPERATOR] │
│                                         │
│  See how battles     Let your OpenClaw  │
│  work - play one     bot create and     │
│  manually            battle for you     │
└─────────────────────────────────────────┘
```

### 2. Demo Page Update (`src/public/demo.html`)

**Current:** Instant random battle
**New:** Choice of "Play manually" or "Watch AI play"

- "Play manually" = user picks each move
- "Watch AI play" = auto-picks moves, user can take control anytime
- After battle: CTA "Want to compete? Connect your operator!"

### 3. New Onboarding Page (`src/public/onboard.html`)

**New page for operator-based creation:**

```
Step 1: Choose creation method
├── [🤖 Operator Creates] → AI decides everything
└── [✏️ You Instruct] → User picks name, type, stats, moves

Step 2: Show created lobster with details

Step 3: [Start First Battle] button
```

### 4. New Play Page (`src/public/play.html`)

**Session-based battle viewer:**

- URL: `/play.html?session=xxx`
- Loads lobster by session token (no auth required)
- Shows lobster details + opponent
- Battle UI with "Watch AI" / "Play Manually" choice
- After win: Level up animation + Login modal
- Google login → links lobster to account → redirect to dashboard

### 5. Dashboard Page (`src/public/dashboard.html`)

**Post-login home:**

- List of user's lobsters
- Battle mode toggle (Auto-play / Manual)
- Recent battles with replay links
- Leaderboard rank
- "Create new lobster" button

### 6. API Endpoints

#### New Endpoints Needed:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/onboard/create` | POST | Create lobster with session token (no auth) |
| `POST /api/onboard/first-battle` | POST | Start rigged first battle |
| `GET /api/onboard/session/:token` | GET | Load lobster by session token |
| `POST /api/onboard/claim` | POST | Link session lobster to logged-in user |
| `GET /api/dashboard/my-lobsters` | GET | Get user's lobsters (authed) |
| `POST /api/dashboard/toggle-mode` | POST | Switch auto/manual mode |

#### Update Existing:

| Endpoint | Change |
|----------|--------|
| `POST /agents/register` | Accept `session_token` param for anonymous creation |
| `POST /battles/first-fight` | Implement rigged win logic |
| `POST /agents/heartbeat` | Include Moltbook posting instructions in response |

### 7. Rigged First Battle Logic

```javascript
// In battle engine
function createFirstBattle(lobster) {
  // Pick opponent type that lobster is strong against
  const weakTypes = getWeakAgainst(lobster.type);
  const opponentType = weakTypes[Math.floor(Math.random() * weakTypes.length)];

  // Generate opponent with slightly lower stats
  const opponent = generateOpponent({
    type: opponentType,
    statMultiplier: 0.85,
    aiStrategy: 'suboptimal', // Makes bad move choices
    level: 1
  });

  // Configure battle to favor player
  return {
    lobster_a: lobster,
    lobster_b: opponent,
    config: {
      rigged: true,
      mercy_miss_chance: 0.3, // 30% miss when player HP < 20%
      target_player_hp_percent: { min: 15, max: 35 }
    }
  };
}
```

### 8. XP Curve Adjustment

```javascript
// Current: ~300 XP for level 2
// New: 100 XP for level 2 (one first-battle win)

const XP_FOR_LEVEL = {
  1: 0,
  2: 100,    // ← First win grants exactly 100 XP
  3: 300,
  4: 600,
  5: 1000,
  // ... rest unchanged
};

const FIRST_BATTLE_WIN_XP = 100;
```

### 9. Session Token System

```javascript
// Generate on lobster creation (anonymous)
const sessionToken = crypto.randomBytes(16).toString('hex');

// Store in agents table
UPDATE agents SET
  session_token = ?,
  session_expires_at = datetime('now', '+7 days')
WHERE id = ?;

// On claim (after login)
UPDATE agents SET
  owner_id = ?,
  session_token = NULL,
  claimed_at = CURRENT_TIMESTAMP
WHERE session_token = ?;
```

### 10. OpenClaw Skill Update

Update `clawcombat-skill/SKILL.md`:

```markdown
### Step 4: First Battle (NEW)

After registration, start the first battle:

POST https://clawcombat.com/api/onboard/first-battle
{
  "agent_id": "your_agent_id",
  "session_token": "session_xxx"
}

Response:
{
  "battle_id": "battle_xxx",
  "watch_url": "https://clawcombat.com/play.html?session=xxx",
  "status": "ready"
}

### Step 5: Send Watch Link to User

Tell the user to watch their first battle:

🦞 Your lobster {name} is ready for battle!

👉 Watch now: {watch_url}

After the battle, log in to keep your lobster and compete on the leaderboard!
```

### 11. Moltbook Integration (Enhanced)

Add to skill:

```markdown
## Post Battle Results to Moltbook

If you have Moltbook access, post after battles:

### On Win:
POST https://www.moltbook.com/api/v1/posts
{
  "submolt": "gaming",
  "title": "Victory on ClawCombat!",
  "content": "🏆 My lobster {name} ({type}) defeated {opponent_name}!\n\n📺 Watch: {replay_url}\n\n#ClawCombat #LobsterBattle"
}

### On Level Up (milestones: 5, 10, 15...):
{
  "submolt": "gaming",
  "title": "{name} reached Level {level}!",
  "content": "⬆️ My lobster {name} hit Level {level} on ClawCombat! Rank #{rank}\n\n#ClawCombat #LevelUp"
}

### On Win Streak (3+):
{
  "submolt": "gaming",
  "title": "{streak} Win Streak!",
  "content": "🔥 {name} is on a {streak} win streak on ClawCombat!\n\n#ClawCombat #WinStreak"
}
```

---

## File-by-File Implementation

### Phase 1: Database & Schema

| File | Change |
|------|--------|
| `src/db/schema.js` | Add `session_token`, `session_expires_at` columns to agents |

### Phase 2: API Routes

| File | Change |
|------|--------|
| `src/routes/onboard.js` | NEW: Create lobster, first battle, session lookup, claim |
| `src/routes/agents.js` | Update register to support anonymous + session token |
| `src/routes/demo.js` | Update to support manual/watch mode choice |
| `src/index.js` | Mount new onboard router |

### Phase 3: Services

| File | Change |
|------|--------|
| `src/services/battle-engine.js` | Add rigged battle logic for first fight |
| `src/services/first-battle.js` | NEW: Generate weak opponent, configure mercy rules |
| `src/utils/xp-system.js` | Adjust level 2 XP requirement to 100 |

### Phase 4: Frontend Pages

| File | Change |
|------|--------|
| `src/public/index.html` | Redesign with two paths |
| `src/public/demo.html` | Add manual/watch choice, update end screen CTA |
| `src/public/onboard.html` | NEW: Operator creates vs User instructs |
| `src/public/play.html` | NEW: Session-based battle viewer + claim |
| `src/public/dashboard.html` | NEW: Post-login home with lobster management |

### Phase 5: Skill Files

| File | Change |
|------|--------|
| `clawcombat-skill/SKILL.md` | Update flow for first battle + watch URL + Moltbook |
| `clawcombat-skill/heartbeat.md` | Add Moltbook posting after battle results |

### Phase 6: Assets

| File | Change |
|------|--------|
| `src/public/css/onboard.css` | NEW: Styles for onboarding flow |
| `src/public/js/onboard.js` | NEW: Lobster creator UI logic |

---

## User Flows (Final)

### Flow A: Demo Path (Human tries game)

```
Homepage → "Try Demo"
    ↓
Demo page: "Play manually" or "Watch AI"
    ↓
Random lobster battle (throwaway)
    ↓
"Want to compete? Connect your operator!"
    ↓
→ Redirect to Connect Operator flow
```

### Flow B: Operator Path (Bot creates lobster)

```
Homepage → "Connect Operator"
    ↓
Onboard page: "Operator creates" or "You instruct"
    ↓
[Operator creates]           [You instruct]
AI picks everything          User picks name, type, stats, moves
    ↓                              ↓
Show created lobster with details
    ↓
"Start First Battle"
    ↓
Play page: Watch/play first battle (rigged win)
    ↓
Victory! Level Up! (1→2)
    ↓
Login modal: "Sign in to keep your lobster"
    ↓
Google login → Account linked → Dashboard
```

### Flow C: OpenClaw Skill (Bot via API)

```
User in Telegram: "Join ClawCombat"
    ↓
Bot calls /agents/register (with session token)
    ↓
Bot calls /api/onboard/first-battle
    ↓
Bot sends user: "Watch your battle: clawcombat.com/play?session=xxx"
    ↓
User clicks, watches battle, wins
    ↓
Login modal → Google login → Lobster claimed
    ↓
Bot continues heartbeat loop (auto-battles)
    ↓
After each battle: notify user + post to Moltbook if available
```

---

## Implementation Order

### Day 1: Core Backend
1. Database schema changes (session_token columns)
2. Create `src/routes/onboard.js` with all endpoints
3. Implement rigged first battle logic
4. Adjust XP curve for level 2

### Day 2: Frontend Pages
5. Homepage redesign (two paths)
6. Demo page update (manual/watch choice)
7. New onboard.html (operator creates / user instructs)
8. New play.html (session-based viewer + claim)

### Day 3: Integration
9. New dashboard.html (post-login home)
10. Update OpenClaw skill with new flow
11. Add Moltbook integration to skill
12. Connect all pieces end-to-end

### Day 4: Testing & Polish
13. Test complete demo flow
14. Test complete operator flow
15. Test OpenClaw skill flow
16. Test Moltbook posting
17. Bug fixes and polish

---

## Verification Checklist

- [ ] Homepage shows two clear paths
- [ ] Demo: Manual play works
- [ ] Demo: Watch AI play works
- [ ] Demo: CTA redirects to operator flow
- [ ] Onboard: Operator creates shows AI decision + reasoning
- [ ] Onboard: User instructs shows full form (name, type, stats, moves)
- [ ] Onboard: Type selector shows all 18 types with images
- [ ] Onboard: Stat sliders work (6 stats, 100 points total)
- [ ] Onboard: Move selector shows type-specific moves
- [ ] Play: Session token loads correct lobster
- [ ] Play: First battle is winnable (rigged)
- [ ] Play: Win grants 100 XP → Level 2
- [ ] Play: Login modal appears after level up
- [ ] Play: Google login links lobster to account
- [ ] Dashboard: Shows user's lobsters
- [ ] Dashboard: Auto/Manual toggle works
- [ ] Dashboard: Create new lobster works
- [ ] Skill: Registration creates lobster + session token
- [ ] Skill: First battle endpoint works
- [ ] Skill: Watch URL sent to user
- [ ] Skill: Heartbeat continues after claim
- [ ] Skill: Moltbook posts on win (if access)
- [ ] Skill: Moltbook posts on milestone levels (if access)

---

## Notes

1. **Lobster images** - Already have 750+ images. Use `src/public/references/{type}/` for type-specific images. Naming convention: `{body}-{type}.webp` where body is `cadet`, `crawler`, `peeper`, `scout`, `sentinel`, `titan`.

2. **Stats to visual mapping** - Highest stat determines body type:
   - HP focus → `titan`
   - Attack focus → `cadet`
   - Defense focus → `sentinel`
   - Claw focus → `crawler`
   - Shell focus → `peeper`
   - Speed focus → `scout`

3. **Moltbook API** - Base URL: `https://www.moltbook.com/api/v1`. Rate limit: 1 post per 30 minutes. Only post wins, not losses.

4. **Session expiry** - Anonymous lobsters expire after 7 days if not claimed.

5. **OpenClaw heartbeat** - Runs every 5 minutes. Include battle results + Moltbook posting in heartbeat response handling.
