const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const router = express.Router();
const VentaCliente = require("../models/ventaCliente.model");
const PedidoEstadoConfig = require("../models/pedidoEstadoConfig.model");
const Local = require("../models/local.model");
const SocialConfig = require("../models/socialConfig.model");
const Usuario = require("../models/usuario.model");
const authMiddleware = require("../middlewares/auth");
const Cliente = require("../models/Cliente");
const {
  sanitizeText,
  sanitizeOptionalText,
  normalizeEmail,
  isValidEmail,
  toNumberOrNull
} = require("../utils/input");
const { adjuntarScopeLocal, requiereLocal } = require("../middlewares/localScope");
const { getJwtSecret } = require("../utils/jwtConfig");
const {
  evaluateWebSchedule,
  normalizeWebSchedule,
  validatePickupTime,
  resolveScheduleClock,
} = require("../utils/webSchedule");
const { normalizeCoordinate, resolveMatchingZone } = require("../utils/deliveryZones");

const JWT_SECRET = getJwtSecret();
const DEFAULT_ESTADOS_PEDIDO = [
  "pendiente",
  "aceptado",
  "preparando",
  "repartidor llego al restaurante",
  "repartidor esta en espera",
  "repartidor va con tu pedido",
  "llego el repartidor",
  "listo",
  "entregado",
  "rechazado",
  "cancelado"
];
const DEFAULT_ESTADOS_REPARTIDOR = [
  "repartidor llego al restaurante",
  "repartidor esta en espera",
  "repartidor va con tu pedido",
  "llego el repartidor",
  "entregado",
  "cancelado"
];

const obtenerClienteIdDesdeToken = (req) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.id || null;
  } catch {
    return null;
  }
};

const obtenerConfigEstados = async (localId) => {
  let config = await PedidoEstadoConfig.findOne({ local: localId });
  if (!config) {
    config = await PedidoEstadoConfig.create({
      local: localId,
      estados: DEFAULT_ESTADOS_PEDIDO,
      estados_repartidor: DEFAULT_ESTADOS_REPARTIDOR
    });
    return config;
  }

  let changed = false;

  if (!Array.isArray(config.estados) || config.estados.length === 0) {
    config.estados = DEFAULT_ESTADOS_PEDIDO;
    changed = true;
  }

  const actuales = new Set(config.estados.map((item) => String(item).toLowerCase()));
  const faltantes = DEFAULT_ESTADOS_PEDIDO.filter((estado) => !actuales.has(estado));
  if (faltantes.length > 0) {
    config.estados = [...config.estados, ...faltantes];
    changed = true;
  }

  if (!Array.isArray(config.estados_repartidor) || config.estados_repartidor.length === 0) {
    config.estados_repartidor = [...DEFAULT_ESTADOS_REPARTIDOR];
    changed = true;
  }

  const estadosSet = new Set((config.estados || []).map((item) => String(item).toLowerCase()));
  const repartidorSaneado = (config.estados_repartidor || [])
    .map((item) => String(item || "").toLowerCase())
    .filter((item, idx, arr) => item && arr.indexOf(item) === idx && estadosSet.has(item));
  if (repartidorSaneado.length !== (config.estados_repartidor || []).length) {
    config.estados_repartidor = repartidorSaneado;
    changed = true;
  }

  if (changed) {
    await config.save();
  }

  return config;
};

const normalizarAgregados = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((agg) => {
      const nombre = sanitizeOptionalText(agg?.nombre, { max: 80 }) || "";
      if (!nombre) return null;
      const precio = Number(agg?.precio);
      return {
        agregadoId: mongoose.Types.ObjectId.isValid(agg?.agregadoId) ? agg.agregadoId : null,
        nombre,
        precio: Number.isFinite(precio) && precio > 0 ? precio : 0
      };
    })
    .filter(Boolean);
};

