const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const SocialConfig = require('../models/socialConfig.model');
const Local = require('../models/local.model');
const { sanitizeOptionalText } = require('../utils/input');
const { subirImagen, eliminarImagen } = require('../utils/cloudinary');
const { evaluateWebSchedule, normalizeWebSchedule } = require('../utils/webSchedule');
const { adjuntarScopeLocal, requiereLocal } = require('../middlewares/localScope');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(adjuntarScopeLocal);
router.use(requiereLocal);

const NETWORKS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'whatsapp'];

const emptySocial = () => ({ enabled: false, url: '' });

const isValidUrl = (value) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const obtenerConfig = async (localId) => {
  let config = await SocialConfig.findOne({ local: localId });
  if (!config) {
    config = await SocialConfig.create({ local: localId });
  }
  return config;
};

router.get('/', async (req, res) => {
  try {
    const config = await obtenerConfig(req.localId);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener configuracion social' });
  }
});

router.put('/', async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const config = await obtenerConfig(req.localId);
    const payload = req.body?.socials && typeof req.body.socials === 'object' ? req.body.socials : req.body;
    const horariosInput = Array.isArray(req.body?.horarios_web)
      ? req.body.horarios_web
      : payload?.horarios_web;

    NETWORKS.forEach((key) => {
      const input = payload?.[key] || {};
      const enabled = Boolean(input?.enabled);
      const rawUrl = sanitizeOptionalText(input?.url, { max: 300 }) || '';

      if (enabled && rawUrl && !isValidUrl(rawUrl)) {
        throw new Error(`URL invalida para ${key}`);
      }

      config[key] = {
        enabled,
        url: rawUrl
      };
    });

    if (Array.isArray(horariosInput)) {
      config.horarios_web = normalizeWebSchedule(horariosInput);
    }
    config.actualizado_en = new Date();
    const actualizado = await config.save();
    res.json(actualizado);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Error al guardar configuracion social' });
  }
});

router.put('/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const config = await obtenerConfig(req.localId);
    const removeLogo = String(req.body?.remove_logo) === 'true';
    const logoUrl = sanitizeOptionalText(req.body?.logo_url, { max: 300 }) || '';

    if (logoUrl && !isValidUrl(logoUrl)) {
      return res.status(400).json({ error: 'URL invalida para el logo' });
    }

    if (removeLogo) {
      if (config.logo_cloudinary_id) {
        await eliminarImagen(config.logo_cloudinary_id);
      }
      config.logo_cloudinary_id = '';
      config.logo_url = '';
    }

    if (logoUrl) {
      if (config.logo_cloudinary_id) {
        await eliminarImagen(config.logo_cloudinary_id);
      }
      config.logo_cloudinary_id = '';
      config.logo_url = logoUrl;
    }

    if (req.file) {
      if (config.logo_cloudinary_id) {
        await eliminarImagen(config.logo_cloudinary_id);
      }
      const subida = await subirImagen(req.file);
      config.logo_url = subida.secure_url;
      config.logo_cloudinary_id = subida.public_id;
    }

    config.actualizado_en = new Date();
    const actualizado = await config.save();
    res.json({
      logo_url: actualizado.logo_url || '',
      logo_cloudinary_id: actualizado.logo_cloudinary_id || '',
      actualizado_en: actualizado.actualizado_en || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Error al guardar logo web cliente' });
  }
});

router.post('/clonar', async (req, res) => {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const sourceLocalId = String(req.body?.sourceLocalId || req.localId || '').trim();
    const targetsRaw = Array.isArray(req.body?.targetLocalIds) ? req.body.targetLocalIds : [];
    const targetLocalIds = Array.from(
      new Set(
        targetsRaw
          .map((id) => String(id || '').trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      )
    );

    if (!mongoose.Types.ObjectId.isValid(sourceLocalId)) {
      return res.status(400).json({ error: 'Local origen invalido' });
    }
    if (targetLocalIds.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos un local destino' });
    }
    if (targetLocalIds.some((id) => id === sourceLocalId)) {
      return res.status(400).json({ error: 'El local destino debe ser distinto al local origen' });
    }

    const [sourceLocal, targetLocales] = await Promise.all([
      Local.findById(sourceLocalId).lean(),
      Local.find({ _id: { $in: targetLocalIds } }).select('_id').lean()
    ]);

    if (!sourceLocal) {
      return res.status(404).json({ error: 'Local origen no encontrado' });
    }
    if (targetLocales.length !== targetLocalIds.length) {
      return res.status(400).json({ error: 'Uno o mas locales destino no existen' });
    }

    const origen = await obtenerConfig(sourceLocalId);

    await Promise.all(
      targetLocalIds.map(async (localId) => {
        const destino = await obtenerConfig(localId);

        NETWORKS.forEach((key) => {
          const entry = origen?.[key] || emptySocial();
          destino[key] = {
            enabled: Boolean(entry.enabled),
            url: entry.url || ''
          };
        });
        destino.horarios_web = normalizeWebSchedule(origen?.horarios_web);

        // Se copia URL del logo para evitar eliminar recursos cloudinary compartidos.
        destino.logo_url = origen.logo_url || '';
        destino.logo_cloudinary_id = '';
        destino.actualizado_en = new Date();
        await destino.save();
      })
    );

    return res.json({
      mensaje: 'Configuracion social clonada correctamente',
      cantidad: targetLocalIds.length
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al clonar configuracion social' });
  }
});

router.get('/public', async (req, res) => {
  try {
    const config = await obtenerConfig(req.localId);
    const socials = {};
    const horarios = normalizeWebSchedule(config?.horarios_web);
    const horarioEstado = evaluateWebSchedule(horarios, new Date());

    NETWORKS.forEach((key) => {
      const entry = config?.[key] || emptySocial();
      socials[key] = {
        enabled: Boolean(entry.enabled),
        url: entry.url || ''
      };
    });

    res.json({
      socials,
      logo_url: config.logo_url || '',
      horarios_web: horarios,
      horario_web_activo: horarioEstado.active,
      abierto_ahora: horarioEstado.open,
      actualizado_en: config.actualizado_en || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener redes sociales' });
  }
});

module.exports = router;
