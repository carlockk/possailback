const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario.model.js');

const bootstrapSuperadmin = async ({ force = false } = {}) => {
  if (!force && process.env.BOOTSTRAP_SUPERADMIN !== 'true') return;

  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  const nombre = String(process.env.SUPERADMIN_NAME || 'Administrador').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !nombre) {
    throw new Error('Configura SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (minimo 12 caracteres)');
  }

  const existente = await Usuario.findOne({ rol: 'superadmin' }).select('email').lean();
  if (existente) {
    console.log(`Ya existe un superadmin: ${existente.email}`);
    return;
  }

  if (await Usuario.exists({ email })) {
    throw new Error('SUPERADMIN_EMAIL ya pertenece a un usuario con otro rol');
  }

  await Usuario.create({
    email,
    password: await bcrypt.hash(password, 10),
    nombre,
    rol: 'superadmin'
  });
  console.log(`Superadmin creado: ${email}`);
};

module.exports = { bootstrapSuperadmin };
