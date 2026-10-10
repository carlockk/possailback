const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario.model.js');
const { runAsPlatform } = require('./tenantContext');

const bootstrapSuperadmin = ({ force = false } = {}) => runAsPlatform(async () => {
  if (!force && process.env.BOOTSTRAP_SUPERADMIN !== 'true') return;

  const existente = await Usuario.findOne({ rol: 'platform_admin' }).select('email').lean();
  if (existente) {
    console.log(`Ya existe un administrador de plataforma: ${existente.email}`);
    return;
  }

  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  const nombre = String(process.env.SUPERADMIN_NAME || 'Administrador').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !nombre) {
    throw new Error('Configura SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (minimo 12 caracteres)');
  }

  if (await Usuario.exists({ email })) {
    throw new Error('SUPERADMIN_EMAIL ya pertenece a un usuario con otro rol');
  }

  await Usuario.create({
    email,
    password: await bcrypt.hash(password, 10),
    nombre,
    rol: 'platform_admin'
  });
  console.log(`Superadmin creado: ${email}`);
});

module.exports = { bootstrapSuperadmin };
