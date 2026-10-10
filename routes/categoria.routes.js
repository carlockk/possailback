const express = require('express');
const mongoose = require('mongoose');
const Categoria = require('../models/categoria.model.js');
const { sanitizeText, sanitizeOptionalText } = require('../utils/input');
const { adjuntarScopeLocal, requiereLocal } = require('../middlewares/localScope');

const router = express.Router();
router.use(adjuntarScopeLocal);
router.use(requiereLocal);

const categoriaGeneraCiclo = async ({ localId, categoriaId, posibleParentId }) => {
  if (!categoriaId || !posibleParentId) return false;
  if (String(categoriaId) === String(posibleParentId)) return true;

  let actualId = String(posibleParentId);
  const visitados = new Set();

  while (actualId && !visitados.has(actualId)) {
    visitados.add(actualId);
    if (actualId === String(categoriaId)) return true;

    const actual = await Categoria.findOne(
      { _id: actualId, local: localId },
      'parent'
    ).lean();
    if (!actual?.parent) return false;
    actualId = String(actual.parent);
  }

  return false;
};

/**
 * @swagger
 * tags:
 *   name: Categorías
 *   description: Operaciones CRUD para categorías
 */

/**
 * @swagger
 * /categorias:
 *   get:
 *     summary: Obtener todas las categorías
 *     tags: [Categorías]
 *     responses:
 *       200:
 *         description: Lista de categorías
 *       500:
 *         description: Error al obtener categorías
 */
