const test = require('node:test');
const assert = require('node:assert/strict');
const { getModules, parseModules } = require('../utils/modules');
const { requireModule } = require('../middlewares/moduleAccess');

test('conserva los módulos activos en negocios antiguos y respeta cambios explícitos', () => {
  assert.deepEqual(getModules({}), { agregados: true, restaurante: true, pedidosWeb: true });
  assert.deepEqual(getModules({ modulos: { agregados: false, restaurante: true, pedidosWeb: false } }),
    { agregados: false, restaurante: true, pedidosWeb: false });
});

test('acepta únicamente los tres interruptores booleanos', () => {
  const valid = { agregados: false, restaurante: true, pedidosWeb: false };
  assert.deepEqual(parseModules(valid), valid);
  assert.equal(parseModules({ agregados: true }), null);
  assert.equal(parseModules({ ...valid, otro: true }), null);
  assert.equal(parseModules({ ...valid, pedidosWeb: 'true' }), null);
});

test('bloquea el acceso a una ruta de un módulo desactivado', () => {
  let status;
  let nextCalled = false;
  const response = {
    status(code) { status = code; return this; },
    json(body) { return body; }
  };
  const guard = requireModule('restaurante');
  const body = guard({ modulos: { restaurante: false } }, response, () => { nextCalled = true; });
  assert.equal(status, 403);
  assert.match(body.error, /Restaurante/);
  assert.equal(nextCalled, false);
  guard({ modulos: { restaurante: true } }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
