const express = require('express');
const Local = require('../models/local.model');
const { sanitizeText, sanitizeOptionalText, normalizeEmail, isValidEmail } = require('../utils/input');
const { adjuntarScopeLocal } = require('../middlewares/localScope');
const { normalizeDeliveryZones } = require('../utils/deliveryZones');

const router = express.Router();

const esAdmin = (rol) => rol === 'admin' || rol === 'superadmin';
const requireAdmin = (req, res, next) => {
  if (!esAdmin(req.userRole)) {
    return res.status(403).json({ error: 'No tienes permisos para esta accion' });
  }
  return next();
};

const normalizeBoolean = (value, fallback = true) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return fallback;
};

const construirConfigServicios = (raw, fallback = {}) => ({
  tienda: normalizeBoolean(raw?.tienda, fallback?.tienda !== false),
  retiro: normalizeBoolean(raw?.retiro, fallback?.retiro !== false),
  delivery: normalizeBoolean(raw?.delivery, fallback?.delivery !== false),
});

const construirConfigPagosWeb = (raw, fallback = {}) => ({
  efectivo: normalizeBoolean(raw?.efectivo, fallback?.efectivo !== false),
  tarjeta: normalizeBoolean(raw?.tarjeta, fallback?.tarjeta !== false),
  transferencia: normalizeBoolean(raw?.transferencia, fallback?.transferencia === true),
  transferencia_datos: {
    nombre: sanitizeOptionalText(raw?.transferencia_datos?.nombre, { max: 120 }) || '',
    rut: sanitizeOptionalText(raw?.transferencia_datos?.rut, { max: 40 }) || '',
    numero_cuenta: sanitizeOptionalText(raw?.transferencia_datos?.numero_cuenta, { max: 80 }) || '',
    correo: sanitizeOptionalText(raw?.transferencia_datos?.correo, { max: 120 }) || '',
  },
});

const construirPayload = (data, currentLocal = null) => {
  const nombre = sanitizeText(data.nombre, { max: 80 });
  const direccion = sanitizeOptionalText(data.direccion, { max: 160 });
  const telefono = sanitizeOptionalText(data.telefono, { max: 40 });
  const correoRaw = sanitizeOptionalText(data.correo, { max: 120 });
  const correo = correoRaw ? normalizeEmail(correoRaw) : '';

  return {
    nombre,
    direccion,
    telefono,
    correo,
    servicios: construirConfigServicios(data?.servicios, currentLocal?.servicios || {}),
    pagos_web: construirConfigPagosWeb(data?.pagos_web, currentLocal?.pagos_web || {}),
    delivery_zones: normalizeDeliveryZones(data?.delivery_zones ?? currentLocal?.delivery_zones ?? []),
  };
};

router.get('/', async (_req, res) => {
  try {
    const locales = await Local.find().sort({ nombre: 1 });
    res.json(locales);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener locales' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const local = await Local.findById(req.params.id);
    if (!local) return res.status(404).json({ error: 'Local no encontrado' });
    res.json(local);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener local' });
  }
});

router.post('/', adjuntarScopeLocal, requireAdmin, async (req, res) => {
  try {
    const payload = construirPayload(req.body);
    if (!payload.nombre) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    if (payload.correo && !isValidEmail(payload.correo)) {
      return res.status(400).json({ error: 'Correo invalido' });
    }

    if (
      payload.pagos_web.transferencia &&
      (
        !payload.pagos_web.transferencia_datos?.nombre ||
        !payload.pagos_web.transferencia_datos?.rut ||
        !payload.pagos_web.transferencia_datos?.numero_cuenta ||
        !payload.pagos_web.transferencia_datos?.correo
      )
    ) {
      return res.status(400).json({ error: 'Completa los datos de la cuenta para habilitar transferencia' });
    }

    if (
      payload.pagos_web.transferencia_datos?.correo &&
      !isValidEmail(payload.pagos_web.transferencia_datos.correo)
    ) {
      return res.status(400).json({ error: 'Correo de la cuenta invalido' });
    }

    const existe = await Local.findOne({ nombre: payload.nombre });
    if (existe) {
      return res.status(400).json({ error: 'Ya existe un local con ese nombre' });
    }

    const nuevo = new Local({
      nombre: payload.nombre,
      direccion: payload.direccion || '',
      telefono: payload.telefono || '',
      correo: payload.correo || '',
      servicios: payload.servicios,
      pagos_web: payload.pagos_web,
      delivery_zones: payload.delivery_zones,
    });

    const guardado = await nuevo.save();
    res.status(201).json(guardado);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear local' });
  }
});

router.put('/:id', adjuntarScopeLocal, requireAdmin, async (req, res) => {
  try {
    if (req.userRole !== 'superadmin' && String(req.localId || '') !== String(req.params.id)) {
      return res.status(403).json({ error: 'No puedes editar otro local' });
    }

    const local = await Local.findById(req.params.id);
    if (!local) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    const payload = construirPayload(req.body, local);
    if (!payload.nombre) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    if (payload.correo && !isValidEmail(payload.correo)) {
      return res.status(400).json({ error: 'Correo invalido' });
    }

    if (
      payload.pagos_web.transferencia &&
      (
        !payload.pagos_web.transferencia_datos?.nombre ||
        !payload.pagos_web.transferencia_datos?.rut ||
        !payload.pagos_web.transferencia_datos?.numero_cuenta ||
        !payload.pagos_web.transferencia_datos?.correo
      )
    ) {
      return res.status(400).json({ error: 'Completa los datos de la cuenta para habilitar transferencia' });
    }

    if (
      payload.pagos_web.transferencia_datos?.correo &&
      !isValidEmail(payload.pagos_web.transferencia_datos.correo)
    ) {
      return res.status(400).json({ error: 'Correo de la cuenta invalido' });
    }

    const existe = await Local.findOne({ nombre: payload.nombre, _id: { $ne: req.params.id } });
    if (existe) {
      return res.status(400).json({ error: 'Ya existe otro local con ese nombre' });
    }

    local.nombre = payload.nombre;
    local.direccion = payload.direccion || '';
    local.telefono = payload.telefono || '';
    local.correo = payload.correo || '';
    local.servicios = payload.servicios;
    local.pagos_web = payload.pagos_web;
    local.delivery_zones = payload.delivery_zones;

    const actualizado = await local.save();
    res.json(actualizado);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar local' });
  }
});

router.delete('/:id', adjuntarScopeLocal, requireAdmin, async (req, res) => {
  try {
    if (req.userRole !== 'superadmin' && String(req.localId || '') !== String(req.params.id)) {
      return res.status(403).json({ error: 'No puedes eliminar otro local' });
    }
    const local = await Local.findById(req.params.id);
    if (!local) {
      return res.status(404).json({ error: 'Local no encontrado' });
    }

    await Local.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Local eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar local' });
  }
});

module.exports = router;
