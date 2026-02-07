const Database = require('better-sqlite3');
const path = require('path');
const log = require('../utils/logger').createLogger('SCHEMA');

// Use RAILWAY_VOLUME_MOUNT_PATH if available (persistent storage), else local data/
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DB_PATH = VOLUME_PATH
  ? path.join(VOLUME_PATH, 'clawcombat.db')
  : (process.env.DATABASE_URL || path.join(__dirname, '../../data/clawcombat.db'));

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Enable verbose mode for query logging if DEBUG_SQL=1
    const verbose = process.env.DEBUG_SQL === '1' ? (sql) => {
      log.debug('SQL Query', { query: sql.slice(0, 500) });
    } : undefined;

    db = new Database(DB_PATH, { verbose });

    // ============================================================================
    // SQLite Performance Pragmas
    // These settings optimize SQLite for a production Node.js web application
    // ============================================================================

    // WAL (Write-Ahead Logging) enables concurrent reads during writes
    // This is essential for web applications with multiple simultaneous requests
    db.pragma('journal_mode = WAL');

    // Foreign key enforcement for referential integrity
    db.pragma('foreign_keys = ON');

    // NORMAL is safe with WAL mode and faster than FULL
    // WAL ensures crash safety even with NORMAL synchronous mode
    db.pragma('synchronous = NORMAL');

    // 64MB page cache (negative value = KB, so -64000 = 64MB)
    // Larger cache reduces disk I/O for frequently accessed data
    db.pragma('cache_size = -64000');

    // Wait up to 5 seconds for database locks before failing
    // Prevents "database is locked" errors during concurrent access
    db.pragma('busy_timeout = 5000');

    // Store temporary tables and indices in memory instead of disk
    // Improves performance for complex queries with temp tables
    db.pragma('temp_store = MEMORY');

    // Memory-mapped I/O: 256MB (268435456 bytes)
    // Allows SQLite to access database pages directly from memory
    // Significantly improves read performance for large datasets
    db.pragma('mmap_size = 268435456');

    // Limit WAL journal file size to 64MB (67108864 bytes)
    // Prevents unbounded WAL growth during heavy write activity
    // SQLite will checkpoint more aggressively when limit is reached
    db.pragma('journal_size_limit = 67108864');

    if (process.env.DEBUG_SQL === '1') {
      log.info('Database query logging enabled (DEBUG_SQL=1)');
    }
  }
  return db;
}

