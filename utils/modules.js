const MODULE_KEYS = ['agregados', 'restaurante', 'pedidosWeb'];

// Los negocios anteriores al selector conservan sus módulos disponibles.
const getModules = (tenant) => Object.fromEntries(
  MODULE_KEYS.map((key) => [key, tenant?.modulos?.[key] !== false])
);

const parseModules = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !MODULE_KEYS.includes(key))) return null;
  if (MODULE_KEYS.some((key) => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, value[key]]));
};

module.exports = { MODULE_KEYS, getModules, parseModules };
