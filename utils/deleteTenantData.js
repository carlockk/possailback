const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

// Registrar todos los modelos del negocio, incluso los que aun no haya usado una ruta.
const modelsDir = path.join(__dirname, '..', 'models');
for (const file of fs.readdirSync(modelsDir)) {
  if (file.endsWith('.js')) require(path.join(modelsDir, file));
}

const deleteTenantData = async (tenantId, session) => {
  const models = mongoose.modelNames()
    .map((name) => mongoose.model(name))
    .filter((model) => model.schema.path('tenantId'));

  for (const model of models) {
    await model.deleteMany({ tenantId }, { session });
  }
};

module.exports = deleteTenantData;
