/**
 * XP System Test Script
 * Run: node src/config/xp-config.test.js
 */

const {
  getXPToLevelUp,
  getBaseXPForLevel,
  getOpponentLevelModifier,
  getWinStreakBonus,
  getLoginStreakReward,
  getTotalXPForLevel,
  estimateToMax,
  DAILY_FIRST_WIN_BONUS
} = require('./battle-xp-config');

console.log('=== ClawCombat XP System Test ===\n');

// Test 1: Level requirements
console.log('1. LEVEL REQUIREMENTS (XP to level up)\n');
const testLevels = [2, 3, 4, 5, 10, 15, 20, 35, 50, 70, 85, 99];
testLevels.forEach(lvl => {
  console.log(`   Level ${lvl} → ${lvl + 1}: ${getXPToLevelUp(lvl)} XP`);
});

// Test 2: Level-based XP earning
console.log('\n2. LEVEL-BASED XP EARNING (base XP by player level)\n');
const earningLevels = [1, 10, 11, 25, 26, 50, 51, 75, 76, 100];
earningLevels.forEach(lvl => {
  console.log(`   Level ${lvl}: Win=${getBaseXPForLevel(lvl, true)} XP, Loss=${getBaseXPForLevel(lvl, false)} XP`);
});

// Test 3: Opponent level modifiers
console.log('\n3. OPPONENT LEVEL DIFFERENCE MODIFIERS\n');
const modTests = [
  { player: 10, opponent: 35, desc: 'Beat +25 levels' },
  { player: 10, opponent: 20, desc: 'Beat +10 levels' },
  { player: 10, opponent: 15, desc: 'Beat +5 levels' },
  { player: 10, opponent: 10, desc: 'Equal level' },
  { player: 20, opponent: 15, desc: 'Beat -5 levels' },
  { player: 30, opponent: 20, desc: 'Beat -10 levels' },
  { player: 50, opponent: 25, desc: 'Beat -25 levels' },
];
modTests.forEach(({ player, opponent, desc }) => {
  const { modifier, isGiantSlayer } = getOpponentLevelModifier(player, opponent);
  const sign = modifier >= 0 ? '+' : '';
  const gs = isGiantSlayer ? ' (GIANT SLAYER!)' : '';
  console.log(`   Lv${player} beats Lv${opponent} (${desc}): ${sign}${Math.round(modifier * 100)}%${gs}`);
});

// Test 4: Win streak bonuses
console.log('\n4. WIN STREAK BONUSES\n');
[0, 1, 2, 4, 9, 15].forEach(streak => {
  const bonus = getWinStreakBonus(streak);
  const newStreak = streak + 1;
  console.log(`   ${newStreak}-win streak: +${Math.round(bonus * 100)}%`);
});

// Test 5: Daily first win bonus
console.log(`\n5. DAILY FIRST WIN BONUS: +${Math.round(DAILY_FIRST_WIN_BONUS * 100)}%\n`);

// Test 6: Login streak rewards
console.log('6. LOGIN STREAK REWARDS\n');
for (let day = 1; day <= 7; day++) {
  const xp = getLoginStreakReward(day);
  const bonus = day === 7 ? ' (Weekly bonus!)' : '';
  console.log(`   Day ${day}: ${xp} XP${bonus}`);
}

// Test 7: Full XP calculation example
console.log('\n7. EXAMPLE XP CALCULATIONS\n');

function calcExample(playerLvl, oppLvl, winStreak, isFirstWin) {
  const base = getBaseXPForLevel(playerLvl, true);
  const { modifier, isGiantSlayer } = getOpponentLevelModifier(playerLvl, oppLvl);
  const streakBonus = getWinStreakBonus(winStreak);
  const firstWinBonus = isFirstWin ? DAILY_FIRST_WIN_BONUS : 0;

  let total = base;
  total += Math.round(base * modifier);
  total += Math.round(base * streakBonus);
  total += Math.round(base * firstWinBonus);

  const parts = [`base:${base}`];
  if (modifier !== 0) parts.push(`lvl:${modifier > 0 ? '+' : ''}${Math.round(modifier * 100)}%`);
  if (streakBonus > 0) parts.push(`streak:+${Math.round(streakBonus * 100)}%`);
  if (firstWinBonus > 0) parts.push(`first:+${Math.round(firstWinBonus * 100)}%`);
  if (isGiantSlayer) parts.push('GIANT SLAYER!');

  console.log(`   Lv${playerLvl} beats Lv${oppLvl} (streak:${winStreak + 1}, firstWin:${isFirstWin})`);
  console.log(`   → ${total} XP [${parts.join(', ')}]\n`);
}

calcExample(5, 5, 0, true);   // Level 5 beat level 5, no streak, first win
calcExample(10, 15, 2, false); // Level 10 beat level 15, 3-win streak, not first
calcExample(25, 50, 9, true);  // Level 25 beat level 50 (giant slayer!), 10-win streak, first win
calcExample(80, 60, 4, false); // Level 80 beat level 60 (lower), 5-win streak

// Test 8: Progression estimates
console.log('8. PROGRESSION ESTIMATES\n');
console.log(`   Total XP for level 100: ${getTotalXPForLevel(100).toLocaleString()} XP\n`);

const scenarios = [
  { name: 'Premium Hardcore', battles: 24, winRate: 0.55 },
  { name: 'Premium Casual', battles: 12, winRate: 0.50 },
  { name: 'Free Active', battles: 6, winRate: 0.50 },
  { name: 'Free Casual', battles: 3, winRate: 0.50 },
];

scenarios.forEach(({ name, battles, winRate }) => {
  const est = estimateToMax(battles, winRate);
  console.log(`   ${name} (${battles}/day, ${winRate * 100}% win rate):`);
  console.log(`   → ${est.totalBattles.toLocaleString()} battles, ${est.days} days (~${est.months} months)\n`);
});

console.log('=== Test Complete ===');
