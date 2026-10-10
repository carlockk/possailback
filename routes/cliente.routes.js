const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Cliente = require('../models/Cliente');
const { getJwtSecret } = require('../utils/jwtConfig');
const {
  sanitizeText,
  sanitizeOptionalText,
  normalizeEmail,
  isValidEmail
} = require('../utils/input');
const { adjuntarScopeLocal, requiereLocal } = require('../middlewares/localScope');

const JWT_SECRET = getJwtSecret();

const readLocalIdFromHeader = (req) => {
  const raw = req.headers['x-local-id'];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  if (!mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return String(raw);
};

/**
 * @swagger
 * tags:
 *   name: Clientes
 *   description: Gestión de clientes
 */

/**
 * @swagger
 * /clientes/register:
 *   post:
 *     summary: Registro de nuevo cliente
 *     tags: [Clientes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, email, password]
 *             properties:
 *               nombre:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               direccion:
 *                 type: string
 *               telefono:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cliente registrado exitosamente
 *       400:
 *         description: Cliente ya existe
 *       500:
 *         description: Error al registrar cliente
 */
router.post('/register', async (req, res) => {
  try {
    const localId = readLocalIdFromHeader(req);
    const nombre = sanitizeText(req.body.nombre, { max: 80 });
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const direccion = sanitizeOptionalText(req.body.direccion, { max: 160 });
    const telefono = sanitizeOptionalText(req.body.telefono, { max: 40 });

    if (!nombre) return res.status(400).json({ msg: 'Nombre requerido.' });
    if (!isValidEmail(email)) return res.status(400).json({ msg: 'Email inv lido.' });
    if (!password) return res.status(400).json({ msg: 'Password requerida.' });

    const existe = await Cliente.findOne({ email });
    if (existe) return res.status(400).json({ msg: 'El cliente ya existe.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const nuevoCliente = new Cliente({
      nombre,
      email,
      password: hashedPassword,
      direccion,
      telefono,
      local: localId || null
    });

    await nuevoCliente.save();

    const token = jwt.sign({ id: nuevoCliente._id, rol: 'cliente' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      msg: 'Registro exitoso.',
      cliente: {
        _id: nuevoCliente._id,
        nombre: nuevoCliente.nombre,
        email: nuevoCliente.email
      },
      token
    });
  } catch (error) {
    res.status(500).json({ msg: 'Error al registrar cliente.', error });
  }
});

/**
 * @swagger
 * /clientes/login:
 *   post:
 *     summary: Login de cliente
 *     tags: [Clientes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *       400:
 *         description: Email no registrado o contraseña incorrecta
 *       500:
 *         description: Error en el servidor
 */
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ msg: 'Credenciales inv lidas.' });
    }

    const cliente = await Cliente.findOne({ email });
    if (!cliente) return res.status(400).json({ msg: 'Email no registrado.' });

    const isMatch = await bcrypt.compare(password, cliente.password);
    if (!isMatch) return res.status(400).json({ msg: 'Contraseña incorrecta.' });

    const token = jwt.sign({ id: cliente._id, rol: 'cliente' }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      msg: 'Login exitoso.',
      cliente: {
        _id: cliente._id,
        nombre: cliente.nombre,
        email: cliente.email
      },
      token
    });
  } catch (error) {
    res.status(500).json({ msg: 'Error al iniciar sesión.', error });
  }
});

/**
 * @swagger
 * /clientes/todos:
 *   get:
 *     summary: Obtener todos los clientes (sin contraseña)
 *     tags: [Clientes]
 *     responses:
 *       200:
 *         description: Lista de clientes
 *       500:
 *         description: Error al obtener clientes
 */
router.get('/todos', adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    const clientes = await Cliente.find({ local: req.localId }).select('-password');
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ msg: 'Error al obtener clientes', error });
  }
});

// 🔐 Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Token no proporcionado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.clienteId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token inválido' });
  }
};

/**
 * @swagger
 * /clientes/perfil:
 *   get:
 *     summary: Obtener perfil del cliente autenticado
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil obtenido
 *       401:
 *         description: Token inválido
 *       500:
 *         description: Error al obtener perfil
 */
router.get('/perfil', authMiddleware, async (req, res) => {
  try {
    const cliente = await Cliente.findById(req.clienteId).select('-password');
    if (!cliente) return res.status(404).json({ msg: 'Cliente no encontrado' });
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ msg: 'Error al obtener perfil', error });
  }
});

/**
 * @swagger
 * /clientes/perfil:
 *   put:
 *     summary: Actualizar perfil del cliente autenticado
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               direccion:
 *                 type: string
 *               telefono:
 *                 type: string
 *     responses:
 *       200:
 *         description: Perfil actualizado
 *       401:
 *         description: Token inválido
 *       500:
 *         description: Error al actualizar perfil
 */
router.put('/perfil', authMiddleware, async (req, res) => {
  try {
    const actualizacion = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'nombre')) {
      const nombre = sanitizeText(req.body.nombre, { max: 80 });
      if (!nombre) return res.status(400).json({ msg: 'Nombre requerido.' });
      actualizacion.nombre = nombre;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'direccion')) {
      actualizacion.direccion = sanitizeOptionalText(req.body.direccion, { max: 160 });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'telefono')) {
      actualizacion.telefono = sanitizeOptionalText(req.body.telefono, { max: 40 });
    }

    const updated = await Cliente.findByIdAndUpdate(
      req.clienteId,
      actualizacion,
      { new: true }
    ).select('-password');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ msg: 'Error al actualizar perfil', error: err });
  }
});

module.exports = router;
