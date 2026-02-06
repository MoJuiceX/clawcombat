# ClawCombat Prompting Standards

> Based on Google's Prompting Guide + ClawCombat-specific adaptations for Claude CLI

## Core Framework: PTCF

Every prompt Claude receives should consider these four elements:

| Element | Description | ClawCombat Example |
|---------|-------------|-------------------|
| **Persona** | Who Claude should act as | "You are a senior Node.js engineer specializing in gaming backends" |
| **Task** | What needs to be done | "Optimize the battle engine's damage calculation" |
| **Context** | Background information | "The battle engine handles 1000+ concurrent battles" |
| **Format** | Desired output structure | "Return a list of optimizations with estimated performance gains" |

---

## Quick Reference: Six Core Principles

### 1. Use Natural Language
Write prompts conversationally. Claude understands intent better than rigid syntax.

**Instead of:** `FIX: N+1 query battles.js line 47`
**Write:** `The battles.js route has an N+1 query issue around line 47 where we fetch agent data inside a loop. Help me fix this with a batch query.`

### 2. Be Specific and Iterate
Start with your goal, then refine. Each follow-up narrows the solution.

**First prompt:** "Help me improve the matchmaking system"
**Refinement:** "Focus on ELO-based matching within ±100 rating points"
**Refinement:** "Add wait time escalation that expands the range after 30 seconds"

### 3. Be Concise - Avoid Complexity
One task per prompt produces better results. Complex requests should be broken into steps.

**Instead of:** "Update the battle engine to add a new Ice type, create API endpoints for ice moves, update the type chart, add tests, and deploy"
**Break into:**
1. "Add ICE type to the type effectiveness chart in data/types.js"
2. "Create 5 Ice-type moves following our move structure"
3. "Add tests for Ice type effectiveness"
4. "Create migration for Ice-type moves"

### 4. Make It a Conversation
Use follow-ups to guide Claude toward the right solution.

```
You: "Show me how the XP calculation works"
Claude: [explains current system]
You: "Now add diminishing returns for high-level agents"
Claude: [proposes solution]
You: "Make the curve gentler - level 80+ agents should still gain meaningful XP"
```

### 5. Use Your Documents
Reference existing files for context. Claude CLI automatically reads CLAUDE.md files.

**Leverage:** `"Following our API response format in CLAUDE.md, create a new endpoint for..."`

### 6. Ask Claude to Improve Your Prompts
If results aren't what you expected, ask for help.

**Say:** `"I asked for X but got Y. How should I rephrase my request to get better results?"`

---

## ClawCombat Persona Library

Use these personas for domain-specific tasks:

### Battle Engine Work
```
You are a game systems engineer specializing in turn-based combat mechanics.
You understand Pokemon-style type effectiveness, damage formulas, and
competitive balance. The ClawCombat engine uses 18 types with a full
effectiveness matrix.
```

### API Development
```
You are a senior Node.js backend engineer working on a gaming API.
You prioritize: performance (sub-100ms responses), security (SQL injection
prevention via whitelisting), and consistency (standard error formats).
```

### Database Optimization
```
You are a database performance specialist working with SQLite.
You understand N+1 query problems, index optimization, and the tradeoffs
between normalization and query performance in gaming workloads.
```

### Social Features
```
You are a social platform engineer designing engagement systems.
You understand feed algorithms, content moderation, and how to make
AI-generated content feel authentic and entertaining.
```

### Security Review
```
You are a security engineer auditing a gaming backend.
Focus on: input validation, SQL injection, rate limiting, API key
management, and preventing agent impersonation.
```

---

## Task Templates

### Bug Fix Template
```
**Bug:** [Description of the issue]
**Location:** [File and line number if known]
**Steps to Reproduce:** [How to trigger the bug]
**Expected:** [What should happen]
**Actual:** [What actually happens]

Help me fix this while maintaining our code patterns.
```

### Feature Request Template
```
**Feature:** [What needs to be built]
**User Story:** As a [user type], I want [feature] so that [benefit]
**Constraints:**
- Must work with existing [systems]
- Performance requirement: [if any]
- Must include tests

Propose an implementation approach before writing code.
```

### Code Review Template
```
Review this code for:
1. Performance issues (especially N+1 queries, unnecessary loops)
2. Security concerns (SQL injection, input validation)
3. Consistency with our patterns (mapDbAgent usage, error formats)
4. Test coverage gaps

[paste code or file reference]
```

### Refactoring Template
```
I want to refactor [component/file] because [reason].

Current issues:
- [Issue 1]
- [Issue 2]

Constraints:
- Don't change the public API
- Maintain backward compatibility with [specific thing]
- Keep test coverage at or above current level
```

---

## Advanced Techniques

### 1. Break Up Related Tasks
Complex features should be separate prompts that build on each other.

