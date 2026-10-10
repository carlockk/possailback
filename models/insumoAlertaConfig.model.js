const mongoose = require('mongoose');

const insumoAlertaConfigSchema = new mongoose.Schema(
  {
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true, unique: true },
    usuarios: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }],
    actualizado_en: { type: Date, default: Date.now }
  }
);

module.exports = mongoose.model('InsumoAlertaConfig', insumoAlertaConfigSchema);
