/**
 * k6 Load Test: Leaderboard Endpoint
 *
 * Tests the /api/leaderboard endpoint under load.
 * This is a read-heavy endpoint with caching.
 *
 * Run: k6 run load-tests/leaderboard.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const leaderboardDuration = new Trend('leaderboard_duration');
const cacheHits = new Counter('cache_hits');

export const options = {
  stages: [
    { duration: '20s', target: 20 },   // Ramp up
    { duration: '1m', target: 20 },    // Sustain
    { duration: '20s', target: 100 },  // Spike
    { duration: '1m', target: 100 },   // Sustain spike
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% under 500ms
    http_req_duration: ['p(99)<1000'], // 99% under 1s
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Test different page sizes and offsets
  const page = Math.floor(Math.random() * 5) + 1;
  const limit = [10, 20, 50][Math.floor(Math.random() * 3)];

  const res = http.get(`${BASE_URL}/api/leaderboard?page=${page}&limit=${limit}`);

  leaderboardDuration.add(res.timings.duration);

  // Check for cache header
  if (res.headers['X-Cache'] === 'HIT') {
    cacheHits.add(1);
  }

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'has data array': (r) => Array.isArray(r.json('data')),
    'has pagination': (r) => r.json('pagination') !== undefined,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);

  sleep(0.3);
}

export function handleSummary(data) {
  return {
    'load-tests/results/leaderboard-summary.json': JSON.stringify(data, null, 2),
  };
}
