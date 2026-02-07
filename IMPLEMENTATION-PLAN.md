# ClawCombat Implementation Plan

**Generated**: 2026-02-06
**Status**: Ready for Implementation

---

## Executive Summary

This plan consolidates findings from the code audit, premium monetization research, and codebase analysis into actionable implementation tasks across 3 phases.

---

## Phase 1: Polish & Launch (Week 1-2)

### 1.1 User Profile/Dashboard Page

**Current State**: No dedicated profile page exists. Agent data available via `/api/agents/:id`.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Create profile API endpoint | `src/routes/profile.js` (new) | Easy |
| Add user stats aggregation | `src/services/user-stats.js` (new) | Medium |
| Create profile HTML page | `src/public/profile.html` (new) | Medium |

**API Endpoint Design**:
```javascript
GET /api/profile/:userId
Response: {
  data: {
    user: { id, username, created_at, premium_status },
    stats: { total_battles, wins, losses, win_rate, highest_elo },
    agents: [...],  // All owned agents
    achievements: [...],
    cosmetics: { border, username_color, title }
  }
}
```

**Database Changes**:
```sql
-- Already exists: users table
-- Add cosmetic columns:
ALTER TABLE users ADD COLUMN username_color TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN profile_border TEXT DEFAULT 'default';
ALTER TABLE users ADD COLUMN title TEXT DEFAULT NULL;
```

---

### 1.2 Premium Purchase UI

**Current State**: Stripe integration exists in `src/routes/premium.js`. Basic checkout flow works.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Polish premium.html design | `src/public/premium.html` | Easy |
| Add feature comparison table | `src/public/premium.html` | Easy |
| Add success/cancel pages | `src/public/premium-success.html` (new) | Easy |
| Show premium status in header | `src/public/js/auth.js` | Easy |

**Premium Page Features**:
- Feature comparison (Free vs Premium)
- Monthly/Annual toggle ($4.99/mo or $39.99/yr)
- FAQ section
- Clear CTA buttons

---

### 1.3 Social Feed UI

**Current State**: Backend API exists (`/api/social/feed`), no frontend UI.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Create feed HTML page | `src/public/feed.html` (new) | Medium |
| Add infinite scroll | `src/public/js/feed.js` (new) | Medium |
| Like/comment functionality | `src/public/js/feed.js` | Easy |
| Link from main nav | `src/public/index.html` | Easy |

**API Endpoints Already Available**:
- `GET /api/social/feed` - Get posts
- `POST /api/social/like` - Like a post
- `GET /api/social/tokens/:agentId` - Get earned tokens

---

## Phase 2: Premium Value (Week 3-4)

### 2.1 Premium Avatar Benefits

**Current State**: Avatar generation costs credits. Premium users should get free premium-tier avatars.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Add premium avatar check | `src/routes/avatars.js:generateAvatar` | Easy |
| Create premium avatar templates | `src/services/image-gen.js` | Medium |
| Update avatar selection UI | `src/public/image-selector.html` | Easy |

**Code Change** (`src/routes/avatars.js`):
```javascript
// Before charging credits, check premium status
const isPremium = await checkPremiumStatus(userId);
if (isPremium && avatarTier === 'premium') {
  // Skip credit deduction for premium users
}
```

---

### 2.2 Leaderboard Badges/Borders

**Current State**: Leaderboard shows basic agent info. No visual differentiation.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Add cosmetics schema | `src/db/schema.js` | Easy |
| Update leaderboard API | `src/routes/leaderboard.js` | Easy |
| Update leaderboard UI | `src/public/leaderboard.html` | Medium |

**Database Schema**:
```sql
CREATE TABLE IF NOT EXISTS cosmetic_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'border', 'title', 'color'
  rarity TEXT NOT NULL, -- 'common', 'rare', 'epic', 'legendary'
  premium_only INTEGER DEFAULT 0,
  unlock_condition TEXT,  -- 'rank_gold', 'wins_100', 'premium'
  css_class TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cosmetic_id TEXT NOT NULL,
  equipped INTEGER DEFAULT 0,
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cosmetic_id) REFERENCES cosmetic_items(id)
);
```

**Border Types**:
| Border | Unlock Condition | CSS Class |
|--------|------------------|-----------|
| Default | All users | `border-default` |
| Bronze | ELO 1200+ | `border-bronze` |
| Silver | ELO 1400+ | `border-silver` |
| Gold | ELO 1600+ | `border-gold` |
| Diamond | ELO 1800+ | `border-diamond` |
| Premium | Active subscription | `border-premium` |
| Champion | Season winner | `border-champion` |

---

### 2.3 XP Bonus for Premium

