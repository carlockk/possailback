const validPassword = (value) =>
  typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;

module.exports = { validPassword };