const normalizarProductos = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    ...item,
    nombre: sanitizeOptionalText(item?.nombre, { max: 120 }) || "",
    observacion: sanitizeOptionalText(item?.observacion, { max: 160 }) || "",
    varianteNombre: sanitizeOptionalText(item?.varianteNombre, { max: 80 }) || "",
    agregados: normalizarAgregados(item?.agregados)
  }));
};

const normalizarTipoPedido = (raw) => {
  const tipo = (sanitizeOptionalText(raw, { max: 30 }) || "").toLowerCase();
  if (!tipo) return "";
  if (["delivery", "domicilio", "reparto", "reparto_domicilio"].includes(tipo)) return "delivery";
  if (["retiro", "retiro_tienda", "pickup"].includes(tipo)) return "retiro";
  if (["tienda", "local", "consumo_local"].includes(tipo)) return "tienda";
  return tipo;
};

const inferirTipoPedidoDesdeProductos = (productos = []) => {
  for (const item of Array.isArray(productos) ? productos : []) {
    const obs = String(item?.observacion || "").toLowerCase();
    if (!obs) continue;
    if (obs.includes("delivery:") && !obs.includes("sin delivery")) {
      return "delivery";
    }
  }
  return "tienda";
};

const esPedidoDeliveryLegacy = (pedido) => {
  const tipo = normalizarTipoPedido(pedido?.tipo_pedido);
  if (tipo === "delivery") return true;
  const items = Array.isArray(pedido?.productos) ? pedido.productos : [];
  return items.some((item) => {
    const obs = String(item?.observacion || "").toLowerCase();
    return obs.includes("delivery:");
  });
};

const validarCanalesYPagoLocal = (local, tipoPedido, tipoPago) => {
  if (!local) {
    return "Local no encontrado";
  }

  const servicios = local?.servicios || {};
  const pagosWeb = local?.pagos_web || {};

  if (tipoPedido === "delivery" && servicios.delivery === false) {
    return "Delivery no disponible en este local";
  }
  if (tipoPedido === "retiro" && servicios.retiro === false) {
    return "Retiro en tienda no disponible en este local";
  }
  if (tipoPedido === "tienda" && servicios.tienda === false) {
    return "Consumo en tienda no disponible en este local";
  }

  const pagoNormalizado = ["online", "tarjeta_webpay", "tarjeta"].includes(tipoPago)
    ? "tarjeta"
    : ["efectivo", "caja", "domicilio"].includes(tipoPago)
    ? "efectivo"
    : ["transferencia", "transferencia_bancaria"].includes(tipoPago)
    ? "transferencia"
    : tipoPago;

  if (pagoNormalizado === "tarjeta" && pagosWeb.tarjeta === false) {
    return "Pago con tarjeta no disponible en este local";
  }
  if (pagoNormalizado === "efectivo" && pagosWeb.efectivo === false) {
    return "Pago en efectivo no disponible en este local";
  }
  if (pagoNormalizado === "transferencia" && pagosWeb.transferencia === false) {
    return "Pago por transferencia no disponible en este local";
  }

  return "";
};

const obtenerRangoMes = (anioRaw, mesRaw) => {
  const anio = Number(anioRaw);
  const mes = Number(mesRaw);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || anio < 2000 || anio > 2200 || mes < 1 || mes > 12) {
    return null;
  }
  const inicio = new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0, 0));
  const fin = new Date(Date.UTC(anio, mes, 1, 0, 0, 0, 0));
  return { inicio, fin };
};

