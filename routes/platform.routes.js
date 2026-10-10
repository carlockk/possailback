const express = require('express');
const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model');
const Tenant = require('../models/tenant.model');
const Local = require('../models/local.model');
const ProductoBase = require('../models/productBase.model');
const Venta = require('../models/venta.model');
const { getAuthPayloadFromRequest } = require('../utils/authToken');
const { runAsPlatform } = require('../utils/tenantContext');

const router = express.Router();
const safe = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(safe(async (req, res, next) => {
  const payload = getAuthPayloadFromRequest(req);
  if (!payload || payload.rol !== 'platform_admin') {
    return res.status(403).json({ error: 'Acceso reservado al administrador de plataforma' });
  }
  const user = await runAsPlatform(async () => await Usuario.findById(payload.id).select('rol').lean());
  if (!user || user.rol !== 'platform_admin') return res.status(403).json({ error: 'Acceso denegado' });
  req.platformUserId = String(user._id);
  return runAsPlatform(next);
}));

const decorate = async (tenant) => {
  const [usuarios, locales, productos, ventas, owner] = await Promise.all([
    Usuario.countDocuments({ tenantId: tenant._id }),
    Local.countDocuments({ tenantId: tenant._id }),
    ProductoBase.countDocuments({ tenantId: tenant._id }),
    Venta.countDocuments({ tenantId: tenant._id }),
    Usuario.findById(tenant.ownerUser).select('email').lean(),
  ]);
  return { ...tenant, usuarios, locales, productos, ventas, ownerEmail: owner?.email || '' };
};

router.get('/resumen', safe(async (_req, res) => {
  const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
  const items = await Promise.all(tenants.map(decorate));
  return res.json({
    totalNegocios: tenants.length,
    negociosActivos: tenants.filter((tenant) => tenant.estado === 'activo').length,
    usuarios: items.reduce((sum, item) => sum + item.usuarios, 0),
    negocios: items,
  });
}));

router.get('/negocios/:id', safe(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Negocio invalido' });
  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
  const [summary, users, locales] = await Promise.all([
    decorate(tenant),
    Usuario.find({ tenantId: tenant._id }, '-password').sort({ nombre: 1 }).lean(),
    Local.find({ tenantId: tenant._id }).sort({ nombre: 1 }).lean(),
  ]);
  return res.json({ ...summary, users, listaLocales: locales });
}));

router.patch('/negocios/:id/estado', safe(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Negocio invalido' });
  if (!['activo', 'suspendido'].includes(req.body?.estado)) {
    return res.status(400).json({ error: 'Estado invalido' });
  }
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, { estado: req.body.estado }, { new: true }).lean();
  if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
  return res.json({ _id: tenant._id, estado: tenant.estado });
}));

module.exports = router;
