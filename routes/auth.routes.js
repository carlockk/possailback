const express = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario.model.js');
const { normalizeEmail, isValidEmail } = require('../utils/input');
const { signUserToken } = require('../utils/authToken');

const router = express.Router();
const FAILED_ATTEMPTS_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

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

  const usuario = await Usuario.findOne({ email }).populate(
    'local',
    'nombre direccion telefono correo'
  );
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

  clearAttemptState(attemptKey);
  const token = signUserToken(usuario);

  res.json({
    token,
    _id: usuario._id,
    email: usuario.email,
    nombre: usuario.nombre || '',
    rol: usuario.rol,
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
