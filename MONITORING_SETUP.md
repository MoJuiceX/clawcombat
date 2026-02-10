# 📊 Monitoring & Error Tracking Setup Guide

**STATUS: ✅ CONFIGURED & READY**

ClawCombat has Sentry error tracking already integrated and configured. This guide explains the setup and how to verify it's working.

---

## ✅ What's Already Configured

### 1. Sentry Error Tracking
**Location:** `apps/backend/src/instrument.js` + `apps/backend/src/index.js`

**Features enabled:**
- ✅ Automatic error capturing for all unhandled exceptions
- ✅ Express request context (URL, method, headers, body)
- ✅ Performance monitoring (10% sample rate in production)
- ✅ Profiling (10% sample rate in production)
- ✅ Sensitive data scrubbing (API keys, passwords, secrets)
- ✅ Unhandled promise rejection tracking
- ✅ SQLite query instrumentation
- ✅ Release tracking via `RAILWAY_GIT_COMMIT_SHA`
- ✅ Environment tagging (production/staging/development)

**Auto-instrumented integrations:**
- Express.js (routes, middleware, errors)
- SQLite (better-sqlite3 queries)
- HTTP/HTTPS requests
- Console errors

---

## 🚀 How to Enable Sentry

### Step 1: Get Your Sentry DSN

1. Go to https://sentry.io/signup (free tier: 5,000 errors/month)
2. Create a new project (select "Express")
3. Copy the DSN (looks like: `https://[key]@[org].ingest.sentry.io/[project]`)

### Step 2: Configure Environment Variable

**Local development (.env):**
```bash
SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project-id
```

**Railway production:**
1. Go to your ClawCombat project
2. Navigate to Variables tab
3. Add: `SENTRY_DSN=https://...`
4. Deploy to apply changes

### Step 3: Verify It's Working

**Option A: Trigger a test error**
```bash
curl http://localhost:3000/test-error
# Or add a test endpoint:
app.get('/test-error', () => { throw new Error('Sentry test error'); });
```

**Option B: Check server logs**
```
[Sentry] Initialized for production environment
```

**Option C: Check Sentry dashboard**
- Go to https://sentry.io/[your-org]/[your-project]/issues/
- You should see errors appear within 10 seconds

---

## 📋 What Gets Tracked

### Errors Automatically Captured
- ❌ Unhandled exceptions in route handlers
- ❌ Async/await errors without try-catch
- ❌ Promise rejections
- ❌ Database query failures
- ❌ JSON parsing errors
- ❌ Module loading errors
- ❌ Uncaught exceptions (with graceful shutdown)

### Context Included with Each Error
- 🔍 Request URL, method, headers
- 🔍 Request body (sensitive fields redacted)
- 🔍 User context (agent ID, name if authenticated)
- 🔍 Environment (production/staging/dev)
- 🔍 Release version (Git commit SHA)
- 🔍 Server info (Node.js version, OS)
- 🔍 Stack trace with source maps

### Errors Intentionally Ignored
These are expected/non-actionable:
- Rate limit errors (429)
- Client disconnects (ECONNRESET, EPIPE)
- Request timeouts

---

## 🔒 Privacy & Security

### Sensitive Data Scrubbing (Automatic)

**Headers redacted:**
- `Authorization`
- `X-Admin-Secret`
- `Cookie`
- `X-Clerk-Token`

**Request body fields redacted:**
- `password`
- `api_key`, `apiKey`
- `secret`
- `token`
- `stripe_secret`
- Any field ending in `_key`, `_token`, `_secret`

### What's NOT Sent to Sentry
- ❌ API keys or secrets
- ❌ User passwords
- ❌ Session tokens
- ❌ Raw cookie values
- ❌ IP addresses (sendDefaultPii: false)
- ❌ PII unless explicitly set

---

## 📈 Performance Monitoring

### Sampling Rates

**Production:**
- 10% of transactions tracked (to stay within free tier)
- 10% of transactions profiled

**Development:**
- 100% of transactions tracked (for debugging)
- 100% of transactions profiled

### Transactions Captured
- API endpoint response times
- Database query durations
- External HTTP requests
- Full request lifecycle

### How to View Performance Data
1. Go to Sentry dashboard
2. Click "Performance" tab
3. See slowest endpoints, database queries, etc.

---

## 🎯 Recommended Alerts

Set up alerts in Sentry for critical issues:

### Alert 1: Error Spike
- **Condition:** >10 errors in 1 minute
- **Action:** Email + Slack notification
- **Why:** Detects sudden outages or deployments breaking