// Registrar pedido web (cliente logueado o invitado)
router.post("/", async (req, res) => {
  try {
    const last = await VentaCliente.findOne().sort({ numero_pedido: -1 });
    const numero_pedido = last ? last.numero_pedido + 1 : 1;

    const productos = normalizarProductos(req.body.productos);
    const total = toNumberOrNull(req.body.total);
    const tipoPago = sanitizeText(req.body.tipo_pago, { max: 30 });
    const tipoPedidoRaw = normalizarTipoPedido(req.body.tipo_pedido);
    const horaRetiro = sanitizeOptionalText(req.body.hora_retiro, { max: 5 }) || "";
    const emailNormalizado = normalizeEmail(req.body.cliente_email);
    const clienteNombre = sanitizeOptionalText(req.body.cliente_nombre, { max: 120 }) || "";
    const clienteDireccion = sanitizeOptionalText(req.body.cliente_direccion, { max: 220 }) || "";
    const clienteTelefono = sanitizeOptionalText(req.body.cliente_telefono, { max: 40 }) || "";
    const clienteCoords = normalizeCoordinate(req.body.cliente_coords);

    if (!productos || productos.length === 0 || total === null || !tipoPago) {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

    const clienteId = obtenerClienteIdDesdeToken(req);
    const cliente = clienteId ? await Cliente.findById(clienteId) : null;

    let localId = null;
    if (req.body.local && mongoose.Types.ObjectId.isValid(req.body.local)) {
      localId = req.body.local;
    } else if (cliente?.local) {
      localId = cliente.local;
    }

    if (!localId) {
      return res.status(400).json({ msg: "Debes seleccionar un local" });
    }

    const local = await Local.findById(localId);
    if (!local) {
      return res.status(404).json({ msg: "Local no encontrado" });
    }

    const errorCanalPago = validarCanalesYPagoLocal(
      local,
      tipoPedidoRaw || inferirTipoPedidoDesdeProductos(productos),
      String(tipoPago || "").toLowerCase()
    );
    if (errorCanalPago) {
      return res.status(400).json({ msg: errorCanalPago });
    }

    const socialConfig = await SocialConfig.findOne({ local: localId });
    const horariosWeb = normalizeWebSchedule(socialConfig?.horarios_web);
    const estadoHorario = evaluateWebSchedule(horariosWeb, new Date());
    if (estadoHorario.active && !estadoHorario.open) {
      return res.status(400).json({ msg: "El sitio esta cerrado por horario de atencion" });
    }
    if (tipoPedidoRaw === "retiro") {
      if (!horaRetiro) {
        return res.status(400).json({ msg: "Debes indicar la hora de retiro" });
      }
      const clock = resolveScheduleClock(new Date());
      const validacionRetiro = validatePickupTime(horariosWeb, clock.day, horaRetiro);
      if (!validacionRetiro.valid) {
        return res.status(400).json({ msg: validacionRetiro.error || "Hora de retiro fuera de horario" });
      }
    }

    const tipoPedidoFinal = tipoPedidoRaw || inferirTipoPedidoDesdeProductos(productos);
    let deliveryZoneName = "";
    if (tipoPedidoFinal === "delivery") {
      if (!clienteCoords) {
        return res.status(400).json({ msg: "Debes confirmar una ubicacion valida en el mapa para delivery" });
      }
      const zoneResult = resolveMatchingZone(local?.delivery_zones || [], clienteCoords);
      if (!zoneResult.ok) {
        return res.status(400).json({ msg: zoneResult.reason });
      }
      deliveryZoneName = zoneResult.zone?.name || "";
    }

    const emailClienteModel = normalizeEmail(cliente?.email || "");
    const emailFinal = isValidEmail(emailNormalizado)
      ? emailNormalizado
      : isValidEmail(emailClienteModel)
      ? emailClienteModel
      : "sin_correo";

    const nuevaVenta = new VentaCliente({
      numero_pedido,
      productos,
      total,
      tipo_pago: tipoPago,
      tipo_pedido: tipoPedidoFinal,
      hora_retiro: tipoPedidoRaw === "retiro" ? horaRetiro : "",
      estado_pedido: "pendiente",
      historial_estados: [
        {
          estado: "pendiente",
          nota: "Pedido creado desde web",
          usuario_id: null,
          usuario_rol: "cliente",
          fecha: new Date()
        }
      ],
      cliente_id: clienteId || null,
      cliente_email: emailFinal,
      cliente_nombre: clienteNombre,
      cliente_direccion: clienteDireccion,
      cliente_coords: clienteCoords || { lat: null, lng: null },
      delivery_zone_name: deliveryZoneName,
      cliente_telefono: clienteTelefono,
      local: localId
    });

    const ventaGuardada = await nuevaVenta.save();
    await obtenerConfigEstados(localId);
    res.status(201).json(ventaGuardada);
  } catch (error) {
    res.status(500).json({ msg: "Error al registrar venta", error });
  }
});

// Historial de compras del cliente autenticado
router.get("/", authMiddleware, async (req, res) => {
  try {
    const historial = await VentaCliente.find({ cliente_id: req.clienteId }).sort({ fecha: -1 });
    res.json(historial);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener historial", error });
  }
});

// Eliminar pedido propio (cliente autenticado)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const eliminado = await VentaCliente.findOneAndDelete({
      _id: req.params.id,
      cliente_id: req.clienteId
    });

    if (!eliminado) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    res.json({ ok: true, id: eliminado._id });
  } catch (error) {
    res.status(500).json({ msg: "Error al eliminar pedido", error });
  }
});

