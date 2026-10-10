const mongoose = require('mongoose');

const comandaItemSchema = new mongoose.Schema(
  {
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductoLocal',
      required: true
    },
    nombre: {
      type: String,
      required: true,
      trim: true
    },
    precio_unitario: {
      type: Number,
      required: true,
      min: 0
    },
    cantidad: {
      type: Number,
      required: true,
      min: 1
    },
    nota: {
      type: String,
      trim: true,
      default: ''
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0
    }
  },
  { _id: true }
);

const restauranteComandaSchema = new mongoose.Schema(
  {
    local: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Local',
      required: true
    },
    mesa: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RestauranteMesa',
      required: true
    },
    mesero: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      default: null
    },
    estado: {
      type: String,
      enum: ['abierta', 'en_preparacion', 'lista', 'entregada', 'lista_para_cobro', 'cerrada', 'cancelada'],
      default: 'abierta'
    },
    observacion: {
      type: String,
      trim: true,
      default: ''
    },
    items: {
      type: [comandaItemSchema],
      default: []
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      default: 0,
      min: 0
    },
    abiertaEn: {
      type: Date,
      default: Date.now
    },
    cerradaEn: {
      type: Date,
      default: null
    },
    cobradaEn: {
      type: Date,
      default: null
    },
    cobradaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      default: null
    },
    tipo_pago: {
      type: String,
      default: ''
    },
    tipo_pedido: {
      type: String,
      default: ''
    },
    origen_cobro: {
      type: String,
      enum: ['caja', 'mesa'],
      default: null
    },
    rendicion_efectivo_pendiente: {
      type: Boolean,
      default: false
    },
    rendidoEn: {
      type: Date,
      default: null
    },
    ventaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venta',
      default: null
    }
  },
  { timestamps: true }
);

restauranteComandaSchema.pre('validate', function (next) {
  if (!Array.isArray(this.items)) {
    this.items = [];
  }

  const subtotal = this.items.reduce((acc, item) => {
    const precio = Number(item?.precio_unitario) || 0;
    const cantidad = Number(item?.cantidad) || 0;
    const itemSubtotal = precio * cantidad;
    item.subtotal = itemSubtotal;
    return acc + itemSubtotal;
  }, 0);

  this.subtotal = subtotal;
  this.total = subtotal;
  next();
});

restauranteComandaSchema.index({ local: 1, mesa: 1, createdAt: -1 });
restauranteComandaSchema.index({ local: 1, estado: 1, createdAt: -1 });

module.exports = mongoose.model('RestauranteComanda', restauranteComandaSchema);
