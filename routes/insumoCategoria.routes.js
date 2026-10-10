const express = require('express');
const mongoose = require('mongoose');
const InsumoCategoria = require('../models/insumoCategoria.model');
const Insumo = require('../models/insumo.model');
const { sanitizeText } = require('../utils/input');
const { adjuntarScopeLocal, requiereLocal } = require('../middlewares/localScope');

const router = express.Router();
router.use(adjuntarScopeLocal);
router.use(requiereLocal);

router.get('/', async (req, res) => {
  try {
    const categorias = await InsumoCategoria.find({ local: req.localId }).sort({ orden: 1, nombre: 1 });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener categorias' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const nombre = sanitizeText(req.body.nombre, { max: 80 });
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const existe = await InsumoCategoria.findOne({ local: req.localId, nombre });
    if (existe) return res.status(400).json({ error: 'Ya existe una categoria con ese nombre' });
    const nueva = await InsumoCategoria.create({ nombre, local: req.localId });
    res.status(201).json(nueva);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear categoria' });
  }
});

router.put('/orden', async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const orden = Array.isArray(req.body?.orden) ? req.body.orden : [];
    const ids = Array.from(new Set(orden.filter((id) => mongoose.Types.ObjectId.isValid(id))));
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Orden invalido' });
    }
    await Promise.all(
      ids.map((id, index) =>
        InsumoCategoria.updateOne({ _id: id, local: req.localId }, { orden: index + 1 })
      )
    );
    res.json({ mensaje: 'Orden actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar orden' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const nombre = sanitizeText(req.body.nombre, { max: 80 });
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const categoria = await InsumoCategoria.findOneAndUpdate(
      { _id: req.params.id, local: req.localId },
      { nombre },
      { new: true }
    );
    if (!categoria) return res.status(404).json({ error: 'Categoria no encontrada' });
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar categoria' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.userRole)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const categoria = await InsumoCategoria.findOne({ _id: req.params.id, local: req.localId });
    if (!categoria) return res.status(404).json({ error: 'Categoria no encontrada' });
    await Insumo.updateMany({ local: req.localId, categoria: categoria._id }, { categoria: null });
    await categoria.deleteOne();
    res.json({ mensaje: 'Categoria eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar categoria' });
  }
});

module.exports = router;
