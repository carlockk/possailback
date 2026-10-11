const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAcumuladorVentas } = require('../utils/ventaResumen');

test('mantiene el contrato del resumen para ventas POS y web', () => {
  const resumen = crearAcumuladorVentas();
  resumen.agregar({
    total: 900,
    pagos: [{ tipo: 'Efectivo', monto: 500 }, { tipo: 'Tarjeta', monto: 400 }],
    productos: [
      { productoId: 'p1', nombre: 'Café', cantidad: 2, precio_unitario: 300 },
      { nombre: 'Extra', cantidad: 1, precio_unitario: 100 }
    ]
  }, 'POS');
  resumen.agregar({
    total: 400,
    tipo_pago: 'Tarjeta',
    productos: [
      { productoId: 'p1', nombre: 'Café', cantidad: 1, precio_unitario: 300 },
      { nombre: 'Extra', cantidad: 1, precio_unitario: 100 }
    ]
  }, 'WEB');

  assert.deepEqual(resumen.obtenerProductoIds(), ['p1']);
  assert.deepEqual(resumen.finalizar(new Map([['p1', 'Bebidas']])), {
    total: 1300,
    cantidad: 2,
    porTipoPago: { 'Efectivo (POS)': 500, 'Tarjeta (POS)': 400, 'Tarjeta (WEB)': 400 },
    porTipoPagoDetallado: {
      POS: { Efectivo: 500, Tarjeta: 400 },
      WEB: { Tarjeta: 400 }
    },
    porTipoProducto: { Bebidas: 900, 'Sin categoria': 200 },
    porProducto: [
      { nombre: 'Café', cantidad: 3, total: 900 },
      { nombre: 'Extra', cantidad: 2, total: 200 }
    ],
    totalesPorCanal: {
      POS: { total: 900, cantidad: 1 },
      WEB: { total: 400, cantidad: 1 }
    }
  });
});

test('omite productos inválidos del desglose por producto y conserva totales', () => {
  const resumen = crearAcumuladorVentas();
  resumen.agregar({
    total: 0,
    tipo_pago: 'Otro',
    productos: [
      { nombre: 'Inválido', cantidad: 0, precio_unitario: 100 },
      { nombre: 'Descuento', cantidad: 1, precio_unitario: -10 }
    ]
  }, 'POS');

  assert.equal(resumen.finalizar().cantidad, 1);
  assert.deepEqual(resumen.finalizar().porProducto, []);
  assert.deepEqual(resumen.finalizar().porTipoProducto, {});
  assert.deepEqual(resumen.finalizar().porTipoPago, { 'Otro (POS)': 0 });
});
