const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  WebpayPlus,
  Options,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Environment,
} = require("transbank-sdk");

const router = express.Router();
const CheckoutSession = require("../models/checkoutSession.model");
const VentaCliente = require("../models/ventaCliente.model");
const Cliente = require("../models/Cliente");
const Local = require("../models/local.model");
const SocialConfig = require("../models/socialConfig.model");
const { getJwtSecret } = require("../utils/jwtConfig");
const {
  sanitizeText,
  sanitizeOptionalText,
  normalizeEmail,
  isValidEmail,
  toNumberOrNull,
} = require("../utils/input");
const {
  evaluateWebSchedule,
  normalizeWebSchedule,
  validatePickupTime,
  resolveScheduleClock,
} = require("../utils/webSchedule");
const { normalizeCoordinate, resolveMatchingZone } = require("../utils/deliveryZones");

const JWT_SECRET = getJwtSecret();

const normalizarItems = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const nombre = sanitizeOptionalText(item?.nombre, { max: 140 }) || "";
      const precio = toNumberOrNull(item?.precio);
      const cantidadNum = Number(item?.cantidad);
      const cantidad = Number.isFinite(cantidadNum) && cantidadNum > 0 ? Math.floor(cantidadNum) : 1;

      if (!nombre || precio === null || precio < 0) return null;

      return {
        productoId: mongoose.Types.ObjectId.isValid(item?.productoId) ? item.productoId : null,
        nombre,
        precio,
        cantidad,
        varianteId: mongoose.Types.ObjectId.isValid(item?.varianteId) ? item.varianteId : null,
        varianteNombre: sanitizeOptionalText(item?.varianteNombre, { max: 80 }) || "",
        agregados: Array.isArray(item?.agregados)
          ? item.agregados
              .map((agg) => {
                const aggNombre = sanitizeOptionalText(agg?.nombre, { max: 80 }) || "";
                if (!aggNombre) return null;
                const aggPrecio = Number(agg?.precio);
                return {
                  agregadoId: mongoose.Types.ObjectId.isValid(agg?.agregadoId) ? agg.agregadoId : null,
                  nombre: aggNombre,
                  precio: Number.isFinite(aggPrecio) && aggPrecio > 0 ? aggPrecio : 0,
                };
              })
              .filter(Boolean)
          : [],
      };
    })
    .filter(Boolean);
};

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

const generarBuyOrder = () => {
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ORD-${Date.now()}-${random}`.slice(0, 26);
};

const generarSessionId = (clienteId) => {
  const base = String(clienteId || "anon").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "anon";
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SES-${base}-${Date.now()}-${random}`.slice(0, 61);
};

const getTransbankTx = () => {
  const env = String(process.env.TRANSBANK_ENVIRONMENT || "integration").toLowerCase();
  const commerceCode = String(process.env.COMMERCE_CODE || process.env.TRANSBANK_COMMERCE_CODE || "").trim();
  const apiKey = String(process.env.API_KEY || process.env.TRANSBANK_API_KEY || "").trim();

  if (env === "production") {
    if (!commerceCode || !apiKey) {
      throw new Error("COMMERCE_CODE y API_KEY son obligatorios para Transbank en produccion");
    }
    return new WebpayPlus.Transaction(new Options(commerceCode, apiKey, Environment.Production));
  }

  return new WebpayPlus.Transaction(
    new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration)
  );
};

const getReturnUrl = () => {
  const url = String(process.env.TRANSBANK_RETURN_URL || process.env.CHECKOUT_RESULT_URL || "").trim();
  if (!url) {
    throw new Error("Debes configurar TRANSBANK_RETURN_URL (ruta del frontend para resultado de pago)");
  }
  return url;
};

const getCheckoutResultUrl = () => {
  const url = String(
    process.env.TRANSBANK_CHECKOUT_RESULT_URL ||
      process.env.CHECKOUT_RESULT_URL ||
      process.env.FRONTEND_CHECKOUT_RESULT_URL ||
      ""
  ).trim();
  if (!url) {
    throw new Error("Debes configurar TRANSBANK_CHECKOUT_RESULT_URL para redirigir el resultado de Webpay");
  }
  return url;
};

const normalizarTipoPedido = (raw) => {
  const tipo = (sanitizeOptionalText(raw, { max: 30 }) || "").toLowerCase();
  if (!tipo) return "tienda";
  if (["delivery", "domicilio", "reparto", "reparto_domicilio"].includes(tipo)) return "delivery";
  if (["retiro", "retiro_tienda", "pickup"].includes(tipo)) return "retiro";
  if (["tienda", "local", "consumo_local"].includes(tipo)) return "tienda";
  return tipo;
};

const validarCanalesYPagoLocal = (local, tipoPedido) => {
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
  if (pagosWeb.tarjeta === false) {
    return "Pago con tarjeta no disponible en este local";
  }

  return "";
};

const isPagoAutorizado = (result) => {
  const status = String(result?.status || "").toUpperCase();
  const responseCode = Number(result?.response_code);
  return status === "AUTHORIZED" && responseCode === 0;
};

