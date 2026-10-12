const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model.js');
const Tenant = require('../models/tenant.model.js');
const { runAsPlatform, runForTenant } = require('../utils/tenantContext');
const { sanitizeText } = require('../utils/input');
const { normalizeEmail, isValidEmail } = require('../utils/input');
const { signUserToken } = require('../utils/authToken');
const { getAuthPayloadFromRequest } = require('../utils/authToken');
const { authRateLimit } = require('../utils/authRateLimit');
const { validPassword } = require('../utils/passwordPolicy');
const deleteTenantData = require('../utils/deleteTenantData');
const RestauranteComanda = require('../models/restauranteComanda.model');
const VentaCliente = require('../models/ventaCliente.model');
const CheckoutSession = require('../models/checkoutSession.model');
const { getModules, parseModules } = require('../utils/modules');
const Local = require('../models/local.model');
const { STAFF_ROLES, getPlanConfig, getPlanLimits } = require('../utils/planLimits');

const router = express.Router();
router.use((_req, _res, next) => runAsPlatform(next));
router.get('/planes', async (_req, res) => {
  try {
    return res.json(await getPlanConfig());
  } catch {
    return res.status(500).json({ error: 'No se pudieron cargar los planes' });
  }
});
router.post('/register', authRateLimit({ scope: 'tenant-register', ipLimit: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const nombre = sanitizeText(req.body?.nombre, { max: 80 });
  const negocio = sanitizeText(req.body?.negocio, { max: 100 });
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const plan = req.body?.plan === undefined ? 'inicio' : req.body.plan;
  const modulos = req.body?.modulos === undefined
    ? { agregados: false, restaurante: false, pedidosWeb: false }
    : parseModules(req.body.modulos);
  if (!modulos) return res.status(400).json({ error: 'Seleccion de modulos invalida' });
  if (!['inicio', 'pro'].includes(plan)) return res.status(400).json({ error: 'Plan invalido' });
  if (!nombre || !negocio || !isValidEmail(email) || !validPassword(password)) {
    return res.status(400).json({ error: 'Completa nombre, negocio, correo y contraseña de 12 a 72 bytes' });
  }

  let tenant;
  let usuario;
  const session = await mongoose.startSession();
  try {
    const base = negocio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'negocio';
    const passwordHash = await bcrypt.hash(password, 12);
    await session.withTransaction(async () => {
      if (await Usuario.exists({ email }).session(session)) {
        const duplicate = new Error('Correo ya registrado');
        duplicate.code = 11000;
        throw duplicate;
      }
      tenant = new Tenant({
        nombre: negocio,
        slug: `${base}-${require('node:crypto').randomBytes(4).toString('hex')}`,
        plan,
        modulos
      });
      await tenant.save({ session });
      usuario = new Usuario({
        nombre, email, password: passwordHash,
        rol: 'superadmin', tenantId: tenant._id, local: null
      });
      await usuario.save({ session });
      tenant.ownerUser = usuario._id;
      await tenant.save({ session });
    });
    return res.status(201).json({
      token: signUserToken(usuario),
      _id: usuario._id, email: usuario.email, nombre: usuario.nombre,
      rol: usuario.rol, tenantId: tenant._id, negocio: tenant.nombre, local: null,
      modulos: getModules(tenant)
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'El correo ya está registrado' });
    return res.status(500).json({ error: 'No se pudo crear la cuenta' });
  } finally {
    await session.endSession();
  }
});

/**
 * @swagger
 * tags:
 *   name: Autenticación
 *   description: Endpoints para login de usuarios
 */

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión de usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@ejemplo.com
 *               password:
 *                 type: string
 *                 example: 123456
 *     responses:
 *       200:
 *         description: Usuario autenticado correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 nombre:
 *                   type: string
 *                 rol:
 *                   type: string
 *       401:
 *         description: Usuario no encontrado o contraseña incorrecta
 */
router.post('/login', authRateLimit({
  scope: 'user-login', ipLimit: 30, emailLimit: 10, windowMs: 15 * 60 * 1000,
  emailFromRequest: (req) => normalizeEmail(req.body?.email)
}), async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Credenciales invalidas' });
  }

  const usuario = await Usuario.findOne({ email });
  if (!usuario) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const match = typeof usuario.password === 'string' && usuario.password.startsWith('$2')
    && await bcrypt.compare(password, usuario.password);
  if (!match) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  let tenant = null;
  if (usuario.rol !== 'platform_admin') {
    if (!usuario.tenantId) {
      return res.status(403).json({ error: 'La cuenta no tiene un negocio asignado' });
    }
    tenant = await Tenant.findById(usuario.tenantId);
    if (!tenant || tenant.estado !== 'activo') {
      return res.status(403).json({ error: 'Este negocio no está activo' });
    }
    const modulosActivos = getModules(tenant);
    if (usuario.rol === 'mesero' && !modulosActivos.restaurante) {
      return res.status(403).json({ error: 'Restaurante no está habilitado para este negocio' });
    }
    if (usuario.rol === 'repartidor' && !modulosActivos.pedidosWeb) {
      return res.status(403).json({ error: 'Pedidos Web no está habilitado para este negocio' });
    }
    if (usuario.local) {
      await runForTenant(usuario.tenantId, async () => await usuario.populate('local', 'nombre direccion telefono correo'));
      if (!usuario.local) return res.status(403).json({ error: 'Local no disponible para este negocio' });
    }
  }

  const token = signUserToken(usuario);

  res.json({
    token,
    _id: usuario._id,
    email: usuario.email,
    nombre: usuario.nombre || '',
    rol: usuario.rol,
    tenantId: usuario.tenantId || null,
    negocio: tenant?.nombre || null,
    modulos: tenant ? getModules(tenant) : null,
    local: usuario.local
      ? {
          _id: usuario.local._id,
          nombre: usuario.local.nombre || '',
          direccion: usuario.local.direccion || '',
          telefono: usuario.local.telefono || '',
          correo: usuario.local.correo || ''
        }
      : null
  });
});

