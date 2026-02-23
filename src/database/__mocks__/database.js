const { Role } = require('../../model/model.js');

/**
 * In-memory DB mock for Jest tests.
 * This lets endpoint tests run without a real MySQL instance.
 */
function randomId() {
  return Math.floor(Math.random() * 1_000_000_000);
}

const state = {
  usersById: new Map(),
  usersByEmail: new Map(),
  loggedInTokens: new Map(), // token -> userId
  menu: [{ id: 1, title: 'Veggie', description: 'A garden of delight', image: 'pizza1.png', price: 0.0038 }],
  franchisesById: new Map(),
  storesById: new Map(), // storeId -> {id, franchiseId, name}
  userFranchiseIds: new Map(), // adminUserId -> Set(franchiseId)
  ordersByUserId: new Map(), // dinerId -> [{...}]
};

function attachUserHelpers(user) {
  return {
    ...user,
    isRole: (role) => !!user.roles?.find((r) => r.role === role),
  };
}

function sanitizeUser(user) {
  if (!user) return user;
  const clone = { ...user };
  delete clone.password;
  return clone;
}

const DB = {
  // Auth
  async addUser(user) {
    const id = randomId();
    const full = { id, ...user };
    state.usersById.set(id, full);
    state.usersByEmail.set(full.email, full);
    return sanitizeUser(full);
  },

  async getUser(email, password) {
    const user = state.usersByEmail.get(email);
    if (!user || user.password !== password) {
      throw new Error('invalid credentials');
    }
    return sanitizeUser(user);
  },

  async loginUser(userId, token) {
    state.loggedInTokens.set(token, userId);
  },

  async logoutUser(token) {
    state.loggedInTokens.delete(token);
  },

  async isLoggedIn(token) {
    return state.loggedInTokens.has(token);
  },

  // User
  async listUsers(_authUser, page = 0, limit = 10, nameFilter = '*') {
    let all = Array.from(state.usersById.values()).map((u) => sanitizeUser(u));
    if (nameFilter && nameFilter !== '*') {
      const pattern = nameFilter.replace(/\*/g, '.*');
      const re = new RegExp(pattern, 'i');
      all = all.filter((u) => re.test(u.name || '') || re.test(u.email || ''));
    }
    const start = Number(page) * Number(limit) || 0;
    const end = start + (Number(limit) || 10);
    const slice = all.slice(start, end);
    const more = all.length > end;
    return [slice, more];
  },

  async deleteUser(userId) {
    const existing = state.usersById.get(userId);
    if (existing?.email) state.usersByEmail.delete(existing.email);
    state.usersById.delete(userId);
    const tokensToRemove = [...state.loggedInTokens.entries()].filter(([, uid]) => uid === userId).map(([t]) => t);
    tokensToRemove.forEach((t) => state.loggedInTokens.delete(t));
  },

  async updateUser(userId, name, email, password) {
    const existing = state.usersById.get(userId);
    if (!existing) throw new Error('user not found');
    const updated = { ...existing };
    if (name) updated.name = name;
    if (email) updated.email = email;
    if (password) updated.password = password;
    state.usersById.set(userId, updated);
    state.usersByEmail.set(updated.email, updated);
    return sanitizeUser(updated);
  },

  // Menu / Orders
  async getMenu() {
    return state.menu.slice();
  },

  async addMenuItem(item) {
    const id = randomId();
    const added = { id, ...item };
    state.menu.push(added);
    return added;
  },

  async getOrders(user, page = 0) {
    const orders = state.ordersByUserId.get(user.id) ?? [];
    return { dinerId: user.id, orders, page: Number(page) || 0 };
  },

  async addDinerOrder(user, orderReq) {
    const id = randomId();
    const order = { id, ...orderReq, date: new Date().toISOString() };
    const existing = state.ordersByUserId.get(user.id) ?? [];
    existing.push(order);
    state.ordersByUserId.set(user.id, existing);
    return order;
  },

  // Franchises / Stores
  async getFranchises(_user, page = 0, limit = 10, name = '') {
    const all = Array.from(state.franchisesById.values());
    const filtered = name ? all.filter((f) => (f.name ?? '').includes(name)) : all;
    const start = Number(page) || 0;
    const end = start + (Number(limit) || 10);
    const slice = filtered.slice(start, end);
    const more = end < filtered.length;
    return [slice, more];
  },

  async getUserFranchises(userId) {
    const ids = state.userFranchiseIds.get(userId);
    if (!ids) return [];
    return Array.from(ids).map((id) => state.franchisesById.get(id)).filter(Boolean);
  },

  async getFranchise({ id }) {
    return state.franchisesById.get(id) ?? null;
  },

  async createFranchise(franchise) {
    const id = randomId();
    const admins = (franchise.admins ?? [])
      .map((a) => state.usersByEmail.get(a.email))
      .filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, email: u.email }));
    const created = { id, name: franchise.name, admins, stores: [] };
    state.franchisesById.set(id, created);
    for (const a of admins) {
      const set = state.userFranchiseIds.get(a.id) ?? new Set();
      set.add(id);
      state.userFranchiseIds.set(a.id, set);
    }
    return created;
  },

  async deleteFranchise(franchiseId) {
    state.franchisesById.delete(franchiseId);
  },

  async createStore(franchiseId, store) {
    const id = randomId();
    const created = { id, name: store.name, totalRevenue: 0 };
    const franchise = state.franchisesById.get(franchiseId);
    if (franchise) {
      franchise.stores = franchise.stores ?? [];
      franchise.stores.push(created);
      state.franchisesById.set(franchiseId, franchise);
    }
    state.storesById.set(id, { id, franchiseId, name: store.name });
    return created;
  },

  async deleteStore(franchiseId, storeId) {
    const franchise = state.franchisesById.get(franchiseId);
    if (franchise?.stores) {
      franchise.stores = franchise.stores.filter((s) => s.id !== storeId);
      state.franchisesById.set(franchiseId, franchise);
    }
    state.storesById.delete(storeId);
  },
};

module.exports = {
  Role,
  DB,
  // Helpful for white-box assertions if needed later
  __state: state,
  __attachUserHelpers: attachUserHelpers,
};

