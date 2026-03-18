const os = require('os');
const config = require('./config.js');

const cfg = config.metrics || {};
const enabled = Boolean(cfg.endpointUrl && cfg.accountId && cfg.apiKey && cfg.source);

const counts = {
  httpTotal: 0,
  httpByMethod: { GET: 0, POST: 0, PUT: 0, DELETE: 0 },
  authSuccess: 0,
  authFailure: 0,
  pizzasSold: 0,
  pizzaCreationFailures: 0,
  revenueCents: 0,
  endpointLatencySumMs: 0,
  endpointLatencyCount: 0,
  pizzaCreationLatencySumMs: 0,
  pizzaCreationLatencyCount: 0,
};
const activeUserIds = new Set();

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function sourceAttribute() {
  return [{ key: 'source', value: { stringValue: cfg.source } }];
}

function buildOtelPayload(gaugesAndSums) {
  const scopeMetrics = { metrics: [] };

  for (const m of gaugesAndSums) {
    const useDouble = m.unit === '%' || m.name.includes('percent') || m.name.includes('revenue') || m.name.includes('dollars');
    const dataPoint = {
      ...(useDouble ? { asDouble: Number(m.value) } : { asInt: Math.round(m.value) }),
      timeUnixNano: String(Date.now() * 1000000),
      attributes: m.attributes || sourceAttribute(),
    };
    const metric = {
      name: m.name,
      unit: m.unit,
      [m.type]: {
        dataPoints: [dataPoint],
      },
    };
    if (m.type === 'sum') {
      metric.sum.aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
      metric.sum.isMonotonic = true;
    }
    scopeMetrics.metrics.push(metric);
  }

  return {
    resourceMetrics: [
      {
        scopeMetrics: [scopeMetrics],
      },
    ],
  };
}

async function sendToGrafana(payload) {
  if (!enabled) return;
  const body = JSON.stringify(payload);
  const res = await fetch(cfg.endpointUrl, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.accountId}:${cfg.apiKey}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to push metrics to Grafana:', text, body);
  }
}

function requestTracker(req, res, next) {
  if (!enabled) return next();
  const method = req.method;
  if (counts.httpByMethod[method] !== undefined) {
    counts.httpByMethod[method] += 1;
  }
  counts.httpTotal += 1;
  if (req.user && req.user.id) {
    activeUserIds.add(req.user.id);
  }
  const start = Date.now();
  res.on('finish', () => {
    const latencyMs = Date.now() - start;
    counts.endpointLatencySumMs += latencyMs;
    counts.endpointLatencyCount += 1;
  });
  next();
}

function authAttempt(success) {
  if (!enabled) return;
  if (success) {
    counts.authSuccess += 1;
  } else {
    counts.authFailure += 1;
  }
}

function pizzaPurchase(success, latencyMs, revenueDollars) {
  if (!enabled) return;
  if (success) {
    counts.pizzasSold += 1;
    counts.revenueCents += Math.round((revenueDollars || 0) * 100);
    counts.pizzaCreationLatencySumMs += latencyMs;
    counts.pizzaCreationLatencyCount += 1;
  } else {
    counts.pizzaCreationFailures += 1;
    counts.pizzaCreationLatencySumMs += latencyMs;
    counts.pizzaCreationLatencyCount += 1;
  }
}

function sendMetricsPeriodically(periodMs = 10000) {
  if (!enabled) return undefined;
  return setInterval(() => {
    try {
      const metrics = [];

      metrics.push({ name: 'http_requests_total', unit: '1', type: 'sum', value: counts.httpTotal, attributes: sourceAttribute() });
      metrics.push({ name: 'http_requests_get_total', unit: '1', type: 'sum', value: counts.httpByMethod.GET, attributes: sourceAttribute() });
      metrics.push({ name: 'http_requests_post_total', unit: '1', type: 'sum', value: counts.httpByMethod.POST, attributes: sourceAttribute() });
      metrics.push({ name: 'http_requests_put_total', unit: '1', type: 'sum', value: counts.httpByMethod.PUT, attributes: sourceAttribute() });
      metrics.push({ name: 'http_requests_delete_total', unit: '1', type: 'sum', value: counts.httpByMethod.DELETE, attributes: sourceAttribute() });

      metrics.push({ name: 'active_users', unit: '1', type: 'gauge', value: activeUserIds.size, attributes: sourceAttribute() });
      activeUserIds.clear();

      metrics.push({ name: 'auth_attempts_success_total', unit: '1', type: 'sum', value: counts.authSuccess, attributes: sourceAttribute() });
      metrics.push({ name: 'auth_attempts_failure_total', unit: '1', type: 'sum', value: counts.authFailure, attributes: sourceAttribute() });

      metrics.push({ name: 'cpu_percent', unit: '%', type: 'gauge', value: getCpuUsagePercentage(), attributes: sourceAttribute() });
      metrics.push({ name: 'memory_percent', unit: '%', type: 'gauge', value: getMemoryUsagePercentage(), attributes: sourceAttribute() });

      metrics.push({ name: 'pizzas_sold_total', unit: '1', type: 'sum', value: counts.pizzasSold, attributes: sourceAttribute() });
      metrics.push({ name: 'pizza_creation_failures_total', unit: '1', type: 'sum', value: counts.pizzaCreationFailures, attributes: sourceAttribute() });
      metrics.push({ name: 'revenue_dollars_total', unit: '1', type: 'sum', value: counts.revenueCents / 100, attributes: sourceAttribute() });

      metrics.push({ name: 'endpoint_latency_sum_ms', unit: 'ms', type: 'sum', value: counts.endpointLatencySumMs, attributes: sourceAttribute() });
      metrics.push({ name: 'endpoint_latency_count', unit: '1', type: 'sum', value: counts.endpointLatencyCount, attributes: sourceAttribute() });
      metrics.push({ name: 'pizza_creation_latency_sum_ms', unit: 'ms', type: 'sum', value: counts.pizzaCreationLatencySumMs, attributes: sourceAttribute() });
      metrics.push({ name: 'pizza_creation_latency_count', unit: '1', type: 'sum', value: counts.pizzaCreationLatencyCount, attributes: sourceAttribute() });

      const payload = buildOtelPayload(metrics);
      sendToGrafana(payload);
    } catch (error) {
      console.error('Error sending metrics', error);
    }
  }, periodMs);
}

module.exports = {
  requestTracker,
  authAttempt,
  pizzaPurchase,
  sendMetricsPeriodically,
  getCpuUsagePercentage,
  getMemoryUsagePercentage,
};
