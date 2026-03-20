const config = require('./config.js');

class Logger {
  constructor() {
    this.source = config.logging?.source;
    this.endpointUrl = config.logging?.endpointUrl;
    this.accountId = config.logging?.accountId;
    this.apiKey = config.logging?.apiKey;
    this.enabled = Boolean(this.source && this.endpointUrl && this.accountId && this.apiKey);
  }

  httpLogger = (req, res, next) => {
    if (!this.enabled) return next();

    const send = res.send;

    // Wrap `res.send` so `res.json(...)` is also captured (Express `res.json` uses `res.send` internally).
    res.send = (resBody) => {
      const reqBodyString = req.body === undefined ? undefined : JSON.stringify(req.body);
      const resBodyString = typeof resBody === 'string' ? resBody : JSON.stringify(resBody);

      const logData = {
        authorized: !!req.headers.authorization,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        reqBody: reqBodyString,
        resBody: resBodyString,
      };

      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);

      return send.call(res, resBody);
    };

    next();
  };

  log(level, type, logData) {
    if (!this.enabled) return;

    const labels = {
      component: this.source,
      level,
      type,
    };

    const values = [this.nowString(), this.sanitize(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };
    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  sanitize(logData) {
    const redacted = this.redactValue(logData);
    return typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  }

  redactValue(value) {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item));
    }

    if (typeof value === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key)) {
          out[key] = '*****';
        } else {
          out[key] = this.redactValue(val);
        }
      }
      return out;
    }

    if (typeof value === 'string') {
      let text = value
        .replace(/(password|token|jwt|api[_-]?key|authorization|secret)\s*=\s*'[^']*'/gi, "$1='*****'")
        .replace(/(password|token|jwt|api[_-]?key|authorization|secret)\s*=\s*"[^"]*"/gi, '$1="*****"');

      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(this.redactValue(parsed));
        }
      } catch {
        return text;
      }

      return text;
    }

    return value;
  }

  isSensitiveKey(key) {
    return /password|token|jwt|api[_-]?key|authorization|secret/i.test(key);
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);

    fetch(`${this.endpointUrl}`, {
      method: 'post',
      body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accountId}:${this.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) console.log('Failed to send log to Grafana');
    });
  }
}

module.exports = new Logger();