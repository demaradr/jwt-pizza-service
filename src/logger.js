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
    // Return JSON as a string (Grafana expects the log line as a string).
    const json = typeof logData === 'string' ? logData : JSON.stringify(logData);

    // Minimal redaction:
    // - passwords and tokens/JWTs
    // - SQL password='...' patterns
    return json
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"*****"')
      .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"*****"')
      .replace(/"jwt"\s*:\s*"[^"]*"/gi, '"jwt":"*****"')
      .replace(/\\\"password\\\"\\s*:\\s*\\\"[^\\\"]*\\\"/gi, '\\"password\\":\\"*****\\"')
      .replace(/\\\"token\\\"\\s*:\\s*\\\"[^\\\"]*\\\"/gi, '\\"token\\":\\"*****\\"')
      .replace(/\\\"jwt\\\"\\s*:\\s*\\\"[^\\\"]*\\\"/gi, '\\"jwt\\":\\"*****\\"')
      .replace(/password\s*=\s*'[^']*'/gi, "password='*****'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='*****'");
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