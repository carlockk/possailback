const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const WHITESPACE = /\s+/g;

const collapseWhitespace = (value) => value.replace(WHITESPACE, " ").trim();

const sanitizeText = (value, { max = 200, allowEmpty = false } = {}) => {
  if (value === undefined || value === null) {
    return allowEmpty ? "" : null;
  }

  const cleaned = collapseWhitespace(String(value).replace(CONTROL_CHARS, ""));
  if (!cleaned && !allowEmpty) return null;

  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

const sanitizeOptionalText = (value, opts = {}) => {
  if (value === undefined) return undefined;
  return sanitizeText(value, { ...opts, allowEmpty: true });
};

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isValidEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const toNumberOrNull = (value) => {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
};

module.exports = {
  sanitizeText,
  sanitizeOptionalText,
  normalizeEmail,
  isValidEmail,
  toNumberOrNull,
};