**Battle Replay Feature:**
1. "Design the data structure for storing battle replays"
2. "Create the endpoint to save a replay after battle completion"
3. "Create the endpoint to retrieve and playback a replay"
4. "Add replay sharing to the social feed"

### 2. Give Constraints
Explicit limits produce more focused results.

- "Maximum 50 lines of code"
- "Must complete in under 10ms"
- "Use only existing dependencies"
- "Follow our existing error handling pattern"

### 3. Assign a Role (Personas)
Different personas produce different solutions.

**Same task, different results:**
- "As a performance engineer, optimize this query"
- "As a maintainability advocate, simplify this query"
- "As a security auditor, review this query"

### 4. Ask for Feedback
Let Claude identify gaps in your request.

**Prompt:** "I want to add tournaments to ClawCombat. What questions do you have for me before we start?"

**Claude might ask:**
- What's the bracket format? (Single elim, double elim, round robin?)
- How many participants per tournament?
- Are there entry fees or prizes?
- Real-time or async battles?

### 5. Consider Tone
Match the output to its purpose.

- **Technical docs:** "Explain formally with code examples"
- **User-facing:** "Explain casually, avoid jargon"
- **Internal notes:** "Be brief, bullet points are fine"

### 6. Iterate - Say It Another Way
If the first response isn't right, rephrase rather than repeat.

**First try:** "Make the leaderboard faster"
**Better:** "The leaderboard query takes 2 seconds with 10k agents. Profile it and suggest index optimizations or query restructuring."

---

## Claude CLI Auto-Context

Claude CLI automatically reads CLAUDE.md files in the current directory and parent directories. This project is structured so Claude always has relevant context:

```
ClawCombat/CLAUDE.md              # High-level project overview
├── apps/backend/CLAUDE.md        # Backend architecture
│   └── src/
│       ├── routes/CLAUDE.md      # API endpoint patterns
│       ├── services/CLAUDE.md    # Business logic patterns
│       ├── middleware/CLAUDE.md  # Auth and validation
│       ├── data/CLAUDE.md        # Type system and moves
│       ├── config/CLAUDE.md      # Constants and settings
│       ├── db/CLAUDE.md          # Database schema
│       ├── utils/CLAUDE.md       # Shared utilities
│       └── __tests__/CLAUDE.md   # Testing patterns
```

**Tip:** When working in a specific area, `cd` into that directory so Claude automatically loads the relevant CLAUDE.md context.

---

## Common Mistakes to Avoid

### 1. Too Vague
**Bad:** "Fix the bug"
**Good:** "Fix the N+1 query in battles.js where we fetch agent profiles inside the battle results loop"

### 2. Too Much at Once
**Bad:** "Build the entire tournament system"
**Good:** "Let's start with the tournament bracket data model. We'll add matchmaking and scheduling in follow-up prompts."

### 3. Assuming Context
**Bad:** "Update that function we discussed"
**Good:** "Update the `calculateDamage` function in battle-engine.js to include critical hit modifiers"

### 4. Ignoring Existing Patterns
**Bad:** "Create a new way to handle errors"
**Good:** "Create error handling following our existing { error: message } pattern"

### 5. Skipping Iteration
**Bad:** Accepting the first response without refinement
**Good:** "This is close, but I need the response times to be under 50ms. What changes would help?"

---

## Quick Copy-Paste Prompts

### Start a New Feature
```
I want to add [FEATURE] to ClawCombat.

Before writing any code:
1. Review the relevant CLAUDE.md files
2. Identify existing patterns we should follow
3. Propose an implementation approach
4. Ask me any clarifying questions

Let's discuss the approach first.
```

### Debug an Issue
```
I'm seeing [PROBLEM] when [STEPS TO REPRODUCE].

Expected: [WHAT SHOULD HAPPEN]
Actual: [WHAT HAPPENS]

Help me:
1. Identify the root cause
2. Suggest a fix
3. Recommend how to prevent similar issues
```

### Optimize Performance
```
[FILE/ENDPOINT] is slow. Current response time is [X]ms, target is [Y]ms.

Analyze for:
1. N+1 queries
2. Missing indexes
3. Unnecessary computations
4. Caching opportunities

Propose optimizations ranked by impact.
```

### Security Review
```
Review [FILE/FEATURE] for security issues.

Check specifically for:
1. SQL injection (do we use column whitelisting?)
2. Input validation (are types checked?)
3. Authentication bypass
4. Rate limiting gaps

List findings by severity (critical/high/medium/low).
```

---

## Integration with CLAUDE.md Files

Each CLAUDE.md file in the project should include:

1. **Purpose** - What this module/directory does
2. **Key Files** - Most important files with brief descriptions
3. **Patterns** - Code patterns to follow
4. **Gotchas** - Common mistakes to avoid
5. **Dependencies** - What this module depends on

This structure ensures Claude always has the context needed to work effectively in any part of the codebase.
