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

let testUser;
let testUserAuthToken;
let adminUser;
let adminAuthToken;

beforeAll(async () => {
  testUser = { name: randomName(), email: randomName() + '@test.com', password: 'testpass' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUser.id = registerRes.body.user.id;
  expectValidJwt(testUserAuthToken);

  adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

test('getUser - me', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ email: testUser.email, name: testUser.name });
  expect(res.body.roles).toBeDefined();
});

test('getUser - unauthorized', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('updateUser - own profile', async () => {
  const newName = randomName();
  const res = await request(app)
    .put(`/api/user/${testUser.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: newName, email: testUser.email, password: testUser.password });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
  expectValidJwt(res.body.token);
});

test('updateUser - admin updating other user', async () => {
  const newName = randomName();
  const res = await request(app)
    .put(`/api/user/${testUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: newName, email: testUser.email, password: testUser.password });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
});

test('updateUser - unauthorized', async () => {
  const otherUser = { name: randomName(), email: randomName() + '@test.com', password: 'testpass' };
  const registerRes = await request(app).post('/api/auth').send(otherUser);
  const otherUserToken = registerRes.body.token;

  const res = await request(app)
    .put(`/api/user/${testUser.id}`)
    .set('Authorization', `Bearer ${otherUserToken}`)
    .send({ name: 'hacked', email: testUser.email });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('listUsers - not implemented', async () => {
  const res = await request(app).get('/api/user').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('not implemented');
});

test('deleteUser - not implemented', async () => {
  const res = await request(app).delete(`/api/user/${testUser.id}`).set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('not implemented');
});
