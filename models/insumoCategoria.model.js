const mongoose = require('mongoose');

const insumoCategoriaSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
    orden: { type: Number, default: 0 },
    creado_en: { type: Date, default: Date.now }
  }
);

module.exports = mongoose.model('InsumoCategoria', insumoCategoriaSchema);
