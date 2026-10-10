const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../utils/jwtConfig");

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "Token no proporcionado" });

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.clienteId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ msg: "Token inválido" });
  }
};

module.exports = authMiddleware;