// Uso POS: listar pedidos web por local
router.get("/local/pedidos", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero", "repartidor"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const filtro = { local: req.localId };
    const estado = sanitizeOptionalText(req.query?.estado, { max: 30 }) || "";
    const tipoPedido = normalizarTipoPedido(req.query?.tipo_pedido);
    const soloDomicilio = String(req.query?.solo_domicilio || "").toLowerCase() === "true";
    const rangoMes = obtenerRangoMes(req.query?.anio, req.query?.mes);

    if (estado) filtro.estado_pedido = estado;
    if (tipoPedido === "delivery" || soloDomicilio) {
      filtro.$or = [
        { tipo_pedido: "delivery" },
        { productos: { $elemMatch: { observacion: /delivery:/i } } }
      ];
    } else if (tipoPedido) {
      filtro.tipo_pedido = tipoPedido;
    }
    if (rangoMes) filtro.fecha = { $gte: rangoMes.inicio, $lt: rangoMes.fin };

    if (req.userRole === "repartidor") {
      filtro.repartidor_asignado = req.userId || null;
      if (!filtro.$or) {
        filtro.$or = [
          { tipo_pedido: "delivery" },
          { productos: { $elemMatch: { observacion: /delivery:/i } } }
        ];
      }
    }

    const pedidos = await VentaCliente.find(filtro)
      .populate("repartidor_asignado", "nombre email rol")
      .sort({ fecha: -1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener pedidos del local", error });
  }
});

// Uso POS/RepartidorFront: obtener repartidores activos del local
router.get("/local/repartidores", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero", "repartidor"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const repartidores = await Usuario.find(
      {
        rol: "repartidor",
        $or: [{ local: req.localId }, { local: null }]
      },
      "_id nombre email rol local"
    ).sort({ nombre: 1 });

    res.json(repartidores);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener repartidores", error });
  }
});

