// Prueba de integración aislada. Solo usa una base temporal con prefijo possail_saas_test_.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { runAsPlatform, runForTenant } = require('../utils/tenantContext');
const Usuario = require('../models/usuario.model');
const Categoria = require('../models/categoria.model');

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const databaseName = `possail_saas_test_${crypto.randomBytes(4).toString('hex')}`;
process.env.MONGO_DB_NAME = databaseName;
process.env.PORT = '5077';
process.env.BOOTSTRAP_SUPERADMIN = 'false';
require('../server');

const base = 'http://127.0.0.1:5077/api';
const request = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};

const run = async () => {
  while (mongoose.connection.readyState !== 1) await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(mongoose.connection.name, databaseName);
  const password = `Test-${crypto.randomBytes(12).toString('hex')}`;
  const a = await request('/auth/register', { method: 'POST', body: { negocio: 'Negocio de prueba', nombre: 'Dueño A', email: 'saas-test-a@example.com', password } });
  const b = await request('/auth/register', { method: 'POST', body: { negocio: 'Negocio de prueba', nombre: 'Dueño B', email: 'saas-test-b@example.com', password } });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.notEqual(a.data.tenantId, b.data.tenantId);
  const aLogin = await request('/auth/login', { method: 'POST', body: { email: 'saas-test-a@example.com', password } });
  assert.equal(aLogin.status, 200, JSON.stringify(aLogin.data));
  assert.equal(String(aLogin.data.tenantId), String(a.data.tenantId));

  const localA = await request('/locales', { token: a.data.token, method: 'POST', body: { nombre: 'Sucursal Central' } });
  const localB = await request('/locales', { token: b.data.token, method: 'POST', body: { nombre: 'Sucursal Central' } });
  assert.equal(localA.status, 201, JSON.stringify(localA.data));
  assert.equal(localB.status, 201, JSON.stringify(localB.data));
  const aLocales = await request('/locales', { token: a.data.token });
  const bLocales = await request('/locales', { token: b.data.token });
  assert.deepEqual(aLocales.data.map((local) => local._id), [localA.data._id]);
  assert.deepEqual(bLocales.data.map((local) => local._id), [localB.data._id]);
  assert.equal((await request(`/locales/${localB.data._id}`, { token: a.data.token })).status, 404);
  assert.equal((await request('/locales')).status, 401);
  assert.equal((await request('/usuarios', { headers: { 'x-local-id': localA.data._id, 'x-user-role': 'superadmin' } })).status, 401);

  const categories = await runForTenant(a.data.tenantId, async () => await Categoria.insertMany([
    { nombre: 'Categoria A', local: localA.data._id },
    { nombre: 'Categoria B', local: localA.data._id }
  ]));
  assert.equal(categories.length, 2);
  assert.equal((await runForTenant(b.data.tenantId, async () => await Categoria.find().lean())).length, 0);
  assert.equal((await runForTenant(a.data.tenantId, async () => await Categoria.aggregate([{ $count: 'total' }])))[0].total, 2);
  const publicCategoriesA = await request('/categorias', { headers: { 'x-local-id': localA.data._id } });
  const publicCategoriesB = await request('/categorias', { headers: { 'x-local-id': localB.data._id } });
  assert.equal(publicCategoriesA.status, 200, JSON.stringify(publicCategoriesA.data));
  assert.deepEqual(publicCategoriesA.data.map((item) => item.nombre).sort(), ['Categoria A', 'Categoria B']);
  assert.deepEqual(publicCategoriesB.data, []);
  const customer = await request('/clientes/register', {
    method: 'POST', headers: { 'x-local-id': localA.data._id },
    body: { nombre: 'Cliente de prueba', email: 'customer@example.com', password }
  });
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  assert.equal((await request('/usuarios', { token: customer.data.token })).status, 403);
  assert.equal((await request('/clientes/todos', { token: customer.data.token, headers: { 'x-local-id': localA.data._id } })).status, 403);
  assert.equal((await request('/categorias', { token: customer.data.token, headers: { 'x-local-id': localB.data._id } })).status, 403);
  const crossUpdate = await runForTenant(b.data.tenantId, async () => await Categoria.updateOne({ _id: categories[0]._id }, { nombre: 'Cambiada' }));
  assert.equal(crossUpdate.matchedCount, 0);

  const aUsers = await request('/usuarios', { token: a.data.token });
  const bUsers = await request('/usuarios', { token: b.data.token });
  assert.deepEqual(aUsers.data.map((user) => user.email), ['saas-test-a@example.com']);
  assert.deepEqual(bUsers.data.map((user) => user.email), ['saas-test-b@example.com']);
  const crossUser = await request('/usuarios', { token: a.data.token, method: 'POST', body: { nombre: 'Cruce', email: 'cross@example.com', password, rol: 'cajero', local: localB.data._id } });
  assert.equal(crossUser.status, 400);

  await runAsPlatform(() => Usuario.create({ nombre: 'Plataforma', email: 'platform-test@example.com', password: bcrypt.hashSync(password, 10), rol: 'platform_admin' }));
  const admin = await request('/auth/login', { method: 'POST', body: { email: 'platform-test@example.com', password } });
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
  const summary = await request('/plataforma/resumen', { token: admin.data.token });
  assert.equal(summary.status, 200, JSON.stringify(summary.data));
  assert.equal(summary.data.totalNegocios, 2);
  const detail = await request(`/plataforma/negocios/${a.data.tenantId}`, { token: admin.data.token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.users.length, 1);
  assert.equal((await request('/plataforma/resumen', { token: a.data.token })).status, 403);
  assert.equal((await request('/locales', { token: admin.data.token })).status, 403);

  const suspended = await request(`/plataforma/negocios/${b.data.tenantId}/estado`, { token: admin.data.token, method: 'PATCH', body: { estado: 'suspendido' } });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.data));
  assert.equal((await request('/locales', { token: b.data.token })).status, 403);
  console.log('SaaS: registro, aislamiento entre negocios, panel y suspensión correctos');
};

run().then(async () => {
  if (mongoose.connection.name !== databaseName) throw new Error('Base de prueba inesperada');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
}).catch(async (error) => {
  console.error('Prueba SaaS falló:', error.message);
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) {
    await mongoose.connection.db.dropDatabase().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(1);
});
