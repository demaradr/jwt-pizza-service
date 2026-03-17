const axios = require('axios');
const os = require('os');
const config = require('./config');

class Metrics {
  constructor() {
    this.httpMetrics = { GET: 0, POST: 0, PUT: 0, DELETE: 0, total: 0 };
    this.authMetrics = { success: 0, failure: 0 };
    this.pizzaMetrics = { sold: 0, failures: 0, revenue: 0, latency: [] };
  }

  requestTracker(req, res, next) {
    const method = req.method;

    if (this.httpMetrics[method] !== undefined) {
      this.httpMetrics[method]++;
    }

    this.httpMetrics.total++;

    next();
  }

  authAttempt(success) {
    if (success) {
      this.authMetrics.success++;
    } else {
      this.authMetrics.failure++;
    }
  }

  pizzaPurchase(success, latency, price) {
    if (success) {
      this.pizzaMetrics.sold++;
      this.pizzaMetrics.revenue += price;
    } else {
      this.pizzaMetrics.failures++;
    }

    this.pizzaMetrics.latency.push(latency);
  }

  getCpuUsagePercentage() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return Number((cpuUsage * 100).toFixed(2));
  }

  getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return Number(((usedMemory / totalMemory) * 100).toFixed(2));
  }

  async sendMetrics() {
    const payload = {
      streams: [
        {
          stream: { source: config.metrics.source },
          values: [
            [
              Date.now() * 1000000 + '',
              JSON.stringify({
                http: this.httpMetrics,
                auth: this.authMetrics,
                pizza: this.pizzaMetrics,
                cpu: this.getCpuUsagePercentage(),
                memory: this.getMemoryUsagePercentage(),
              }),
            ],
          ],
        },
      ],
    };

    try {
      await axios.post(config.metrics.endpointUrl, payload, {
        auth: {
          username: config.metrics.accountId,
          password: config.metrics.apiKey,
        },
      });
    } catch (err) {
      console.log('Error sending metrics:', err.message);
    }
  }

  start(period = 60000) {
    setInterval(() => {
      this.sendMetrics();
    }, period);
  }
}

module.exports = new Metrics();