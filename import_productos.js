const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Producto = require('./models/product.model.js');
const Categoria = require('./models/categoria.model.js');

dotenv.config({ path: path.join(__dirname, '.env') });

const args = process.argv.slice(2);
const csvPath = args[0]
  ? path.resolve(args[0])
  : path.resolve(__dirname, '..', 'product.csv');
const debug = args.includes('--debug');

const normalizeHeader = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const parseCSV = (input, delimiter = ',') => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const parseNumber = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9,.-]/g, '');
  if (!cleaned) return null;
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    return Number(cleaned.replace(',', '.'));
  }
  return Number(cleaned.replace(/,/g, ''));
};

const obtenerCategoria = async (raw) => {
  if (!raw) return null;
  const primera = raw.split(',')[0].trim();
  if (!primera) return null;
  const nombre = primera.split('>').pop().trim();
  if (!nombre) return null;
  const existente = await Categoria.findOne({ nombre });
  if (existente) return existente._id;
  const creada = await Categoria.create({ nombre, descripcion: '' });
  return creada._id;
};

const buildVariant = (row, indices) => {
  const {
    idxSku,
    idxInventario,
    idxPrecio,
    idxNombreAttr,
    idxValorAttr
  } = indices;

  const sku = String(row[idxSku] || '').trim();
  const inventario = parseNumber(String(row[idxInventario] || '').trim());
  const stock = inventario && inventario > 0 ? Math.floor(inventario) : 0;
  const precio = parseNumber(String(row[idxPrecio] || '').trim());

  if (!Number.isFinite(precio)) return null;

  const nombreParts = [];
  let color = undefined;
  let talla = undefined;

  for (let i = 0; i < idxValorAttr.length; i += 1) {
    const nombreAttr = String(row[idxNombreAttr[i]] || '').trim();
    const valorRaw = String(row[idxValorAttr[i]] || '').trim();
    if (!valorRaw) continue;

    const valor = valorRaw.split(',')[0].trim();
    if (valor) nombreParts.push(valor);

    const key = normalizeHeader(nombreAttr);
    if (key.includes('color')) color = valor;
    if (key.includes('talla')) talla = valor;
  }

  const nombre = nombreParts.join(' / ') || sku || 'Variante';

  const variante = { nombre, precio, stock };
  if (sku) variante.sku = sku;
  if (color) variante.color = color;
  if (talla) variante.talla = talla;

  return variante;
};

