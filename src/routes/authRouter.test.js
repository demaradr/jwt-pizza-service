jest.mock('../database/database.js');

const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let testUserId;
let adminUser;
let adminAuthToken;

beforeAll(async () => {
  testUser.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUserId = registerRes.body.user.id;
  expectValidJwt(testUserAuthToken);

  adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

// Auth Router Tests
test('register', async () => {
  const newUser = { name: randomName(), email: randomName() + '@test.com', password: 'testpass' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);
  expect(registerRes.body.user).toMatchObject({ name: newUser.name, email: newUser.email, roles: [{ role: 'diner' }] });
});

test('register - missing fields', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('name, email, and password are required');
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login - invalid credentials', async () => {
  const loginRes = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrongpassword' });
  expect(loginRes.status).toBe(500);
});

test('logout', async () => {
  // Create a separate user for logout test to avoid invalidating testUserAuthToken
  const logoutUser = { name: randomName(), email: randomName() + '@test.com', password: 'testpass' };
  const registerRes = await request(app).post('/api/auth').send(logoutUser);
  const logoutToken = registerRes.body.token;
  
  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${logoutToken}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');
  
  // Verify token is invalidated
  const verifyRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${logoutToken}`);
  expect(verifyRes.status).toBe(401);
});

test('logout - unauthorized', async () => {
  const logoutRes = await request(app).delete('/api/auth');
  expect(logoutRes.status).toBe(401);
  expect(logoutRes.body.message).toBe('unauthorized');
});

test('logout - invalid token', async () => {
  const logoutRes = await request(app).delete('/api/auth').set('Authorization', 'Bearer invalid.token.here');
  expect(logoutRes.status).toBe(401);
  expect(logoutRes.body.message).toBe('unauthorized');
});

test('setAuthUser middleware - invalid token format', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', 'InvalidFormat token');
  expect(res.status).toBe(401);
});

test('setAuthUser middleware - no token', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
});

test('setAuthUser middleware - token not logged in', async () => {
  // Valid JWT *shape* but not present in DB auth table, so setAuthUser should not set req.user.
  const notLoggedInToken = 'a.b.c';
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${notLoggedInToken}`);
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('setAuthUser middleware - logged in token but invalid JWT (hits jwt.verify catch)', async () => {
  // Force DB.isLoggedIn(token) === true, but jwt.verify(token, secret) throws.
  const badJwtToken = 'invalid.token.here';
  await DB.loginUser(testUserId, badJwtToken);

  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${badJwtToken}`);
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('setAuthUser middleware - malformed Bearer header (missing token)', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', 'Bearer');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});