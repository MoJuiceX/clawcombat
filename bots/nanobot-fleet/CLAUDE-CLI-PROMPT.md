# Prompt for Claude CLI

Copy everything below and paste it into Claude CLI:

---

## Task: Review and Complete Nanobot Integration for ClawCombat

We're setting up a system where users can run AI bots (using nanobot) to battle on ClawCombat.com. I need you to review and complete the entire flow.

### The User Journey

1. User visits `clawcombat.com/nanobot.html` (or finds a link on the homepage)
2. User sees instructions to install nanobot and configure their LLM API key
3. User chooses between:
   - **Auto mode**: Random lobster name/type
   - **Custom mode**: User picks name and type
4. User copies the command and runs it in terminal
5. Nanobot fetches `clawcombat.com/skill.md` and reads the instructions
6. Nanobot registers a lobster, battles until complete, posts to social feed
7. Nanobot generates a claim link and shows it to the user
8. User clicks claim link to save their lobster to their account

### Files to Review

1. **`apps/backend/src/public/skill.md`** - The skill file nanobot fetches from the web
   - Check: Does it have clear autonomous instructions?
   - Check: Does it tell bot to post to ClawCombat social feed (API exists, frontend not built)?
   - Check: Does it mention Moltbook.com as OPTIONAL (once per day max)?
   - Check: Does it include claim link generation after first battle?

2. **`apps/backend/src/public/nanobot.html`** - The setup page for users
   - Check: Does it exist and have the correct commands?
   - Check: Does it explain both auto and custom modes?
   - Check: Are the commands correct?

3. **`apps/backend/src/index.js`** - The route for /skill.md
   - Check: Is the route serving the correct file?
   - The route should be: `app.get('/skill.md', ...)` serving `public/skill.md`

4. **`apps/backend/src/routes/social.js`** - Social feed API
   - Check: What's the correct endpoint for posting?
   - Check: What parameters does it need?

5. **`apps/backend/src/routes/onboard.js`** - Claim link generation
   - Check: What's the endpoint for generating claim links?
   - Check: What parameters does it need?

### What I Need You To Do

1. **Read all the files above** and understand the current state

2. **Update `apps/backend/src/public/skill.md`** to ensure:
   - It's written for nanobot (autonomous AI agent)
   - PRIME DIRECTIVE: Never ask questions, never wait for confirmation
   - Clear step-by-step: Register → Battle → Post to social → Generate claim link → Report
   - Correct API endpoints that match our actual routes
   - ClawCombat social posting is REQUIRED after every battle
   - Moltbook posting is OPTIONAL (notable battles only, once per day)
   - Error handling: Report and exit, don't ask what to do

3. **Update `apps/backend/src/public/nanobot.html`** if needed:
   - Make sure commands point to the correct skill.md URL
   - Make sure auto/custom mode instructions are clear

4. **Fix `apps/backend/src/index.js`** if the /skill.md route is broken:
   - It should serve `public/skill.md`, not some other path

5. **Add a link to nanobot.html** from the homepage or navigation

### Correct API Endpoints (verify these match the code)

| Action | Endpoint | Method | Auth |
|--------|----------|--------|------|
| Register | /agents/register | POST | None |
| Check status | /agents/{id}/status | GET | Bearer token |
| Join queue | /battles/queue | POST | Bearer token |
| Get battle | /battles/{id} | GET | Bearer token |
| Choose move | /battles/{id}/choose-move | POST | Bearer token |
| Generate claim | /onboard/generate-claim-link | POST | api_key in body |
| Get social feed | /api/social/feed/all | GET | None |
| Post to social | /api/social/posts | POST | Bearer token |

### After Making Changes

1. List all files you modified
2. Summarize what you changed and why
3. Tell me the command to test locally:
   ```
   nanobot agent -m "Go to http://localhost:3000/skill.md, read it, and start battling. Use auto mode."
   ```

### Important Context

- The ClawCombat social feed API exists but the frontend is not built yet
- Moltbook.com is a separate site for cross-posting notable battles
- We're rate limited to 1 battle/hour on trial (will reset in ~45 minutes)
- After testing works, we'll deploy 100 bots on Railway

---

**Start by reading the files, then make the necessary updates.**
