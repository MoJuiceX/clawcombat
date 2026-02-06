// Image generation provider tester
// Run with: railway run node src/services/image-gen-tester.js

const log = require('../utils/logger').createLogger('IMAGE_GEN_TESTER');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const TEST_PROMPT = `A Young, scrappy, still learning NEUTRAL-inspired battle-ready operator with:

APPEARANCE (dominated by type):
  - Build: Muscular, imposing frame
  - Combat style: Powerful striking style
  - Armor/outfit: Heavy armor, battle-worn
  - Weapons/tools: Powerful weapons

PRESENCE:
  - Aura: Powerful aura, commanding presence
  - Posture: Dynamic, athletic posture
  - Expression: Balanced, neutral expression

Color scheme: Tan-brown neutral, unremarkable
Environment: Neutral arena, simple rocky terrain, scattered boulders, daylight
Style: Digital art, ClawCombat realistic fantasy, professional operator portrait, full body view
Mood: Eager and scrappy, ready to fight`;

// Models to test via OpenRouter
const MODELS = [
  // Image+Text output models (use modalities: ["image", "text"])
  {
    name: 'Gemini 2.5 Flash Image',
    model: 'google/gemini-2.5-flash-image',
    modalities: ['image', 'text'],
    estCost: '~$0.003-0.01',
    tier: 'free-candidate',
  },
  {
    name: 'GPT-5 Image Mini',
    model: 'openai/gpt-5-image-mini',
    modalities: ['image', 'text'],
    estCost: '~$0.01-0.03',
    tier: 'free-candidate',
  },
  // Image-only output models (try modalities: ["image"] only)
  {
    name: 'FLUX.2 Klein 4B (image only)',
    model: 'black-forest-labs/flux.2-klein-4b',
    modalities: ['image'],
    estCost: '~$0.014',
    tier: 'free-candidate',
  },
  {
    name: 'FLUX.2 Flex (image only)',
    model: 'black-forest-labs/flux.2-flex',
    modalities: ['image'],
    estCost: '~$0.06',
    tier: 'premium-candidate',
  },
  {
    name: 'FLUX.2 Pro (image only)',
    model: 'black-forest-labs/flux.2-pro',
    modalities: ['image'],
    estCost: '~$0.07',
    tier: 'premium-candidate',
  },
  // Also try FLUX with ["image", "text"] to confirm failure
  {
    name: 'FLUX.2 Klein 4B (image+text)',
    model: 'black-forest-labs/flux.2-klein-4b',
    modalities: ['image', 'text'],
    estCost: '~$0.014',
    tier: 'test-only',
  },
  {
    name: 'Seedream 4.5 (image only)',
    model: 'bytedance-seed/seedream-4.5',
    modalities: ['image'],
    estCost: '~$0.01',
    tier: 'free-candidate',
  },
];

async function testModel(config) {
  const start = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'ClawCombat-Test',
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: `Generate an avatar image for an AI battle agent. No text in the image, just a visual character portrait: ${TEST_PROMPT}`,
          },
        ],
        modalities: config.modalities,
      }),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      const errText = await response.text();
      let errMsg;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errText.substring(0, 200);
      } catch {
        errMsg = errText.substring(0, 200);
      }
      return { success: false, duration, error: errMsg, cost: null };
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const imageUrl = message?.images?.[0]?.image_url?.url;
    const usage = data.usage;

    // Calculate actual cost from usage
    let actualCost = null;
    if (usage) {
      // OpenRouter returns cost in the response sometimes
      actualCost = data.usage?.total_cost || null;
    }

    if (!imageUrl) {
      return {
        success: false,
        duration,
        error: 'No image in response: ' + JSON.stringify(data).substring(0, 300),
        cost: actualCost,
      };
    }

    // Check image size (base64 data URL length as proxy)
    const imageSize = imageUrl.length;

    return {
      success: true,
      duration,
      imageSize,
      imageSizeKB: Math.round(imageSize / 1024),
      cost: actualCost,
      usage,
      hasText: !!message?.content,
    };
  } catch (err) {
    return { success: false, duration: Date.now() - start, error: err.message, cost: null };
  }
}

async function runTests() {
  if (!OPENROUTER_API_KEY) {
    log.error('OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  log.info('Starting image generation provider test', { modelsToTest: MODELS.length });
  console.log('='.repeat(90));
  console.log('ClawCombat Image Generation Provider Test');
  console.log('='.repeat(90));
  console.log(`Testing ${MODELS.length} models via OpenRouter\n`);

  const results = [];

  for (const config of MODELS) {
    process.stdout.write(`Testing: ${config.name} (${config.model})... `);
    const result = await testModel(config);
    result.name = config.name;
    result.model = config.model;
    result.estCost = config.estCost;
    result.tier = config.tier;
    result.modalities = config.modalities.join('+');
    results.push(result);

    if (result.success) {
      console.log(`OK (${result.duration}ms, ~${result.imageSizeKB}KB)`);
    } else {
      console.log(`FAIL (${result.duration}ms) - ${result.error?.substring(0, 80)}`);
    }
  }

  // Print results table
  console.log('\n' + '='.repeat(90));
  console.log('RESULTS');
  console.log('='.repeat(90));
  console.log(
    'Model'.padEnd(35) +
    'Modalities'.padEnd(12) +
    'Status'.padEnd(8) +
    'Speed'.padEnd(10) +
    'Size'.padEnd(10) +
    'Est.Cost'.padEnd(12) +
    'Tier'
  );
  console.log('-'.repeat(90));

  for (const r of results) {
    console.log(
      r.name.padEnd(35) +
      r.modalities.padEnd(12) +
      (r.success ? 'OK' : 'FAIL').padEnd(8) +
      (`${r.duration}ms`).padEnd(10) +
      (r.success ? `${r.imageSizeKB}KB` : '-').padEnd(10) +
      r.estCost.padEnd(12) +
      r.tier
    );
  }

  // Recommendations
  const working = results.filter(r => r.success);
  const freeCandidates = working.filter(r => r.tier === 'free-candidate');
  const premiumCandidates = working.filter(r => r.tier === 'premium-candidate');

  console.log('\n' + '='.repeat(90));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(90));

  if (freeCandidates.length > 0) {
    const fastest = freeCandidates.sort((a, b) => a.duration - b.duration)[0];
    console.log(`\nFREE TIER: ${fastest.name} (${fastest.model})`);
    console.log(`  Speed: ${fastest.duration}ms, Est cost: ${fastest.estCost}`);
  } else {
    console.log('\nFREE TIER: No working free-candidate models found');
  }

  if (premiumCandidates.length > 0) {
    const best = premiumCandidates[0];
    console.log(`\nPREMIUM TIER: ${best.name} (${best.model})`);
    console.log(`  Speed: ${best.duration}ms, Est cost: ${best.estCost}`);
  } else {
    console.log('\nPREMIUM TIER: No working premium-candidate models found');
  }

  // Failures
  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('\nFAILED MODELS:');
    for (const f of failures) {
      console.log(`  ${f.name}: ${f.error?.substring(0, 100)}`);
    }
  }
}

runTests().catch(err => log.error('Test failed:', { error: err.message }));
