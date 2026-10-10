const jwt = require("jsonwebtoken");
const { getJwtExpiresIn, getJwtSecret } = require("./jwtConfig");

const extractBearerToken = (authHeader) => {
  if (typeof authHeader !== "string") return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
};

const signUserToken = (usuario) => {
  const localId =
    usuario?.local && typeof usuario.local === "object"
      ? usuario.local._id || usuario.local.id || null
      : usuario?.local || null;

  const payload = {
    id: String(usuario._id),
    rol: String(usuario.rol || ""),
    localId: localId ? String(localId) : null,
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: getJwtExpiresIn() });
};

const getAuthPayloadFromRequest = (req) => {
  const token = extractBearerToken(req?.headers?.authorization);
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (_err) {
    return null;
  }
};

module.exports = {
  extractBearerToken,
  signUserToken,
  getAuthPayloadFromRequest,
};
