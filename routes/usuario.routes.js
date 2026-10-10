const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Local = require('../models/local.model');
const Tenant = require('../models/tenant.model');
const Usuario = require('../models/usuario.model.js');
const { sanitizeText, normalizeEmail, isValidEmail } = require('../utils/input');
const { validPassword } = require('../utils/passwordPolicy');
const { adjuntarScopeLocal, requiereLocal } = require('../middlewares/localScope');

const router = express.Router();
const ROLES_VALIDOS = new Set(['superadmin', 'admin', 'cajero', 'mesero', 'repartidor']);
const requireAdmin = (req, res, next) => {
  if (!['superadmin', 'admin'].includes(req.userRole)) {
    return res.status(403).json({ error: 'No tienes permisos para gestionar usuarios' });
  }
  return next();
};

router.use(adjuntarScopeLocal);

/**
 * @swagger
 * tags:
 *   name: Usuarios
 *   description: Gestión de usuarios
 */

/**
 * @swagger
 * /usuarios:
 *   post:
 *     summary: Crear un nuevo usuario
 *     tags: [Usuarios]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, email, password, rol]
 *             properties:
 *               nombre:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               rol:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usuario creado correctamente
 *       400:
 *         description: Faltan campos o el usuario ya existe
 *       500:
 *         description: Error en el servidor
 */
