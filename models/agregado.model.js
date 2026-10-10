const mongoose = require('mongoose');

const agregadoSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  descripcion: { type: String, trim: true, default: '' },
  precio: { type: Number, default: null },
  grupo: { type: mongoose.Schema.Types.ObjectId, ref: 'AgregadoGrupo', default: null },
  grupos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AgregadoGrupo' }],
  categorias: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Categoria' }],
  productos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductoLocal' }],
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
  activo: { type: Boolean, default: true },
  creado_en: { type: Date, default: Date.now },
  actualizado_en: { type: Date, default: Date.now }
});

agregadoSchema.index({ local: 1, nombre: 1 });

module.exports = mongoose.model('Agregado', agregadoSchema);