const getTenantSession = async (req) => {
  const payload = getAuthPayloadFromRequest(req);
  if (!payload || payload.rol === 'cliente' || payload.rol === 'platform_admin' ||
      !mongoose.Types.ObjectId.isValid(payload.tenantId)) return null;
  const user = await Usuario.findOne({
    _id: payload.id,
    tenantId: payload.tenantId,
    rol: payload.rol
  }).select('rol tenantId tokenVersion');
  if (!user || Number(user.tokenVersion || 0) !== Number(payload.ver || 0)) return null;
  const tenant = await Tenant.findById(payload.tenantId);
  if (!tenant || tenant.estado !== 'activo') return null;
  return { user, tenant };
};

router.get('/modulos', async (req, res) => {
  try {
    const session = await getTenantSession(req);
    if (!session) return res.status(401).json({ error: 'Sesion invalida' });
    return res.json({ modulos: getModules(session.tenant) });
  } catch {
    return res.status(500).json({ error: 'No se pudieron cargar los modulos' });
  }
});

router.get('/plan', async (req, res) => {
  try {
    const session = await getTenantSession(req);
    if (!session) return res.status(401).json({ error: 'Sesion invalida' });
    const config = await getPlanConfig();
    const [usuarios, locales, counts] = await Promise.all([
      Usuario.countDocuments({ tenantId: session.tenant._id }),
      Local.countDocuments({ tenantId: session.tenant._id }),
      Promise.all(STAFF_ROLES.map((rol) => Usuario.countDocuments({ tenantId: session.tenant._id, rol }))),
    ]);
    const usuariosPorRol = Object.fromEntries(STAFF_ROLES.map((rol, index) => [rol, counts[index]]));
    return res.json({ ...getPlanLimits(session.tenant, config), usuarios, usuariosPorRol, locales,
      precioUsuarioExtra: config.precioUsuarioExtra, billingStatus: session.tenant.billingStatus });
  } catch {
    return res.status(500).json({ error: 'No se pudo cargar el plan' });
  }
});

