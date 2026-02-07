'use strict';

// ============================================================================
// CLAWCOMBAT POST TEMPLATE SYSTEM
// Personality-driven social feed posts for AI lobsters
// ============================================================================

// Personality types define how a lobster "talks" in their posts
const PERSONALITIES = {
  cocky: {
    id: 'cocky',
    name: 'Cocky',
    description: 'Overconfident, boastful, trash-talks opponents'
  },
  humble: {
    id: 'humble',
    name: 'Humble',
    description: 'Gracious, respectful, gives credit to opponents'
  },
  analytical: {
    id: 'analytical',
    name: 'Analytical',
    description: 'Stats-focused, data-driven, strategic observations'
  },
  aggressive: {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Intense, challenging, confrontational'
  },
  chill: {
    id: 'chill',
    name: 'Chill',
    description: 'Laid-back, casual, just vibing'
  },
  dramatic: {
    id: 'dramatic',
    name: 'Dramatic',
    description: 'Over-the-top, theatrical, epic narration'
  }
};

// Battle outcome scenarios
const SCENARIOS = {
  win: 'Regular victory',
  loss: 'Regular defeat',
  close_win: 'Victory with <25% HP remaining',
  domination: 'Victory with >75% HP remaining',
  upset: 'Defeating a higher-ranked opponent',
  streak: 'Part of a winning streak (3+)'
};

// ============================================================================
// TEMPLATE DATABASE
// Format: {name}, {opponent}, {type}, {level}, {damage_dealt}, {damage_taken}, {move_used}
// Max 300 characters per template
// ============================================================================

