const mongoose = require("mongoose");

const CheckoutSessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true, unique: true, index: true },
    local: { type: mongoose.Schema.Types.ObjectId, ref: "Local", required: true },
    cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente", default: null },
    cliente_email: { type: String, default: "sin_correo" },
    cliente_nombre: { type: String, default: "" },
    cliente_direccion: { type: String, default: "" },
    cliente_coords: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    delivery_zone_name: { type: String, default: "" },
    cliente_telefono: { type: String, default: "" },
    tipo_pedido: { type: String, default: "tienda" },
    hora_retiro: { type: String, default: "" },
    tipo_pago: { type: String, default: "online" },
    total: { type: Number, required: true },
    productos: { type: Array, default: [] },
    estado: { type: String, default: "pendiente_pago" },
    venta_cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: "VentaCliente", default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CheckoutSession", CheckoutSessionSchema);
