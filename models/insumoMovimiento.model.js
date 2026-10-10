const mongoose = require('mongoose');

const insumoMovimientoSchema = new mongoose.Schema(
  {
    insumo: { type: mongoose.Schema.Types.ObjectId, ref: 'Insumo', required: true },
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
    lote: { type: mongoose.Schema.Types.ObjectId, ref: 'InsumoLote' },
    tipo: { type: String, enum: ['entrada', 'salida'], required: true },
    cantidad: { type: Number, required: true },
    motivo: { type: String, trim: true },
    nota: { type: String, trim: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
    fecha: { type: Date, default: Date.now }
  }
);

module.exports = mongoose.model('InsumoMovimiento', insumoMovimientoSchema);
