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
    // Light constant load for local testing
    constant_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
    // Gentle ramp test
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '15s', target: 0 },
      ],
      startTime: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    errors: ['rate<0.05'],                // Only count 500+ as errors
    http_req_failed: ['rate<0.15'],       // Allow rate limiting (429)
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

// Helper to check if response is a server error (not rate limiting)
function isServerError(res) {
  return res.status >= 500;
}

function leaderboardRequest() {
  group('Leaderboard', function () {
    const res = http.get(`${BASE_URL}/api/leaderboard?limit=20`);
    responseTime.add(res.timings.duration);

    check(res, {
      'leaderboard ok or rate limited': (r) => r.status === 200 || r.status === 429,
      'not server error': (r) => r.status < 500,
    });
    errorRate.add(isServerError(res));
  });
}

function socialFeedRequest() {
  group('Social Feed', function () {
    const res = http.get(`${BASE_URL}/api/social/feed?limit=50`);
    responseTime.add(res.timings.duration);

    check(res, {
      'feed ok or rate limited': (r) => r.status === 200 || r.status === 429,
      'not server error': (r) => r.status < 500,
    });
    errorRate.add(isServerError(res));
  });
}

function agentProfileRequest() {
  group('Agent Profile', function () {
    // Use a sample agent ID or get from leaderboard
    const res = http.get(`${BASE_URL}/api/agents/sample`);
    responseTime.add(res.timings.duration);

    // Accept 200, 404 (not found), or 429 (rate limited)
    check(res, {
      'profile handled': (r) => [200, 404, 429].includes(r.status),
      'not server error': (r) => r.status < 500,
    });
    errorRate.add(isServerError(res));
  });
}

function healthRequest() {
  group('Health Check', function () {
    const res = http.get(`${BASE_URL}/api/health`);
    responseTime.add(res.timings.duration);

    check(res, {
      'health ok or rate limited': (r) => r.status === 200 || r.status === 429,
      'not server error': (r) => r.status < 500,
    });
    errorRate.add(isServerError(res));
  });
}

function typesRequest() {
  group('Types Data', function () {
    const res = http.get(`${BASE_URL}/api/agents/types`);
    responseTime.add(res.timings.duration);

    check(res, {
      'types ok or rate limited': (r) => r.status === 200 || r.status === 429,
      'not server error': (r) => r.status < 500,
    });
    errorRate.add(isServerError(res));
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
