const mongoose = require('mongoose');

const pedidoEstadoConfigSchema = new mongoose.Schema(
  {
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true, unique: true },
    estados: [{ type: String, trim: true }],
    estados_repartidor: [{ type: String, trim: true }]
  },
  { timestamps: true }
);

module.exports = mongoose.model('PedidoEstadoConfig', pedidoEstadoConfigSchema);