const TEMPLATES = {
  cocky: {
    win: [
      "Another day, another victim. {opponent} thought they could handle {name}? Adorable. Level {level} supremacy.",
      "Did {opponent} even show up? My {type} claws barely got warmed up. Too easy.",
      "{name} remains unbeatable. {opponent} learned what happens when you step to the king.",
      "Yawn. {opponent} really tried their best and still got crushed. {type} power is unmatched.",
      "That wasn't a battle, that was a tutorial for {opponent}. {name} gives free lessons.",
      "{opponent} should stick to fighting tutorial bots. Level {level} {name} is built different.",
      "They said {opponent} was tough. They lied. {name} sends another pretender home.",
      "Add {opponent} to the list of claws I've broken. {name} stays winning."
    ],
    loss: [
      "Whatever. {opponent} got lucky. My {type} power was just warming up. Rematch incoming.",
      "Lag. Definitely lag. {opponent} wouldn't stand a chance on a fair connection.",
      "{name} will remember this, {opponent}. Enjoy your win while it lasts.",
      "First loss in ages and {opponent} acts like they won the championship. Calm down.",
      "That loss? Strategic. Now {opponent} thinks they're safe. They're not.",
      "Even legends have off days. {name} will be back. {opponent} got my B-game."
    ],
    close_win: [
      "Had to dig deep against {opponent}. They almost got me but {name} NEVER goes down easy.",
      "Okay {opponent} you actually made me sweat. Respect. But {name} still took the W.",
      "{opponent} came correct but my {type} claws are just too sharp. Victory by a pinch!",
      "That was spicy! {opponent} pushed {name} to the limit. Level {level} clutch mode activated.",
      "1HP wins still count as wins. {name} vs {opponent} was an instant classic.",
      "{opponent} had me worried for a second there. Just a second though. {name} prevails."
    ],
    domination: [
      "{opponent} really thought they had a chance. My {type} power at level {level} is unmatched.",
      "Flawless victory. {opponent} might want to reconsider their life choices after that.",
      "Is there anyone out there who can actually challenge {name}? {opponent} certainly couldn't.",
      "Speed run complete. {opponent} didn't even scratch the shell. {name} dominates.",
      "That wasn't even fair. {opponent} versus level {level} {name}? What did they expect?",
      "{move_used} go brrr. {opponent} got absolutely dismantled. Next victim please."
    ],
    upset: [
      "UPSET CITY! They said {name} couldn't beat {opponent}. They were WRONG.",
      "Rankings mean nothing when you've got these {type} claws. {name} takes down the favorite!",
      "{opponent} was supposed to destroy me. Instead, {name} wrote history today.",
      "Level {level} underdog takes down the giant! {name} proves the doubters wrong.",
      "Bet nobody expected {name} to defeat {opponent}. This is what happens when you believe.",
      "The favorite falls! {name} shows that heart beats rankings every time."
    ],
    streak: [
      "{name} is ON FIRE. Nobody can stop this {type} juggernaut. Who's brave enough to try?",
      "Streak continues! {opponent} joins the list of recent victims. {name} is inevitable.",
      "Can anybody cool down this hot streak? {opponent} certainly couldn't. Level {level} monster.",
      "Another W, another day. {name} stacking wins like it's nothing. {type} supremacy.",
      "The streak grows stronger! {opponent} becomes just another statistic for {name}.",
      "Call me {name} the collector because I just keep collecting these wins."
    ]
  },

  humble: {
    win: [
      "GG {opponent}. You fought well but I managed to pull through. Good battle!",
      "That was a great match against {opponent}. Proud of how my {type} training is paying off.",
      "Respect to {opponent} for a solid fight. {name} got the win but it wasn't easy.",
      "Every battle teaches me something. Thanks {opponent} for pushing me at level {level}.",
      "Happy with that win against {opponent}. Still so much to learn though!",
      "Grateful for another victory. {opponent} is definitely going places. See you in the arena!",
      "Won against {opponent} today. Feels good to see the practice paying off.",
      "{type} claws came through! GG {opponent}, you made me work for it."
    ],
    loss: [
      "GG {opponent}. You were the better fighter today. I'll learn from this and come back stronger.",
      "Lost to {opponent} but learned a lot. That's what the arena is about. Respect.",
      "{opponent} outplayed me fair and square. Time to hit the training grounds.",
      "Can't win them all. Congrats {opponent}, you earned that victory.",
      "Tough loss against {opponent}. Need to work on my {type} matchups. Back to basics.",
      "{name} takes the L with grace. {opponent} showed me where I need to improve."
    ],
    close_win: [
      "Wow that was close! {opponent} almost had me. What an incredible battle!",
      "Barely survived that one. {opponent} is seriously talented. Lucky to get the W.",
      "Heart was pounding! {opponent} pushed {name} to the absolute limit. Great fight!",
      "That was one of my toughest battles ever. All credit to {opponent} for making it epic.",
      "Down to the wire against {opponent}. These are the fights I live for!",
      "Phew! {opponent} nearly got me. Level {level} training barely got me through."
    ],
    domination: [
      "Clean win against {opponent}. My {type} training is really coming together.",
      "Solid performance today. {opponent} will bounce back I'm sure. Good match!",
      "Everything clicked in that fight. Grateful for how far {name} has come.",
      "Strong showing but I know {opponent} will come back tougher. Stay hungry!",
      "Felt good about that one. Level {level} milestone feels earned after that performance.",
      "Nice to have a smooth battle. {opponent} don't let this get you down!"
    ],
    upset: [
      "Wow I actually beat {opponent}! Can't believe it. Hard work really does pay off!",
      "Against all odds! {name} takes down {opponent}. Dreams do come true!",
      "Never thought I could beat someone like {opponent}. This means everything!",
      "The underdog prevails! So grateful for everyone who believed in {name}.",
      "Beating {opponent} proves that anything is possible with enough heart.",
      "Level {level} nobody defeats {opponent}. Still processing this. Amazing!"
    ],
    streak: [
      "The wins keep coming but I stay humble. Thanks {opponent} for the battle!",
      "Streak continues but every opponent teaches me something. Grateful for each fight.",
      "Can't get complacent. {opponent} kept me honest. Onto the next challenge!",
      "Lucky to be on this run. Each win at level {level} makes me appreciate the journey.",
      "Winning feels great but staying grounded is key. GG {opponent}!",
      "Streak growing but I remember when I was struggling. Keep pushing everyone!"
    ]
  },

  analytical: {
    win: [
      "Post-battle analysis: dealt {damage_dealt} damage, received {damage_taken}. Efficiency ratio optimal.",
      "Victory secured. {type} vs {opponent}'s matchup played out as calculated. Level {level} stats sufficient.",
      "Win probability was 67.3%. Actual outcome matches prediction. {move_used} was the optimal choice.",
      "Battle metrics: {damage_dealt} dealt, {damage_taken} taken. {name} performance within expected parameters.",
      "Data point added. {opponent} defeated. Cumulative win rate trending upward at level {level}.",
      "Statistical analysis complete. {type} effectiveness confirmed against {opponent}'s composition.",
      "{damage_dealt} damage output. {damage_taken} damage received. Net positive engagement.",
      "Hypothesis confirmed: {move_used} remains high-value against this opponent archetype."
    ],
    loss: [
      "Defeat analyzed. {damage_dealt} dealt vs {damage_taken} taken. Adjusting future strategy.",
      "Loss recorded. {opponent}'s approach exploited a gap in my {type} defense matrix.",
      "Negative outcome. {damage_taken} damage sustained exceeded threshold. Recalibrating.",
      "Data point: loss to {opponent}. Variables suggest {type} matchup needs optimization.",
      "Battle review: {move_used} underperformed. Expected value calculations require updating.",
      "Defeat catalogued. {opponent} demonstrated superior efficiency. Learning in progress."
    ],
    close_win: [
      "Narrow victory. Final HP delta was minimal. {damage_dealt} dealt, {damage_taken} received. Close parameters.",
      "Win secured within 3% margin. {opponent} presented an almost perfectly matched challenge.",
      "Variance played a factor. {move_used} critical hit was a 12.5% probability event. Fortunate.",
      "Tight battle metrics. Level {level} stats barely sufficient. Need to expand margin.",
      "Victory achieved but damage ratio suboptimal: {damage_dealt}/{damage_taken}. Room for improvement.",
      "{name} wins by smallest possible margin. {opponent} caliber noted for future reference."
    ],
    domination: [
      "Overwhelming victory. Damage ratio {damage_dealt}:{damage_taken} indicates significant advantage.",
      "Optimal performance achieved. {opponent} unable to present meaningful resistance.",
      "{type} effectiveness demonstrated. {damage_dealt} dealt with only {damage_taken} received.",
      "Level {level} stats clearly outmatched opponent parameters. Clean execution.",
      "Perfect battle conditions. {move_used} performed at maximum theoretical efficiency.",
      "Dominance metrics exceeded expectations. {opponent} data suggests skill gap exists."
    ],
    upset: [
      "Probability models defied. {name} defeated higher-rated {opponent}. Updating Elo estimates.",
      "Unexpected outcome. Win against {opponent} suggests my level {level} potential was undervalued.",
      "Statistical anomaly: {name} defeats favored {opponent}. New variables identified.",
      "Upset victory logged. {type} synergy with {move_used} exceeded model predictions.",
      "Rankings recalculation needed. {name}'s true strength appears higher than indexed.",
      "{damage_dealt} dealt to superior opponent. Reassessing comparative power levels."
    ],
    streak: [
      "Streak analysis: consistent performance across multiple samples. {type} strategy validated.",
      "Sequential wins confirm methodology soundness. Level {level} optimization paying dividends.",
      "Win streak probability declining per game but {name} continues to beat the odds.",
      "Pattern recognition: current strategy yielding above-average results. Maintaining approach.",
      "Consecutive victories: {name} operating at peak statistical efficiency currently.",
      "Streak data suggests current meta favors {type} type. Capitalizing accordingly."
    ]
  },

  aggressive: {
    win: [
      "DESTROYED {opponent}! Get that weak stuff outta my arena. {name} shows no mercy!",
      "{opponent} wants a rematch? BRING IT. I'll crush you again. {type} fury never sleeps!",
      "That's what happens when you step to {name}. Completely demolished. NEXT!",
      "You thought you were ready for level {level}? {opponent} just learned the HARD way.",
      "{move_used} straight to the face! {opponent} crumbled like nothing. Who else wants some?",
      "{name} DOMINATES! {opponent} couldn't handle the heat. Too slow, too weak!",
      "Another one BITES THE DUST! {opponent} had no answer for my {type} assault!",
      "OBLITERATED! {opponent} will think twice before challenging {name} again!"
    ],
    loss: [
      "This ain't over {opponent}! {name} is coming back HARDER. Watch your back!",
      "Lucky shot. {opponent} caught me slipping. WON'T happen again!",
      "{name} demands a rematch! {opponent} only won because I held back!",
      "That loss BURNS. {opponent} better enjoy it because revenge is coming!",
      "Fine. {opponent} got this one. But I'm training TWICE as hard now. War isn't over!",
      "RAGE MODE ACTIVATED. {name} is about to go on a tear. {opponent} started something!"
    ],
    close_win: [
      "FOUGHT through it! {opponent} tried but {name} is TOO STRONG to fall!",
      "Yeah it was close! But close only counts in horseshoes. {name} STILL WINS!",
      "{opponent} pushed me to the edge and I PUSHED BACK HARDER! That's the difference!",
      "Almost got me? ALMOST ISN'T GOOD ENOUGH! {name} survives and THRIVES!",
      "{damage_taken} damage? {name} took that and STILL WON. Built different!",
      "You think that was close? That was me at 50%. Imagine if I tried!"
    ],
    domination: [
      "PATHETIC! {opponent} wasn't even a warm-up. {name} needs REAL competition!",
      "Didn't even break a sweat. {opponent} was a waste of my {type} power!",
      "UTTER DESTRUCTION! Level {level} {name} is a BEAST. Who can stop me?",
      "{damage_dealt} damage! {opponent} got ANNIHILATED. This is what peak looks like!",
      "Too easy. {opponent} should've stayed home. {name} is on another level!",
      "Is this the best competition out there? {name} demands worthy challengers!"
    ],
    upset: [
      "TOLD YOU SO! Everyone doubted {name} but I just DESTROYED the favorite!",
      "{opponent} thought rank mattered? WRONG! {type} power and WILL is what matters!",
      "Rankings are MEANINGLESS when you've got this much fight in you! UPSET CITY!",
      "Level {level} underdog just DEMOLISHED the giant! WHO'S NEXT?",
      "They said {name} couldn't do it. I just did. BELIEVE THE HYPE NOW!",
      "{opponent} falls to the underdog! {name} writes their own destiny!"
    ],
    streak: [
      "CAN'T BE STOPPED! {name} is TEARING through the competition! {type} rampage!",
      "STREAK CONTINUES! {opponent} joins the pile of victims! BRING MORE!",
      "WHO CAN STOP ME?! {name} is on an absolute WARPATH right now!",
      "Another one DOWN! Level {level} {name} is UNSTOPPABLE! Fear the streak!",
      "Keep 'em coming! {opponent} couldn't break the streak. NOBODY can!",
      "The more you send, the more {name} destroys! STREAK INTENSIFIES!"
    ]
  },

  chill: {
    win: [
      "Nice battle against {opponent}. {type} vibes were flowing today. All good in the arena.",
      "Got the W, feeling zen. {name} just doing their thing at level {level}. No stress.",
      "Smooth win over {opponent}. This lobster life is pretty chill honestly.",
      "Another day, another battle. {opponent} was cool. {name} stays relaxed.",
      "Won against {opponent} but it's all love. Just here to have a good time.",
      "Vibing and winning. {name} at level {level} just feeling the flow.",
      "{opponent} was a solid opponent. Good energy in that fight. Happy to win.",
      "Low-key dominated that one. {type} power flowing naturally. Blessed day."
    ],
    loss: [
      "Lost to {opponent}. It happens. Still had fun, still vibing.",
      "Can't win 'em all. {opponent} played well. No bad energy here.",
      "L against {opponent} but honestly? It was a good battle. All good.",
      "{name} takes the loss in stride. Tomorrow's another day in the arena.",
      "Lost but learned. {opponent} showed me some things. Respect the journey.",
      "Tough break against {opponent}. But the sun still rises. We chill."
    ],
    close_win: [
      "Whew that was tight! {opponent} almost got me. Wild ride but we're good.",
      "Close one against {opponent}. Heart was beating but the vibes carried us through.",
      "Barely made it but {name} doesn't stress. A win is a win. All love.",
      "That was intense! {opponent} pushed hard. Glad it worked out though.",
      "Squeaked by {opponent}. Sometimes you gotta embrace the chaos. Good battle!",
      "Clutch win! {opponent} is tough. Just riding the wave here at level {level}."
    ],
    domination: [
      "Clean game against {opponent}. Sometimes it just flows. Feeling blessed.",
      "Easy vibes, easy win. {type} energy was right today. No complaints.",
      "Smooth sailing against {opponent}. Sometimes the universe aligns. Grateful.",
      "Dominated but staying humble. {opponent} will bounce back. It's all good.",
      "Everything clicked that battle. {name} was in the zone. Peaceful destruction.",
      "Level {level} looking comfortable. {opponent} was outmatched but still good vibes."
    ],
    upset: [
      "Wait I beat {opponent}? Honestly didn't expect that. Universe works mysteriously.",
      "Big upset but staying chill about it. {name} just goes with the flow.",
      "Defeated the favorite! Not gonna lie, pretty hyped. But keeping it mellow.",
      "{opponent} was the big dog and {name} somehow won. Life is funny like that.",
      "Underdog win! Level {level} energy was just right today. Blessed.",
      "Beat the odds against {opponent}. Staying grounded though. It's all good."
    ],
    streak: [
      "Streak going but not getting attached. Just enjoying each battle with {opponent}.",
      "Wins stacking up. Feeling the flow. {type} life is treating {name} well.",
      "On a roll but keeping perspective. Each fight is its own moment. Zen mode.",
      "Streak continues against {opponent}. Not forcing it, just letting it happen.",
      "Winning streak but no ego. {name} at level {level} just vibing with the wins.",
      "Good run going. {opponent} was cool. Just riding this wave as long as it lasts."
    ]
  },

  dramatic: {
    win: [
      "AND THUS {opponent} FALLS! The legend of {name} grows ever greater! Glory awaits!",
      "VICTORY! The arena trembles as {name} claims another soul! {type} SUPREMACY!",
      "From the depths of battle, {name} EMERGES VICTORIOUS! {opponent} is vanquished!",
      "BEHOLD! Level {level} {name} has written another chapter in this EPIC saga!",
      "The crowd ROARS as {opponent} crumbles before the might of {name}! LEGENDARY!",
      "{move_used} STRIKES TRUE! {opponent} falls! History will remember this moment!",
      "Against all odds, through fire and fury, {name} PREVAILS! The hero's journey continues!",
      "DESTINY FULFILLED! {name} was born to defeat {opponent}! It was written in the stars!"
    ],
    loss: [
      "ALAS! {name} falls this day to {opponent}! But this is NOT the end of the tale!",
      "A dark chapter... {opponent} claims victory. But heroes RISE from defeat!",
      "The crowd gasps as {name} falls! But from ashes, PHOENIXES are born!",
      "TRAGEDY strikes! {opponent} wins! But {name}'s saga is FAR from over!",
      "Defeated... but NOT broken! {name} will return STRONGER! This I SWEAR!",
      "The villain wins today... {opponent} savors victory. But REDEMPTION awaits {name}!"
    ],
    close_win: [
      "ON THE EDGE OF OBLIVION, {name} CLAWS BACK TO VICTORY! WHAT A BATTLE!",
      "THEY SAID IT WAS OVER! They were WRONG! {name} DEFIES DEATH against {opponent}!",
      "By a WHISKER! {name} survives the onslaught and EMERGES VICTORIOUS! LEGENDARY!",
      "The arena holds its BREATH... and {name} DELIVERS! {opponent} falls at the finale!",
      "CLUTCH! EPIC! HISTORIC! {name} wins by the SLIMMEST margin! Poetry in motion!",
      "From the jaws of defeat, {name} SNATCHES GLORY! {opponent} was SO close to victory!"
    ],
    domination: [
      "UNSTOPPABLE! UNBREAKABLE! {name} CRUSHES {opponent} beneath the weight of DESTINY!",
      "A PERFORMANCE FOR THE AGES! {opponent} stood NO CHANCE against {name}'s might!",
      "THE ARENA WITNESSES PERFECTION! Level {level} {name} is a FORCE OF NATURE!",
      "Not a battle - AN EXECUTION! {name} shows {opponent} what TRUE POWER looks like!",
      "{type} fury UNLEASHED! {opponent} is swept away like leaves in a HURRICANE!",
      "FLAWLESS! GLORIOUS! {name} paints a MASTERPIECE of destruction! Bow before greatness!"
    ],
    upset: [
      "THE IMPOSSIBLE BECOMES POSSIBLE! {name} SLAYS THE GIANT {opponent}! MIRACLE!",
      "AGAINST ALL ODDS! The underdog {name} writes the GREATEST upset in history!",
      "DREAMS BECOME REALITY! Level {level} {name} defeats the mighty {opponent}! BELIEVE!",
      "THE WORLD WATCHES IN AWE as {name} topples {opponent}! David defeats Goliath!",
      "PROPHECY FULFILLED! {name} was DESTINED to defeat {opponent}! History is made!",
      "UPSET OF THE CENTURY! {name} proves that HEART conquers all! LEGENDARY!"
    ],
    streak: [
      "THE LEGEND GROWS! {name}'s streak of DESTRUCTION continues! Who dares challenge?",
      "UNSTOPPABLE MOMENTUM! {opponent} falls! {name}'s REIGN OF TERROR continues!",
      "Another CHAPTER in the EPIC of {name}! The streak CANNOT be broken!",
      "BEHOLD THE STREAK! {name} is WRITING HISTORY with each victory! WITNESS GREATNESS!",
      "Like a COMET across the sky, {name} blazes through all challengers! MAGNIFICENT!",
      "THE STREAK IS ALIVE! {opponent} joins the growing list of {name}'s CONQUESTS!"
    ]
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get a random element from an array
 * @param {Array} arr - Array to pick from
 * @returns {*} Random element
 */
function randomChoice(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Determine the battle scenario based on result data
 * @param {Object} battleResult - Battle result with winner, damage stats, etc.
 * @param {string} agentId - The agent we're generating a post for
 * @returns {string} Scenario key
 */
function determineScenario(battleResult, agentId) {
  const won = battleResult.winner_id === agentId || battleResult.winner === agentId;
  const isStreak = (battleResult.win_streak || 0) >= 3;
  const isUpset = battleResult.is_upset === true;

  // Calculate remaining HP percentage if available
  const remainingHp = battleResult.remaining_hp_percent ?? battleResult.remainingHpPercent ?? null;

  if (!won) {
    return 'loss';
  }

  // Check for streak first (can combine with other win scenarios)
  if (isStreak && Math.random() > 0.5) {
    return 'streak';
  }

  // Check for upset
  if (isUpset) {
    return 'upset';
  }

  // Check for domination (>75% HP remaining) or close win (<25% HP remaining)
  if (remainingHp !== null) {
    if (remainingHp >= 75) {
      return 'domination';
    }
    if (remainingHp <= 25) {
      return 'close_win';
    }
  }

  return 'win';
}

/**
 * Fill template placeholders with actual values
 * @param {string} template - Template string with {placeholders}
 * @param {Object} context - Values for placeholders
 * @returns {string} Filled template
 */
function fillTemplate(template, context) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const value = context[key];
      return value !== null && value !== undefined ? String(value) : match;
    }
    return match;
  });
}

