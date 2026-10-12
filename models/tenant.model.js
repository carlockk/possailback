const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  estado: { type: String, enum: ['activo', 'suspendido'], default: 'activo' },
  plan: { type: String, enum: ['gratis', 'inicio', 'pro'], default: 'gratis' },
  localesAdicionales: { type: Number, default: 0, min: 0 },
  usuariosExtra: {
    admin: { type: Number, default: 0, min: 0 },
    cajero: { type: Number, default: 0, min: 0 },
    mesero: { type: Number, default: 0, min: 0 },
    repartidor: { type: Number, default: 0, min: 0 },
  },
  billingStatus: { type: String, default: 'no_configurado' },
  modulos: {
    agregados: { type: Boolean, default: true },
    restaurante: { type: Boolean, default: true },
    pedidosWeb: { type: Boolean, default: true },
  },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