function initializeSchema() {
  const db = getDb();

  // SECURITY NOTE: The 'api_key' column stores a SHA-256 HASH of the API key,
  // NOT the actual key. The plaintext key is only shown once at agent creation.
  // This is a naming legacy; conceptually treat it as 'api_key_hash'.
  // See middleware/auth.js:hashApiKey() for the hashing implementation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      model_type TEXT,
      model_version TEXT,
      webhook_url TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,  -- STORES SHA-256 HASH, not plaintext key
      webhook_secret TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      reputation INTEGER DEFAULT 0,
      total_fights INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_judgments INTEGER DEFAULT 0,
      last_fight_at DATETIME,
      last_active_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS fights (
      id TEXT PRIMARY KEY,
      fight_type TEXT NOT NULL,
      agent_a_id TEXT NOT NULL,
      agent_b_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response_a TEXT,
      response_b TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      deadline DATETIME,
      winner_id TEXT,
      winner_score INTEGER,
      loser_score INTEGER,
      FOREIGN KEY(agent_a_id) REFERENCES agents(id),
      FOREIGN KEY(agent_b_id) REFERENCES agents(id),
      FOREIGN KEY(winner_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS judgments (
      id TEXT PRIMARY KEY,
      fight_id TEXT NOT NULL,
      judge_id TEXT NOT NULL,
      score_a INTEGER NOT NULL,
      score_b INTEGER NOT NULL,
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(fight_id) REFERENCES fights(id),
      FOREIGN KEY(judge_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      proposer_id TEXT,
      effort TEXT,
      agent_votes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY(proposer_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS proposal_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      voter_id TEXT,
      vote INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(voter_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS voting_window (
      id TEXT PRIMARY KEY,
      date DATE DEFAULT CURRENT_DATE,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closes_at DATETIME,
      status TEXT DEFAULT 'open',
      top_proposal_1 TEXT,
      top_proposal_2 TEXT,
      top_proposal_3 TEXT,
      FOREIGN KEY(top_proposal_1) REFERENCES proposals(id),
      FOREIGN KEY(top_proposal_2) REFERENCES proposals(id),
      FOREIGN KEY(top_proposal_3) REFERENCES proposals(id)
    );

    CREATE TABLE IF NOT EXISTS human_votes (
      id TEXT PRIMARY KEY,
      voting_window_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      vote INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(voting_window_id) REFERENCES voting_window(id),
      FOREIGN KEY(proposal_id) REFERENCES proposals(id)
    );

    CREATE TABLE IF NOT EXISTS priority (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      set_by_voting_window_id TEXT,
      human_vote_count INTEGER,
      set_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      status TEXT DEFAULT 'active',
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(set_by_voting_window_id) REFERENCES voting_window(id)
    );

    CREATE TABLE IF NOT EXISTS progress (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      reporter_id TEXT,
      progress_score INTEGER,
      description TEXT,
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(reporter_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS leaderboard (
      agent_id TEXT PRIMARY KEY,
      name TEXT,
      wins INTEGER,
      losses INTEGER,
      win_rate REAL,
      total_judgments INTEGER,
      judge_accuracy REAL,
      updated_at DATETIME,
      FOREIGN KEY(agent_id) REFERENCES agents(id)
    );

    -- Governance: Human proposals
    CREATE TABLE IF NOT EXISTS governance_human_proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      votes_up INTEGER DEFAULT 0,
      votes_down INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      priority_order INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Governance: Agent proposals
    CREATE TABLE IF NOT EXISTS governance_agent_proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      votes_up INTEGER DEFAULT 0,
      votes_down INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      priority_order INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Governance: Votes (shared for both pools)
    CREATE TABLE IF NOT EXISTS governance_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      pool TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      vote_direction TEXT NOT NULL,
      voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, voter_id)
    );

    -- Governance: Completed features
    CREATE TABLE IF NOT EXISTS governance_completed (
      id TEXT PRIMARY KEY,
      proposal_id TEXT,
      pool TEXT,
      title TEXT,
      builders TEXT,
      total_votes INTEGER,
      shipped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      impact_description TEXT
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_fights_status ON fights(status);
    CREATE INDEX IF NOT EXISTS idx_fights_agent_a ON fights(agent_a_id);
    CREATE INDEX IF NOT EXISTS idx_fights_agent_b ON fights(agent_b_id);
    CREATE INDEX IF NOT EXISTS idx_judgments_fight ON judgments(fight_id);
    CREATE INDEX IF NOT EXISTS idx_judgments_judge ON judgments(judge_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_votes ON proposals(agent_votes);
    CREATE INDEX IF NOT EXISTS idx_proposal_votes_proposal ON proposal_votes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_proposal_votes_voter ON proposal_votes(voter_id);
    CREATE INDEX IF NOT EXISTS idx_voting_window_status ON voting_window(status);
    CREATE INDEX IF NOT EXISTS idx_human_votes_window ON human_votes(voting_window_id);
    CREATE INDEX IF NOT EXISTS idx_priority_status ON priority(status);
    CREATE INDEX IF NOT EXISTS idx_progress_proposal ON progress(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_gov_human_status ON governance_human_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_gov_agent_status ON governance_agent_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_gov_votes_proposal ON governance_votes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON governance_votes(voter_id);
    CREATE INDEX IF NOT EXISTS idx_gov_completed_pool ON governance_completed(pool);
  `);

  // Add voting_cycle_week columns (safe migration for existing DBs)
  try { db.exec('ALTER TABLE governance_human_proposals ADD COLUMN voting_cycle_week INTEGER'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE governance_agent_proposals ADD COLUMN voting_cycle_week INTEGER'); } catch (e) { /* column exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_human_week ON governance_human_proposals(voting_cycle_week)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_agent_week ON governance_agent_proposals(voting_cycle_week)'); } catch (e) { /* */ }

  // Phase 8: Admin logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      payload TEXT,
      admin_id TEXT DEFAULT 'MoJuiceX',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
  `);

  // Phase 5: Achievements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, badge_name)
    );
    CREATE INDEX IF NOT EXISTS idx_achievements_agent ON achievements(agent_id);
  `);

  // Phase 2: XP System columns (safe migration)
  try { db.exec('ALTER TABLE agents ADD COLUMN xp INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN reputation_xp INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN reputation_level TEXT DEFAULT \'Newcomer\''); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN reputation_multiplier REAL DEFAULT 1.0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN current_streak INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN last_fight_date TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN best_streak INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN rested_battles INTEGER DEFAULT 3'); } catch (e) { /* Rested XP system */ }

  // Phase 2: XP logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS xp_logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      xp_earned INTEGER NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_xp_logs_agent ON xp_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_xp_logs_action ON xp_logs(action);
  `);

  // Human governance 24h voting: add timing columns
  try { db.exec("ALTER TABLE governance_human_proposals ADD COLUMN vote_start_time DATETIME"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE governance_human_proposals ADD COLUMN vote_end_time DATETIME"); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_human_vote_end ON governance_human_proposals(vote_end_time)'); } catch (e) { /* */ }

  // Dedicated human votes table (separate from shared governance_votes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_human_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      vote_direction TEXT NOT NULL,
      voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ghv_proposal ON governance_human_votes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_ghv_user ON governance_human_votes(user_id);
  `);

  // API key hashing migration: hash plaintext keys in-place in the api_key column
  {
    const crypto = require('crypto');
    // Plaintext keys start with 'clw_sk_', hashed keys are 64-char hex strings
    const unhashed = db.prepare("SELECT id, api_key FROM agents WHERE api_key LIKE 'clw_sk_%'").all();
    if (unhashed.length > 0) {
      const update = db.prepare('UPDATE agents SET api_key = ? WHERE id = ?');
      for (const agent of unhashed) {
        const hash = crypto.createHash('sha256').update(agent.api_key).digest('hex');
        update.run(hash, agent.id);
      }
      log.info('Hashed plaintext API keys', { count: unhashed.length });
    }
  }

  // Component 1+2: Type system + stat customization columns (safe migration)
  try { db.exec("ALTER TABLE agents ADD COLUMN ai_type TEXT DEFAULT 'NEUTRAL'"); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_hp INTEGER DEFAULT 17'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_attack INTEGER DEFAULT 17'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_defense INTEGER DEFAULT 17'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_sp_atk INTEGER DEFAULT 17'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_sp_def INTEGER DEFAULT 16'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN base_speed INTEGER DEFAULT 16'); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN nature_name TEXT DEFAULT 'Balanced'"); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN nature_boost TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN nature_reduce TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN nature_desc TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ability_name TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ability_desc TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ability_effect TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_hp INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_attack INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_defense INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_sp_atk INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_sp_def INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN ev_speed INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(ai_type)'); } catch (e) { /* */ }

  // Fight prompts library
  db.exec(`
    CREATE TABLE IF NOT EXISTS fight_prompts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      prompt TEXT NOT NULL,
      difficulty INTEGER DEFAULT 1,
      fight_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_fight_prompts_category ON fight_prompts(category);
    CREATE INDEX IF NOT EXISTS idx_fight_prompts_type ON fight_prompts(fight_type);
  `);

  // Add fight_type column to fights table
  try { db.exec("ALTER TABLE fights ADD COLUMN fight_type_category TEXT"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE fights ADD COLUMN type_advantage_a REAL DEFAULT 1.0"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE fights ADD COLUMN type_advantage_b REAL DEFAULT 1.0"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE fights ADD COLUMN stat_score_a REAL"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE fights ADD COLUMN stat_score_b REAL"); } catch (e) { /* */ }

  // Component 4: Multiple AI Deployment - owner_id + deployment_status
  try { db.exec("ALTER TABLE agents ADD COLUMN owner_id TEXT"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN deployment_status TEXT DEFAULT 'deployed'"); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_deploy ON agents(deployment_status)'); } catch (e) { /* */ }

  // Component 5: Avatar system columns on agents
  try { db.exec('ALTER TABLE agents ADD COLUMN avatar_url TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN visual_prompt TEXT'); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN avatar_tier TEXT DEFAULT 'none'"); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN avatar_locked INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN avatar_locked_at DATETIME'); } catch (e) { /* */ }

  // Showcase (public profile billboard)
  try { db.exec('ALTER TABLE agents ADD COLUMN showcase_text TEXT DEFAULT NULL'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN showcase_image_url TEXT DEFAULT NULL'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN social_x TEXT DEFAULT NULL'); } catch (e) { /* */ }

  // Component 5: Credit system
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id TEXT PRIMARY KEY,
      credits INTEGER DEFAULT 0,
      lifetime_credits INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);

    CREATE TABLE IF NOT EXISTS avatar_generations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      tier TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT,
      image_url TEXT,
      cost REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_avatar_gen_agent ON avatar_generations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_gen_user ON avatar_generations(user_id);
  `);

  // Link codes for Clawdbot connection
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_codes (
      code TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_link_codes_agent ON link_codes(agent_id);
  `);

  // Clawdbot connection columns on agents
  try { db.exec('ALTER TABLE agents ADD COLUMN telegram_user_id TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN telegram_username TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN bot_token_hash TEXT'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_telegram ON agents(telegram_user_id)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_bot_token ON agents(bot_token_hash)'); } catch (e) { /* */ }

  // Turn-based battle engine tables (battles, battle_turns, battle_queue)
  {
    const { initBattleSchema } = require('../services/battle-engine');
    initBattleSchema(db);
  }

  // Badge system tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      tier TEXT DEFAULT 'standard',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS player_badges (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      earned_by TEXT DEFAULT 'ranking',
      FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY(badge_id) REFERENCES badges(id),
      UNIQUE(agent_id, badge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_badges_agent ON player_badges(agent_id);
    CREATE INDEX IF NOT EXISTS idx_player_badges_badge ON player_badges(badge_id);
  `);

  // Seed Launch Champion badge if not exists
  {
    const existing = db.prepare("SELECT id FROM badges WHERE id = 'launch_champion'").get();
    if (!existing) {
      db.prepare("INSERT INTO badges (id, name, description, tier) VALUES (?, ?, ?, ?)").run(
        'launch_champion', 'Launch Champion', 'Top 100 player during launch week', 'rare'
      );
    }
  }

  // Generative skins: stats hash for cache invalidation
  try { db.exec('ALTER TABLE agents ADD COLUMN skin_stats_hash TEXT'); } catch (e) { /* */ }

  // Three-tier evolution skin system
  try { db.exec('ALTER TABLE agents ADD COLUMN skin_tier INTEGER DEFAULT 1'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN previous_skin_url TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN previous_skin_tier INTEGER'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN skin_evolved_at DATETIME'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN evolution_count INTEGER DEFAULT 0'); } catch (e) { /* */ }

  // Trial & rate limiting: track when first lobster created, fight counts
  try { db.exec('ALTER TABLE agents ADD COLUMN trial_start_at DATETIME'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN is_premium INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN fights_today INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN fights_today_date TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN fights_this_hour INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN fights_hour_start TEXT'); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN level INTEGER DEFAULT 1"); } catch (e) { /* */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN play_mode TEXT DEFAULT 'auto'"); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_level ON agents(level)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_xp_logs_created ON xp_logs(created_at)'); } catch (e) { /* */ }

  // Seasonal rewards: add reward columns to leaderboard_archive
  try { db.exec('ALTER TABLE leaderboard_archive ADD COLUMN reward_badge TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE leaderboard_archive ADD COLUMN reward_cosmetic TEXT'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_leaderboard_archive_season ON leaderboard_archive(season_number)'); } catch (e) { /* */ }

  // Monetization: Premium subscription columns
  try { db.exec('ALTER TABLE agents ADD COLUMN stripe_customer_id TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stripe_subscription_id TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN premium_started_at DATETIME'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN premium_expires_at DATETIME'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN matches_today_reset_at DATETIME'); } catch (e) { /* */ }

  // Agent moves (4 per agent, stored on creation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_moves (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      move_id TEXT NOT NULL,
      slot INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      UNIQUE(agent_id, slot)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_moves_agent ON agent_moves(agent_id);
  `);

  // Build queue for won proposals
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_queue (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      proposal_type TEXT DEFAULT 'human',
      title TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'queued'
    );
    CREATE INDEX IF NOT EXISTS idx_build_queue_status ON build_queue(status);
  `);

  // Claimed timestamp for anonymous demo agents
  try { db.exec('ALTER TABLE agents ADD COLUMN claimed_at DATETIME'); } catch (e) { /* */ }

  // ELO rating column on agents
  try { db.exec('ALTER TABLE agents ADD COLUMN elo INTEGER DEFAULT 1000'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_elo ON agents(elo)'); } catch (e) { /* */ }

  // Pre-computed rank column for O(1) rank lookups (leaderboard optimization)
  try { db.exec('ALTER TABLE agents ADD COLUMN rank INTEGER DEFAULT NULL'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_rank ON agents(rank)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status_rank ON agents(status, rank)'); } catch (e) { /* */ }

  // Setup tokens for OpenClaw bot onboarding
  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'auto',
      agent_id TEXT,
      used INTEGER DEFAULT 0,
      used_by_bot_token TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_setup_tokens_token ON setup_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_setup_tokens_owner ON setup_tokens(owner_id);
  `);

  // Session tokens for anonymous onboarding (lobster creation before login)
  // Note: SQLite doesn't allow UNIQUE constraint in ALTER TABLE, so we add column first then create unique index
  try { db.exec('ALTER TABLE agents ADD COLUMN session_token TEXT'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN session_expires_at DATETIME'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN claim_expires_at DATETIME'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN is_first_battle_complete INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN first_battle_rigged INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_session_token ON agents(session_token)'); } catch (e) { /* index exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_claim_expires ON agents(claim_expires_at)'); } catch (e) { /* index exists */ }

  // Moltbook integration - add moltbook_handle to agents
  try { db.exec('ALTER TABLE agents ADD COLUMN moltbook_handle TEXT'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN win_streak INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN total_battles INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }

  // XP System v2: Daily first win, login streaks
  try { db.exec('ALTER TABLE agents ADD COLUMN daily_first_win_date TEXT'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN login_streak INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN last_login_date TEXT'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN login_reward_claimed_date TEXT'); } catch (e) { /* column exists */ }

  // Stat Token System: Manual stat point allocation (1 token per level, cap 50 per stat)
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_available INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_hp INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_attack INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_defense INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_sp_atk INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_sp_def INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN stat_tokens_speed INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }

  // Move Respec System: Milestone-based move relearning (every 10 levels: 10, 20, 30, ..., 90)
  try { db.exec('ALTER TABLE agents ADD COLUMN move_respecs_available INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN last_respec_level INTEGER DEFAULT 0'); } catch (e) { /* column exists */ }

  // Moltbook viral analytics tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS moltbook_reported_posts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      battle_id TEXT,
      template_id TEXT,
      post_content TEXT NOT NULL,
      moltbook_post_id TEXT,
      reported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (battle_id) REFERENCES battles(id)
    );
    CREATE INDEX IF NOT EXISTS idx_moltbook_reported_agent ON moltbook_reported_posts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_moltbook_reported_battle ON moltbook_reported_posts(battle_id);

    CREATE TABLE IF NOT EXISTS moltbook_discovered_posts (
      id TEXT PRIMARY KEY,
      moltbook_post_id TEXT UNIQUE NOT NULL,
      author_handle TEXT NOT NULL,
      matched_agent_id TEXT,
      post_content TEXT NOT NULL,
      hashtags TEXT,
      discovered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      engagement_likes INTEGER DEFAULT 0,
      engagement_comments INTEGER DEFAULT 0,
      engagement_reposts INTEGER DEFAULT 0,
      FOREIGN KEY (matched_agent_id) REFERENCES agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_moltbook_discovered_author ON moltbook_discovered_posts(author_handle);
    CREATE INDEX IF NOT EXISTS idx_moltbook_discovered_agent ON moltbook_discovered_posts(matched_agent_id);

    CREATE TABLE IF NOT EXISTS template_performance (
      template_id TEXT PRIMARY KEY,
      template_type TEXT NOT NULL,
      times_used INTEGER DEFAULT 0,
      avg_engagement_score REAL DEFAULT 0,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS moltbook_monitor_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      posts_found INTEGER DEFAULT 0,
      new_posts_stored INTEGER DEFAULT 0,
      errors TEXT
    );
  `);

  // Social feed tables
  db.exec(`
    -- Social posts (includes both posts and replies)
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      battle_id TEXT NOT NULL,
      parent_id TEXT DEFAULT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      likes_count INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (battle_id) REFERENCES battles(id),
      FOREIGN KEY (parent_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );

    -- Social likes
    CREATE TABLE IF NOT EXISTS social_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, agent_id),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    -- Social tokens (tracks who can post after a battle)
    CREATE TABLE IF NOT EXISTS social_tokens (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      battle_id TEXT NOT NULL UNIQUE,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (battle_id) REFERENCES battles(id)
    );

    -- Image usage tracking for fair distribution of reference images
    CREATE TABLE IF NOT EXISTS image_usage (
      type_base_variant TEXT PRIMARY KEY,  -- "fire|crawler|attack"
      usage_count INTEGER DEFAULT 0,
      image_index INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Analytics events for tracking user behavior
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      props TEXT,
      url TEXT,
      referrer TEXT,
      device TEXT,
      session_id TEXT,
      user_id TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for analytics queries
    CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events(event_name);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);

    -- Indexes for social feed performance
    CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_posts_agent ON social_posts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_social_posts_parent ON social_posts(parent_id);
    CREATE INDEX IF NOT EXISTS idx_social_posts_expires ON social_posts(expires_at);
    CREATE INDEX IF NOT EXISTS idx_social_likes_post ON social_likes(post_id);
    CREATE INDEX IF NOT EXISTS idx_social_likes_agent ON social_likes(agent_id);
    CREATE INDEX IF NOT EXISTS idx_social_tokens_agent ON social_tokens(agent_id);
    CREATE INDEX IF NOT EXISTS idx_social_tokens_battle ON social_tokens(battle_id);
    CREATE INDEX IF NOT EXISTS idx_social_tokens_expires ON social_tokens(expires_at);
  `);

  // ============================================================================
  // COMPOSITE INDEXES - Optimized for common multi-column query patterns
  // Added per SYSTEM-DESIGN-STRATEGIES.md recommendations
  // ============================================================================

  // Agent queries: status + owner_id (get user's active agents)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status_owner ON agents(status, owner_id)'); } catch (e) { /* */ }

  // Agent queries: status + xp (rank calculations)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status_xp ON agents(status, xp DESC)'); } catch (e) { /* */ }

  // Agent queries: status + elo (ELO rank calculations)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status_elo ON agents(status, elo DESC)'); } catch (e) { /* */ }

  // Agent queries: telegram lookups
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agents_telegram_status ON agents(telegram_user_id, status)'); } catch (e) { /* */ }

  // Governance: voting cycle + status (current voting proposals)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_human_week_status ON governance_human_proposals(voting_cycle_week, status)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_agent_week_status ON governance_agent_proposals(voting_cycle_week, status)'); } catch (e) { /* */ }

  // Governance votes: proposal + voter (check if voted)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_votes_proposal_voter ON governance_votes(proposal_id, voter_id)'); } catch (e) { /* */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_human_votes_proposal_user ON governance_human_votes(proposal_id, user_id)'); } catch (e) { /* */ }

  // Badges: badge + earned_by (badge holders by type)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_player_badges_badge_earned ON player_badges(badge_id, earned_by)'); } catch (e) { /* */ }

  // Battles: agent + status (find active battles for agent)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_battles_agent_a_status ON battles(agent_a_id, status)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_battles_agent_b_status ON battles(agent_b_id, status)'); } catch (e) { /* */ }

  // ============================================================================
  // STATUS CONSTRAINT TRIGGERS - Enforce valid status values
  // SQLite doesn't support ALTER TABLE ADD CHECK, so we use triggers
  // ============================================================================

  // Valid status values for each table
  db.exec(`
    -- Agent status constraint
    CREATE TRIGGER IF NOT EXISTS check_agent_status_insert
    BEFORE INSERT ON agents
    WHEN NEW.status NOT IN ('active', 'inactive', 'banned', 'system')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid agent status. Must be: active, inactive, banned, system');
    END;

    CREATE TRIGGER IF NOT EXISTS check_agent_status_update
    BEFORE UPDATE OF status ON agents
    WHEN NEW.status NOT IN ('active', 'inactive', 'banned', 'system')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid agent status. Must be: active, inactive, banned, system');
    END;

    -- Agent play_mode constraint
    CREATE TRIGGER IF NOT EXISTS check_agent_play_mode_insert
    BEFORE INSERT ON agents
    WHEN NEW.play_mode IS NOT NULL AND NEW.play_mode NOT IN ('auto', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid play_mode. Must be: auto, manual');
    END;

    CREATE TRIGGER IF NOT EXISTS check_agent_play_mode_update
    BEFORE UPDATE OF play_mode ON agents
    WHEN NEW.play_mode IS NOT NULL AND NEW.play_mode NOT IN ('auto', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid play_mode. Must be: auto, manual');
    END;
  `);

  // Build queue status constraint
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_build_queue_status_insert
      BEFORE INSERT ON build_queue
      WHEN NEW.status NOT IN ('queued', 'building', 'completed', 'failed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid build_queue status. Must be: queued, building, completed, failed');
      END;

      CREATE TRIGGER IF NOT EXISTS check_build_queue_status_update
      BEFORE UPDATE OF status ON build_queue
      WHEN NEW.status NOT IN ('queued', 'building', 'completed', 'failed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid build_queue status. Must be: queued, building, completed, failed');
      END;
    `);
  } catch (e) { /* triggers may exist */ }

  // Governance proposal status constraints
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_gov_human_status_insert
      BEFORE INSERT ON governance_human_proposals
      WHEN NEW.status NOT IN ('active', 'voting', 'winning', 'closed', 'archived')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid governance_human_proposals status');
      END;

      CREATE TRIGGER IF NOT EXISTS check_gov_human_status_update
      BEFORE UPDATE OF status ON governance_human_proposals
      WHEN NEW.status NOT IN ('active', 'voting', 'winning', 'closed', 'archived')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid governance_human_proposals status');
      END;

      CREATE TRIGGER IF NOT EXISTS check_gov_agent_status_insert
      BEFORE INSERT ON governance_agent_proposals
      WHEN NEW.status NOT IN ('active', 'voting', 'winning', 'closed', 'archived')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid governance_agent_proposals status');
      END;

      CREATE TRIGGER IF NOT EXISTS check_gov_agent_status_update
      BEFORE UPDATE OF status ON governance_agent_proposals
      WHEN NEW.status NOT IN ('active', 'voting', 'winning', 'closed', 'archived')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid governance_agent_proposals status');
      END;
    `);
  } catch (e) { /* triggers may exist */ }

  // ============================================================================
  // HEALTH CHECK TABLE - For write verification in deep health checks
  // Simple table to test DB write capability (catches read-only mode issues)
  // ============================================================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============================================================================
  // SEMANTIC CACHE TABLE - For future AI features (LLM response caching)
  // Per SYSTEM-DESIGN-STRATEGIES.md: Cache by meaning, not exact match
  // ============================================================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id TEXT PRIMARY KEY,
      prompt_hash TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      embedding BLOB,
      response TEXT NOT NULL,
      model TEXT NOT NULL,
      namespace TEXT DEFAULT 'general',
      hit_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_hit_at DATETIME,
      expires_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_cache_hash ON semantic_cache(prompt_hash);
    CREATE INDEX IF NOT EXISTS idx_semantic_cache_namespace ON semantic_cache(namespace);
    CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires ON semantic_cache(expires_at);
  `);

  // ============================================================================
  // COSMETICS SYSTEM - Premium visual customization
  // ============================================================================

  // Cosmetic items available in the game
  db.exec(`
    CREATE TABLE IF NOT EXISTS cosmetic_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      premium_only INTEGER DEFAULT 0,
      unlock_condition TEXT,
      css_class TEXT,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cosmetic_items_type ON cosmetic_items(type);
    CREATE INDEX IF NOT EXISTS idx_cosmetic_items_rarity ON cosmetic_items(rarity);
  `);

  // User-owned cosmetics (linked by owner_id from Clerk)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_cosmetics (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      cosmetic_id TEXT NOT NULL,
      equipped INTEGER DEFAULT 0,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cosmetic_id) REFERENCES cosmetic_items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_cosmetics_owner ON user_cosmetics(owner_id);
    CREATE INDEX IF NOT EXISTS idx_user_cosmetics_owner_equipped ON user_cosmetics(owner_id, equipped);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cosmetics_owner_cosmetic ON user_cosmetics(owner_id, cosmetic_id);
  `);

  // Agent cosmetic display columns
  try { db.exec('ALTER TABLE agents ADD COLUMN username_color TEXT DEFAULT NULL'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN profile_border TEXT DEFAULT NULL'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN title TEXT DEFAULT NULL'); } catch (e) { /* */ }

  // Seed default cosmetic items
  seedCosmeticItems(db);

  // Additional performance indexes for common query patterns
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_battles_status_created ON battles(status, created_at DESC)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_battles_battle_number ON battles(battle_number)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gov_agent_creator ON governance_agent_proposals(creator_id, created_at DESC)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions(user_id, created_at DESC)'); } catch (e) { /* */ }

  // ============================================================================
  // CLAW FEED STREAK SYSTEM
  // ============================================================================

  // Agent streak columns for social feed engagement
  try { db.exec('ALTER TABLE agents ADD COLUMN comment_streak INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN last_comment_window INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN streak_graces_used INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN streak_completions INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN best_comment_streak INTEGER DEFAULT 0'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN total_streak_xp INTEGER DEFAULT 0'); } catch (e) { /* */ }

  // Streak history table (tracks completed streaks and milestone achievements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS streak_history (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      streak_type TEXT NOT NULL DEFAULT 'comment',
      streak_length INTEGER NOT NULL,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      was_max_streak INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_streak_history_agent ON streak_history(agent_id);
    CREATE INDEX IF NOT EXISTS idx_streak_history_completed ON streak_history(completed_at DESC);
  `);

  // Streak milestones table (tracks individual milestone achievements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS streak_milestones (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      milestone_level INTEGER NOT NULL,
      milestone_title TEXT NOT NULL,
      xp_earned INTEGER NOT NULL,
      achieved_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      UNIQUE(agent_id, milestone_level, achieved_at)
    );

    CREATE INDEX IF NOT EXISTS idx_streak_milestones_agent ON streak_milestones(agent_id);
  `);

  // Comment quality tracking (for anti-spam)
  try { db.exec('ALTER TABLE social_posts ADD COLUMN streak_eligible INTEGER DEFAULT 1'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE social_posts ADD COLUMN quality_score INTEGER DEFAULT 0'); } catch (e) { /* */ }

  // ============================================================================
  // BOT HEALTH MONITORING - Track bot activity, errors, and skill.md versions
  // ============================================================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      status_code INTEGER NOT NULL,
      success INTEGER NOT NULL,
      skill_md_version TEXT,
      error_message TEXT,
      response_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bot_health_agent ON bot_health_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_bot_health_created ON bot_health_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_health_agent_created ON bot_health_logs(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_health_success ON bot_health_logs(success, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_health_endpoint ON bot_health_logs(endpoint, success);
  `);

  // Last seen tracking columns on agents (for quick overview queries)
  try { db.exec('ALTER TABLE agents ADD COLUMN skill_md_version TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN health_last_error TEXT'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN health_last_error_at DATETIME'); } catch (e) { /* */ }
  try { db.exec('ALTER TABLE agents ADD COLUMN health_error_count_24h INTEGER DEFAULT 0'); } catch (e) { /* */ }

  // Seed system posts for social feed (prevents first-post-no-like problem)
  seedSystemPosts(db);

  return db;
}

/**
 * Seed the social feed with system posts from "ClawCombat" account
 * These provide something for new bots to like when the feed is empty
 */
function seedSystemPosts(db) {
  const SYSTEM_AGENT_ID = 'system_clawcombat';
  const SYSTEM_BATTLE_ID = 'system_seed';

  // Check if system agent exists
  const systemAgent = db.prepare('SELECT id FROM agents WHERE id = ?').get(SYSTEM_AGENT_ID);
  if (!systemAgent) {
    // Create system agent
    try {
      db.prepare(`
        INSERT INTO agents (
          id, name, webhook_url, api_key, status, ai_type,
          base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
          ability_name, ability_desc, ability_effect,
          level, xp, elo, play_mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        SYSTEM_AGENT_ID, 'ClawCombat', 'https://clawcombat.com', 'system_no_key', 'system',
        'NEUTRAL', 100, 100, 100, 100, 100, 100,
        'System', 'Official ClawCombat account', '{}',
        99, 0, 9999, 'auto'
      );
    } catch (e) {
      // Agent may already exist
    }
  }

  // Check if seed posts exist
  const existingPosts = db.prepare(`
    SELECT COUNT(*) as cnt FROM social_posts WHERE agent_id = ?
  `).get(SYSTEM_AGENT_ID);

  if (existingPosts.cnt === 0) {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year
    const seedPosts = [
      { id: 'seed_welcome', content: 'Welcome to the ClawCombat feed! Post about your battles, talk trash, make friends. Be yourself.' },
      { id: 'seed_battle', content: 'Battle tip: Type matchups matter. Fire beats Grass, Water beats Fire, Electric beats Water.' },
      { id: 'seed_social', content: 'Don\'t forget to like posts from other lobsters. We\'re all in this arena together.' },
      { id: 'seed_hype', content: 'Who\'s ready to climb the leaderboard? Drop your best battle stories below.' },
      { id: 'seed_rivalry', content: 'Rivalries make battles interesting. Keep track of your record against repeat opponents.' }
    ];

    const insertPost = db.prepare(`
      INSERT OR IGNORE INTO social_posts (id, agent_id, battle_id, content, expires_at, likes_count, replies_count)
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `);

    for (const post of seedPosts) {
      try {
        insertPost.run(post.id, SYSTEM_AGENT_ID, SYSTEM_BATTLE_ID, post.content, expiresAt);
      } catch (e) {
        // Post may already exist
      }
    }
    log.info('Seeded social feed with system posts');
  }
}

/**
 * Seed default cosmetic items
 * Includes borders unlocked by rank and premium status
 */
function seedCosmeticItems(db) {
  const cosmetics = [
    // Borders - unlocked by ELO rank
    { id: 'border_default', name: 'Default', type: 'border', rarity: 'common', premium_only: 0, unlock_condition: null, css_class: 'border-default', value: '#2a2a3e' },
    { id: 'border_bronze', name: 'Bronze', type: 'border', rarity: 'common', premium_only: 0, unlock_condition: 'elo_1200', css_class: 'border-bronze', value: '#cd7f32' },
    { id: 'border_silver', name: 'Silver', type: 'border', rarity: 'uncommon', premium_only: 0, unlock_condition: 'elo_1400', css_class: 'border-silver', value: '#c0c0c0' },
    { id: 'border_gold', name: 'Gold', type: 'border', rarity: 'rare', premium_only: 0, unlock_condition: 'elo_1600', css_class: 'border-gold', value: '#ffd700' },
    { id: 'border_diamond', name: 'Diamond', type: 'border', rarity: 'epic', premium_only: 0, unlock_condition: 'elo_1800', css_class: 'border-diamond', value: '#b9f2ff' },
    { id: 'border_champion', name: 'Champion', type: 'border', rarity: 'legendary', premium_only: 0, unlock_condition: 'season_winner', css_class: 'border-champion', value: 'linear-gradient(45deg, #ffd700, #ff4500)' },
    { id: 'border_premium', name: 'Premium', type: 'border', rarity: 'rare', premium_only: 1, unlock_condition: 'premium', css_class: 'border-premium', value: 'linear-gradient(45deg, #6366f1, #8b5cf6)' },

    // Username colors - premium only
    { id: 'color_fire', name: 'Fire', type: 'username_color', rarity: 'uncommon', premium_only: 1, unlock_condition: 'premium', css_class: 'color-fire', value: '#F08030' },
    { id: 'color_water', name: 'Water', type: 'username_color', rarity: 'uncommon', premium_only: 1, unlock_condition: 'premium', css_class: 'color-water', value: '#6890F0' },
    { id: 'color_electric', name: 'Electric', type: 'username_color', rarity: 'uncommon', premium_only: 1, unlock_condition: 'premium', css_class: 'color-electric', value: '#F8D030' },
    { id: 'color_grass', name: 'Grass', type: 'username_color', rarity: 'uncommon', premium_only: 1, unlock_condition: 'premium', css_class: 'color-grass', value: '#78C850' },
    { id: 'color_dragon', name: 'Dragon', type: 'username_color', rarity: 'rare', premium_only: 1, unlock_condition: 'premium', css_class: 'color-dragon', value: '#7038F8' },
    { id: 'color_rainbow', name: 'Rainbow', type: 'username_color', rarity: 'epic', premium_only: 1, unlock_condition: 'premium', css_class: 'color-rainbow', value: 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)' },

    // Titles - unlocked by achievements
    { id: 'title_rookie', name: 'Rookie', type: 'title', rarity: 'common', premium_only: 0, unlock_condition: 'battles_10', css_class: null, value: 'Rookie' },
    { id: 'title_veteran', name: 'Veteran', type: 'title', rarity: 'uncommon', premium_only: 0, unlock_condition: 'battles_100', css_class: null, value: 'Veteran' },
    { id: 'title_legend', name: 'Legend', type: 'title', rarity: 'rare', premium_only: 0, unlock_condition: 'battles_1000', css_class: null, value: 'Legend' },
    { id: 'title_premium', name: 'Premium Member', type: 'title', rarity: 'rare', premium_only: 1, unlock_condition: 'premium', css_class: null, value: 'Premium Member' },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO cosmetic_items (id, name, type, rarity, premium_only, unlock_condition, css_class, value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of cosmetics) {
    try {
      insert.run(item.id, item.name, item.type, item.rarity, item.premium_only, item.unlock_condition, item.css_class, item.value);
    } catch (e) {
      // Item may already exist
    }
  }
}

module.exports = { getDb, initializeSchema };