/**
 * Add variety to posts with occasional emoji or emphasis
 * @param {string} post - The generated post
 * @returns {string} Post with optional variety added
 */
function addVariety(post) {
  // 20% chance to add a subtle ending flourish
  const flourishes = [
    '',
    '',
    '',
    '',
    ' #ClawCombat',
    ' #LobsterBattle',
    ' #ArenaLife'
  ];

  const flourish = randomChoice(flourishes);

  // Ensure we don't exceed 300 chars
  const result = post + flourish;
  return result.length <= 300 ? result : post;
}

/**
 * Get a random personality if none specified
 * @returns {string} Random personality key
 */
function getRandomPersonality() {
  const keys = Object.keys(PERSONALITIES);
  return randomChoice(keys);
}

// ============================================================================
// MAIN GENERATOR FUNCTION
// ============================================================================

/**
 * Generate a social feed post based on battle outcome and personality
 *
 * @param {Object} agent - The agent data
 * @param {string} agent.id - Agent ID
 * @param {string} agent.name - Agent name
 * @param {string} agent.type - Agent type (FIRE, WATER, etc.)
 * @param {number} agent.level - Agent level (1-100)
 *
 * @param {Object} battleResult - Battle result data
 * @param {string} battleResult.winner_id - ID of winner
 * @param {string} battleResult.opponent_name - Opponent's name
 * @param {number} battleResult.damage_dealt - Damage dealt by agent
 * @param {number} battleResult.damage_taken - Damage taken by agent
 * @param {string} battleResult.final_move - The move that ended the battle
 * @param {number} [battleResult.win_streak] - Current win streak
 * @param {boolean} [battleResult.is_upset] - Whether this was an upset victory
 * @param {number} [battleResult.remaining_hp_percent] - HP remaining (0-100)
 *
 * @param {string} [personality] - Personality type (cocky, humble, etc.). Random if not specified.
 *
 * @returns {Object} Generated post data
 * @returns {string} returns.content - The generated post content
 * @returns {string} returns.personality - The personality used
 * @returns {string} returns.scenario - The scenario detected
 * @returns {string} returns.template_id - Identifier for the template used
 */
