const DEV_DEFAULT_SECRET = "dev_only_change_this_jwt_secret";

let warned = false;

const getJwtSecret = () => {
  const raw = typeof process.env.JWT_SECRET === "string" ? process.env.JWT_SECRET.trim() : "";
  if (raw) return raw;

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET no configurado en entorno productivo");
  }

  if (!warned) {
    warned = true;
    console.warn("[auth] JWT_SECRET no definido; usando secreto temporal de desarrollo.");
  }
  return DEV_DEFAULT_SECRET;
};

const getJwtExpiresIn = () => {
  const raw = typeof process.env.JWT_EXPIRES_IN === "string" ? process.env.JWT_EXPIRES_IN.trim() : "";
  return raw || "12h";
};

const ensureJwtConfig = () => {
  getJwtSecret();
};

module.exports = {
  getJwtSecret,
  getJwtExpiresIn,
  ensureJwtConfig,
};
