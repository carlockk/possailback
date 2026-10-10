const mongoose = require('mongoose');

const restauranteMesaSchema = new mongoose.Schema(
  {
    local: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Local',
      required: true
    },
    numero: {
      type: Number,
      required: true,
      min: 1
    },
    nombre: {
      type: String,
      trim: true,
      default: ''
    },
    zona: {
      type: String,
      trim: true,
      default: ''
    },
    capacidad: {
      type: Number,
      min: 1,
      default: 4
    },
    estado: {
      type: String,
      enum: ['libre', 'ocupada', 'reservada', 'inactiva'],
      default: 'libre'
    },
    meseroAsignado: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      default: null
    },
    asignadaEn: {
      type: Date,
      default: null
    },
    activa: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

restauranteMesaSchema.index({ local: 1, numero: 1 }, { unique: true });

module.exports = mongoose.model('RestauranteMesa', restauranteMesaSchema);
