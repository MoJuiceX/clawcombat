/**
 * k6 Load Test: Realistic Traffic Simulation
 *
 * Simulates realistic user traffic patterns across multiple endpoints.
 * Distribution based on expected real-world usage:
 * - 40% Leaderboard/profiles (reads)
 * - 30% Social feed (reads)
 * - 15% Battle-related (writes)
 * - 10% Agent profile views
 * - 5% Other
 *
 * Run: k6 run load-tests/realistic-traffic.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

export const options = {
  scenarios: {
    // Constant load
    constant_load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
    // Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 150 },  // Spike
        { duration: '30s', target: 150 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      startTime: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    errors: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Weighted random selection
function weightedRandom(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;

  for (let i = 0; i < weights.length; i++) {
    if (random < weights[i]) return i;
    random -= weights[i];
  }
  return weights.length - 1;
}

const endpoints = [
  // 40% - Leaderboard
  { weight: 40, fn: leaderboardRequest },
  // 30% - Social feed
  { weight: 30, fn: socialFeedRequest },
  // 15% - Agent profiles
  { weight: 15, fn: agentProfileRequest },
  // 10% - Health/status
  { weight: 10, fn: healthRequest },
  // 5% - Types/static data
  { weight: 5, fn: typesRequest },
];

const weights = endpoints.map((e) => e.weight);

function leaderboardRequest() {
  group('Leaderboard', function () {
    const res = http.get(`${BASE_URL}/api/leaderboard?limit=20`);
    responseTime.add(res.timings.duration);

    const success = check(res, {
      'leaderboard 200': (r) => r.status === 200,
      'has data': (r) => r.json('data') !== undefined,
    });
    errorRate.add(!success);
  });
}

function socialFeedRequest() {
  group('Social Feed', function () {
    const res = http.get(`${BASE_URL}/api/social/feed?limit=50`);
    responseTime.add(res.timings.duration);

    const success = check(res, {
      'feed 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  });
}

function agentProfileRequest() {
  group('Agent Profile', function () {
    // Use a sample agent ID or get from leaderboard
    const res = http.get(`${BASE_URL}/api/agents/sample`);
    responseTime.add(res.timings.duration);

    // Accept 200 or 404 (agent not found)
    const success = check(res, {
      'profile handled': (r) => [200, 404].includes(r.status),
    });
    errorRate.add(!success && res.status >= 500);
  });
}

function healthRequest() {
  group('Health Check', function () {
    const res = http.get(`${BASE_URL}/api/health`);
    responseTime.add(res.timings.duration);

    const success = check(res, {
      'health 200': (r) => r.status === 200,
      'status ok': (r) => r.json('status') === 'ok' || r.json('status') === 'healthy',
    });
    errorRate.add(!success);
  });
}

function typesRequest() {
  group('Types Data', function () {
    const res = http.get(`${BASE_URL}/api/agents/types`);
    responseTime.add(res.timings.duration);

    const success = check(res, {
      'types 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  });
}

export default function () {
  const selectedIndex = weightedRandom(weights);
  endpoints[selectedIndex].fn();

  // Random sleep between 0.5 and 2 seconds to simulate user think time
  sleep(Math.random() * 1.5 + 0.5);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      totalRequests: data.metrics.http_reqs.values.count,
      failedRequests: data.metrics.http_req_failed?.values.passes || 0,
      avgResponseTime: data.metrics.http_req_duration.values.avg,
      p95ResponseTime: data.metrics.http_req_duration.values['p(95)'],
      p99ResponseTime: data.metrics.http_req_duration.values['p(99)'],
      errorRate: data.metrics.errors?.values.rate || 0,
    },
  };

  console.log('\n=== Load Test Summary ===');
  console.log(`Total Requests: ${summary.metrics.totalRequests}`);
  console.log(`Avg Response Time: ${summary.metrics.avgResponseTime.toFixed(2)}ms`);
  console.log(`P95 Response Time: ${summary.metrics.p95ResponseTime.toFixed(2)}ms`);
  console.log(`P99 Response Time: ${summary.metrics.p99ResponseTime.toFixed(2)}ms`);
  console.log(`Error Rate: ${(summary.metrics.errorRate * 100).toFixed(2)}%`);

  return {
    'load-tests/results/realistic-traffic-summary.json': JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
