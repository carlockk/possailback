const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const { restringirMesero } = require("./middlewares/roleAccess");
const { ensureJwtConfig } = require("./utils/jwtConfig");
const { bootstrapSuperadmin } = require("./utils/bootstrapSuperadmin");
const tenantMiddleware = require('./middlewares/tenant');
const { requireModule } = require('./middlewares/moduleAccess');
const platformRoutes = require('./routes/platform.routes');

// Cargar variables de entorno
dotenv.config();
ensureJwtConfig();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// 🛡️ Middleware
const normalizeOrigin = (value) =>
  String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\/+$/, "");

const allowedOrigins = ["https://possail.vercel.app", ...(process.env.CORS_ORIGINS || "").split(",")]
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);
const allowLocalhostCors = String(process.env.CORS_ALLOW_LOCALHOST || "false").toLowerCase() === "true";
const extraOrigins = allowLocalhostCors
  ? Array.from({ length: 10 }, (_, idx) => 5173 + idx)
      .flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`])
      .map((origin) => normalizeOrigin(origin))
  : [];
const allowVercelPreviewCors =
  String(process.env.CORS_ALLOW_VERCEL_PREVIEW || "false").toLowerCase() === "true";
const mergedOrigins = Array.from(new Set([...allowedOrigins, ...extraOrigins]));
const corsOrigin = mergedOrigins.length
  ? (origin, callback) => {
      const requestOrigin = normalizeOrigin(origin);
      const isAllowedVercelPreview =
        allowVercelPreviewCors &&
        requestOrigin.startsWith("https://") &&
        requestOrigin.endsWith(".vercel.app");

      if (!requestOrigin || mergedOrigins.includes(requestOrigin) || isAllowedVercelPreview) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido por CORS"));
    }
  : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl === "/api/pagos/webhook") {
        req.rawBody = buf.toString();
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    maxAge: "30d",
    immutable: true
  })
);
app.use(restringirMesero);
app.use('/api/plataforma', platformRoutes);
app.use(tenantMiddleware);

// 🏠 Ruta raíz (para que no salga "Cannot GET /")
app.get("/", (req, res) => {
  res.send("✅ Backend POS funcionando");
});

// 🩺 Endpoint de healthcheck
app.get("/health", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
});

// 📦 Rutas
const productRoutes = require("./routes/product.routes.js");
const ventaRoutes = require("./routes/venta.routes.js");
const cajaRoutes = require("./routes/caja.routes.js");
const authRoutes = require("./routes/auth.routes.js");
const usuarioRoutes = require("./routes/usuario.routes.js");
const categoriaRoutes = require("./routes/categoria.routes.js");
const ticketRoutes = require("./routes/ticket.routes.js");
const clienteRoutes = require("./routes/cliente.routes");
const ventaClienteRoutes = require("./routes/ventaCliente.routes");
const pagosRoutes = require("./routes/pagos.routes");
const insumoRoutes = require("./routes/insumo.routes");
const insumoCategoriaRoutes = require("./routes/insumoCategoria.routes");
const localesRoutes = require("./routes/locales.routes");
const reciboConfigRoutes = require("./routes/reciboConfig.routes");
const agregadoRoutes = require("./routes/agregado.routes");
const socialConfigRoutes = require("./routes/socialConfig.routes");
const restauranteRoutes = require("./routes/restaurante.routes");
const descuentoRoutes = require("./routes/descuento.routes");

// Swagger
const { swaggerUi, specs } = require("./swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs)); // Swagger UI

// Prefijo /api para todas las rutas REST
app.use("/api/productos", productRoutes);
app.use("/api/ventas", ventaRoutes);
app.use("/api/caja", cajaRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/categorias", categoriaRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/clientes", clienteRoutes);
app.use("/api/ventasCliente", requireModule('pedidosWeb'), ventaClienteRoutes);
app.use("/api/pagos", pagosRoutes);
app.use("/api/insumos", insumoRoutes);
app.use("/api/insumo-categorias", insumoCategoriaRoutes);
app.use("/api/locales", localesRoutes);
app.use("/api/recibo-config", reciboConfigRoutes);
app.use("/api/agregados", requireModule('agregados'), agregadoRoutes);
app.use("/api/social-config", requireModule('pedidosWeb'), socialConfigRoutes);
app.use("/api/restaurante", requireModule('restaurante'), restauranteRoutes);
app.use("/api/descuentos", descuentoRoutes);

// 🔌 Levantar servidor primero para evitar timeout en Render
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

// 🔌 Conexión MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "possail",
  })
  .then(() => {
    console.log("✅ Conectado a MongoDB");
    bootstrapSuperadmin().catch((err) => {
      console.error("Error al crear superadmin:", err.message);
    });
  })
  .catch((err) => {
    console.error("❌ Error al conectar a MongoDB:", err);
  });
