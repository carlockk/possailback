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

const router = express.Router();
router.use((_req, _res, next) => runAsPlatform(next));
router.post('/register', authRateLimit({ scope: 'tenant-register', ipLimit: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const nombre = sanitizeText(req.body?.nombre, { max: 80 });
  const negocio = sanitizeText(req.body?.negocio, { max: 100 });
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
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
      tenant = new Tenant({ nombre: negocio, slug: `${base}-${require('node:crypto').randomBytes(4).toString('hex')}` });
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
      rol: usuario.rol, tenantId: tenant._id, negocio: tenant.nombre, local: null
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
