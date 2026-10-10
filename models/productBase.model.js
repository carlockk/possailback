const mongoose = require('mongoose');

const varianteBaseSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    color: { type: String, trim: true },
    talla: { type: String, trim: true },
    sku: { type: String, trim: true }
  },
  { _id: true }
);

const productBaseSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true },
    imagen_url: { type: String },
    cloudinary_id: { type: String },
    categoria: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Categoria',
      default: null
    },
    variantes: [varianteBaseSchema],
    creado_en: { type: Date, default: Date.now }
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

module.exports = mongoose.model('ProductoBase', productBaseSchema);