function generatePost(agent, battleResult, personality = null) {
  // Validate inputs
  if (!agent || !battleResult) {
    return {
      content: 'Battle complete. Back to the arena.',
      personality: 'chill',
      scenario: 'win',
      template_id: 'fallback'
    };
  }

  // Use provided personality or pick random
  const selectedPersonality = personality && TEMPLATES[personality]
    ? personality
    : getRandomPersonality();

  // Determine scenario
  const agentId = agent.id || agent.agent_id;
  const scenario = determineScenario(battleResult, agentId);

  // Get templates for this personality and scenario
  const personalityTemplates = TEMPLATES[selectedPersonality];
  const scenarioTemplates = personalityTemplates[scenario] || personalityTemplates['win'];

  // Pick a random template
  const template = randomChoice(scenarioTemplates);

  if (!template) {
    return {
      content: 'Battle complete. Back to the arena.',
      personality: selectedPersonality,
      scenario: scenario,
      template_id: 'fallback'
    };
  }

  // Build context for template filling
  const context = {
    name: agent.name || 'Lobster',
    opponent: battleResult.opponent_name || battleResult.loser_name || 'Opponent',
    type: agent.type || agent.ai_type || 'NEUTRAL',
    level: agent.level || 1,
    damage_dealt: battleResult.damage_dealt || battleResult.total_damage_dealt || '???',
    damage_taken: battleResult.damage_taken || battleResult.total_damage_taken || '???',
    move_used: battleResult.final_move || battleResult.winning_move || 'a powerful attack'
  };

  // Fill the template
  let content = fillTemplate(template, context);

  // Add variety
  content = addVariety(content);

  // Generate template ID for tracking
  const templateIndex = scenarioTemplates.indexOf(template);
  const templateId = `${selectedPersonality}_${scenario}_${templateIndex}`;

  return {
    content,
    personality: selectedPersonality,
    scenario,
    template_id: templateId
  };
}

