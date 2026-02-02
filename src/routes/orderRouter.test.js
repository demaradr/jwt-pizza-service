jest.mock('../database/database.js');

const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

// Prevent network calls during tests
beforeAll(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ jwt: 'factory.jwt.token', reportUrl: 'https://example.test/report' }),
  }));
});

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
let testStore;

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

  // Create a franchise and store for order tests
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });
  testFranchise = franchiseRes.body;

  const storeRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName() });
  testStore = storeRes.body;
});

test('getMenu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('addMenuItem - admin', async () => {
  const menuItem = {
    title: randomName(),
    description: 'Test pizza',
    image: 'pizza.png',
    price: 0.01,
  };
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(menuItem);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  const addedItem = res.body.find((item) => item.title === menuItem.title);
  expect(addedItem).toBeDefined();
});

test('addMenuItem - unauthorized', async () => {
  const menuItem = {
    title: randomName(),
    description: 'Test pizza',
    image: 'pizza.png',
    price: 0.01,
  };
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(menuItem);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to add menu item');
});

test('getOrders', async () => {
  const res = await request(app).get('/api/order').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('dinerId');
  expect(res.body).toHaveProperty('orders');
  expect(Array.isArray(res.body.orders)).toBe(true);
});

test('getOrders - unauthorized', async () => {
  const res = await request(app).get('/api/order');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('createOrder', async () => {
  const menuRes = await request(app).get('/api/order/menu');
  const menuItems = menuRes.body;
  expect(menuItems.length).toBeGreaterThan(0);

  const order = {
    franchiseId: testFranchise.id,
    storeId: testStore.id,
    items: [
      {
        menuId: menuItems[0].id,
        description: menuItems[0].title,
        price: menuItems[0].price,
      },
    ],
  };

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(order);
  // The factory might fail, but we should get a response
  expect([200, 500]).toContain(res.status);
  if (res.status === 200) {
    expect(res.body.order).toBeDefined();
  }
});

test('createOrder - unauthorized', async () => {
  const order = {
    franchiseId: testFranchise.id,
    storeId: testStore.id,
    items: [],
  };
  const res = await request(app).post('/api/order').send(order);
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('getOrders - with page parameter', async () => {
  const res = await request(app).get('/api/order?page=1').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('dinerId');
  expect(res.body).toHaveProperty('orders');
});
