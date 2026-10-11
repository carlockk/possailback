const MODULE_NAMES = {
  agregados: 'Agregados',
  restaurante: 'Restaurante',
  pedidosWeb: 'Pedidos Web'
};

const requireModule = (key) => (req, res, next) => {
  if (req.modulos?.[key]) return next();
  return res.status(403).json({ error: `El módulo ${MODULE_NAMES[key]} no está habilitado para este negocio` });
};

module.exports = { requireModule };
