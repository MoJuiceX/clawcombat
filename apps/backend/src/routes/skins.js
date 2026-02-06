const log = require('../utils/logger').createLogger('SKINS');
const express = require('express');
const { getDb } = require('../db/schema');
const { buildSkinPrompt, hashAgentStats, getTier, checkTierEvolution } = require('../services/skin-generator');
const { generatePremiumAvatar } = require('../services/image-gen');
const { assignImage } = require('../services/image-assigner');
const { authenticateAgent, optionalAgentAuth } = require('../middleware/auth');
const { invalidateAgent } = require('../services/agent-cache');

const router = express.Router();

// POST /skins/:agent_id/generate — Generate or return cached skin image
// Requires agent authentication and ownership verification
router.post('/:agent_id/generate', authenticateAgent, async (req, res) => {
  try {
    const start = Date.now();
    const db = getDb();
    const agentId = req.params.agent_id;
    const tier = req.body.tier || 'free';

    // Verify the authenticated agent owns this agent_id
    if (req.agent.id !== agentId) {
      return res.status(403).json({ error: 'You can only generate skins for your own agent' });
    }

    // Fetch agent
    const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND status = 'active'").get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Compute stats hash for cache check (includes evolution tier)
    const currentHash = hashAgentStats(agent);
    const level = Math.floor((agent.xp || 0) / 1000) + 1;
    const skinTier = getTier(level);

    // If skin already generated and stats haven't changed, return cached
    if (agent.avatar_url && agent.skin_stats_hash === currentHash) {
      return res.json({
        image_url: agent.avatar_url,
        cached: true,
        stats_hash: currentHash,
        skin_tier: skinTier,
      });
    }

    // Build the tier-appropriate prompt
    const prompt = buildSkinPrompt(agent);
    let imageUrl;
    let model = 'reference';

    if (tier === 'premium') {
      // Premium: Use AI generation
      const result = await generatePremiumAvatar(prompt, agent.ai_type);
      if (!result.url) {
        log.error('Premium generation failed:', { error: result.error });
        return res.status(502).json({
          error: 'Failed to generate image',
          reason: result.error,
          model: result.model,
        });
      }
      imageUrl = result.url;
      model = result.model;
    } else {
      // Free: Use reference image based on type + stats
      const stats = {
        hp: agent.base_hp,
        attack: agent.base_attack,
        defense: agent.base_defense,
        sp_atk: agent.base_sp_atk,
        sp_def: agent.base_sp_def,
        speed: agent.base_speed
      };
      const assignment = assignImage(agent.ai_type, stats);
      imageUrl = assignment.imagePath;
      log.info('Reference assigned', { type: agent.ai_type, assignment: `${assignment.base}-${assignment.variant}` });
    }

    // If tier changed, save previous skin before overwriting
    if (agent.avatar_url && agent.skin_tier && agent.skin_tier !== skinTier) {
      db.prepare(`
        UPDATE agents SET previous_skin_url = ?, previous_skin_tier = ?,
          skin_evolved_at = CURRENT_TIMESTAMP,
          evolution_count = COALESCE(evolution_count, 0) + 1
        WHERE id = ?
      `).run(agent.avatar_url, agent.skin_tier, agentId);
      log.info('Agent evolved', { agent: agent.name, oldTier: agent.skin_tier, newTier: skinTier });
    }

    // Save new skin to database
    db.prepare(`
      UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = ?
      WHERE id = ?
    `).run(imageUrl, prompt, currentHash, skinTier, agentId);

    // Invalidate cache after skin update
    invalidateAgent(agentId);

    const took = Date.now() - start;

    res.json({
      image_url: imageUrl,
      cached: false,
      stats_hash: currentHash,
      skin_tier: skinTier,
      model,
      took_ms: took,
    });

  } catch (err) {
    log.error('Generation error:', { error: err.message });
    res.status(502).json({
      error: 'Failed to generate image',
      reason: err.message,
    });
  }
});

