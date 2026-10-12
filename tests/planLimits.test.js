const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PLAN_CONFIG, getPlanLimits, parsePlanConfig } = require('../utils/planLimits');

test('aplica cupos por rol, un propietario y precios de extras', () => {
  const inicio = getPlanLimits({ plan: 'inicio' }, DEFAULT_PLAN_CONFIG);
  assert.equal(inicio.maxUsuarios, 7);
  assert.deepEqual(inicio.cuposPorRol, { admin: 1, cajero: 2, mesero: 2, repartidor: 1 });
  const pro = getPlanLimits({ plan: 'pro', localesAdicionales: 2,
    usuariosExtra: { admin: 1, cajero: 0, mesero: 0, repartidor: 1 } }, DEFAULT_PLAN_CONFIG);
  assert.equal(pro.maxLocales, 4);
  assert.equal(pro.maxUsuarios, 15);
  assert.equal(pro.precioMensual, 20950);
  assert.deepEqual(pro.cuposPorRol, { admin: 3, cajero: 4, mesero: 4, repartidor: 3 });
});

test('conserva sin límites los negocios anteriores', () => {
  const limits = getPlanLimits({ plan: 'gratis' }, DEFAULT_PLAN_CONFIG);
  assert.equal(limits.maxLocales, null);
  assert.equal(limits.maxUsuarios, null);
  assert.equal(limits.cuposPorRol, null);
});

test('rechaza precios y cupos inválidos del administrador global', () => {
  assert.deepEqual(parsePlanConfig(DEFAULT_PLAN_CONFIG), DEFAULT_PLAN_CONFIG);
  assert.equal(parsePlanConfig({ ...DEFAULT_PLAN_CONFIG, inicio: { ...DEFAULT_PLAN_CONFIG.inicio, cuposPorRol: { ...DEFAULT_PLAN_CONFIG.inicio.cuposPorRol, cajero: -1 } } }), null);
  assert.equal(parsePlanConfig({ ...DEFAULT_PLAN_CONFIG, localAdicional: { ...DEFAULT_PLAN_CONFIG.localAdicional, precioMensual: -1 } }), null);
});
