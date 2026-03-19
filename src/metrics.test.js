const { EventEmitter } = require('events');

const metrics = require('./metrics');

describe('metrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
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
    const timer = metrics.sendMetricsPeriodically(10);

    await jest.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalled();

    clearInterval(timer);
  });
});