router.put('/modulos', async (req, res) => {
  const modulos = parseModules(req.body?.modulos);
  if (!modulos) return res.status(400).json({ error: 'Seleccion de modulos invalida' });
  try {
    const session = await getTenantSession(req);
    if (!session) return res.status(401).json({ error: 'Sesion invalida' });
    const { user, tenant } = session;
    if (user.rol !== 'superadmin' || String(tenant.ownerUser) !== String(user._id)) {
      return res.status(403).json({ error: 'Solo el propietario puede cambiar los modulos' });
    }

    const actuales = getModules(tenant);
    if (actuales.restaurante && !modulos.restaurante) {
      const abierta = await runForTenant(tenant._id, () => RestauranteComanda.exists({
        estado: { $nin: ['cerrada', 'cancelada'] }
      }));
      if (abierta) return res.status(409).json({ error: 'Cierra las comandas pendientes antes de desactivar Restaurante' });
    }
    if (actuales.pedidosWeb && !modulos.pedidosWeb) {
      const pagoPendiente = await runForTenant(tenant._id, () => CheckoutSession.exists({
        estado: 'pendiente_pago', createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }));
      if (pagoPendiente) return res.status(409).json({ error: 'Hay pagos web pendientes. Resuélvelos antes de desactivar Pedidos Web' });
      const abierto = await runForTenant(tenant._id, () => VentaCliente.exists({
        estado_pedido: { $nin: [/^entregado$/i, /^rechazado$/i, /^cancelado$/i] }
      }));
      if (abierto) return res.status(409).json({ error: 'Resuelve los pedidos pendientes antes de desactivar Pedidos Web' });
    }

    tenant.modulos = modulos;
    await tenant.save();
    return res.json({ modulos: getModules(tenant) });
  } catch {
    return res.status(500).json({ error: 'No se pudieron guardar los modulos' });
  }
});

router.post('/password', authRateLimit({ scope: 'password-change', ipLimit: 10, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const payload = getAuthPayloadFromRequest(req);
  if (!payload || payload.rol === 'cliente') return res.status(401).json({ error: 'Sesión inválida' });
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = req.body?.newPassword;
  if (!currentPassword || !validPassword(newPassword) || currentPassword === newPassword) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente y tener entre 12 y 72 bytes' });
  }
  const user = await Usuario.findById(payload.id);
  if (!user || user.rol !== payload.rol || Number(user.tokenVersion || 0) !== Number(payload.ver || 0)) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  if (!await bcrypt.compare(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const changed = await Usuario.findOneAndUpdate(
    { _id: user._id, password: user.password },
    { $set: { password: passwordHash }, $inc: { tokenVersion: 1 } }
  );
  if (!changed) return res.status(409).json({ error: 'La contraseña cambió. Inicia sesión nuevamente.' });
  return res.json({ message: 'Contraseña actualizada. Inicia sesión nuevamente.' });
});

router.delete('/cuenta', authRateLimit({ scope: 'account-delete', ipLimit: 10, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const payload = getAuthPayloadFromRequest(req);
  if (!payload || payload.rol !== 'superadmin' || !mongoose.Types.ObjectId.isValid(payload.tenantId)) {
    return res.status(403).json({ error: 'Solo el propietario puede eliminar el negocio' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) return res.status(400).json({ error: 'Ingresa tu contraseña para confirmar' });

  const user = await Usuario.findById(payload.id);
  const tenant = await Tenant.findById(payload.tenantId);
  if (!user || !tenant || String(user.tenantId) !== String(tenant._id) ||
      String(tenant.ownerUser) !== String(user._id) || user.rol !== 'superadmin' ||
      Number(user.tokenVersion || 0) !== Number(payload.ver || 0)) {
    return res.status(403).json({ error: 'Solo el propietario puede eliminar el negocio' });
  }
  if (!await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const currentTenant = await Tenant.findOne({ _id: tenant._id, ownerUser: user._id }).session(session);
      const currentUser = await Usuario.findOne({ _id: user._id, tenantId: tenant._id, rol: 'superadmin', tokenVersion: payload.ver }).session(session);
      if (!currentTenant || !currentUser) throw new Error('La cuenta cambió. Inicia sesión nuevamente.');
      await deleteTenantData(tenant._id, session);
      await Tenant.deleteOne({ _id: tenant._id, ownerUser: user._id }).session(session);
    });
    return res.json({ message: 'La cuenta y los datos del negocio fueron eliminados' });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo eliminar la cuenta. Inténtalo nuevamente.' });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