router.get('/', async (req, res) => {
  try {
    const categorias = await Categoria.find({ local: req.localId }).sort({ nombre: 1 });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

/**
 * @swagger
 * /categorias/{id}:
 *   get:
 *     summary: Obtener una categoría por ID
 *     tags: [Categorías]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la categoría
 *     responses:
 *       200:
 *         description: Categoría encontrada
 *       404:
 *         description: Categoría no encontrada
 *       500:
 *         description: Error en el servidor
 */
router.get('/:id', async (req, res) => {
  try {
    const categoria = await Categoria.findOne({
      _id: req.params.id,
      local: req.localId
    });
    if (!categoria) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar la categoría' });
  }
});

/**
 * @swagger
 * /categorias:
 *   post:
 *     summary: Crear nueva categoría
 *     tags: [Categorías]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Bebidas
 *               descripcion:
 *                 type: string
 *                 example: Productos líquidos para consumo
 *     responses:
 *       201:
 *         description: Categoría creada exitosamente
 *       400:
 *         description: Validación fallida o ya existe
 *       500:
 *         description: Error al crear categoría
 */
router.post('/', async (req, res) => {
  try {
    const nombre = sanitizeText(req.body.nombre, { max: 60 });
    const descripcion = sanitizeOptionalText(req.body.descripcion, { max: 200 });
    const parentRaw = req.body.parent;

    if (!nombre) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    let parentId = null;
    if (parentRaw !== undefined && parentRaw !== null && String(parentRaw).trim() !== '') {
      if (!mongoose.Types.ObjectId.isValid(parentRaw)) {
        return res.status(400).json({ error: 'Categoría padre inválida' });
      }
      const parent = await Categoria.findOne({ _id: parentRaw, local: req.localId });
      if (!parent) {
        return res.status(400).json({ error: 'Categoría padre no encontrada' });
      }
      parentId = parentRaw;
    }

    const existe = await Categoria.findOne({ nombre, local: req.localId });
    if (existe) {
      return res.status(400).json({ error: 'Ya existe esa categoría' });
    }

    const nueva = new Categoria({
      nombre,
      descripcion: descripcion || "",
      parent: parentId,
      local: req.localId
    });

    const guardada = await nueva.save();
    res.status(201).json(guardada);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

/**
 * @swagger
 * /categorias/{id}:
 *   put:
 *     summary: Editar una categoría existente
 *     tags: [Categorías]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la categoría
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Comidas
 *               descripcion:
 *                 type: string
 *                 example: Productos sólidos para consumo
 *     responses:
 *       200:
 *         description: Categoría actualizada
 *       400:
 *         description: Validación fallida o nombre duplicado
 *       404:
 *         description: Categoría no encontrada
 *       500:
 *         description: Error del servidor
 */
router.put('/:id', async (req, res) => {
  try {
    const nombre = sanitizeText(req.body.nombre, { max: 60 });
    const descripcion = sanitizeOptionalText(req.body.descripcion, { max: 200 });
    const parentRaw = req.body.parent;

    if (!nombre) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    const categoria = await Categoria.findOne({ _id: req.params.id, local: req.localId });
    if (!categoria) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    const existe = await Categoria.findOne({
      nombre,
      _id: { $ne: req.params.id },
      local: req.localId
    });
    if (existe) {
      return res.status(400).json({ error: 'Ya existe otra categoría con ese nombre' });
    }

    let parentId = null;
    if (parentRaw !== undefined) {
      if (parentRaw === null || String(parentRaw).trim() === '') {
        parentId = null;
      } else if (!mongoose.Types.ObjectId.isValid(parentRaw)) {
        return res.status(400).json({ error: 'Categoría padre inválida' });
      } else if (String(parentRaw) === String(req.params.id)) {
        return res.status(400).json({ error: 'La categoría no puede ser su propio padre' });
      } else {
        const parent = await Categoria.findOne({ _id: parentRaw, local: req.localId });
        if (!parent) {
          return res.status(400).json({ error: 'Categoría padre no encontrada' });
        }
        const generaCiclo = await categoriaGeneraCiclo({
          localId: req.localId,
          categoriaId: req.params.id,
          posibleParentId: parentRaw
        });
        if (generaCiclo) {
          return res.status(400).json({ error: 'La categoría padre genera un ciclo inválido' });
        }
        parentId = parentRaw;
      }
    } else {
      parentId = categoria.parent || null;
    }

    categoria.nombre = nombre;
    categoria.descripcion = descripcion || "";
    categoria.parent = parentId;

    const actualizada = await categoria.save();
    res.json(actualizada);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

/**
 * @swagger
 * /categorias/{id}:
 *   delete:
 *     summary: Eliminar una categoría
 *     tags: [Categorías]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la categoría
 *     responses:
 *       200:
 *         description: Categoría eliminada correctamente
 *       404:
 *         description: Categoría no encontrada
 *       500:
 *         description: Error al eliminar categoría
 */
router.delete('/:id', async (req, res) => {
  try {
    const categoria = await Categoria.findOne({ _id: req.params.id, local: req.localId });
    if (!categoria) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    const tieneHijas = await Categoria.exists({ parent: req.params.id, local: req.localId });
    if (tieneHijas) {
      return res.status(400).json({ error: 'No se puede eliminar una categoría con subcategorías' });
    }

    await Categoria.findOneAndDelete({ _id: req.params.id, local: req.localId });
    res.json({ mensaje: 'Categoría eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

router.post('/clonar', async (req, res) => {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'No tienes permisos para clonar categorias' });
    }

    const { sourceLocalId, categoriaId, clonarTodas } = req.body || {};
    if (!sourceLocalId || (!categoriaId && !clonarTodas)) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    if (!mongoose.Types.ObjectId.isValid(sourceLocalId)) {
      return res.status(400).json({ error: 'Local origen invalido' });
    }
    if (categoriaId && !mongoose.Types.ObjectId.isValid(categoriaId)) {
      return res.status(400).json({ error: 'Categoria invalida' });
    }
    if (String(sourceLocalId) === String(req.localId)) {
      return res.status(400).json({ error: 'El local origen y destino deben ser distintos' });
    }

    const todas = await Categoria.find({ local: sourceLocalId });
    const porId = new Map(todas.map((c) => [c._id.toString(), c]));
    const hijosMap = new Map();
    todas.forEach((c) => {
      const parentId = c.parent ? c.parent.toString() : null;
      if (!hijosMap.has(parentId)) hijosMap.set(parentId, []);
      hijosMap.get(parentId).push(c);
    });

    const subtree = [];
    if (clonarTodas) {
      subtree.push(...todas);
    } else {
      const origen = await Categoria.findOne({ _id: categoriaId, local: sourceLocalId });
      if (!origen) {
        return res.status(404).json({ error: 'Categoria origen no encontrada' });
      }

      const stack = [origen];
      const seen = new Set();
      while (stack.length) {
        const current = stack.pop();
        if (!current || seen.has(current._id.toString())) continue;
        seen.add(current._id.toString());
        subtree.push(current);
        const hijos = hijosMap.get(current._id.toString()) || [];
        hijos.forEach((h) => stack.push(h));
      }
    }

    const nombres = subtree.map((c) => c.nombre);
    const existentes = await Categoria.find({ local: req.localId, nombre: { $in: nombres } });
    if (existentes.length > 0) {
      return res.status(400).json({ error: `Ya existe la categoria "${existentes[0].nombre}" en este local` });
    }

    const depthMap = new Map();
    const calcDepth = (cat) => {
      if (!cat.parent) return 0;
      const pid = cat.parent.toString();
      if (!porId.has(pid)) return 0;
      if (depthMap.has(cat._id.toString())) return depthMap.get(cat._id.toString());
      const parent = porId.get(pid);
      const depth = calcDepth(parent) + 1;
      depthMap.set(cat._id.toString(), depth);
      return depth;
    };
    subtree.forEach((cat) => calcDepth(cat));
    const ordered = [...subtree].sort(
      (a, b) => (depthMap.get(a._id.toString()) || 0) - (depthMap.get(b._id.toString()) || 0)
    );

    const idMap = new Map();
    for (const cat of ordered) {
      const parentOld = cat.parent ? cat.parent.toString() : null;
      const parentNew = parentOld && idMap.has(parentOld) ? idMap.get(parentOld) : null;
      const nueva = new Categoria({
        nombre: cat.nombre,
        descripcion: cat.descripcion || '',
        parent: parentNew,
        local: req.localId
      });
      const guardada = await nueva.save();
      idMap.set(cat._id.toString(), guardada._id);
    }

    res.json({ mensaje: 'Categorias clonadas correctamente', cantidad: ordered.length });
  } catch (error) {
    res.status(500).json({ error: 'Error al clonar categorias' });
  }
});

module.exports = router;
