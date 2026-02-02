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
let testFranchise;

beforeAll(async () => {
  testUser = { name: randomName(), email: randomName() + '@test.com', password: 'testpass' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

test('getFranchises', async () => {
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('franchises');
  expect(res.body).toHaveProperty('more');
  expect(Array.isArray(res.body.franchises)).toBe(true);
});

test('getFranchises - with query params', async () => {
  const res = await request(app).get('/api/franchise?page=0&limit=5');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('franchises');
  expect(res.body).toHaveProperty('more');
});

test('createFranchise - admin', async () => {
  const franchiseName = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe(franchiseName);
  expect(res.body.admins).toBeDefined();
  testFranchise = res.body;
});

test('createFranchise - unauthorized', async () => {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: randomName(), admins: [] });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a franchise');
});

test('createFranchise - no auth', async () => {
  const res = await request(app).post('/api/franchise').send({ name: randomName(), admins: [] });
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('getUserFranchises - own franchises', async () => {
  if (!testFranchise) {
    // Create a franchise first if it doesn't exist
    const franchiseName = randomName();
    const createRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
    testFranchise = createRes.body;
  }

  const res = await request(app)
    .get(`/api/franchise/${adminUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('getUserFranchises - admin viewing other user', async () => {
  const res = await request(app)
    .get(`/api/franchise/${testUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('getUserFranchises - unauthorized', async () => {
  const res = await request(app)
    .get(`/api/franchise/${adminUser.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(0);
});

test('deleteFranchise', async () => {
  // Create a franchise to delete
  const franchiseName = randomName();
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
  const franchiseToDelete = createRes.body;

  const res = await request(app).delete(`/api/franchise/${franchiseToDelete.id}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});

test('createStore - admin', async () => {
  if (!testFranchise) {
    const franchiseName = randomName();
    const createRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
    testFranchise = createRes.body;
  }

  const storeName = randomName();
  const res = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: storeName });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe(storeName);
  expect(res.body).toHaveProperty('id');
});

test('createStore - unauthorized', async () => {
  if (!testFranchise) {
    const franchiseName = randomName();
    const createRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
    testFranchise = createRes.body;
  }

  const res = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: randomName() });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a store');
});

test('deleteStore - admin', async () => {
  if (!testFranchise) {
    const franchiseName = randomName();
    const createRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
    testFranchise = createRes.body;
  }

  // Create a store to delete
  const storeName = randomName();
  const createStoreRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: storeName });
  const storeToDelete = createStoreRes.body;

  const res = await request(app)
    .delete(`/api/franchise/${testFranchise.id}/store/${storeToDelete.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('store deleted');
});

test('deleteStore - unauthorized', async () => {
  if (!testFranchise) {
    const franchiseName = randomName();
    const createRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
    testFranchise = createRes.body;
  }

  // Create a store
  const storeName = randomName();
  const createStoreRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: storeName });
  const storeToDelete = createStoreRes.body;

  const res = await request(app)
    .delete(`/api/franchise/${testFranchise.id}/store/${storeToDelete.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete a store');
});

test('createStore - invalid franchise', async () => {
  const res = await request(app)
    .post('/api/franchise/99999/store')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName() });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a store');
});

test('deleteStore - invalid franchise', async () => {
  const res = await request(app)
    .delete('/api/franchise/99999/store/1')
    .set('Authorization', `Bearer ${adminAuthToken}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete a store');
});

test('getFranchises - with name filter', async () => {
  const franchiseName = randomName();
  await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: franchiseName, admins: [{ email: adminUser.email }] });

  const res = await request(app).get(`/api/franchise?name=${franchiseName}`);
  expect(res.status).toBe(200);
  expect(res.body.franchises.some((f) => f.name === franchiseName)).toBe(true);
});
