const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model.js');
const Tenant = require('../models/tenant.model.js');
const { runAsPlatform, runForTenant } = require('../utils/tenantContext');
const { sanitizeText } = require('../utils/input');
const { normalizeEmail, isValidEmail } = require('../utils/input');
const { signUserToken } = require('../utils/authToken');

const router = express.Router();
router.use((_req, _res, next) => runAsPlatform(next));
const FAILED_ATTEMPTS_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
const registerAttempts = new Map();

const getClientIp = (req) => req.ip || req.connection?.remoteAddress || 'unknown';

const getAttemptKey = (req, email) => `${getClientIp(req)}|${email}`;

const getAttemptState = (key) => {
  const current = loginAttempts.get(key);
  if (!current) return null;
  if (current.lockUntil && current.lockUntil > Date.now()) return current;
  if (current.expiresAt && current.expiresAt < Date.now()) {
    loginAttempts.delete(key);
    return null;
  }
  return current;
};

const registerFailedAttempt = (key) => {
  const now = Date.now();
  const current = getAttemptState(key);
  const nextCount = current ? current.count + 1 : 1;
  const next = {
    count: nextCount,
    expiresAt: now + FAILED_ATTEMPTS_WINDOW_MS
  };
  if (nextCount >= MAX_FAILED_ATTEMPTS) {
    next.lockUntil = now + BLOCK_DURATION_MS;
  }
  loginAttempts.set(key, next);
};

const clearAttemptState = (key) => {
  loginAttempts.delete(key);
};

router.post('/register', async (req, res) => {
  const ip = getClientIp(req);
  const current = registerAttempts.get(ip);
  const now = Date.now();
  if (registerAttempts.size > 1000) {
    for (const [key, attempt] of registerAttempts) {
      if (attempt.expiresAt <= now) registerAttempts.delete(key);
    }
  }
  if (current?.expiresAt > now && current.count >= 5) {
    return res.status(429).json({ error: 'Demasiados registros. Intenta más tarde' });
  }
  registerAttempts.set(ip, current?.expiresAt > now
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + 60 * 60 * 1000 });
  const nombre = sanitizeText(req.body?.nombre, { max: 80 });
  const negocio = sanitizeText(req.body?.negocio, { max: 100 });
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!nombre || !negocio || !isValidEmail(email) || password.length < 12) {
    return res.status(400).json({ error: 'Completa nombre, negocio, correo y contraseña de al menos 12 caracteres' });
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
router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Credenciales invalidas' });
  }

  const attemptKey = getAttemptKey(req, email);
  const attemptState = getAttemptState(attemptKey);
  if (attemptState?.lockUntil && attemptState.lockUntil > Date.now()) {
    return res.status(429).json({ error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' });
  }

  const usuario = await Usuario.findOne({ email });
  if (!usuario) {
    registerFailedAttempt(attemptKey);
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  let match = false;
  if (typeof usuario.password === 'string' && usuario.password.startsWith('$2')) {
    match = await bcrypt.compare(password, usuario.password);
  } else {
    match = password === usuario.password;
    if (match) {
      usuario.password = await bcrypt.hash(password, 10);
      await usuario.save();
    }
  }
  if (!match) {
    registerFailedAttempt(attemptKey);
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

  clearAttemptState(attemptKey);
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

module.exports = router;
