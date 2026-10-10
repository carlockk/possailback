const mongoose = require('mongoose');
const { registerTenantModel } = require('../utils/tenantContext');

const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  tokenVersion: { type: Number, default: 0 },
  rol: { type: String, enum: ['platform_admin', 'superadmin', 'admin', 'cajero', 'mesero', 'repartidor'], default: 'cajero' },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', default: null }
});

module.exports = registerTenantModel('Usuario', usuarioSchema);
