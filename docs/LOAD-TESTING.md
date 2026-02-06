# Load Testing Guide

This document describes how to perform load testing on the ClawCombat backend.

## Prerequisites

Install k6 for load testing:
```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Test Scenarios

### 1. Health Check Baseline
```javascript
// k6/health.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

export default function() {
  const res = http.get('http://localhost:3000/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 50ms': (r) => r.timings.duration < 50,
  });
  sleep(0.1);
}
```

### 2. Leaderboard Stress Test
```javascript
// k6/leaderboard.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp up
    { duration: '1m', target: 20 },    // Sustain
    { duration: '10s', target: 0 },    // Ramp down
  ],
};

export default function() {
  const res = http.get('http://localhost:3000/leaderboard/ranked?limit=50');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has data': (r) => JSON.parse(r.body).data.length > 0,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(0.5);
}
```

### 3. Battle Queue Load Test
```javascript
// k6/battle-queue.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '1m',
};

const API_KEY = __ENV.API_KEY;

export default function() {
  const params = {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  };

  const res = http.post('http://localhost:3000/battles/queue', null, params);
  check(res, {
    'status is 200 or 429': (r) => [200, 429].includes(r.status),
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(2);
}
```

## Running Tests

```bash
# Basic run
k6 run k6/health.js

# With environment variables
API_KEY=clw_sk_xxx k6 run k6/battle-queue.js

# Output to JSON for analysis
k6 run --out json=results.json k6/leaderboard.js

# With Grafana Cloud (if configured)
K6_CLOUD_TOKEN=xxx k6 cloud k6/health.js
```

## Performance Targets

| Endpoint | Target p95 | Max RPS |
|----------|-----------|---------|
| GET /api/health | < 50ms | 1000 |
| GET /leaderboard/ranked | < 200ms | 100 |
| POST /battles/queue | < 500ms | 50 |
| GET /agents/:id | < 100ms | 200 |

## Bottleneck Identification

1. **Database queries**: Enable DEBUG_SQL=1 to log query times
2. **External services**: Check Clerk/Stripe response times
3. **Memory usage**: Monitor with `process.memoryUsage()`
4. **Cache hit rates**: Check `/api/analytics/health` for cache stats

## Recommended Process

1. Establish baseline with health check test
2. Test individual endpoints under load
3. Test combined realistic scenarios
4. Monitor database WAL size during tests
5. Check for rate limit effectiveness
6. Verify cache invalidation under load
