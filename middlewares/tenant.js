const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model');
const Tenant = require('../models/tenant.model');
const Local = require('../models/local.model');
const CheckoutSession = require('../models/checkoutSession.model');
const VentaCliente = require('../models/ventaCliente.model');
const Cliente = require('../models/Cliente');
const { getAuthPayloadFromRequest } = require('../utils/authToken');
const { runForTenant, runAsPlatform } = require('../utils/tenantContext');

const publicLocalId = (req) => {
  const path = req.path;
  if (req.method === 'GET' && /^\/api\/locales\/[a-f\d]{24}$/i.test(path)) {
    return path.split('/').pop();
  }
  if (req.method === 'GET' && (
    /^\/api\/productos(?:\/[a-f\d]{24})?$/i.test(path) ||
    /^\/api\/categorias(?:\/[a-f\d]{24})?$/i.test(path) ||
    path === '/api/agregados/opciones' || path === '/api/social-config/public'
  )) return req.headers['x-local-id'];
  if (req.method === 'POST' && ['/api/clientes/register', '/api/clientes/login'].includes(path)) {
    return req.headers['x-local-id'];
  }
  if (req.method === 'POST' && path === '/api/ventasCliente') return req.body?.local;
  if (req.method === 'POST' && path === '/api/pagos/crear-sesion') return req.body?.order?.local;
  return null;
};

const resolvePublicTenant = async (req) => {
  const localId = publicLocalId(req);
  if (localId) {
    if (!mongoose.Types.ObjectId.isValid(localId)) return null;
    const local = await runAsPlatform(async () => await Local.findById(localId).select('tenantId').lean());
    return local?.tenantId || null;
  }
  if (req.method === 'GET' && /^\/api\/ventasCliente\/public\/[a-f\d]{24}$/i.test(req.path)) {
    const order = await runAsPlatform(async () => await VentaCliente.findById(req.path.split('/').pop()).select('tenantId').lean());
    return order?.tenantId || null;
  }
  if (req.path === '/api/pagos/confirmar-sesion' && req.method === 'POST') {
    const token = req.body?.token_ws || req.body?.token || req.query?.token_ws || req.query?.token;
    if (!token || typeof token !== 'string') return null;
    const session = await runAsPlatform(async () => await CheckoutSession.findOne({ session_id: token }).select('tenantId').lean());
    return session?.tenantId || null;
  }
  return null;
};

const clientCanAccess = (req) => {
  const path = req.path;
  if (path === '/api/clientes/perfil' && ['GET', 'PUT'].includes(req.method)) return true;
  if (req.method === 'POST' && path === '/api/ventasCliente') return true;
  if (req.method === 'GET' && /^\/api\/ventasCliente(?:\/[a-f\d]{24})?$/i.test(path)) return true;
  if (req.method === 'POST' && ['/api/pagos/crear-sesion', '/api/pagos/confirmar-sesion'].includes(path)) return true;
  if (req.method === 'GET' && /^\/api\/ventasCliente\/public\/[a-f\d]{24}$/i.test(path)) return true;
  return Boolean(publicLocalId(req));
};

const tenantMiddleware = async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/auth/')) return next();
  if (req.path.startsWith('/api-docs')) return next();
  if (req.path === '/api/pagos/retorno-webpay') return next();

  try {
    const authHeader = req.headers.authorization;
    const payload = getAuthPayloadFromRequest(req);
    if (authHeader && !payload) return res.status(401).json({ error: 'Token invalido' });

    let tenantId;
    if (payload?.rol === 'platform_admin') {
      return res.status(403).json({ error: 'Usa el panel de plataforma' });
    }
    if (payload) {
      tenantId = payload.tenantId;
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(401).json({ error: 'Inicia sesion nuevamente' });
      }
      if (payload.rol === 'cliente') {
        if (!clientCanAccess(req)) return res.status(403).json({ error: 'Acceso de cliente no permitido' });
        const client = await runForTenant(tenantId, async () => await Cliente.exists({ _id: payload.id }));
        if (!client) return res.status(401).json({ error: 'Sesion de cliente invalida' });
      } else {
        const user = await runAsPlatform(async () => await Usuario.findById(payload.id).select('tenantId rol local tokenVersion').lean());
        if (!user || String(user.tenantId) !== String(tenantId) || user.rol !== payload.rol ||
            Number(user.tokenVersion || 0) !== Number(payload.ver || 0) ||
            (user.rol !== 'superadmin' && String(user.local || '') !== String(payload.localId || ''))) {
          return res.status(401).json({ error: 'Sesion invalida' });
        }
      }
      req.auth = payload;
    } else {
      tenantId = await resolvePublicTenant(req);
      if (!tenantId) return res.status(401).json({ error: 'Negocio o sesion requerido' });
    }

    const tenant = await Tenant.findById(tenantId).select('estado').lean();
    if (!tenant || tenant.estado !== 'activo') {
      return res.status(403).json({ error: 'Este negocio no esta activo' });
    }
    if (payload) {
      const localId = req.headers['x-local-id'] || payload.localId;
      if (localId) {
        if (!mongoose.Types.ObjectId.isValid(localId)) {
          return res.status(400).json({ error: 'Local invalido' });
        }
        const ownsLocal = await runForTenant(tenantId, async () => await Local.exists({ _id: localId }));
        if (!ownsLocal) return res.status(403).json({ error: 'Local de otro negocio' });
      }
    }
    req.tenantId = String(tenantId);
    return runForTenant(tenantId, next);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo validar el negocio' });
  }
};

module.exports = tenantMiddleware;