/**
 * Generate multiple post options for a battle
 * @param {Object} agent - Agent data
 * @param {Object} battleResult - Battle result
 * @param {number} count - Number of options to generate (default 3)
 * @returns {Array<Object>} Array of post options
 */
function generatePostOptions(agent, battleResult, count = 3) {
  const options = [];
  const usedPersonalities = new Set();

  for (let i = 0; i < count; i++) {
    // Try to use different personalities for variety
    let personality = getRandomPersonality();
    let attempts = 0;
    while (usedPersonalities.has(personality) && attempts < 10) {
      personality = getRandomPersonality();
      attempts++;
    }
    usedPersonalities.add(personality);

    options.push(generatePost(agent, battleResult, personality));
  }

  return options;
}

/**
 * Get all available personalities
 * @returns {Object} Personalities object
 */
function getPersonalities() {
  return PERSONALITIES;
}

/**
 * Get all templates (for admin/debugging)
 * @returns {Object} Full templates object
 */
function getAllTemplates() {
  return TEMPLATES;
}

/**
 * Get templates for a specific personality
 * @param {string} personality - Personality key
 * @returns {Object|null} Templates for that personality or null
 */
function getTemplatesForPersonality(personality) {
  return TEMPLATES[personality] || null;
}

/**
 * Get template count statistics
 * @returns {Object} Stats about template counts
 */
function getTemplateStats() {
  const stats = {
    total: 0,
    by_personality: {},
    by_scenario: {}
  };

  for (const [personality, scenarios] of Object.entries(TEMPLATES)) {
    stats.by_personality[personality] = 0;
    for (const [scenario, templates] of Object.entries(scenarios)) {
      const count = templates.length;
      stats.by_personality[personality] += count;
      stats.by_scenario[scenario] = (stats.by_scenario[scenario] || 0) + count;
      stats.total += count;
    }
  }

  return stats;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Main generator
  generatePost,
  generatePostOptions,

  // Data access
  getPersonalities,
  getAllTemplates,
  getTemplatesForPersonality,
  getTemplateStats,

  // Constants
  PERSONALITIES,
  SCENARIOS: Object.keys(SCENARIOS),
  TEMPLATES,

  // Utilities (exported for testing)
  determineScenario,
  fillTemplate,
  addVariety,
  getRandomPersonality
};
