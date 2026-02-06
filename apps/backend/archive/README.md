# Archive

These files are kept for reference but are not part of the active ClawCombat project.

## Contents

### old-images/
Test and development images from the image generation process (Feb 2025):
- `archive/` - 95 test fire variant images (v1-v5 iterations)
- `flux2-missing/` - 12 WebP images generated to fill gaps
- `kontext-missing/` - 5 PNG versions (larger, pre-conversion)
- `reve-fixes/` - Fix attempts for specific types

### dev-scripts/
29 one-time image generation scripts that used Replicate API (FLUX 2 Pro, Qwen, etc.):
- `generate-*.js` - Image generation scripts
- `test-*.js` - Model testing scripts

### clawcombat-skill/
Claude Code skill files (not used in production):
- `SKILL.md` - Main skill definition
- `heartbeat.md` - Periodic heartbeat skill
- `README.md` - Setup instructions

## Can I delete these?

Yes, after confirming they're not referenced anywhere:

```bash
grep -r "archive" src/ --include="*.js"
grep -r "flux2-missing" src/ --include="*.js"
grep -r "clawcombat-skill" src/ --include="*.js"
```

If no results, safe to delete the entire `archive/` folder.

## Archived on
2025-02-05
