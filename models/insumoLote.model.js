const mongoose = require('mongoose');

const insumoLoteSchema = new mongoose.Schema(
  {
    insumo: { type: mongoose.Schema.Types.ObjectId, ref: 'Insumo', required: true },
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
    lote: { type: String, trim: true },
    fecha_vencimiento: { type: Date, default: null },
    cantidad: { type: Number, required: true },
    fecha_ingreso: { type: Date, default: Date.now },
    activo: { type: Boolean, default: true }
  }
);

module.exports = mongoose.model('InsumoLote', insumoLoteSchema);
