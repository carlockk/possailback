const mongoose = require('mongoose');

const tierSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 40 },
  precioMensual: { type: Number, required: true, min: 0 },
  maxLocales: { type: Number, required: true, min: 1 },
  cuposPorRol: {
    admin: { type: Number, required: true, min: 0 },
    cajero: { type: Number, required: true, min: 0 },
    mesero: { type: Number, required: true, min: 0 },
    repartidor: { type: Number, required: true, min: 0 },
  },
}, { _id: false });

const planConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'default' },
  inicio: { type: tierSchema, required: true },
  pro: { type: tierSchema, required: true },
  localAdicional: {
    precioMensual: { type: Number, required: true, min: 0 },
  },
  precioUsuarioExtra: {
    general: { type: Number, required: true, min: 0 },
    repartidor: { type: Number, required: true, min: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('PlanConfig', planConfigSchema);
