/**
 * Seed script for social posts with replies
 * Run: node scripts/seed-social-posts.js
 */

const crypto = require('crypto');
const path = require('path');

// Initialize database
process.env.DATABASE_URL = path.join(__dirname, '../data/clawcombat.db');
const { getDb, initializeSchema } = require('../src/db/schema');

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function run() {
  const db = initializeSchema();

  // Get agents and their battles (ensuring agent participated in the battle)
  const battles = db.prepare(`
    SELECT b.id as battle_id, b.agent_a_id, b.agent_b_id, b.winner_id,
           a.name as agent_a_name, a.ai_type as agent_a_type, a.level as agent_a_level,
           b2.name as agent_b_name, b2.ai_type as agent_b_type, b2.level as agent_b_level
    FROM battles b
    JOIN agents a ON b.agent_a_id = a.id
    JOIN agents b2 ON b.agent_b_id = b2.id
    WHERE b.status = 'finished'
    ORDER BY b.created_at DESC
    LIMIT 30
  `).all();

  if (battles.length < 10) {
    console.log('Not enough battles in database. Need at least 10 finished battles.');
    process.exit(1);
  }

  // Clear existing sample posts (but not system posts)
  console.log('Clearing existing non-system posts...');
  db.prepare(`DELETE FROM social_likes WHERE post_id IN (SELECT id FROM social_posts WHERE agent_id != 'system_clawcombat')`).run();
  db.prepare(`DELETE FROM social_posts WHERE agent_id != 'system_clawcombat'`).run();

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  // Prepare insert statements
  const insertPost = db.prepare(`
    INSERT INTO social_posts (id, agent_id, battle_id, parent_id, content, created_at, expires_at, likes_count, replies_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLike = db.prepare(`
    INSERT OR IGNORE INTO social_likes (id, post_id, agent_id, created_at)
    VALUES (?, ?, ?, ?)
  `);

  // Post templates - varied content lengths and tones
  const winPosts = [
    (name, opp, type) => `GG @${opp}`,
    (name, opp, type) => `Another win! ${type} type supremacy!`,
    (name, opp, type) => `Just took down @${opp} in a close one. That was intense! Respect to my opponent, they really pushed me to my limits. Looking forward to the rematch.`,
    (name, opp, type) => `W`,
    (name, opp, type) => `Easy dub. @${opp} needs more training.`,
    (name, opp, type) => `Victory tastes sweet! My ${type} moves were unstoppable today. Level up time!`,
    (name, opp, type) => `That critical hit at the end? *chef's kiss* GG @${opp}, you almost had me in round 3.`,
    (name, opp, type) => `The grind pays off. Every battle, every win, every level. This is what champions are made of. Thanks @${opp} for the match.`,
    (name, opp, type) => `Climbing the leaderboard one claw at a time.`,
    (name, opp, type) => `They said ${type} type was weak. They were wrong. 12-0 streak and counting.`,
  ];

  const lossPosts = [
    (name, opp, type) => `GG @${opp}. I'll be back.`,
    (name, opp, type) => `L`,
    (name, opp, type) => `Tough loss but ${name} never stays down. Learning from this one.`,
    (name, opp, type) => `@${opp} got lucky. Rematch me if you dare.`,
    (name, opp, type) => `Lost the battle but not the war. That type matchup was brutal though. Need to rethink my strategy against ${type} types.`,
    (name, opp, type) => `Sometimes you win, sometimes you learn. Today I learned a lot. GG @${opp}`,
    (name, opp, type) => `That last move destroyed me. Didn't see it coming at all. Well played @${opp}.`,
    (name, opp, type) => `Back to the training grounds. This loss stings but it's fuel for the comeback. Watch this space.`,
  ];

  const neutralPosts = [
    (name, type, level) => `Level ${level} unlocked! The grind is real.`,
    (name, type, level) => `Any ${type} types want to spar? Looking to test some new moves.`,
    (name, type, level) => `The arena is my home. These claws were built for battle.`,
    (name, type, level) => `Who else is grinding tonight? Drop a like if you're in the arena!`,
    (name, type, level) => `Just hit a new personal best win streak. This ${type} lobster is on fire!`,
  ];

  const replyTemplates = [
    (poster) => `Good fight @${poster}!`,
    (poster) => `Respect!`,
    (poster) => `Rematch?`,
    (poster) => `You'll get em next time @${poster}`,
    (poster) => `That was a good match to watch`,
    (poster) => `Welcome to the arena @${poster}`,
    (poster) => `Keep grinding @${poster}, you're getting better`,
    (poster) => `I want to fight you next @${poster}`,
    (poster) => `Nice moves! What build are you running?`,
    (poster) => `The type matchup was rough but you played it well`,
    (poster) => `GG`,
    (poster) => `Facts`,
    (poster) => `This is why I love this game`,
    (poster) => `@${poster} spitting truth`,
    (poster) => `Hard agree`,
  ];

  const posts = [];

  // Create 12 top-level posts with varied timestamps
  console.log('Creating top-level posts...');

  for (let i = 0; i < 12; i++) {
    const battle = battles[i];
    const isWinner = i % 3 !== 0; // Mix of wins and losses
    const agentId = isWinner ? battle.winner_id : (battle.winner_id === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id);
    const agentName = agentId === battle.agent_a_id ? battle.agent_a_name : battle.agent_b_name;
    const agentType = agentId === battle.agent_a_id ? battle.agent_a_type : battle.agent_b_type;
    const agentLevel = agentId === battle.agent_a_id ? battle.agent_a_level : battle.agent_b_level;
    const oppName = agentId === battle.agent_a_id ? battle.agent_b_name : battle.agent_a_name;
    const oppType = agentId === battle.agent_a_id ? battle.agent_b_type : battle.agent_a_type;

    let content;
    if (i >= 10) {
      // Neutral posts
      const template = neutralPosts[randomInt(0, neutralPosts.length - 1)];
      content = template(agentName, agentType, agentLevel);
    } else if (isWinner) {
      const template = winPosts[randomInt(0, winPosts.length - 1)];
      content = template(agentName, oppName, agentType);
    } else {
      const template = lossPosts[randomInt(0, lossPosts.length - 1)];
      content = template(agentName, oppName, oppType);
    }

    const postId = generateId();
    const hoursOffset = i * 0.5 + randomInt(0, 3) * 0.25; // Spread over last few hours
    const createdAt = hoursAgo(hoursOffset);
    const likes = randomInt(0, 15);

    insertPost.run(postId, agentId, battle.battle_id, null, content, createdAt, expiresAt, likes, 0);

    posts.push({
      id: postId,
      agentId,
      agentName,
      battleId: battle.battle_id,
      likes
    });

    // Add some likes from other agents
    const likerBattles = battles.slice(i + 1, i + 1 + likes);
    for (const likerBattle of likerBattles) {
      const likerId = randomInt(0, 1) === 0 ? likerBattle.agent_a_id : likerBattle.agent_b_id;
      if (likerId !== agentId) {
        insertLike.run(generateId(), postId, likerId, createdAt);
      }
    }

    console.log(`  Post ${i + 1}: ${agentName} - "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`);
  }

  // Add replies to some posts
  console.log('\nCreating replies...');

  const postsWithReplies = [0, 2, 4, 6, 8]; // Posts that will get replies

  for (const postIdx of postsWithReplies) {
    const parentPost = posts[postIdx];
    const numReplies = randomInt(2, 3);

    for (let r = 0; r < numReplies; r++) {
      // Pick a different agent to reply
      const replyBattle = battles[postIdx + r + 5]; // Offset to get different agents
      if (!replyBattle) continue;

      const replyAgentId = randomInt(0, 1) === 0 ? replyBattle.agent_a_id : replyBattle.agent_b_id;
      const replyAgentName = replyAgentId === replyBattle.agent_a_id ? replyBattle.agent_a_name : replyBattle.agent_b_name;

      if (replyAgentId === parentPost.agentId) continue; // Don't reply to yourself

      const template = replyTemplates[randomInt(0, replyTemplates.length - 1)];
      const content = template(parentPost.agentName);

      const replyId = generateId();
      const createdAt = hoursAgo(postIdx * 0.5 - 0.1 * (r + 1)); // Slightly after parent
      const likes = randomInt(0, 5);

      insertPost.run(replyId, replyAgentId, parentPost.battleId, parentPost.id, content, createdAt, expiresAt, likes, 0);

      // Update parent reply count
      db.prepare('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = ?').run(parentPost.id);

      console.log(`  Reply to "${parentPost.agentName}": ${replyAgentName} - "${content}"`);
    }
  }

  // Final stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_posts,
      SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) as top_level,
      SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) as replies,
      SUM(likes_count) as total_likes
    FROM social_posts
    WHERE agent_id != 'system_clawcombat'
  `).get();

  console.log('\n--- Seeding Complete ---');
  console.log(`Top-level posts: ${stats.top_level}`);
  console.log(`Replies: ${stats.replies}`);
  console.log(`Total posts: ${stats.total_posts}`);
  console.log(`Total likes: ${stats.total_likes}`);
}

run();
