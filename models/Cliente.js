const { registerTenantModel } = require('../utils/tenantContext');
// models/Cliente.js
const mongoose = require('mongoose');

const ClienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  direccion: { type: String },
  telefono: { type: String },
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', default: null },
  createdAt: { type: Date, default: Date.now }
});

ClienteSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = registerTenantModel('Cliente', ClienteSchema);
