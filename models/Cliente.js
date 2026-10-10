// models/Cliente.js
const mongoose = require('mongoose');

const ClienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  direccion: { type: String },
  telefono: { type: String },
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Cliente', ClienteSchema);
