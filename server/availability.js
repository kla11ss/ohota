import {
  addIsoDays,
  calculateNights,
  getBookingDateWindow,
  parseIsoDate,
  validateAvailabilitySelection,
} from "./booking-request.js";
import { DATABASE_NOT_CONFIGURED, getBookingRepository } from "./booking-database.js";

const MAX_PUBLIC_RANGE_DAYS = 370;

export function validateAvailabilityRange(query, today = new Date()) {
  const from = typeof query?.from === "string" ? query.from.trim() : "";
  const to = typeof query?.to === "string" ? query.to.trim() : "";
  if (!parseIsoDate(from) || !parseIsoDate(to)) {
    return { ok: false, error: "Укажите диапазон дат в формате YYYY-MM-DD." };
  }

  const days = calculateNights(from, to);
  if (days < 1 || days > MAX_PUBLIC_RANGE_DAYS) {
    return { ok: false, error: "Некорректный диапазон дат." };
  }

  const { minDate, maxDate } = getBookingDateWindow(today);
  if (from < minDate || to > maxDate) {
    return { ok: false, error: "Диапазон должен находиться в пределах ближайших 12 месяцев." };
  }
  return { ok: true, from, to, days };
}

function emptyDay() {
  return {
    hotelRoom: { remaining: 6, available: true },
    cottage: { available: true },
    hunterHouses: {
      "hunter-house-1": { available: true },
      "hunter-house-2": { available: true },
    },
  };
}

export function formatAvailability(from, to, rows) {
  const days = {};
  for (let date = from; date < to; date = addIsoDays(date, 1)) days[date] = emptyDay();

  for (const row of rows) {
    const day = days[row.date];
    if (!day || row.available) continue;
    if (row.stayId === "hotel-room") {
      day.hotelRoom.remaining = Math.max(0, day.hotelRoom.remaining - 1);
      day.hotelRoom.available = day.hotelRoom.remaining > 0;
    } else if (row.stayId === "cottage") {
      day.cottage.available = false;
    } else if (row.stayId === "hunter-house" && day.hunterHouses[row.unitId]) {
      day.hunterHouses[row.unitId].available = false;
    }
  }
  return { from, to, days };
}

function databaseErrorBody(error) {
  const notConfigured = error?.message === DATABASE_NOT_CONFIGURED;
  return {
    error: notConfigured
      ? "Календарь занятости временно не настроен. Даты можно уточнить по телефону +7 920 020-15-16."
      : "Не удалось загрузить занятость. Попробуйте ещё раз.",
  };
}

export async function processAvailabilityRequest(query, environment = process.env, options = {}) {
  const validation = validateAvailabilityRange(query, options.today);
  if (!validation.ok) return { ok: false, status: 400, body: { error: validation.error } };

  try {
    const repository = options.repository ?? await getBookingRepository(environment);
    const rows = await repository.listAvailability(validation.from, validation.to);
    return {
      ok: true,
      status: 200,
      body: formatAvailability(validation.from, validation.to, rows),
    };
  } catch (error) {
    return { ok: false, status: 503, body: databaseErrorBody(error) };
  }
}

export async function processAvailabilityCheck(payload, environment = process.env, options = {}) {
  const validation = validateAvailabilitySelection(payload, options.today);
  if (!validation.ok) return { ok: false, status: 400, body: { error: validation.error } };

  try {
    const repository = options.repository ?? await getBookingRepository(environment);
    const result = await repository.checkAvailability(validation.selection);
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        available: result.available,
        code: result.code,
      },
    };
  } catch (error) {
    return { ok: false, status: 503, body: databaseErrorBody(error) };
  }
}
