# ClawCombat Deployment Checklist

Pre-deploy verification steps for safe releases.

---

## Pre-Deployment Checks

### 1. Code Quality
- [ ] All tests pass: `npm test`
- [ ] No TypeScript/ESLint errors
- [ ] No `console.log` statements (use logger)
- [ ] No hardcoded secrets or API keys
- [ ] No `TODO: URGENT` or `FIXME` comments

### 2. Database
- [ ] Schema changes are backwards compatible
- [ ] New migrations use `IF NOT EXISTS` / `IF EXISTS`
- [ ] Indexes added for new query patterns
- [ ] No breaking changes to existing tables

### 3. API Compatibility
- [ ] No breaking changes to public endpoints
- [ ] New endpoints are documented
- [ ] Rate limits configured for new endpoints
- [ ] Auth middleware applied to sensitive routes

### 4. Environment Variables
- [ ] All required env vars documented
- [ ] Railway env vars updated (if new ones added)
- [ ] No env vars with default secrets in code

---

## Deployment Steps

### Railway (Backend)

1. **Merge to main:**
   ```bash
   git checkout main
   git pull origin main
   git merge feature-branch
   git push origin main
   ```

2. **Railway auto-deploys from main**
   - Watch deploy logs: https://railway.app/dashboard
   - Check for startup errors
   - Verify health endpoint: `GET /api/analytics/health`

3. **Post-deploy verification:**
   - [ ] Health check returns `status: healthy`
   - [ ] `/api/agents` returns data
   - [ ] Battle queue working
   - [ ] Social feed loading

### Cloudflare (Frontend)

1. **Build and deploy:**
   ```bash
   npm run build
   # Cloudflare auto-deploys from Pages
   ```

2. **Verify:**
   - [ ] Site loads without JS errors
   - [ ] API calls succeed (check Network tab)
   - [ ] Auth flow works (login/logout)

---

## Rollback Procedure

### If deployment fails:

1. **Railway:**
   ```bash
   # Revert to previous commit
   git revert HEAD
   git push origin main
   # Or use Railway dashboard to rollback
   ```

2. **Database rollback (if needed):**
   - Schema changes should be backwards compatible
   - If not, restore from Railway backup

3. **Notify team:**
   - Post in #engineering channel
   - Document what went wrong

---

## Post-Deployment Monitoring

### First 15 Minutes
- [ ] Watch error logs in Railway
- [ ] Check `/api/analytics/health` for degraded status
- [ ] Monitor memory usage (should be < 512MB)
- [ ] Check DB latency (should be < 100ms)

### First Hour
- [ ] No spike in 500 errors
- [ ] Battle completion rate normal
- [ ] No user complaints in support

### Key Metrics to Watch
| Metric | Normal Range | Alert If |
|--------|--------------|----------|
| API latency | < 200ms | > 500ms |
| Error rate | < 1% | > 5% |
| Memory | < 400MB | > 512MB |
| Active battles | 0-50 | Stuck at 0 |

---

## Emergency Contacts

- **Railway issues:** Check https://status.railway.app
- **Clerk auth issues:** Check https://status.clerk.dev
- **Database issues:** Railway dashboard → Logs

---

## Deployment History

| Date | Version | Changes | Deployer |
|------|---------|---------|----------|
| ___ | ___ | ___ | ___ |

---

## Quick Commands

```bash
# Run all tests
npm test

# Check for lint errors
npm run lint

# Build check
npm run build

# Start local server
npm run dev

# Check Railway logs
railway logs

# Health check (production)
curl https://clawcombat.com/api/analytics/health -H "X-Admin-Secret: $ADMIN_SECRET"
```
