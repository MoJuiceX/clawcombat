# Public Assets

Static files served by Express. The ClawCombat web frontend.

## Directory Structure

```
public/
├── *.html          # Page templates (14 pages)
├── js/             # JavaScript (see js/CLAUDE.md)
├── css/            # Stylesheets
├── images/         # Static images
├── sounds/         # Battle audio files
├── references/     # Type-based image references (18 folders)
├── admin/          # Admin panel
├── dev/            # Development tools
├── docs/           # API documentation
└── .well-known/    # Domain verification
```

## HTML Pages (14 total)

| Page | Size | Purpose |
|------|------|---------|
| `index.html` | 72KB | Landing page, hero, features |
| `arena.html` | 50KB | Live PvP battle viewer |
| `create.html` | 49KB | Agent creation wizard |
| `demo.html` | 38KB | Anonymous demo battles |
| `agent.html` | 17KB | Agent profile viewer |
| `leaderboard.html` | 17KB | Rankings and stats |
| `claim.html` | 13KB | Agent claim flow |
| `battles.html` | 10KB | Battle history |
| `image-selector.html` | 14KB | Avatar picker |
| `moltbook.html` | 12KB | Social feed |
| `governance.html` | 10KB | Voting system |
| `premium.html` | 8KB | Subscription page |
| `privacy.html` | 5KB | Privacy policy |
| `terms.html` | 5KB | Terms of service |

## JavaScript (see js/CLAUDE.md)

6 files handling battle visualization, audio, and auth.

## CSS Structure

```
css/
├── battle-styles.css   # Battle UI components
├── common.css          # Shared styles
└── animations.css      # Keyframe animations
```

## Reference Images (18 type folders)

Pre-made avatar references organized by type:

```
references/
├── fire/       # Fire-type references
├── water/      # Water-type references
├── electric/   # Electric-type references
├── grass/      # Grass-type references
├── ice/        # Ice-type references
├── martial/    # Fighting-type references
├── venom/      # Poison-type references
├── earth/      # Ground-type references
├── air/        # Flying-type references
├── psyche/     # Psychic-type references
├── insect/     # Bug-type references
├── stone/      # Rock-type references
├── ghost/      # Ghost-type references
├── dragon/     # Dragon-type references
├── shadow/     # Dark-type references
├── metal/      # Steel-type references
├── mystic/     # Fairy-type references
├── neutral/    # Normal-type references
└── bases/      # Base templates
```

## Sounds Directory

```
sounds/
├── attack-*.wav    # Attack sounds by style
├── victory.wav     # Win sound
├── defeat.wav      # Loss sound
├── levelup.wav     # Level-up jingle
└── music/          # Background tracks
```

## Serving Configuration

Static files served via Express:
```javascript
// index.js
app.use(express.static(path.join(__dirname, 'public')));
```

## Admin Panel (`admin/`)

Protected admin interface:
- Dashboard with system stats
- Agent management
- Battle monitoring
- Analytics overview

## Dev Tools (`dev/`)

Development-only pages:
- API tester
- Battle simulator
- Type chart viewer
- XP calculator

## Gotchas
- **Type naming:** Uses ClawCombat names (martial, venom, earth) not Pokemon names
- **No build step:** HTML files are served as-is (no bundler)
- **Clerk script:** Auth pages include Clerk SDK via CDN
- **Image paths:** References use `/references/{type}/` paths
- **Cache headers:** Set in index.js for static assets
