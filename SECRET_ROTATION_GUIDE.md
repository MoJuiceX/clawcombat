# 🔐 CRITICAL: Secret Rotation Guide

**STATUS: EXPOSED PRODUCTION SECRETS DETECTED**

Your `.env` file contains real production credentials that have been committed to this local system. These must be rotated **immediately** before deploying to production.

## 🚨 Critical Secrets to Rotate

### 1. Replicate API Token ✅ HIGHEST PRIORITY
**Current:** `r8_[EXPOSED_TOKEN_DELETED]`

**Steps:**
1. Go to https://replicate.com/account/api-tokens
2. Delete the exposed token immediately
3. Create a new token
4. Update `.env`: `REPLICATE_API_TOKEN=r8_new_token_here`

**Impact:** Used for avatar generation (FLUX 2 Pro). Without this, users can't create custom avatars.

---

### 2. Stripe Keys ✅ HIGH PRIORITY
**Current:**
- Secret: `sk_test_51SwgRQ...` (test mode - lower risk but still rotate)
- Webhook: `whsec_WbSIO2pPA...`

**Steps:**
1. Go to https://dashboard.stripe.com/test/apikeys
2. Reveal your current secret key and confirm it matches
3. Click "Roll key" to generate new secret key
4. Update `.env`: `STRIPE_SECRET_KEY=sk_test_new_key_here`
5. Go to https://dashboard.stripe.com/test/webhooks
6. Find your ClawCombat webhook endpoint
7. Click "..." → "Reveal signing secret" → "Roll secret"
8. Update `.env`: `STRIPE_WEBHOOK_SECRET=whsec_new_secret_here`

**Impact:** Payment processing and premium subscriptions. Test keys have limited blast radius.

---

### 3. Clerk Authentication Keys ✅ HIGH PRIORITY
**Current:**
- Publishable: `pk_live_Y2xlcmsuY2xhd2NvbWJhdC5jb20k`
- Secret: `sk_live_9UDH2lezs...`

**Steps:**
1. Go to https://dashboard.clerk.com
2. Select your ClawCombat application
3. Navigate to "API Keys"
4. Click "Regenerate" for both Publishable and Secret keys
5. Update `.env`:
   ```
   CLERK_PUBLISHABLE_KEY=pk_live_new_key_here
   CLERK_SECRET_KEY=sk_live_new_key_here
   ```

**Impact:** User authentication. If compromised, attackers could impersonate users.

---

### 4. Admin Secret ✅ MEDIUM PRIORITY
**Current:** `bee gaga weekend` (weak passphrase)

**Steps:**
1. Generate a strong random secret:
   ```bash
   openssl rand -base64 32
   ```
2. Update `.env`: `ADMIN_SECRET=generated_strong_secret_here`
3. Update any admin scripts/tools using this secret

**Impact:** Protects `/admin/*` endpoints. Weak secret = easy to guess.

---

### 5. Sentry DSN ⚠️ MEDIUM PRIORITY
**Current:** `https://ec6e35720b9829a766050a38335d75cd@o4510839844175872.ingest.de.sentry.io/4510839857741904`

**Steps:**
1. Go to https://sentry.io/settings/projects/
2. Select your ClawCombat project
3. Navigate to "Client Keys (DSN)"
4. Disable the exposed DSN
5. Create a new DSN
6. Update `.env`: `SENTRY_DSN=https://new_dsn_here`

**Note:** DSNs are semi-public (sent to browser) but best practice is to rotate when exposed.

---

## ✅ Post-Rotation Checklist

After rotating all secrets:

- [ ] All 5 secrets rotated in external services
- [ ] `.env` file updated with new values
- [ ] `.env` is in `.gitignore` (already confirmed ✅)
- [ ] Test local development still works
- [ ] Test Stripe webhooks in test mode
- [ ] Test avatar generation with new Replicate token
- [ ] Test admin endpoints with new secret
- [ ] Verify Sentry error tracking works
- [ ] Deploy to Railway with new secrets
- [ ] Set up Railway environment variables (see below)

---

## 🚀 Railway Deployment

**DO NOT copy `.env` file to Railway.** Instead, set each variable individually:

1. Go to https://railway.app/project/[your-project]
2. Click your backend service
3. Navigate to "Variables" tab
4. Add each variable from your `.env` file:
   - `PORT=3000`
   - `ADMIN_SECRET=[new value]`
   - `REPLICATE_API_TOKEN=[new value]`
   - `STRIPE_SECRET_KEY=[new value]`
   - `STRIPE_PREMIUM_PRICE_ID=[same value]`
   - `STRIPE_WEBHOOK_SECRET=[new value]`
   - `CLERK_PUBLISHABLE_KEY=[new value]`
   - `CLERK_SECRET_KEY=[new value]`
   - `WEB_URL=https://clawcombat.com`
   - `SENTRY_DSN=[new value]`

**Railway will automatically set:**
- `RAILWAY_VOLUME_MOUNT_PATH` (for database)
- `RAILWAY_PUBLIC_DOMAIN` (for webhooks)

---

## 🔒 Security Best Practices Going Forward

1. **Never commit `.env` files** (already protected ✅)
2. **Rotate secrets every 90 days** (set calendar reminder)
3. **Use different secrets for dev/staging/prod**
4. **Enable 2FA on all service accounts** (Stripe, Clerk, Replicate, Sentry)
5. **Monitor for leaked secrets** with tools like:
   - GitHub secret scanning (if using GitHub)
   - GitGuardian
   - TruffleHog

---

## 📋 Rotation Schedule Recommendation

| Secret | Rotation Frequency | Next Rotation |
|--------|-------------------|---------------|
| Replicate API | Every 90 days | [Date] |
| Stripe Keys | Every 90 days | [Date] |
| Clerk Keys | Every 90 days | [Date] |
| Admin Secret | Every 30 days | [Date] |
| Sentry DSN | Every 180 days | [Date] |

---

## 🆘 Emergency Contact

If you suspect active exploitation:

1. **Replicate:** Contact support@replicate.com
2. **Stripe:** https://support.stripe.com (24/7)
3. **Clerk:** https://clerk.com/support
4. **Sentry:** support@sentry.io

---

**Last Updated:** 2026-02-10
**Status:** ⚠️ PENDING ROTATION
