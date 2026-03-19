const { EventEmitter } = require('events');

jest.mock('./config.js', () => ({
  metrics: {
    source: 'test-source',
    endpointUrl: 'https://example.test/otlp/v1/metrics',
    accountId: '123456',
    apiKey: 'test-metrics-key',
  },
}));

const metrics = require('./metrics');

describe('metrics', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('requestTracker records latency when response finishes', () => {
    const req = { method: 'GET', user: { id: 'user-1' } };
    const res = new EventEmitter();
    const next = jest.fn();

    metrics.requestTracker(req, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalled();
  });

  test('sendMetricsPeriodically builds payload and sends via fetch', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((cb) => {
      cb();
      return 1;
    });

    metrics.sendMetricsPeriodically(10);
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  test('sendMetricsPeriodically logs when Grafana returns non-OK', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      text: async () => 'unauthorized',
    }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((cb) => {
      cb();
      return 1;
    });

    metrics.sendMetricsPeriodically(10);
    await new Promise((r) => setImmediate(r));

    expect(global.fetch).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      'Failed to push metrics to Grafana:',
      'unauthorized',
      expect.any(String),
    );

    setIntervalSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('authAttempt and pizzaPurchase affect exported payload', async () => {
    metrics.authAttempt(true);
    metrics.authAttempt(false);
    metrics.pizzaPurchase(true, 5, 12.5);
    metrics.pizzaPurchase(false, 3, 0);

    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((cb) => {
      cb();
      return 1;
    });

    metrics.sendMetricsPeriodically(10);
    await Promise.resolve();

    const [, init] = global.fetch.mock.calls[0];
    expect(init.body).toContain('auth_attempts_success_total');
    expect(init.body).toContain('pizzas_sold_total');
    expect(init.body).toContain('pizza_creation_failures_total');

    setIntervalSpy.mockRestore();
  });

  test('getCpuUsagePercentage and getMemoryUsagePercentage return numbers', () => {
    expect(typeof metrics.getCpuUsagePercentage()).toBe('number');
    expect(typeof metrics.getMemoryUsagePercentage()).toBe('number');
  });
});