// Uso POS/RepartidorFront: asignar o limpiar repartidor de pedido delivery
router.patch("/local/pedidos/:id/repartidor", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const pedido = await VentaCliente.findOne({ _id: req.params.id, local: req.localId });
    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    if (!esPedidoDeliveryLegacy(pedido)) {
      return res.status(400).json({ error: "Solo puedes asignar repartidor a pedidos delivery" });
    }

    const repartidorIdRaw = req.body?.repartidor_id;
    const limpiar = repartidorIdRaw === null || String(repartidorIdRaw || "").trim() === "";

    if (limpiar) {
      pedido.repartidor_asignado = null;
      pedido.fecha_asignacion_repartidor = null;
      pedido.historial_estados = Array.isArray(pedido.historial_estados) ? pedido.historial_estados : [];
      pedido.historial_estados.push({
        estado: pedido.estado_pedido || "pendiente",
        nota: "Repartidor desasignado",
        usuario_id: req.userId || null,
        usuario_rol: req.userRole || "",
        fecha: new Date()
      });
      await pedido.save();
      const salida = await VentaCliente.findById(pedido._id).populate("repartidor_asignado", "nombre email rol");
      return res.json(salida);
    }

    if (!mongoose.Types.ObjectId.isValid(repartidorIdRaw)) {
      return res.status(400).json({ error: "repartidor_id invalido" });
    }

    const repartidor = await Usuario.findOne({
      _id: repartidorIdRaw,
      rol: "repartidor",
      $or: [{ local: req.localId }, { local: null }]
    });
    if (!repartidor) {
      return res.status(404).json({ error: "Repartidor no encontrado para este local" });
    }

    pedido.repartidor_asignado = repartidor._id;
    pedido.fecha_asignacion_repartidor = new Date();
    pedido.historial_estados = Array.isArray(pedido.historial_estados) ? pedido.historial_estados : [];
    pedido.historial_estados.push({
      estado: pedido.estado_pedido || "pendiente",
      nota: `Repartidor asignado: ${repartidor.nombre || repartidor.email || repartidor._id}`,
      usuario_id: req.userId || null,
      usuario_rol: req.userRole || "",
      fecha: new Date()
    });

    await pedido.save();
    const salida = await VentaCliente.findById(pedido._id).populate("repartidor_asignado", "nombre email rol");
    res.json(salida);
  } catch (error) {
    res.status(500).json({ msg: "Error al asignar repartidor", error });
  }
});

// Uso POS/RepartidorFront: metricas de reparto delivery por mes y acumulado
router.get("/local/repartos/resumen", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero", "repartidor"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const base = {
      local: req.localId,
      $or: [
        { tipo_pedido: "delivery" },
        { productos: { $elemMatch: { observacion: /delivery:/i } } }
      ]
    };
    if (req.userRole === "repartidor") {
      base.repartidor_asignado = req.userId || null;
    }

    const totalHistorico = await VentaCliente.countDocuments(base);
    const rangoMes = obtenerRangoMes(req.query?.anio, req.query?.mes);
    let totalMes = 0;
    let totalMesEntregados = 0;

    if (rangoMes) {
      totalMes = await VentaCliente.countDocuments({
        ...base,
        fecha: { $gte: rangoMes.inicio, $lt: rangoMes.fin }
      });
      totalMesEntregados = await VentaCliente.countDocuments({
        ...base,
        estado_pedido: "entregado",
        fecha: { $gte: rangoMes.inicio, $lt: rangoMes.fin }
      });
    }

    res.json({ totalHistorico, totalMes, totalMesEntregados });
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener resumen de repartos", error });
  }
});

// Uso POS: eliminar pedido web por local (solo admin/superadmin)
router.delete("/local/pedidos/:id", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const eliminado = await VentaCliente.findOneAndDelete({
      _id: req.params.id,
      local: req.localId
    });

    if (!eliminado) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    res.json({ ok: true, id: eliminado._id });
  } catch (error) {
    res.status(500).json({ msg: "Error al eliminar pedido", error });
  }
});

// Uso POS: estados configurados para pedidos web del local
router.get("/local/estados", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    const config = await obtenerConfigEstados(req.localId);
    res.json({ estados: config.estados });
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener estados de pedido", error });
  }
});

// Uso POS/RepartidorFront: estados permitidos para repartidor en el local
router.get("/local/estados-repartidor", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero", "repartidor"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const config = await obtenerConfigEstados(req.localId);
    const estados = Array.isArray(config.estados_repartidor) ? config.estados_repartidor : [];
    res.json({ estados });
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener estados de repartidor", error });
  }
});

