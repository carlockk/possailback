const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  estado: { type: String, enum: ['activo', 'suspendido'], default: 'activo' },
  plan: { type: String, default: 'gratis' },
  billingStatus: { type: String, default: 'no_configurado' },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