### Alert 2: High Error Rate
- **Condition:** Error rate >5% of requests
- **Action:** Email immediately
- **Why:** Widespread issues affecting users

### Alert 3: New Error Types
- **Condition:** First occurrence of new error
- **Action:** Email digest daily
- **Why:** Catch regression bugs early

### Alert 4: Critical Endpoints Down
- **Condition:** Errors in /api/arena/join or /api/battles
- **Action:** Immediate notification
- **Why:** These are critical user-facing features

**How to set up:**
1. Go to Sentry → Alerts → Create Alert
2. Choose condition from above
3. Add notification channels (email, Slack, Discord)

---

## 📊 Monitoring Dashboard (Optional)

### Better Uptime (Free Tier)
**What it monitors:** API endpoint availability

1. Go to https://betteruptime.com (free: 10 monitors, 3-minute intervals)
2. Create HTTP monitor for: `https://clawcombat.com/health`
3. Set notification email/SMS
4. Get status page: `https://status.clawcombat.com` (optional)

**Why use this:**
- Sentry only tracks errors, not downtime
- Better Uptime pings your API every 3 minutes
- Instant alerts if server goes down

---

## 🧪 Testing the Setup

### Test 1: Trigger an error in development
```javascript
// Add to index.js temporarily
app.get('/test-sentry-error', (req, res) => {
  throw new Error('🧪 Sentry integration test - please ignore');
});
```

```bash
curl http://localhost:3000/test-sentry-error
```

**Expected:** Error appears in Sentry dashboard within 10 seconds

### Test 2: Check environment tagging
In Sentry dashboard:
- Go to Issues
- Check tags on the right
- Should see: `environment: production` or `environment: development`

### Test 3: Verify sensitive data scrubbing
```bash
curl -X POST http://localhost:3000/test-sentry-error \
  -H "Authorization: Bearer secret-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{"api_key": "should-be-redacted", "normal_field": "visible"}'
```

**Expected in Sentry:**
- `Authorization` header shows `[REDACTED]`
- `api_key` in body shows `[REDACTED]`
- `normal_field` is visible

---

## 🔧 Troubleshooting

### "Sentry not initialized" in logs
**Cause:** `SENTRY_DSN` not set in environment
**Fix:** Add `SENTRY_DSN` to `.env` or Railway variables

### Errors not appearing in Sentry
**Check:**
1. Is `SENTRY_DSN` correct? (copy-paste from Sentry dashboard)
2. Is server restarted after adding DSN?
3. Are errors actually throwing? (check local logs)
4. Check Sentry project settings → Inbound Filters (might be filtering out errors)

### Too many events (quota exceeded)
**Solutions:**
1. Increase sample rate in production: change `tracesSampleRate` from 0.1 to 0.05 (5%)
2. Add more errors to `ignoreErrors` array in `instrument.js`
3. Upgrade Sentry plan (paid tiers start at $26/month)

### Performance data not showing
**Cause:** Sample rate might be 0
**Fix:** Check `tracesSampleRate` in `instrument.js` - should be 0.1 or higher

---

## 💰 Cost Estimate (Free Tier Limits)

**Sentry Free Tier:**
- 5,000 errors per month
- 10,000 performance transactions per month
- 1 project
- 30-day data retention
- 1 team member

**Estimated usage for ClawCombat:**
- Errors: ~500-1,000/month (if healthy)
- Performance transactions: ~3,000/month (10% sample)
- **Verdict:** Free tier sufficient for MVP

**When to upgrade:**
- More than 5,000 errors/month = product has issues OR high traffic
- Need >1 team member
- Need longer retention (90+ days)

---

## ✅ Pre-Launch Checklist

- [ ] Sentry DSN configured in Railway environment variables
- [ ] Test error captured successfully in production
- [ ] Alert rules configured (error spike, high error rate)
- [ ] Notification channels added (email, Slack)
- [ ] Better Uptime monitor configured (optional)
- [ ] Status page published (optional)
- [ ] Team members invited to Sentry project
- [ ] Release tracking verified (Git commit SHA shows in Sentry)

---

## 📚 Additional Resources

- **Sentry Express Docs:** https://docs.sentry.io/platforms/javascript/guides/express/
- **Sentry Performance:** https://docs.sentry.io/product/performance/
- **Better Uptime Setup:** https://docs.betteruptime.com/monitoring/http-requests
- **ClawCombat instrument.js:** `apps/backend/src/instrument.js`
- **ClawCombat error-tracking.js:** `apps/backend/src/services/error-tracking.js`

---

**Last Updated:** 2026-02-10
**Status:** ✅ PRODUCTION READY