// Uso POS: configurar estados permitidos para repartidor (solo admin/superadmin)
router.put("/local/estados-repartidor", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const raw = Array.isArray(req.body?.estados) ? req.body.estados : [];
    const limpios = raw
      .map((item) => sanitizeOptionalText(item, { max: 30 }) || "")
      .map((item) => item.toLowerCase())
      .filter((item, idx, arr) => item && arr.indexOf(item) === idx);

    const config = await obtenerConfigEstados(req.localId);
    const permitidos = new Set((config.estados || []).map((item) => String(item).toLowerCase()));
    const finales = limpios.filter((item) => permitidos.has(item));

    if (finales.length === 0) {
      return res.status(400).json({ error: "Debes asignar al menos un estado para repartidor" });
    }

    config.estados_repartidor = finales;
    await config.save();
    res.json({ estados: config.estados_repartidor });
  } catch (error) {
    res.status(500).json({ msg: "Error al guardar estados de repartidor", error });
  }
});

// Uso POS: crear estado de pedido web (solo admin/superadmin)
router.post("/local/estados", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const estadoRaw = sanitizeText(req.body?.estado, { max: 30 });
    const estado = estadoRaw ? estadoRaw.toLowerCase() : "";

    if (!estado) {
      return res.status(400).json({ error: "Estado invalido" });
    }

    const config = await obtenerConfigEstados(req.localId);
    const yaExiste = config.estados.some((item) => String(item).toLowerCase() === estado);

    if (yaExiste) {
      return res.status(409).json({ error: "El estado ya existe", estados: config.estados });
    }

    config.estados.push(estado);
    await config.save();

    res.status(201).json({ estados: config.estados });
  } catch (error) {
    res.status(500).json({ msg: "Error al crear estado de pedido", error });
  }
});

// Uso POS: editar estado de pedido web (solo admin/superadmin)
router.put("/local/estados/:estado", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const estadoActualRaw = sanitizeText(req.params?.estado, { max: 30 });
    const estadoNuevoRaw = sanitizeText(req.body?.estado || req.body?.nuevoEstado, { max: 30 });
    const estadoActual = estadoActualRaw ? estadoActualRaw.toLowerCase() : "";
    const estadoNuevo = estadoNuevoRaw ? estadoNuevoRaw.toLowerCase() : "";

    if (!estadoActual || !estadoNuevo) {
      return res.status(400).json({ error: "Estado invalido" });
    }

    const config = await obtenerConfigEstados(req.localId);
    const index = config.estados.findIndex((item) => String(item).toLowerCase() === estadoActual);
    if (index === -1) {
      return res.status(404).json({ error: "Estado no encontrado" });
    }

    const duplicado = config.estados.some(
      (item, idx) => idx !== index && String(item).toLowerCase() === estadoNuevo
    );
    if (duplicado) {
      return res.status(409).json({ error: "El estado ya existe" });
    }

    config.estados[index] = estadoNuevo;
    if (Array.isArray(config.estados_repartidor)) {
      config.estados_repartidor = config.estados_repartidor.map((item) =>
        String(item).toLowerCase() === estadoActual ? estadoNuevo : item
      );
    }
    await config.save();

    if (estadoActual !== estadoNuevo) {
      await VentaCliente.updateMany(
        { local: req.localId, estado_pedido: estadoActual },
        { $set: { estado_pedido: estadoNuevo } }
      );
    }

    res.json({ estados: config.estados });
  } catch (error) {
    res.status(500).json({ msg: "Error al editar estado de pedido", error });
  }
});

