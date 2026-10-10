const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { bootstrapSuperadmin } = require('./utils/bootstrapSuperadmin');

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('Configura MONGO_URI antes de crear el administrador');

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || 'davimotors'
  });

  try {
    await bootstrapSuperadmin({ force: true });
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('❌ Error al crear superadmin:', err);
  process.exit(1);
});
