const PlanConfig = require('../models/planConfig.model');

const STAFF_ROLES = ['admin', 'cajero', 'mesero', 'repartidor'];
const DEFAULT_PLAN_CONFIG = Object.freeze({
  inicio: { nombre: 'Inicio', precioMensual: 5990, maxLocales: 1,
    cuposPorRol: { admin: 1, cajero: 2, mesero: 2, repartidor: 1 } },
  pro: { nombre: 'Pro', precioMensual: 9990, maxLocales: 2,
    cuposPorRol: { admin: 2, cajero: 4, mesero: 4, repartidor: 2 } },
  localAdicional: { precioMensual: 2990 },
  precioUsuarioExtra: { general: 2990, repartidor: 1990 },
});

const getPlanConfig = async () => {
  const saved = await PlanConfig.findOne({ key: 'default' }).lean();
  if (!saved) return DEFAULT_PLAN_CONFIG;
  const tier = (key) => ({
    nombre: saved[key]?.nombre || DEFAULT_PLAN_CONFIG[key].nombre,
    precioMensual: saved[key]?.precioMensual ?? DEFAULT_PLAN_CONFIG[key].precioMensual,
    maxLocales: saved[key]?.maxLocales ?? DEFAULT_PLAN_CONFIG[key].maxLocales,
    cuposPorRol: { ...DEFAULT_PLAN_CONFIG[key].cuposPorRol, ...saved[key]?.cuposPorRol },
  });
  return {
    inicio: tier('inicio'), pro: tier('pro'),
    localAdicional: { precioMensual: saved.localAdicional?.precioMensual ?? DEFAULT_PLAN_CONFIG.localAdicional.precioMensual },
    precioUsuarioExtra: { ...DEFAULT_PLAN_CONFIG.precioUsuarioExtra, ...saved.precioUsuarioExtra },
  };
};

const parsePlanConfig = (value) => {
  if (!value || typeof value !== 'object') return null;
  const validInt = (number, min, max) => Number.isSafeInteger(number) && number >= min && number <= max;
  const tier = (item) => item && typeof item.nombre === 'string' &&
    item.nombre.trim().length >= 2 && item.nombre.trim().length <= 40 &&
    validInt(item.precioMensual, 0, 10000000) &&
    validInt(item.maxLocales, 1, 1000) &&
    STAFF_ROLES.every((role) => validInt(item.cuposPorRol?.[role], 0, 10000));
  if (!tier(value.inicio) || !tier(value.pro) ||
      !validInt(value.localAdicional?.precioMensual, 0, 10000000) ||
      !validInt(value.precioUsuarioExtra?.general, 0, 10000000) ||
      !validInt(value.precioUsuarioExtra?.repartidor, 0, 10000000)) return null;
  const cleanTier = (item) => ({
    nombre: item.nombre.trim(), precioMensual: item.precioMensual, maxLocales: item.maxLocales,
    cuposPorRol: Object.fromEntries(STAFF_ROLES.map((role) => [role, item.cuposPorRol[role]])),
  });
  return {
    inicio: cleanTier(value.inicio), pro: cleanTier(value.pro),
    localAdicional: { precioMensual: value.localAdicional.precioMensual },
    precioUsuarioExtra: { general: value.precioUsuarioExtra.general, repartidor: value.precioUsuarioExtra.repartidor },
  };
};

const getPlanLimits = (tenant, config) => {
  const plan = tenant?.plan === 'pro' ? 'pro' : tenant?.plan === 'inicio' ? 'inicio' : 'gratis';
  if (plan === 'gratis') return {
    plan, nombre: 'Legado', precioMensual: 0, maxLocales: null, maxUsuarios: null,
    localesAdicionales: 0, cuposPorRol: null, usuariosExtra: null,
  };
  const localesAdicionales = plan === 'pro' ? Math.max(0, Number(tenant?.localesAdicionales) || 0) : 0;
  const usuariosExtra = Object.fromEntries(STAFF_ROLES.map((role) =>
    [role, Math.max(0, Number(tenant?.usuariosExtra?.[role]) || 0)]));
  const cuposPorRol = Object.fromEntries(STAFF_ROLES.map((role) =>
    [role, config[plan].cuposPorRol[role] + usuariosExtra[role]]));
  const extraGeneral = usuariosExtra.admin + usuariosExtra.cajero + usuariosExtra.mesero;
  return {
    plan,
    nombre: config[plan].nombre,
    precioMensual: config[plan].precioMensual + localesAdicionales * config.localAdicional.precioMensual +
      extraGeneral * config.precioUsuarioExtra.general + usuariosExtra.repartidor * config.precioUsuarioExtra.repartidor,
    maxLocales: config[plan].maxLocales + localesAdicionales,
    maxUsuarios: 1 + Object.values(cuposPorRol).reduce((sum, count) => sum + count, 0),
    localesAdicionales, cuposPorRol, usuariosExtra,
  };
};

module.exports = { STAFF_ROLES, DEFAULT_PLAN_CONFIG, getPlanConfig, getPlanLimits, parsePlanConfig };