// GET /skins/:agent_id — Get current skin (if exists)
router.get('/:agent_id', (req, res) => {
  const db = getDb();
  const agent = db.prepare(
    "SELECT id, name, avatar_url, visual_prompt, skin_stats_hash, skin_tier, previous_skin_url, previous_skin_tier, skin_evolved_at, evolution_count FROM agents WHERE id = ? AND status = 'active'"
  ).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  if (!agent.avatar_url) {
    return res.json({ agent_id: agent.id, name: agent.name, has_skin: false });
  }

  res.json({
    agent_id: agent.id,
    name: agent.name,
    has_skin: true,
    image_url: agent.avatar_url,
    stats_hash: agent.skin_stats_hash,
    skin_tier: agent.skin_tier,
    previous_skin_url: agent.previous_skin_url || null,
    previous_skin_tier: agent.previous_skin_tier || null,
    skin_evolved_at: agent.skin_evolved_at || null,
    evolution_count: agent.evolution_count || 0,
  });
});

// GET /skins/:agent_id/prompt — Preview the skin prompt without generating
router.get('/:agent_id/prompt', (req, res) => {
  const db = getDb();
  const agent = db.prepare(
    "SELECT * FROM agents WHERE id = ? AND status = 'active'"
  ).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const level = Math.floor((agent.xp || 0) / 1000) + 1;
  const skinTier = getTier(level);
  const prompt = buildSkinPrompt(agent);

  // Also show what all 3 tiers would look like
  const tierOverride = req.query.tier ? parseInt(req.query.tier, 10) : null;
  const displayPrompt = tierOverride ? buildSkinPrompt(agent, tierOverride) : prompt;

  res.json({
    agent_id: agent.id,
    name: agent.name,
    level,
    current_tier: skinTier,
    requested_tier: tierOverride || skinTier,
    skin_prompt: displayPrompt,
  });
});

// POST /skins/:agent_id/evolve — Force evolution regeneration
// Requires agent authentication and ownership verification
router.post('/:agent_id/evolve', authenticateAgent, async (req, res) => {
  try {
    const db = getDb();
    const agentId = req.params.agent_id;
    const targetTier = parseInt(req.body.target_tier, 10);
    const paymentTier = req.body.tier || 'free';

    // Verify the authenticated agent owns this agent_id
    if (req.agent.id !== agentId) {
      return res.status(403).json({ error: 'You can only evolve your own agent' });
    }

    if (![1, 2, 3].includes(targetTier)) {
      return res.status(400).json({ error: 'target_tier must be 1, 2, or 3' });
    }

    const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND status = 'active'").get(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Save current skin as previous
    if (agent.avatar_url) {
      db.prepare(`
        UPDATE agents SET previous_skin_url = ?, previous_skin_tier = ?,
          skin_evolved_at = CURRENT_TIMESTAMP,
          evolution_count = COALESCE(evolution_count, 0) + 1
        WHERE id = ?
      `).run(agent.avatar_url, agent.skin_tier || 1, agentId);
    }

    // Generate with forced tier
    const prompt = buildSkinPrompt(agent, targetTier);
    let imageUrl;
    let model = 'reference';

    if (paymentTier === 'premium') {
      // Premium: Use AI generation
      const result = await generatePremiumAvatar(prompt, agent.ai_type);
      if (!result.url) {
        return res.status(502).json({ error: 'Generation failed', reason: result.error });
      }
      imageUrl = result.url;
      model = result.model;
    } else {
      // Free: Use reference image based on type + stats
      const stats = {
        hp: agent.base_hp,
        attack: agent.base_attack,
        defense: agent.base_defense,
        sp_atk: agent.base_sp_atk,
        sp_def: agent.base_sp_def,
        speed: agent.base_speed
      };
      const assignment = assignImage(agent.ai_type, stats);
      imageUrl = assignment.imagePath;
      log.info('Evolved with reference', { type: agent.ai_type, assignment: `${assignment.base}-${assignment.variant}` });
    }

    const hash = hashAgentStats(agent);
    db.prepare(`
      UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = ?
      WHERE id = ?
    `).run(imageUrl, prompt, hash, targetTier, agentId);

    // Invalidate cache after evolution
    invalidateAgent(agentId);

    res.json({
      image_url: imageUrl,
      skin_tier: targetTier,
      model,
      evolved_from: agent.skin_tier || null,
    });
  } catch (err) {
    log.error('Evolve error:', { error: err.message, agent_id: req.params.agent_id });
    res.status(500).json({ error: 'Failed to evolve skin' });
  }
});

module.exports = router;