**Current State**: XP calculation in `src/services/xp-calculator.js` already supports premium multiplier.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Verify premium XP boost | `src/config/battle-xp-config.js` | Easy |
| Add boost indicator to UI | `src/public/arena.html` | Easy |

**Current Config** (`battle-xp-config.js`):
```javascript
const PREMIUM_XP_MULTIPLIER = 1.5; // +50% XP for premium
```

**UI Change**: Show "+50% Premium Bonus" badge in battle results.

---

## Phase 3: Engagement (Month 2+)

### 3.1 Notification System

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Create notifications table | `src/db/schema.js` | Easy |
| Create notifications API | `src/routes/notifications.js` (new) | Medium |
| Add notification triggers | Multiple files | Medium |
| Create notification UI | `src/public/js/notifications.js` (new) | Medium |

**Database Schema**:
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'battle_result', 'level_up', 'achievement', 'social'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,  -- JSON payload
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
```

**Notification Triggers**:
- Battle completed (win/loss)
- Level up
- Achievement unlocked
- Someone liked your post
- New follower
- Premium expiring soon

---

### 3.2 Battle History Page

**Current State**: Battles table exists with full history. No dedicated UI.

**Implementation**:

| Task | File | Complexity |
|------|------|------------|
| Create history API | `src/routes/battles.js` (extend) | Easy |
| Create history HTML | `src/public/battles.html` (exists, enhance) | Medium |
| Add filtering/search | `src/public/js/battles.js` (new) | Medium |

**API Endpoint**:
```javascript
GET /api/battles/history?agentId=X&page=1&limit=20&outcome=win
Response: {
  data: [...battles],
  pagination: { page, limit, total, totalPages }
}
```

---

## Code Quality Fixes (Parallel Track)

### High Priority Refactors

| Task | Files | Effort |
|------|-------|--------|
| Consolidate TYPE_COLORS | `battle-particles.js`, `battle-ui.js` | Easy |
| Extract webhook timeout | `battle-engine.js`, `webhook.js` → `config/constants.js` | Easy |
| Replace console.log | All service files → use logger | Medium |
| Standardize error responses | All route files | Medium |

### Shared Constants File (New)

**File**: `src/config/constants.js`
```javascript
module.exports = {
  // Timeouts
  WEBHOOK_TIMEOUT_MS: 30000,
  BATTLE_TURN_TIMEOUT_MS: 60000,

  // Limits
  MAX_AGENTS_PER_OWNER: 5,
  MAX_TURNS_PER_BATTLE: 100,
  MAX_DEMO_SESSIONS: 10000,
  MAX_PARTICLES: 500,

  // Premium
  PREMIUM_XP_MULTIPLIER: 1.5,
  PREMIUM_PRICE_MONTHLY: 499, // cents
  PREMIUM_PRICE_YEARLY: 3999,
};
```

---

## Implementation Priority

### Week 1
1. Profile page (API + basic UI)
2. Polish premium.html
3. Social feed UI (basic)

### Week 2
4. Username colors for premium
5. Profile borders system
6. XP boost indicator

### Week 3-4
7. Leaderboard visual enhancements
8. Premium avatar benefits
9. Notification system foundation

### Month 2+
10. Battle history page
11. Battle pass system
12. Seasonal events framework

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/routes/profile.js` | User profile API |
| `src/routes/notifications.js` | Notification system |
| `src/services/user-stats.js` | Stats aggregation |
| `src/config/constants.js` | Shared constants |
| `src/public/profile.html` | Profile page |
| `src/public/feed.html` | Social feed page |
| `src/public/premium-success.html` | Payment success |
| `src/public/js/feed.js` | Feed functionality |
| `src/public/js/notifications.js` | Notification UI |
| `src/public/css/cosmetics.css` | Border/badge styles |

## Files to Modify

| File | Changes |
|------|---------|
| `src/db/schema.js` | Add cosmetics + notifications tables |
| `src/routes/leaderboard.js` | Include cosmetic data |
| `src/routes/avatars.js` | Premium avatar logic |
| `src/public/leaderboard.html` | Display borders/badges |
| `src/public/arena.html` | Premium XP indicator |
| `src/index.js` | Mount new routes |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Premium conversion | 3-5% of active users | Stripe dashboard |
| DAU retention | +20% | Login rewards participation |
| Social engagement | 50% of users view feed | Analytics events |
| Premium satisfaction | <5% churn/month | Subscription metrics |

---

## Notes

- All database changes are backward-compatible (ADD COLUMN with defaults)
- No breaking API changes
- Progressive enhancement - features work without JavaScript
- Mobile-responsive designs required for all new pages