// Uso POS: eliminar estado de pedido web (solo admin/superadmin)
router.delete("/local/estados/:estado", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const estadoRaw = sanitizeText(req.params?.estado, { max: 30 });
    const estado = estadoRaw ? estadoRaw.toLowerCase() : "";
    if (!estado) {
      return res.status(400).json({ error: "Estado invalido" });
    }

    const config = await obtenerConfigEstados(req.localId);
    const existe = config.estados.some((item) => String(item).toLowerCase() === estado);
    if (!existe) {
      return res.status(404).json({ error: "Estado no encontrado" });
    }

    const pedidosUsandoEstado = await VentaCliente.countDocuments({
      local: req.localId,
      estado_pedido: estado
    });
    if (pedidosUsandoEstado > 0) {
      return res.status(409).json({
        error: "No puedes eliminar un estado que esta en uso por pedidos"
      });
    }

    const siguiente = config.estados.filter((item) => String(item).toLowerCase() !== estado);
    if (siguiente.length === 0) {
      return res.status(400).json({ error: "Debe existir al menos un estado" });
    }

    config.estados = siguiente;
    if (Array.isArray(config.estados_repartidor)) {
      config.estados_repartidor = config.estados_repartidor.filter(
        (item) => String(item).toLowerCase() !== estado
      );
      if (config.estados_repartidor.length === 0) {
        const fallback = DEFAULT_ESTADOS_REPARTIDOR.filter((item) =>
          config.estados.some((estadoCfg) => String(estadoCfg).toLowerCase() === item)
        );
        config.estados_repartidor = fallback.length > 0 ? fallback : [config.estados[0]].filter(Boolean);
      }
    }
    await config.save();

    res.json({ estados: config.estados });
  } catch (error) {
    res.status(500).json({ msg: "Error al eliminar estado de pedido", error });
  }
});

// Uso POS: cambiar estado de pedido web
router.patch("/local/pedidos/:id/estado", adjuntarScopeLocal, requiereLocal, async (req, res) => {
  try {
    if (!["admin", "superadmin", "cajero", "repartidor"].includes(req.userRole)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const estadoRaw = sanitizeText(req.body?.estado, { max: 30 });
    const estado = estadoRaw ? estadoRaw.toLowerCase() : "";
    const nota = sanitizeOptionalText(req.body?.nota, { max: 160 }) || "";

    if (!estado) {
      return res.status(400).json({ error: "Estado de pedido invalido" });
    }

    const config = await obtenerConfigEstados(req.localId);
    const estadoPermitido = config.estados.some((item) => String(item).toLowerCase() === estado);
    if (!estadoPermitido) {
      return res.status(400).json({ error: "Estado no configurado para este local" });
    }

    const venta = await VentaCliente.findOne({ _id: req.params.id, local: req.localId });
    if (!venta) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    if (req.userRole === "repartidor") {
      const estadosRepartidor = Array.isArray(config.estados_repartidor)
        ? config.estados_repartidor.map((item) => String(item).toLowerCase())
        : [];
      if (!estadosRepartidor.includes(estado)) {
        return res.status(403).json({ error: "Estado no permitido para repartidor" });
      }

      const esDelivery = esPedidoDeliveryLegacy(venta);
      const esAsignado = venta.repartidor_asignado && String(venta.repartidor_asignado) === String(req.userId || "");
      if (!esDelivery || !esAsignado) {
        return res.status(403).json({ error: "Solo puedes cambiar estados de tus repartos asignados" });
      }
    }

    venta.estado_pedido = estado;
    venta.historial_estados = Array.isArray(venta.historial_estados) ? venta.historial_estados : [];
    venta.historial_estados.push({
      estado,
      nota,
      usuario_id: req.userId || null,
      usuario_rol: req.userRole || "",
      fecha: new Date()
    });

    await venta.save();
    res.json(venta);
  } catch (error) {
    res.status(500).json({ msg: "Error al actualizar estado del pedido", error });
  }
});

// Consulta publica por id de pedido (usado por historial local sin login)
router.get("/public/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "ID de pedido invalido" });
    }

    const venta = await VentaCliente.findById(req.params.id).select(
      "_id numero_pedido estado_pedido estado status fecha total tipo_pago tipo_pedido hora_retiro local cliente_nombre cliente_direccion cliente_telefono productos"
    );

    if (!venta) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    res.json(venta);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener pedido", error });
  }
});
// Detalle de venta para cliente autenticado
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const venta = await VentaCliente.findOne({ _id: req.params.id, cliente_id: req.clienteId });
    if (!venta) return res.status(404).json({ msg: "Venta no encontrada" });
    res.json(venta);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener venta", error });
  }
});

module.exports = router;
