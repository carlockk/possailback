const mongoose = require('mongoose');
const Usuario = require('../models/usuario.model');
const { runAsPlatform } = require('../utils/tenantContext');

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const run = async () => {
  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (email !== 'virtualdeskspa@gmail.com') throw new Error('Correo de plataforma inesperado');
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'possail' });
  const user = await runAsPlatform(async () => await Usuario.findOne({ email }));
  if (!user || user.tenantId || !['superadmin', 'platform_admin'].includes(user.rol)) {
    throw new Error('El usuario no corresponde a la cuenta inicial de plataforma');
  }
  if (user.rol !== 'platform_admin') {
    user.rol = 'platform_admin';
    await runAsPlatform(() => user.save());
  }
  console.log('Cuenta de plataforma preparada:', user.email);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error('Migración falló:', error.message);
  process.exit(1);
});
