const { sanitizeOptionalText, toNumberOrNull } = require("./input");

const normalizeCoordinate = (raw) => {
  const lat = toNumberOrNull(raw?.lat);
  const lng = toNumberOrNull(raw?.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat: Number(lat),
    lng: Number(lng),
  };
};

const normalizePolygon = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCoordinate).filter(Boolean);
};

const normalizeDeliveryZones = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((zone, index) => {
      const polygon = normalizePolygon(zone?.polygon);
      if (polygon.length < 3) return null;
      return {
        name: sanitizeOptionalText(zone?.name, { max: 80 }) || `Zona ${index + 1}`,
        color: sanitizeOptionalText(zone?.color, { max: 20 }) || "#2563eb",
        active: zone?.active !== false,
        priority: Number.isFinite(Number(zone?.priority)) ? Number(zone.priority) : index,
        polygon,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority);
};

const isPointOnSegment = (point, start, end) => {
  const cross =
    (point.lng - start.lng) * (end.lat - start.lat) -
    (point.lat - start.lat) * (end.lng - start.lng);
  if (Math.abs(cross) > 1e-10) return false;

  const dot =
    (point.lng - start.lng) * (end.lng - start.lng) +
    (point.lat - start.lat) * (end.lat - start.lat);
  if (dot < 0) return false;

  const squaredLength =
    (end.lng - start.lng) * (end.lng - start.lng) +
    (end.lat - start.lat) * (end.lat - start.lat);
  return dot <= squaredLength;
};

const isPointInPolygon = (point, polygon = []) => {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];

    if (isPointOnSegment(point, current, previous)) {
      return true;
    }

    const intersects =
      current.lat > point.lat !== previous.lat > point.lat &&
      point.lng <
        ((previous.lng - current.lng) * (point.lat - current.lat)) /
          (previous.lat - current.lat || Number.EPSILON) +
          current.lng;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const resolveMatchingZone = (zones = [], point) => {
  const normalizedPoint = normalizeCoordinate(point);
  if (!normalizedPoint) {
    return { ok: false, reason: "Coordenadas de delivery invalidas", zone: null };
  }

  const activeZones = normalizeDeliveryZones(zones).filter((zone) => zone.active !== false);
  if (activeZones.length === 0) {
    return { ok: true, reason: "", zone: null };
  }

  const zone = activeZones.find((item) => isPointInPolygon(normalizedPoint, item.polygon)) || null;
  if (!zone) {
    return { ok: false, reason: "La ubicacion esta fuera de la zona de reparto", zone: null };
  }

  return { ok: true, reason: "", zone };
};

module.exports = {
  normalizeCoordinate,
  normalizePolygon,
  normalizeDeliveryZones,
  isPointInPolygon,
  resolveMatchingZone,
};
