const Tenant = require('../models/tenant.model');
const Local = require('../models/local.model');
const Usuario = require('../models/usuario.model');
const { getPlanConfig, getPlanLimits } = require('../utils/planLimits');

const requireCapacity = (kind) => async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('plan localesAdicionales usuariosExtra').lean();
    if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
    const limits = getPlanLimits(tenant, await getPlanConfig());
    const role = kind === 'usuario' ? req.body?.rol : null;
    if (role === 'superadmin') return res.status(403).json({ error: 'Solo puede existir el superadmin propietario' });
    if (kind === 'usuario' && !['admin', 'cajero', 'mesero', 'repartidor'].includes(role)) return next();
    const max = kind === 'local' ? limits.maxLocales : limits.cuposPorRol?.[role];
    if (max === null) return next();
    const count = kind === 'local'
      ? await Local.countDocuments({ tenantId: req.tenantId })
      : await Usuario.countDocuments({ tenantId: req.tenantId, rol: role });
    if (count >= max) {
      const label = kind === 'local' ? 'locales' : `usuarios con rol ${role}`;
      return res.status(409).json({ error: `Tu plan permite hasta ${max} ${label}. Solicita un cupo adicional al administrador de la plataforma.` });
    }
    return next();
  } catch {
    return res.status(500).json({ error: 'No se pudo verificar el cupo del plan' });
  }
};

module.exports = { requireCapacity };
