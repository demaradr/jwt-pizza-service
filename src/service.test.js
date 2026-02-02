const request = require('supertest');
const app = require('./service');

test('root endpoint', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('message');
  expect(res.body).toHaveProperty('version');
});

test('docs endpoint', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('version');
  expect(res.body).toHaveProperty('endpoints');
  expect(res.body).toHaveProperty('config');
  expect(Array.isArray(res.body.endpoints)).toBe(true);
});

test('unknown endpoint - 404', async () => {
  const res = await request(app).get('/unknown/endpoint');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});
