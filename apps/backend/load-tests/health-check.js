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
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 10 },    // Stay at 10 users
    { duration: '30s', target: 50 },   // Ramp up to 50 users
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 100 },  // Ramp up to 100 users
    { duration: '1m', target: 100 },   // Stay at 100 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],  // 95% of requests under 200ms
    errors: ['rate<0.01'],              // Error rate under 1%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/health`);

  // Track custom metrics
  healthCheckDuration.add(res.timings.duration);

  // Validate response
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response has status': (r) => r.json('status') !== undefined,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(!success);

  sleep(0.5);
}

export function handleSummary(data) {
  return {
    'load-tests/results/health-check-summary.json': JSON.stringify(data, null, 2),
  };
}
