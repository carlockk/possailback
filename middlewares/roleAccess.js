const normalizarRol = (rol) =>
  typeof rol === 'string' ? rol.trim().toLowerCase() : '';
const { getAuthPayloadFromRequest } = require('../utils/authToken');

const restringirMesero = (req, res, next) => {
  const payload = getAuthPayloadFromRequest(req);
  if (payload) {
    req.auth = payload;
  }

  const allowLegacyHeaders = process.env.ALLOW_LEGACY_SCOPE_HEADERS === 'true';
  const rol = payload
    ? normalizarRol(payload.rol)
    : (allowLegacyHeaders ? normalizarRol(req.headers['x-user-role']) : '');

  if (rol !== 'mesero') {
    return next();
  }

  const path = req.path || '';
  const permitido =
    path.startsWith('/api/restaurante') ||
    path === '/api/auth/login' ||
    path === '/health' ||
    path === '/';

  if (!permitido) {
    return res.status(403).json({ error: 'Acceso restringido para rol mesero' });
  }

  return next();
};

module.exports = {
  restringirMesero
};
