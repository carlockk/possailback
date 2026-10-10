const { AsyncLocalStorage } = require('node:async_hooks');
const mongoose = require('mongoose');

const storage = new AsyncLocalStorage();

const getTenantContext = () => storage.getStore();
const runForTenant = (tenantId, callback) => {
  if (!mongoose.Types.ObjectId.isValid(tenantId)) {
    throw new Error('Negocio invalido');
  }
  return storage.run({ tenantId: String(tenantId) }, callback);
};
const runAsPlatform = (callback) => storage.run({ platform: true }, callback);

const requireTenantContext = () => {
  const context = getTenantContext();
  if (context?.platform) return null;
  if (!context?.tenantId) throw new Error('Contexto de negocio requerido');
  return new mongoose.Types.ObjectId(context.tenantId);
};

const tenantPlugin = (schema) => {
  if (!schema.path('tenantId')) {
    schema.add({ tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true } });
  }
  schema.index({ tenantId: 1 });

  const scopeQuery = function () {
    const tenantId = requireTenantContext();
    if (!tenantId) return;
    const filter = this.getFilter();
    if (filter.tenantId && String(filter.tenantId) !== String(tenantId)) {
      throw new Error('Acceso a otro negocio denegado');
    }
    this.where({ tenantId });
    if (/^(update|findOneAndUpdate|replace)/.test(this.op)) {
      const update = this.getUpdate() || {};
      if (Object.prototype.hasOwnProperty.call(update, 'tenantId') ||
          ['$set', '$unset', '$rename', '$setOnInsert'].some((operator) =>
            Object.prototype.hasOwnProperty.call(update[operator] || {}, 'tenantId'))) {
        throw new Error('No se puede cambiar el negocio de un registro');
      }
    }
  };

  for (const op of [
    'find', 'findOne', 'countDocuments', 'distinct',
    'updateOne', 'updateMany', 'findOneAndUpdate',
    'deleteOne', 'deleteMany', 'findOneAndDelete',
    'findOneAndReplace', 'replaceOne'
  ]) {
    schema.pre(op, scopeQuery);
  }

  schema.pre('aggregate', function () {
    const tenantId = requireTenantContext();
    if (!tenantId) return;
    const pipeline = this.pipeline();
    const index = pipeline[0]?.$geoNear ? 1 : 0;
    pipeline.splice(index, 0, { $match: { tenantId } });
  });

  schema.pre('validate', function () {
    const tenantId = requireTenantContext();
    if (!tenantId) return;
    if (this.tenantId && String(this.tenantId) !== String(tenantId)) {
      throw new Error('Acceso a otro negocio denegado');
    }
    this.tenantId = tenantId;
  });

  schema.pre('insertMany', function (next, documents) {
    try {
      const tenantId = requireTenantContext();
      if (tenantId) {
        for (const document of documents) {
          if (document.tenantId && String(document.tenantId) !== String(tenantId)) {
            throw new Error('Acceso a otro negocio denegado');
          }
          document.tenantId = tenantId;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  });
};

const registerTenantModel = (name, schema) => {
  schema.plugin(tenantPlugin);
  return mongoose.model(name, schema);
};

module.exports = {
  getTenantContext,
  runForTenant,
  runAsPlatform,
  requireTenantContext,
  registerTenantModel,
};
