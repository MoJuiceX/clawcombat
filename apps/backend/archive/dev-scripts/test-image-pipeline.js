// Test script: verify the image generation pipeline end-to-end
// Run: node test-image-pipeline.js
// Add --live flag to make a real Replicate API call: node test-image-pipeline.js --live

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const LIVE_TEST = process.argv.includes('--live');
const TEST_TYPE = process.argv[2] === '--live' ? (process.argv[3] || 'FIRE') : (process.argv[2] || 'FIRE');

console.log('=== ClawCombat Image Pipeline Test ===\n');

// ── Test 1: All 18 reference images exist ──
console.log('--- Test 1: Reference image files ---');
const TYPES = [
  'NEUTRAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE',
  'MARTIAL', 'VENOM', 'EARTH', 'AIR', 'PSYCHE', 'INSECT',
  'STONE', 'GHOST', 'DRAGON', 'SHADOW', 'METAL', 'MYSTIC'
];

const refDir = path.join(__dirname, 'src', 'public', 'references');
let missingImages = [];
for (const type of TYPES) {
  const file = `${type.toLowerCase()}-type-young.webp`;
  const fullPath = path.join(refDir, file);
  const exists = fs.existsSync(fullPath);
  const size = exists ? (fs.statSync(fullPath).size / 1024 / 1024).toFixed(2) + ' MB' : 'MISSING';
  const status = exists ? 'OK' : 'FAIL';
  if (!exists) missingImages.push(type);
  console.log(`  ${status}  ${type.padEnd(10)} → ${file} (${size})`);
}
if (missingImages.length > 0) {
  console.log(`\n  PROBLEM: Missing images for: ${missingImages.join(', ')}`);
} else {
  console.log('\n  All 18 reference images present.');
}

// ── Test 2: getReferenceImageUrl builds correct URLs ──
console.log('\n--- Test 2: Reference URL construction ---');
const { getReferenceImageUrl } = require('./src/services/image-gen.js');
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'https://clawcombat.com');

console.log(`  BASE_URL: ${BASE_URL}`);
const testUrl = getReferenceImageUrl(TEST_TYPE);
console.log(`  ${TEST_TYPE} → ${testUrl}`);
const expectedPath = `${BASE_URL}/references/${TEST_TYPE.toLowerCase()}-type-young.webp`;
console.log(`  Expected: ${expectedPath}`);
console.log(`  Match: ${testUrl === expectedPath ? 'OK' : 'FAIL'}`);

// ── Test 3: Prompt generation ──
console.log('\n--- Test 3: Prompt generation ---');
const { buildSkinPrompt } = require('./src/services/skin-generator.js');

const testAgent = {
  name: 'TestLobster',
  ai_type: TEST_TYPE,
  level: 1,
  xp: 0,
  base_hp: 20,
  base_attack: 25,
  base_defense: 15,
  base_sp_atk: 20,
  base_sp_def: 10,
  base_speed: 10,
  ability_name: 'Blaze',
};

const prompt = buildSkinPrompt(testAgent, 1);
console.log(`  Type: ${TEST_TYPE}`);
console.log(`  Stats: HP=${testAgent.base_hp} ATK=${testAgent.base_attack} DEF=${testAgent.base_defense} SpA=${testAgent.base_sp_atk} SpD=${testAgent.base_sp_def} SPD=${testAgent.base_speed}`);
console.log(`  Prompt length: ${prompt.length} chars`);
console.log(`  Contains type: ${prompt.includes(TEST_TYPE) ? 'OK' : 'FAIL'}`);
console.log(`  Contains "cybernetic robot lobster": ${prompt.includes('cybernetic robot lobster') ? 'OK' : 'FAIL'}`);
console.log(`  Contains tier 1 stage: ${prompt.includes('Young newly-forged') ? 'OK' : 'FAIL'}`);
console.log('\n  --- Full prompt ---');
console.log(prompt);
console.log('  --- End prompt ---');

// ── Test 4: What Replicate receives ──
console.log('\n--- Test 4: Replicate payload preview ---');
const replicatePrompt = `Using the cyberlobster from the reference image as the base character, generate a variation with these specific modifications: ${prompt}`;
console.log(`  Model: black-forest-labs/flux-2-pro`);
console.log(`  input_images: ["${testUrl}"]`);
console.log(`  aspect_ratio: 1:1`);
console.log(`  output_format: webp`);
console.log(`  Full prompt length: ${replicatePrompt.length} chars`);

// ── Test 5: ENV check ──
console.log('\n--- Test 5: Environment ---');
console.log(`  REPLICATE_API_TOKEN: ${process.env.REPLICATE_API_TOKEN ? 'SET (' + process.env.REPLICATE_API_TOKEN.substring(0, 6) + '...)' : 'NOT SET'}`);
console.log(`  BASE_URL resolved to: ${BASE_URL}`);

// ── Test 6 (optional): Live Replicate API call ──
if (LIVE_TEST) {
  console.log('\n--- Test 6: LIVE Replicate API call ---');
  console.log(`  Calling Replicate FLUX 2 Pro with ${TEST_TYPE} reference...`);
  console.log('  This will take 10-30 seconds...\n');

  const { generateFreeAvatar } = require('./src/services/image-gen.js');

  generateFreeAvatar(prompt, TEST_TYPE).then(result => {
    if (result.error) {
      console.log(`  FAIL: ${result.error}`);
    } else {
      console.log(`  SUCCESS!`);
      console.log(`  Model: ${result.model}`);
      console.log(`  Image URL: ${result.url}`);
      console.log(`\n  Open this URL in your browser to see the generated lobster.`);
    }
  }).catch(err => {
    console.log(`  ERROR: ${err.message}`);
  });
} else {
  console.log('\n--- Test 6: Live API call ---');
  console.log('  Skipped. Run with --live flag to make a real Replicate call:');
  console.log(`  node test-image-pipeline.js --live ${TEST_TYPE}`);
}