router.post('/', requireAdmin, async (req, res) => {
  const nombre = sanitizeText(req.body.nombre, { max: 80 });
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const rol = typeof req.body.rol === 'string' ? req.body.rol.trim() : '';
  const localRaw = req.body.local;
  let localId = req.localId;

  if (!nombre || !isValidEmail(email) || !validPassword(password) || !rol) {
    return res.status(400).json({ error: 'Completa los campos y usa una contraseña de 12 a 72 bytes' });
  }
  if (!ROLES_VALIDOS.has(rol)) {
    return res.status(400).json({ error: 'Rol inv lido' });
  }
  if (rol === 'superadmin' && req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el propietario puede crear otro superadministrador' });
  }

  try {
    if (req.userRole === 'superadmin' && localRaw !== undefined) {
      if (localRaw === null || String(localRaw).trim() === '') {
        localId = null;
      } else if (!mongoose.Types.ObjectId.isValid(localRaw)) {
        return res.status(400).json({ error: 'Local invalido' });
      } else {
        localId = localRaw;
      }
    }

    const esRepartidorGlobal = req.userRole === 'superadmin' && rol === 'repartidor' && !localId;

    if (!esRepartidorGlobal) {
      if (!localId || !mongoose.Types.ObjectId.isValid(localId)) {
        return res.status(400).json({ error: 'Local invalido' });
      }

      const localExiste = await Local.findById(localId);
      if (!localExiste) {
        return res.status(400).json({ error: 'Local no encontrado' });
      }
    }

    const existe = await Usuario.findOne({ email });
    if (existe) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const nuevo = new Usuario({ nombre, email, password: hashedPassword, rol, tenantId: req.tenantId, local: esRepartidorGlobal ? null : localId });
    await nuevo.save();

    res.status(201).json({ mensaje: 'Usuario creado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

/**
 * @swagger
 * /usuarios:
 *   get:
 *     summary: Obtener todos los usuarios (sin contraseñas)
 *     tags: [Usuarios]
 *     responses:
 *       200:
 *         description: Lista de usuarios
 *       500:
 *         description: Error al obtener usuarios
 */
router.get('/', async (req, res) => {
  try {
    let filtro = { tenantId: req.tenantId };
    if (req.userRole === 'superadmin') {
      if (req.localId) {
        filtro = {
          tenantId: req.tenantId,
          $or: [
            { local: req.localId },
            { rol: 'repartidor', local: null }
          ]
        };
      }
    } else {
      if (!req.localId) {
        return res.status(400).json({ error: 'Local requerido' });
      }
      filtro = { tenantId: req.tenantId, local: req.localId };
    }
    const usuarios = await Usuario.find(filtro, '-password').populate('local', 'nombre direccion telefono correo');
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

/**
 * @swagger
 * /usuarios/{id}:
 *   delete:
 *     summary: Eliminar un usuario por ID
 *     tags: [Usuarios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario
 *     responses:
 *       200:
 *         description: Usuario eliminado
 *       500:
 *         description: Error al eliminar usuario
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (!req.localId && req.userRole !== 'superadmin') {
      return res.status(400).json({ error: 'Local requerido' });
    }
    const tenant = await Tenant.findById(req.tenantId).select('ownerUser').lean();
    if (String(tenant?.ownerUser) === String(req.params.id)) {
      return res.status(403).json({ error: 'No se puede eliminar al propietario del negocio' });
    }
    const filtro = req.userRole === 'superadmin'
      ? { _id: req.params.id, tenantId: req.tenantId }
      : { _id: req.params.id, tenantId: req.tenantId, local: req.localId, rol: { $ne: 'superadmin' } };
    await Usuario.findOneAndDelete(filtro);
    res.json({ mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

/**
 * @swagger
 * /usuarios/{id}:
 *   put:
 *     summary: Actualizar un usuario por ID
 *     tags: [Usuarios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               password:
 *                 type: string
 *               rol:
 *                 type: string
 *     responses:
 *       200:
 *         description: Usuario actualizado correctamente
 *       500:
 *         description: Error al actualizar usuario
 */
router.put('/:id', requireAdmin, async (req, res) => {
  const { nombre, password, rol } = req.body;

  try {
    const tenant = await Tenant.findById(req.tenantId).select('ownerUser').lean();
    if (String(tenant?.ownerUser) === String(req.params.id) && (
      Object.prototype.hasOwnProperty.call(req.body, 'rol') && req.body.rol !== 'superadmin' ||
      Object.prototype.hasOwnProperty.call(req.body, 'local')
    )) {
      return res.status(403).json({ error: 'No se puede quitar el rol de propietario' });
    }
    const actualizacion = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'nombre')) {
      const nombreLimpio = sanitizeText(nombre, { max: 80 });
      if (!nombreLimpio) return res.status(400).json({ error: 'Nombre inv lido' });
      actualizacion.nombre = nombreLimpio;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'password')) {
      if (!validPassword(password)) {
        return res.status(400).json({ error: 'Contraseña de 12 a 72 bytes requerida' });
      }
      actualizacion.password = await bcrypt.hash(password, 12);
      actualizacion.$inc = { tokenVersion: 1 };
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'rol')) {
      const rolLimpio = typeof rol === 'string' ? rol.trim() : '';
      if (!ROLES_VALIDOS.has(rolLimpio)) {
        return res.status(400).json({ error: 'Rol inv lido' });
      }
      if (rolLimpio === 'superadmin' && req.userRole !== 'superadmin') {
        return res.status(403).json({ error: 'Solo el propietario puede asignar este rol' });
      }
      actualizacion.rol = rolLimpio;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'local')) {
      if (req.userRole === 'superadmin') {
        const localRaw = req.body.local;
        if (localRaw === null || String(localRaw).trim() === '') {
          actualizacion.local = null;
        } else if (!mongoose.Types.ObjectId.isValid(localRaw)) {
          return res.status(400).json({ error: 'Local invalido' });
        } else {
          const localExiste = await Local.findById(localRaw);
          if (!localExiste) {
            return res.status(400).json({ error: 'Local no encontrado' });
          }
          actualizacion.local = localRaw;
        }
      } else {
        if (!req.localId || !mongoose.Types.ObjectId.isValid(req.localId)) {
          return res.status(400).json({ error: 'Local invalido' });
        }
        const localExiste = await Local.findById(req.localId);
        if (!localExiste) {
          return res.status(400).json({ error: 'Local no encontrado' });
        }
        actualizacion.local = req.localId;
      }
    }

    if (!req.localId && req.userRole !== 'superadmin') {
      return res.status(400).json({ error: 'Local requerido' });
    }

    const filtro = req.userRole === 'superadmin'
      ? { _id: req.params.id, tenantId: req.tenantId }
      : { _id: req.params.id, tenantId: req.tenantId, local: req.localId, rol: { $ne: 'superadmin' } };

    await Usuario.findOneAndUpdate(filtro, actualizacion);
    res.json({ mensaje: 'Usuario actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

module.exports = router;
