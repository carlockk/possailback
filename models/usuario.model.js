const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol: { type: String, enum: ['superadmin', 'admin', 'cajero', 'mesero', 'repartidor'], default: 'cajero' },
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', default: null }
});

module.exports = mongoose.model('Usuario', usuarioSchema);
