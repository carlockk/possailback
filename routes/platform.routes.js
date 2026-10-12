const express = require('express');
const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model');
const Tenant = require('../models/tenant.model');
const Local = require('../models/local.model');
const ProductoBase = require('../models/productBase.model');
const Venta = require('../models/venta.model');
const { getAuthPayloadFromRequest } = require('../utils/authToken');
const { runAsPlatform } = require('../utils/tenantContext');
const PlanConfig = require('../models/planConfig.model');
const { STAFF_ROLES, getPlanConfig, getPlanLimits, parsePlanConfig } = require('../utils/planLimits');

const router = express.Router();
const safe = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(safe(async (req, res, next) => {
  const payload = getAuthPayloadFromRequest(req);
  if (!payload || payload.rol !== 'platform_admin') {
    return res.status(403).json({ error: 'Acceso reservado al administrador de plataforma' });
  }
  const user = await runAsPlatform(async () => await Usuario.findById(payload.id).select('rol tokenVersion').lean());
  if (!user || user.rol !== 'platform_admin' || Number(user.tokenVersion || 0) !== Number(payload.ver || 0)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
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

router.get('/planes', safe(async (_req, res) => {
  return res.json(await getPlanConfig());
}));

router.put('/planes', safe(async (req, res) => {
  const config = parsePlanConfig(req.body);
  if (!config) return res.status(400).json({ error: 'Revisa nombres, precios y limites de los planes' });
  await PlanConfig.findOneAndUpdate({ key: 'default' }, { $set: config }, { upsert: true, new: true, runValidators: true });
  return res.json(await getPlanConfig());
}));

router.get('/usuarios', safe(async (req, res) => {
  const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const limite = 25;
  const filtro = { tenantId: { $ne: null } };
  const [users, total] = await Promise.all([
    Usuario.find(filtro, 'nombre email rol tenantId local')
      .sort({ _id: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Usuario.countDocuments(filtro),
  ]);
  const tenantIds = [...new Set(users.map((user) => String(user.tenantId)))];
  const tenants = await Tenant.find({ _id: { $in: tenantIds } }, 'nombre estado').lean();
  const tenantById = new Map(tenants.map((tenant) => [String(tenant._id), tenant]));
  return res.json({
    usuarios: users.map((user) => ({
      ...user,
      negocio: tenantById.get(String(user.tenantId))?.nombre || 'Negocio no disponible',
      estadoNegocio: tenantById.get(String(user.tenantId))?.estado || 'desconocido',
    })),
    total,
    pagina,
    totalPaginas: Math.max(1, Math.ceil(total / limite)),
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
  return res.json({ ...summary, users, listaLocales: locales, limitesPlan: getPlanLimits(tenant, await getPlanConfig()) });
}));

router.patch('/negocios/:id/plan', safe(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Negocio invalido' });
  const { plan, localesAdicionales, usuariosExtra } = req.body || {};
  if (!['gratis', 'inicio', 'pro'].includes(plan) ||
      !Number.isSafeInteger(localesAdicionales) || localesAdicionales < 0 || localesAdicionales > 1000 ||
      (plan !== 'pro' && localesAdicionales !== 0) ||
      !usuariosExtra || STAFF_ROLES.some((role) => !Number.isSafeInteger(usuariosExtra[role]) || usuariosExtra[role] < 0 || usuariosExtra[role] > 1000) ||
      (plan === 'gratis' && STAFF_ROLES.some((role) => usuariosExtra[role] !== 0))) {
    return res.status(400).json({ error: 'Seleccion de plan, locales o cupos adicionales invalida' });
  }
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
  const config = await getPlanConfig();
  const limits = getPlanLimits({ plan, localesAdicionales, usuariosExtra }, config);
  const [usuarios, locales, usuariosPorRol, superadmins] = await Promise.all([
    Usuario.countDocuments({ tenantId: tenant._id }),
    Local.countDocuments({ tenantId: tenant._id }),
    Promise.all(STAFF_ROLES.map((role) => Usuario.countDocuments({ tenantId: tenant._id, rol: role }))),
    Usuario.countDocuments({ tenantId: tenant._id, rol: 'superadmin' }),
  ]);
  if ((limits.cuposPorRol && (superadmins !== 1 || STAFF_ROLES.some((role, index) => usuariosPorRol[index] > limits.cuposPorRol[role]))) ||
      (limits.maxLocales !== null && locales > limits.maxLocales)) {
    return res.status(409).json({ error: `El negocio ya tiene ${usuarios} usuarios y ${locales} locales. Elige cupos por rol y locales que los cubran.` });
  }
  tenant.plan = plan;
  tenant.localesAdicionales = localesAdicionales;
  tenant.usuariosExtra = usuariosExtra;
  await tenant.save();
  return res.json({ _id: tenant._id, plan, localesAdicionales, usuariosExtra, limitesPlan: limits });
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