const main = async () => {
  if (!fs.existsSync(csvPath)) {
    console.error(`No se encontro el archivo: ${csvPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    console.error('El CSV no tiene datos.');
    process.exit(1);
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const indexByHeader = new Map();
  headers.forEach((header, idx) => {
    indexByHeader.set(normalizeHeader(header), idx);
  });

  const getIndex = (keys) => {
    for (const key of keys) {
      if (indexByHeader.has(key)) return indexByHeader.get(key);
    }
    return undefined;
  };

  const idxId = getIndex(['id']);
  const idxTipo = getIndex(['tipo']);
  const idxNombre = getIndex(['nombre']);
  const idxCategorias = getIndex(['categorias', 'categoras']);
  const idxInventario = getIndex(['inventario']);
  const idxImagenes = getIndex(['imagenes', 'imgenes']);
  const idxPrecio = getIndex(['precionormal']);
  const idxSku = getIndex(['sku']);
  const idxSuperior = getIndex(['superior']);
  const idxNombreAttr = [
    getIndex(['nombredelatributo1']),
    getIndex(['nombredelatributo2']),
    getIndex(['nombredelatributo3']),
    getIndex(['nombredelatributo4'])
  ];
  const idxValorAttr = [
    getIndex(['valoresdelatributo1']),
    getIndex(['valoresdelatributo2']),
    getIndex(['valoresdelatributo3']),
    getIndex(['valoresdelatributo4'])
  ];

  if (
    idxId === undefined ||
    idxTipo === undefined ||
    idxNombre === undefined ||
    idxCategorias === undefined ||
    idxInventario === undefined ||
    idxImagenes === undefined ||
    idxPrecio === undefined ||
    idxSku === undefined ||
    idxSuperior === undefined
  ) {
    console.error('Faltan columnas requeridas en el CSV.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const motivos = new Map();
  const muestras = new Map();

  const bases = new Map();
  const variantesPorPadre = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const id = String(row[idxId] || '').trim();
    const tipo = String(row[idxTipo] || '').trim().toLowerCase();

    if (tipo === 'variation') {
      const parentId = String(row[idxSuperior] || '').trim();
      if (!parentId) {
        omitidos += 1;
        if (debug) {
          const motivo = 'variacion_sin_padre';
          motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
        }
        continue;
      }

      const variante = buildVariant(row, {
        idxSku,
        idxInventario,
        idxPrecio,
        idxNombreAttr,
        idxValorAttr
      });

      if (!variante) {
        omitidos += 1;
        if (debug) {
          const motivo = 'variacion_sin_precio';
          motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
        }
        continue;
      }

      if (!variantesPorPadre.has(parentId)) {
        variantesPorPadre.set(parentId, []);
      }
      variantesPorPadre.get(parentId).push(variante);
      continue;
    }

    if (!id) {
      omitidos += 1;
      if (debug) {
        const motivo = 'id_vacio';
        motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
      }
      continue;
    }

    bases.set(id, {
      id,
      tipo,
      nombre: String(row[idxNombre] || '').trim(),
      sku: String(row[idxSku] || '').trim(),
      categoriaRaw: String(row[idxCategorias] || '').trim(),
      inventarioRaw: String(row[idxInventario] || '').trim(),
      imagenRaw: String(row[idxImagenes] || '').trim(),
      precioRaw: String(row[idxPrecio] || '').trim()
    });
  }

  for (const base of bases.values()) {
    const sku = base.sku || (base.id ? `woo-${base.id}` : '');
    const nombre = base.nombre;

    if (!sku || !nombre) {
      omitidos += 1;
      if (debug) {
        const motivo = !sku ? 'sku_vacio' : 'nombre_vacio';
        motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
        if (!muestras.has(motivo)) muestras.set(motivo, []);
        const lista = muestras.get(motivo);
        if (lista.length < 5) {
          lista.push({ fila: base.id, sku, nombre, precio: base.precioRaw });
        }
      }
      continue;
    }

    const variantes = base.tipo === 'variable'
      ? (variantesPorPadre.get(base.id) || [])
      : [];

    let precio = parseNumber(base.precioRaw);
    if (!Number.isFinite(precio)) {
      if (variantes.length > 0) {
        const precios = variantes.map((v) => v.precio).filter((v) => Number.isFinite(v));
        precio = precios.length > 0 ? Math.min(...precios) : null;
      }
    }

    if (!Number.isFinite(precio)) {
      omitidos += 1;
      if (debug) {
        const motivo = 'precio_vacio';
        motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
        if (!muestras.has(motivo)) muestras.set(motivo, []);
        const lista = muestras.get(motivo);
        if (lista.length < 5) {
          lista.push({ fila: base.id, sku, nombre, precio: base.precioRaw });
        }
      }
      continue;
    }

    const inventario = parseNumber(base.inventarioRaw);
    const stockBase = inventario && inventario > 0 ? Math.floor(inventario) : null;
    const stockVariantes = variantes.reduce((acc, v) => acc + (v.stock || 0), 0);
    const stock = variantes.length > 0
      ? (stockVariantes > 0 ? stockVariantes : null)
      : stockBase;

    const imagenUrl = base.imagenRaw.split(',')[0].trim();
    const categoriaId = await obtenerCategoria(base.categoriaRaw);

    const updateDoc = {
      sku,
      nombre,
      precio,
      stock,
      categoria: categoriaId || null
    };

    if (imagenUrl) updateDoc.imagen_url = imagenUrl;
    if (variantes.length > 0) updateDoc.variantes = variantes;

    const existe = await Producto.exists({ sku });
    await Producto.findOneAndUpdate(
      { sku },
      updateDoc,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (existe) actualizados += 1;
    else insertados += 1;
  }

  console.log(`Importacion completa. Insertados: ${insertados}, Actualizados: ${actualizados}, Omitidos: ${omitidos}`);
  if (debug && omitidos > 0) {
    console.log('Motivos de omision:');
    for (const [motivo, cantidad] of motivos.entries()) {
      console.log(`- ${motivo}: ${cantidad}`);
      const lista = muestras.get(motivo) || [];
      for (const muestra of lista) {
        console.log(`  fila ${muestra.fila} sku="${muestra.sku}" nombre="${muestra.nombre}" precio="${muestra.precio}"`);
      }
    }
  }
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error('Error en importacion:', err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
