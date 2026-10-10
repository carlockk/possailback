const mongoose = require('mongoose');

const agregadoGrupoSchema = new mongoose.Schema({
  categoriaPrincipal: { type: String, trim: true, default: '' },
  titulo: { type: String, required: true, trim: true },
  descripcion: { type: String, trim: true, default: '' },
  modoSeleccion: { type: String, enum: ['multiple', 'unico'], default: 'multiple' },
  obligatorio: { type: Boolean, default: false },
  local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
  activo: { type: Boolean, default: true },
  creado_en: { type: Date, default: Date.now },
  actualizado_en: { type: Date, default: Date.now }
});

agregadoGrupoSchema.index({ local: 1, titulo: 1 }, { unique: true });

module.exports = mongoose.model('AgregadoGrupo', agregadoGrupoSchema);
