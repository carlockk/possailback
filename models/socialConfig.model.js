const mongoose = require('mongoose');

const socialEntrySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    url: { type: String, default: '' }
  },
  { _id: false }
);

const horarioRangoSchema = new mongoose.Schema(
  {
    inicio: { type: String, required: true },
    fin: { type: String, required: true }
  },
  { _id: false }
);

const horarioDiaSchema = new mongoose.Schema(
  {
    dia: { type: Number, min: 0, max: 6, required: true },
    tramos: { type: [horarioRangoSchema], default: [] }
  },
  { _id: false }
);

const socialConfigSchema = new mongoose.Schema(
  {
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true, unique: true },
    logo_url: { type: String, default: '' },
    logo_cloudinary_id: { type: String, default: '' },
    facebook: { type: socialEntrySchema, default: () => ({}) },
    instagram: { type: socialEntrySchema, default: () => ({}) },
    tiktok: { type: socialEntrySchema, default: () => ({}) },
    youtube: { type: socialEntrySchema, default: () => ({}) },
    x: { type: socialEntrySchema, default: () => ({}) },
    whatsapp: { type: socialEntrySchema, default: () => ({}) },
    horarios_web: { type: [horarioDiaSchema], default: [] },
    actualizado_en: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SocialConfig', socialConfigSchema);
