const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULT_WEB_TIMEZONE =
  process.env.WEB_SCHEDULE_TIMEZONE || process.env.TZ || "America/Santiago";

const WEEKDAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const parseTimeToMinutes = (raw) => {
  const value = String(raw || "").trim();
  const match = value.match(TIME_RE);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  return hh * 60 + mm;
};

const minutesToTime = (minutes) => {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const resolveScheduleClock = (now = new Date(), timeZone = DEFAULT_WEB_TIMEZONE) => {
  const date = now instanceof Date ? now : new Date(now);
  const fallback = {
    day: date.getDay(),
    minute: date.getHours() * 60 + date.getMinutes(),
    timeZone: "system",
  };

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const weekday = String(parts.find((item) => item.type === "weekday")?.value || "").toLowerCase();
    const hour = Number(parts.find((item) => item.type === "hour")?.value);
    const minutePart = Number(parts.find((item) => item.type === "minute")?.value);
    const day = WEEKDAY_MAP[weekday];

    if (!Number.isInteger(day) || !Number.isFinite(hour) || !Number.isFinite(minutePart)) {
      return fallback;
    }

    return {
      day,
      minute: hour * 60 + minutePart,
      timeZone,
    };
  } catch {
    return fallback;
  }
};

const normalizeWebSchedule = (raw) => {
  if (!Array.isArray(raw)) return [];

  const byDay = new Map();

  raw.forEach((entry) => {
    const dia = Number(entry?.dia);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) return;

    const tramosRaw = Array.isArray(entry?.tramos) ? entry.tramos : [];
    const normalized = tramosRaw
      .map((tramo) => {
        const ini = parseTimeToMinutes(tramo?.inicio);
        const fin = parseTimeToMinutes(tramo?.fin);
        if (ini === null || fin === null || fin <= ini) return null;
        return { ini, fin };
      })
      .filter(Boolean)
      .sort((a, b) => a.ini - b.ini);

    const merged = [];
    normalized.forEach((slot) => {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push({ ...slot });
        return;
      }
      if (slot.ini <= prev.fin) {
        prev.fin = Math.max(prev.fin, slot.fin);
        return;
      }
      merged.push({ ...slot });
    });

    byDay.set(
      dia,
      merged.map((slot) => ({
        inicio: minutesToTime(slot.ini),
        fin: minutesToTime(slot.fin),
      }))
    );
  });

  return Array.from(byDay.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([dia, tramos]) => ({ dia, tramos }));
};

const scheduleHasAnySlots = (schedule = []) =>
  Array.isArray(schedule) &&
  schedule.some((entry) => Array.isArray(entry?.tramos) && entry.tramos.length > 0);

const getDaySlots = (schedule = [], day) => {
  const entry = (Array.isArray(schedule) ? schedule : []).find((item) => Number(item?.dia) === Number(day));
  return Array.isArray(entry?.tramos) ? entry.tramos : [];
};

const isMinuteInsideSlots = (minute, slots = []) =>
  slots.some((slot) => {
    const ini = parseTimeToMinutes(slot?.inicio);
    const fin = parseTimeToMinutes(slot?.fin);
    if (ini === null || fin === null) return false;
    return minute >= ini && minute < fin;
  });

const evaluateWebSchedule = (schedule = [], now = new Date()) => {
  const normalized = normalizeWebSchedule(schedule);
  const clock = resolveScheduleClock(now);

  if (!scheduleHasAnySlots(normalized)) {
    return {
      active: false,
      open: true,
      reason: "sin_horario",
      day: clock.day,
      minute: clock.minute,
      timeZone: clock.timeZone,
      schedule: normalized,
    };
  }

  const slots = getDaySlots(normalized, clock.day);
  const open = isMinuteInsideSlots(clock.minute, slots);

  return {
    active: true,
    open,
    reason: open ? "abierto" : "cerrado",
    day: clock.day,
    minute: clock.minute,
    slots,
    timeZone: clock.timeZone,
    schedule: normalized,
  };
};

const validatePickupTime = (schedule = [], day, time) => {
  const minute = parseTimeToMinutes(time);
  if (minute === null) {
    return { valid: false, error: "Hora de retiro invalida" };
  }

  const normalized = normalizeWebSchedule(schedule);
  if (!scheduleHasAnySlots(normalized)) {
    return { valid: true, active: false, schedule: normalized };
  }

  const slots = getDaySlots(normalized, day);
  const valid = isMinuteInsideSlots(minute, slots);
  return {
    valid,
    active: true,
    slots,
    schedule: normalized,
    error: valid ? "" : "La hora de retiro esta fuera del horario de atencion",
  };
};

module.exports = {
  parseTimeToMinutes,
  normalizeWebSchedule,
  evaluateWebSchedule,
  validatePickupTime,
  scheduleHasAnySlots,
  resolveScheduleClock,
};
