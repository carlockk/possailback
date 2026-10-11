const { sanitizeOptionalText } = require('./input');

const crearAcumuladorVentas = () => {
  const totalesPorCanal = {
    POS: { total: 0, cantidad: 0 },
    WEB: { total: 0, cantidad: 0 }
  };
  const porTipoPago = {};
  const porTipoPagoDetallado = { POS: {}, WEB: {} };
  const productos = new Map();
  const subtotalesPorProductoId = new Map();
  let subtotalSinProductoId = 0;

  const agregar = (venta, canal) => {
    totalesPorCanal[canal].total += Number(venta.total) || 0;
    totalesPorCanal[canal].cantidad += 1;

    const pagos = Array.isArray(venta.pagos) && venta.pagos.length > 0
      ? venta.pagos.map((pago) => ({
          tipo: pago?.tipo || 'Otro',
          monto: Number(pago?.monto) || 0
        })).filter((pago) => pago.monto > 0)
      : [{ tipo: venta.tipo_pago || 'Otro', monto: Number(venta.total) || 0 }];

    pagos.forEach(({ tipo, monto }) => {
      const llave = `${tipo} (${canal})`;
      porTipoPago[llave] = (porTipoPago[llave] || 0) + monto;
      porTipoPagoDetallado[canal][tipo] = (porTipoPagoDetallado[canal][tipo] || 0) + monto;
    });

    venta.productos?.forEach((item) => {
      const precio = Number(item?.precio_unitario) || 0;
      const cantidad = Number(item?.cantidad) || 0;
      const subtotal = precio * cantidad;
      if (subtotal > 0) {
        const productoId = item?.productoId?.toString();
        if (productoId) {
          subtotalesPorProductoId.set(
            productoId,
            (subtotalesPorProductoId.get(productoId) || 0) + subtotal
          );
        } else {
          subtotalSinProductoId += subtotal;
        }
      }

      const nombreBase = item?.nombre || 'Producto sin nombre';
      const atributos = Array.isArray(item?.atributos) ? item.atributos : [];
      const detalleAtributos = atributos
        .map((atributo) => {
          const nombre = sanitizeOptionalText(atributo?.nombre, { max: 30 }) || '';
          const valor = sanitizeOptionalText(atributo?.valor, { max: 60 }) || '';
          return nombre && valor ? `${nombre}: ${valor}` : null;
        })
        .filter(Boolean);
      const varianteNombre = sanitizeOptionalText(item?.varianteNombre, { max: 80 }) || '';
      const detalle = detalleAtributos.length > 0
        ? detalleAtributos.join(' | ')
        : varianteNombre;
      const nombre = detalle ? `${nombreBase} (${detalle})` : nombreBase;
      if (cantidad <= 0 || precio < 0) return;

      const actual = productos.get(nombre) || { nombre, cantidad: 0, total: 0 };
      actual.cantidad += cantidad;
      actual.total += subtotal;
      productos.set(nombre, actual);
    });
  };

  const finalizar = (categoriaPorProducto = new Map()) => {
    const porTipoProducto = {};
    for (const [productoId, subtotal] of subtotalesPorProductoId) {
      const categoria = categoriaPorProducto.get(productoId) || 'Sin categoria';
      porTipoProducto[categoria] = (porTipoProducto[categoria] || 0) + subtotal;
    }
    if (subtotalSinProductoId > 0) {
      porTipoProducto['Sin categoria'] =
        (porTipoProducto['Sin categoria'] || 0) + subtotalSinProductoId;
    }

    return {
      total: totalesPorCanal.POS.total + totalesPorCanal.WEB.total,
      cantidad: totalesPorCanal.POS.cantidad + totalesPorCanal.WEB.cantidad,
      porTipoPago,
      porTipoPagoDetallado,
      porTipoProducto,
      porProducto: [...productos.values()].sort((a, b) => b.total - a.total),
      totalesPorCanal
    };
  };

  return { agregar, finalizar, obtenerProductoIds: () => [...subtotalesPorProductoId.keys()] };
};

module.exports = { crearAcumuladorVentas };