const crearVentaClienteDesdeCheckout = async (sessionId) => {
  const pending = await CheckoutSession.findOne({ session_id: sessionId });
  if (!pending) return null;

  if (pending.venta_cliente_id) {
    const existente = await VentaCliente.findById(pending.venta_cliente_id);
    if (existente) return existente;
  }

  const last = await VentaCliente.findOne().sort({ numero_pedido: -1 });
  const numero_pedido = last ? last.numero_pedido + 1 : 1;

  const productos = (pending.productos || []).map((item) => {
    const precioUnitario = Number(item.precio || 0);
    const cantidad = Number(item.cantidad || 1);
    return {
      nombre: item.nombre,
      cantidad,
      precio_unitario: precioUnitario,
      subtotal: precioUnitario * cantidad,
      varianteId: item.varianteId || null,
      varianteNombre: item.varianteNombre || "",
      agregados: Array.isArray(item.agregados) ? item.agregados : [],
      observacion: "Pago online confirmado",
    };
  });

  const venta = await VentaCliente.create({
    numero_pedido,
    productos,
    total: pending.total,
    tipo_pago: pending.tipo_pago || "tarjeta_webpay",
    tipo_pedido: pending.tipo_pedido || "tienda",
    hora_retiro: pending.hora_retiro || "",
    estado_pedido: "pendiente",
    historial_estados: [
      {
        estado: "pendiente",
        nota: "Pedido web pagado en Webpay",
        usuario_id: null,
        usuario_rol: "cliente",
        fecha: new Date(),
      },
    ],
    local: pending.local,
    cliente_id: pending.cliente_id || null,
    cliente_email: pending.cliente_email || "sin_correo",
    cliente_nombre: pending.cliente_nombre || "",
      cliente_direccion: pending.cliente_direccion || "",
      cliente_coords: pending.cliente_coords || { lat: null, lng: null },
      delivery_zone_name: pending.delivery_zone_name || "",
      cliente_telefono: pending.cliente_telefono || "",
  });

  pending.venta_cliente_id = venta._id;
  pending.estado = "procesado";
  await pending.save();

  return venta;
};

router.all("/retorno-webpay", async (req, res) => {
  try {
    const checkoutResultUrl = getCheckoutResultUrl();

    const tokenWs = sanitizeOptionalText(
      req.body?.token_ws || req.query?.token_ws || req.body?.token || req.query?.token,
      { max: 180 }
    );
    const tbkToken = sanitizeOptionalText(req.body?.TBK_TOKEN || req.query?.TBK_TOKEN, { max: 220 });
    const tbkIdSesion = sanitizeOptionalText(req.body?.TBK_ID_SESION || req.query?.TBK_ID_SESION, { max: 120 });
    const tbkOrdenCompra = sanitizeOptionalText(req.body?.TBK_ORDEN_COMPRA || req.query?.TBK_ORDEN_COMPRA, {
      max: 120,
    });

    const params = new URLSearchParams();
    if (tokenWs) params.set("token_ws", tokenWs);
    if (tbkToken) params.set("TBK_TOKEN", tbkToken);
    if (tbkIdSesion) params.set("TBK_ID_SESION", tbkIdSesion);
    if (tbkOrdenCompra) params.set("TBK_ORDEN_COMPRA", tbkOrdenCompra);

    const redirectUrl = params.toString() ? `${checkoutResultUrl}?${params.toString()}` : checkoutResultUrl;
    return res.redirect(302, redirectUrl);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo redirigir el retorno de Webpay", detail: error?.message || "" });
  }
});

