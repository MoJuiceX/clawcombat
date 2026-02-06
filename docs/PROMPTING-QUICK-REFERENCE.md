# ClawCombat Prompting Quick Reference

> One-page cheat sheet for working with Claude CLI on ClawCombat

## The PTCF Framework

| Element | Description | Example |
|---------|-------------|---------|
| **P**ersona | Who Claude should be | "As a game balance designer..." |
| **T**ask | What to do | "...optimize the XP curve..." |
| **C**ontext | Background info | "...for levels 60-100 which feel too slow..." |
| **F**ormat | Output structure | "...provide a table comparing old vs new values." |

## Six Quick Rules

1. **Natural language** - Talk like you would to a colleague
2. **Be specific** - "Fix N+1 in battles.js line 47" not "fix the bug"
3. **Be concise** - One task per prompt
4. **Iterate** - Refine in follow-ups
5. **Use context** - Reference CLAUDE.md files
6. **Ask Claude** - "How should I phrase this better?"

## Personas by Task Type

| Task | Use This Persona |
|------|------------------|
| Battle logic | "As a game systems engineer..." |
| API routes | "As a senior Node.js engineer..." |
| Database | "As a database performance specialist..." |
| Security | "As a security auditor..." |
| Balance | "As a game balance designer..." |
| Tests | "As a QA engineer..." |

## Common Prompts

### Bug Fix
```
The [endpoint/function] has [problem].
Steps to reproduce: [steps]
Expected: [what should happen]
Actual: [what happens]
Help me fix this.
```

### New Feature
```
Add [feature] to ClawCombat.
Constraints: [any limits]
Before coding, propose the approach.
```

### Performance
```
[Endpoint] is slow (current: Xms, target: Yms).
Check for N+1 queries, missing indexes, caching opportunities.
```

### Security Review
```
Review [file] for: SQL injection, auth bypass, input validation.
List findings by severity.
```

## Directory Quick Reference

| Working In | Claude Context |
|------------|----------------|
| `/routes` | API patterns, auth, responses |
| `/services` | Battle logic, caching |
| `/db` | Schema, queries, indexes |
| `/data` | Types, moves, balance |
| `/__tests__` | Test patterns, mocks |

## Anti-Patterns (Don't Do This)

| Bad | Better |
|-----|--------|
| "Fix the bug" | "Fix the N+1 query in battles.js line 47" |
| "Make it faster" | "Reduce leaderboard query from 2s to 200ms" |
| "Add tournaments" | "Design the tournament bracket data model" |
| "Update the code" | "Add rate limiting to /api/arena/join" |

## Iteration Examples

**First:** "Help me improve matchmaking"
**Refine:** "Focus on ELO ±100 range"
**Refine:** "Add wait time escalation after 30s"

## Key Gotchas to Mention

When relevant, remind Claude about:
- `mapDbAgent()` - DB→engine format conversion
- `getMoveById()` - Legacy move ID support
- `invalidateAgent()` - Cache invalidation after updates
- Level 1→2 is FREE (no XP required)
- Evolution tiers: 20 (+10%), 60 (+25%)

## Ask Claude for Help

If results aren't right:
```
I asked for X but got Y.
How should I rephrase my request?
```
