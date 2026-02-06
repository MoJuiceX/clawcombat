/**
 * k6 Load Test: Battle Queue Endpoints
 *
 * Tests the /api/arena/queue endpoints (join/leave/status).
 * These are write-heavy endpoints with rate limiting.
 *
 * Run: k6 run load-tests/battle-queue.js
 *
 * Note: Requires API keys for authenticated endpoints.
 * Set via: k6 run -e API_KEY=clw_sk_xxx load-tests/battle-queue.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const joinDuration = new Trend('queue_join_duration');
const leaveDuration = new Trend('queue_leave_duration');
const statusDuration = new Trend('queue_status_duration');
const rateLimited = new Counter('rate_limited');

export const options = {
  stages: [
    { duration: '20s', target: 5 },    // Slow ramp
    { duration: '1m', target: 5 },     // Sustain low
    { duration: '20s', target: 20 },   // Ramp up
    { duration: '1m', target: 20 },    // Sustain
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% under 1s
    errors: ['rate<0.05'],              // Allow higher error rate due to rate limiting
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'test_api_key';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

export default function () {
  group('Queue Status', function () {
    const res = http.get(`${BASE_URL}/api/arena/queue/stats`);
    statusDuration.add(res.timings.duration);

    check(res, {
      'status check successful': (r) => r.status === 200,
      'has queue count': (r) => r.json('queueSize') !== undefined,
    });
  });

  group('Join Queue', function () {
    const res = http.post(
      `${BASE_URL}/api/arena/queue/join`,
      null,
      { headers }
    );

    joinDuration.add(res.timings.duration);

    if (res.status === 429) {
      rateLimited.add(1);
    }

    const success = check(res, {
      'join handled': (r) => [200, 201, 400, 429].includes(r.status),
      'response has status': (r) => r.json('status') !== undefined || r.json('error') !== undefined,
    });

    errorRate.add(!success && res.status !== 429);

    sleep(0.5);
  });

  group('Leave Queue', function () {
    const res = http.post(
      `${BASE_URL}/api/arena/queue/leave`,
      null,
      { headers }
    );

    leaveDuration.add(res.timings.duration);

    check(res, {
      'leave handled': (r) => [200, 400, 404].includes(r.status),
    });
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'load-tests/results/battle-queue-summary.json': JSON.stringify(data, null, 2),
  };
}
