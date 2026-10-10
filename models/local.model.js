const mongoose = require('mongoose');

const localSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  direccion: { type: String, trim: true },
  telefono: { type: String, trim: true },
  correo: { type: String, trim: true },
  servicios: {
    tienda: { type: Boolean, default: true },
    retiro: { type: Boolean, default: true },
    delivery: { type: Boolean, default: true },
  },
  pagos_web: {
    efectivo: { type: Boolean, default: true },
    tarjeta: { type: Boolean, default: true },
    transferencia: { type: Boolean, default: false },
    transferencia_datos: {
      nombre: { type: String, trim: true, default: "" },
      rut: { type: String, trim: true, default: "" },
      numero_cuenta: { type: String, trim: true, default: "" },
      correo: { type: String, trim: true, default: "" },
    },
  },
  delivery_zones: [
    {
      name: { type: String, trim: true, default: "" },
      color: { type: String, trim: true, default: "#2563eb" },
      active: { type: Boolean, default: true },
      priority: { type: Number, default: 0 },
      polygon: [
        {
          lat: { type: Number, required: true },
          lng: { type: Number, required: true },
        }
      ],
    }
  ],
  creado_en: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Local', localSchema);
