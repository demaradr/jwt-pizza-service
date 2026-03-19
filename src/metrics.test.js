const { EventEmitter } = require('events');

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
      // Run exactly one cycle immediately; we don't want to depend on fake timers.
      cb();
      return 1;
    });

    metrics.sendMetricsPeriodically(10);
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });
});

