const mongoose = require("mongoose");

const ProductoSchema = new mongoose.Schema({
  nombre: String,
  cantidad: Number,
  precio_unitario: Number,
  subtotal: Number,
  observacion: String,
  varianteId: mongoose.Schema.Types.ObjectId,
  varianteNombre: String,
  atributos: [
    {
      nombre: String,
      valor: String
    }
  ],
  agregados: [
    {
      agregadoId: mongoose.Schema.Types.ObjectId,
      nombre: String,
      precio: Number
    }
  ]
});

const VentaClienteSchema = new mongoose.Schema({
  numero_pedido: Number,
  productos: [ProductoSchema],
  total: Number,
  tipo_pago: String,
  tipo_pedido: { type: String, default: "tienda" },
  hora_retiro: { type: String, default: "" },
  estado_pedido: { type: String, default: "pendiente" },
  historial_estados: [
    {
      estado: String,
      nota: String,
      usuario_id: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", default: null },
      usuario_rol: String,
      fecha: { type: Date, default: Date.now }
    }
  ],
  local: { type: mongoose.Schema.Types.ObjectId, ref: "Local", default: null },
  fecha: { type: Date, default: Date.now },
  cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente" },
  cliente_email: String,
  cliente_nombre: String,
  cliente_direccion: { type: String, default: "" },
  cliente_coords: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  delivery_zone_name: { type: String, default: "" },
  cliente_telefono: String,
  repartidor_asignado: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", default: null },
  fecha_asignacion_repartidor: { type: Date, default: null }
});

module.exports = mongoose.model("VentaCliente", VentaClienteSchema);