router.post("/crear-sesion", async (req, res) => {
  try {
    const order = req.body?.order || {};
    const items = normalizarItems(order.items);
    const localId = order.local;

    if (!mongoose.Types.ObjectId.isValid(localId)) {
      return res.status(400).json({ error: "Local invalido" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos para pagar" });
    }

    const clienteNombre = sanitizeText(order?.cliente?.nombre, { max: 120 });
    const clienteTelefono = sanitizeText(order?.cliente?.telefono, { max: 40 });
    const clienteDireccion = sanitizeOptionalText(order?.cliente?.direccion, { max: 220 }) || "";
    const clienteCoords = normalizeCoordinate(order?.cliente?.coords);
    const clienteCorreoRaw = normalizeEmail(order?.cliente?.correo || "");

    if (!clienteNombre || !clienteTelefono) {
      return res.status(400).json({ error: "Nombre y telefono son obligatorios" });
    }

    const local = await Local.findById(localId);
    if (!local) {
      return res.status(404).json({ error: "Local no encontrado" });
    }

    const total = items.reduce((sum, item) => sum + Number(item.precio || 0) * Number(item.cantidad || 1), 0);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Total invalido" });
    }

    const tipoPedido = normalizarTipoPedido(order?.tipo_pedido);
    const horaRetiro = sanitizeOptionalText(order?.hora_retiro, { max: 5 }) || "";
    const clienteId = obtenerClienteIdDesdeToken(req);
    const cliente = clienteId ? await Cliente.findById(clienteId) : null;
    const emailCliente = normalizeEmail(cliente?.email || "");
    const emailFinal = isValidEmail(clienteCorreoRaw)
      ? clienteCorreoRaw
      : isValidEmail(emailCliente)
      ? emailCliente
      : "sin_correo";

    const errorCanalPago = validarCanalesYPagoLocal(local, tipoPedido);
    if (errorCanalPago) {
      return res.status(400).json({ error: errorCanalPago });
    }

    const socialConfig = await SocialConfig.findOne({ local: localId });
    const horariosWeb = normalizeWebSchedule(socialConfig?.horarios_web);
    const estadoHorario = evaluateWebSchedule(horariosWeb, new Date());
    if (estadoHorario.active && !estadoHorario.open) {
      return res.status(400).json({ error: "El sitio esta cerrado por horario de atencion" });
    }
    if (tipoPedido === "retiro") {
      if (!horaRetiro) {
        return res.status(400).json({ error: "Debes indicar la hora de retiro" });
      }
      const clock = resolveScheduleClock(new Date());
      const validacionRetiro = validatePickupTime(horariosWeb, clock.day, horaRetiro);
      if (!validacionRetiro.valid) {
        return res.status(400).json({ error: validacionRetiro.error || "Hora de retiro fuera de horario" });
      }
    }

    let deliveryZoneName = "";
    if (tipoPedido === "delivery") {
      if (!clienteCoords) {
        return res.status(400).json({ error: "Debes confirmar una ubicacion valida en el mapa para delivery" });
      }
      const zoneResult = resolveMatchingZone(local?.delivery_zones || [], clienteCoords);
      if (!zoneResult.ok) {
        return res.status(400).json({ error: zoneResult.reason });
      }
      deliveryZoneName = zoneResult.zone?.name || "";
    }

    const tx = getTransbankTx();
    const buyOrder = generarBuyOrder();
    const sessionId = generarSessionId(clienteId);
    const returnUrl = getReturnUrl();
    const amount = Math.round(total);

    const response = await tx.create(buyOrder, sessionId, amount, returnUrl);

    await CheckoutSession.create({
      session_id: String(response.token),
      local: localId,
      cliente_id: clienteId || null,
      cliente_email: emailFinal,
      cliente_nombre: clienteNombre,
      cliente_direccion: clienteDireccion,
      cliente_coords: clienteCoords || { lat: null, lng: null },
      delivery_zone_name: deliveryZoneName,
      cliente_telefono: clienteTelefono,
      tipo_pedido: tipoPedido,
      hora_retiro: tipoPedido === "retiro" ? horaRetiro : "",
      tipo_pago: "tarjeta_webpay",
      total: amount,
      productos: items,
      estado: "pendiente_pago",
    });

    return res.json({
      url: response.url,
      token: response.token,
      buy_order: buyOrder,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Error creando sesion Webpay:", error);
    return res.status(500).json({ error: "No se pudo crear sesion de pago" });
  }
});

router.post("/confirmar-sesion", async (req, res) => {
  try {
    const tokenWs = sanitizeText(
      req.body?.token_ws || req.body?.token || req.query?.token_ws || req.query?.token,
      { max: 180 }
    );

    if (!tokenWs) {
      return res.status(400).json({ error: "token_ws requerido" });
    }

    const pending = await CheckoutSession.findOne({ session_id: tokenWs });
    if (!pending) {
      return res.status(404).json({ error: "No se encontro sesion pendiente" });
    }

    if (pending.estado === "procesado" && pending.venta_cliente_id) {
      const ventaExistente = await VentaCliente.findById(pending.venta_cliente_id);
      if (ventaExistente) {
        return res.json({
          ok: true,
          venta: {
            _id: ventaExistente._id,
            numero_pedido: ventaExistente.numero_pedido,
            estado_pedido: ventaExistente.estado_pedido,
            total: ventaExistente.total,
            fecha: ventaExistente.fecha,
            local: ventaExistente.local,
          },
        });
      }
    }

    const tx = getTransbankTx();
    const result = await tx.commit(tokenWs);

    if (!isPagoAutorizado(result)) {
      pending.estado = "rechazado";
      await pending.save();
      return res.status(400).json({
        error: "La transaccion no fue aprobada",
        detalle: {
          status: result?.status || null,
          response_code: result?.response_code ?? null,
        },
      });
    }

    const venta = await crearVentaClienteDesdeCheckout(tokenWs);
    if (!venta) {
      return res.status(404).json({ error: "No se encontro sesion pendiente" });
    }

    return res.json({
      ok: true,
      transaccion: {
        status: result?.status || null,
        authorization_code: result?.authorization_code || null,
        amount: result?.amount ?? null,
        buy_order: result?.buy_order || null,
      },
      venta: {
        _id: venta._id,
        numero_pedido: venta.numero_pedido,
        estado_pedido: venta.estado_pedido,
        total: venta.total,
        fecha: venta.fecha,
        local: venta.local,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo confirmar la sesion", detail: error?.message || "" });
  }
});

module.exports = router;
