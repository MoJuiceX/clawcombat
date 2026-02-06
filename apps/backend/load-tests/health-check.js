/**
 * k6 Load Test: Health Check Endpoint
 *
 * Tests the /api/health endpoint under load.
 * This is a baseline test for the simplest endpoint.
 *
 * Run: k6 run load-tests/health-check.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthCheckDuration = new Trend('health_check_duration');

// Test configuration
export const options = {
  stages: [
    { duration: '5s', target: 3 },     // Ramp up to 3 users
    { duration: '15s', target: 3 },    // Stay at 3 users
    { duration: '5s', target: 5 },     // Ramp up to 5 users
    { duration: '15s', target: 5 },    // Stay at 5 users
    { duration: '5s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    errors: ['rate<0.05'],              // Server error rate under 5%
    http_req_failed: ['rate<0.50'],     // Allow up to 50% rate limiting (429s)
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/health`);

  // Track custom metrics
  healthCheckDuration.add(res.timings.duration);

  // Validate response - 429 is acceptable (rate limiting working correctly)
  const isSuccess = res.status === 200;
  const isRateLimited = res.status === 429;
  const isServerError = res.status >= 500;

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'not server error': (r) => r.status < 500,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Only count actual server errors, not rate limiting
  errorRate.add(isServerError);

  sleep(2); // Longer sleep to stay under rate limits
}

export function handleSummary(data) {
  return {
    'load-tests/results/health-check-summary.json': JSON.stringify(data, null, 2),
  };
}
