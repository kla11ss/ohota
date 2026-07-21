import { createHash } from "node:crypto";

import {
  calculateBookingTotal,
  formatNightlyRate,
  formatRubles,
  getSelectionCapacity,
  getStayById,
} from "../src/booking/catalog.js";
import {
  createRequestId,
  DATABASE_NOT_CONFIGURED,
  getBookingRepository,
} from "./booking-database.js";
import {
  deleteTelegramMessage,
  parseTopicId,
  sendTopicMessage,
} from "./telegram.js";

const BOOKING_TIME_ZONE = "Europe/Moscow";
const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const limits = {
  stayId: 60,
  unitId: 60,
  phone: 80,
  name: 100,
  comment: 1_000,
  website: 120,
  requestKey: 60,
};

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character]);
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}

export function currentDateInMoscow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addIsoDays(isoDate, days) {
  const date = parseIsoDate(isoDate);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return dateToIso(date);
}

function addMonthsClamped(isoDate, months) {
  const date = parseIsoDate(isoDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateToIso(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, daysInTargetMonth))));
}

export function getBookingDateWindow(today = new Date()) {
  const minDate = typeof today === "string" && parseIsoDate(today)
    ? today
    : currentDateInMoscow(today instanceof Date ? today : new Date(today));
  return { minDate, maxDate: addMonthsClamped(minDate, 12) };
}

export function calculateNights(checkIn, checkOut) {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_IN_MS);
}

export function validateStaySelection(stay, payload) {
  if (stay.selectionType === "units") {
    if (!Array.isArray(payload.unitIds)) {
      return { ok: false, error: "Выберите хотя бы один дом охотника." };
    }

    const unitIds = payload.unitIds.map((id) => clean(id, limits.unitId));
    const allowedIds = new Set(stay.unitOptions.map((unit) => unit.id));
    if (
      unitIds.length < stay.minUnits
      || unitIds.length > stay.maxUnits
      || new Set(unitIds).size !== unitIds.length
      || unitIds.some((id) => !allowedIds.has(id))
    ) {
      return { ok: false, error: "Выберите дом охотника № 1, № 2 или оба дома." };
    }

    return { ok: true, selection: { unitIds } };
  }

  if (stay.selectionType === "fixed") {
    if (payload.quantity !== undefined && payload.quantity !== 1) {
      return { ok: false, error: "Коттедж бронируется целиком." };
    }
    return { ok: true, selection: { quantity: 1 } };
  }

  if (
    !Number.isInteger(payload.quantity)
    || payload.quantity < stay.minUnits
    || payload.quantity > stay.maxUnits
  ) {
    return { ok: false, error: `Выберите от ${stay.minUnits} до ${stay.maxUnits} номеров.` };
  }
  return { ok: true, selection: { quantity: payload.quantity } };
}

export function validateBookingDates(payload, today = new Date()) {
  const checkIn = typeof payload.checkIn === "string" ? payload.checkIn.trim() : "";
  const checkOut = typeof payload.checkOut === "string" ? payload.checkOut.trim() : "";
  if (!parseIsoDate(checkIn) || !parseIsoDate(checkOut)) {
    return { ok: false, error: "Укажите даты заезда и выезда." };
  }

  const { minDate, maxDate } = getBookingDateWindow(today);
  if (checkIn < minDate || checkIn > maxDate || checkOut < minDate || checkOut > maxDate) {
    return { ok: false, error: "Даты должны быть в пределах ближайших 12 месяцев." };
  }

  const nights = calculateNights(checkIn, checkOut);
  if (nights < 1) {
    return { ok: false, error: "Дата выезда должна быть позже даты заезда минимум на одну ночь." };
  }
  return { ok: true, checkIn, checkOut, nights };
}

export function validateAvailabilitySelection(payload, today = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Некорректные данные формы." };
  }

  const stay = getStayById(clean(payload.stayId, limits.stayId));
  if (!stay) return { ok: false, error: "Выберите вариант размещения." };

  const selectionResult = validateStaySelection(stay, payload);
  if (!selectionResult.ok) return selectionResult;
  const datesResult = validateBookingDates(payload, today);
  if (!datesResult.ok) return datesResult;

  const selectedUnitIds = stay.selectionType === "units"
    ? selectionResult.selection.unitIds
    : [];
  const unitCount = stay.selectionType === "units"
    ? selectedUnitIds.length
    : selectionResult.selection.quantity;

  return {
    ok: true,
    selection: {
      stay,
      selection: selectionResult.selection,
      stayId: stay.id,
      unitCount,
      selectedUnitIds,
      ...datesResult,
    },
  };
}

export function validateBookingRequest(payload, today = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Некорректные данные формы." };
  }

  const website = clean(payload.website ?? payload.honeypot, limits.website);
  if (website) return { ok: true, request: null };

  const requestKey = clean(payload.requestKey, limits.requestKey);
  if (!UUID_PATTERN.test(requestKey)) {
    return { ok: false, error: "Не удалось идентифицировать заявку. Обновите страницу и попробуйте ещё раз." };
  }

  const base = validateAvailabilitySelection(payload, today);
  if (!base.ok) return base;
  const { stay, selection, checkIn, checkOut, nights, unitCount, selectedUnitIds } = base.selection;

  const { adults, children } = payload;
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) {
    return { ok: false, error: "Укажите корректное количество взрослых и детей." };
  }

  const capacity = getSelectionCapacity(stay, selection);
  if (adults + children > capacity) {
    return { ok: false, error: `Выбранный вариант рассчитан максимум на ${capacity} гостей.` };
  }

  const phone = clean(payload.phone, limits.phone);
  const phoneDigits = phone.replace(/\D/g, "");
  if (!phone || !/^[+\d().\-\s]+$/.test(phone) || phoneDigits.length < 10 || phoneDigits.length > 15) {
    return { ok: false, error: "Укажите телефон, содержащий от 10 до 15 цифр." };
  }

  return {
    ok: true,
    request: {
      requestKey,
      stay,
      selection,
      stayId: stay.id,
      unitCount,
      selectedUnitIds,
      checkIn,
      checkOut,
      nights,
      adults,
      children,
      capacity,
      total: calculateBookingTotal(stay, nights, selection),
      phone,
      phoneDigits,
      name: clean(payload.name, limits.name),
      comment: clean(payload.comment, limits.comment),
    },
  };
}

function pluralize(number, [one, few, many]) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDate(isoDate));
}

function formatSelection(request) {
  if (request.stay.selectionType === "units") {
    const selectedIds = new Set(request.selection.unitIds);
    return request.stay.unitOptions
      .filter((unit) => selectedIds.has(unit.id))
      .map((unit) => unit.label)
      .join(", ");
  }
  if (request.stay.selectionType === "fixed") return "Коттедж целиком";
  const quantity = request.selection.quantity;
  return `${quantity} ${pluralize(quantity, ["номер", "номера", "номеров"])}`;
}

export function formatBookingRequest(request, requestId = null) {
  const guests = request.adults + request.children;
  const guestSummary = [
    `${request.adults} ${pluralize(request.adults, ["взрослый", "взрослых", "взрослых"])}`,
    `${request.children} ${pluralize(request.children, ["ребёнок", "ребёнка", "детей"])}`,
  ].join(", ");
  const totalLabel = request.total === null ? "Итог уточняется" : formatRubles(request.total);

  const rows = [
    "<b>Новый запрос на бронирование размещения</b>",
    "<b>Статус:</b> требует подтверждения",
  ];
  if (requestId) rows.push(`<b>ID:</b> <code>${escapeHtml(requestId)}</code>`);
  rows.push(
    "",
    `<b>Вариант:</b> ${escapeHtml(request.stay.label)}`,
    `<b>Выбрано:</b> ${escapeHtml(formatSelection(request))}`,
    `<b>Заезд:</b> ${escapeHtml(formatDate(request.checkIn))}`,
    `<b>Выезд:</b> ${escapeHtml(formatDate(request.checkOut))}`,
    `<b>Ночей:</b> ${request.nights}`,
    `<b>Гости:</b> ${escapeHtml(guestSummary)} — всего ${guests}`,
    `<b>Вместимость:</b> до ${request.capacity} гостей`,
    `<b>Тариф:</b> ${escapeHtml(formatNightlyRate(request.stay))}`,
    `<b>Ориентировочный итог:</b> ${escapeHtml(totalLabel)}`,
    "",
    `<b>Телефон:</b> ${escapeHtml(request.phone)}`,
  );
  if (request.name) rows.push(`<b>Имя:</b> ${escapeHtml(request.name)}`);
  if (request.comment) rows.push(`<b>Комментарий:</b> ${escapeHtml(request.comment)}`);
  return rows.join("\n");
}

export function getBookingRequestKeyboard(requestId) {
  return {
    inline_keyboard: [[
      { text: "✅ Подтвердить", callback_data: `booking:confirm:${requestId}` },
      { text: "❌ Отклонить", callback_data: `booking:reject:${requestId}` },
    ]],
  };
}

export async function sendBookingRequest(
  request,
  requestIdOrEnvironment,
  environmentOrFetch = process.env,
  maybeFetch = fetch,
) {
  // Backwards-compatible signature: sendBookingRequest(request, environment, fetch).
  const hasRequestId = typeof requestIdOrEnvironment === "string";
  const requestId = hasRequestId ? requestIdOrEnvironment : request.id ?? createRequestId();
  const environment = hasRequestId ? environmentOrFetch : requestIdOrEnvironment;
  const fetchImpl = hasRequestId ? maybeFetch : environmentOrFetch;
  const topicId = parseTopicId(
    environment.TELEGRAM_NEW_TOPIC_ID,
    "TELEGRAM_NEW_TOPIC_ID",
  );
  return sendTopicMessage({
    text: formatBookingRequest(request, requestId),
    topicId,
    replyMarkup: getBookingRequestKeyboard(requestId),
    parseMode: "HTML",
  }, environment, fetchImpl);
}

function bookingMetadata(request, id) {
  const canonical = {
    stayId: request.stayId,
    unitCount: request.unitCount,
    selectedUnitIds: [...request.selectedUnitIds].sort(),
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    adults: request.adults,
    children: request.children,
    capacity: request.capacity,
    nights: request.nights,
    nightlyRate: request.stay.pricePerNight,
    total: request.total,
  };
  return {
    id,
    requestKey: request.requestKey,
    metadataHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    ...canonical,
  };
}

function configurationError(error) {
  return error?.message === DATABASE_NOT_CONFIGURED || error?.message === "BOOKING_DATABASE_NOT_CONFIGURED";
}

function databaseErrorCategory(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/row-level security policy/i.test(message)) return "row-level-security";
  if (/permission denied for table/i.test(message)) return "table-permission";
  if (/permission denied for sequence/i.test(message)) return "sequence-permission";
  if (/permission denied for (?:schema|database)/i.test(message)) return "namespace-permission";
  if (/permission denied for function/i.test(message)) return "function-permission";
  return "other";
}

function logDatabaseFailure(stage, error, environment) {
  let configuredRole = "unparseable";
  try {
    configuredRole = new URL(environment.DATABASE_URL).username || "missing";
  } catch {
    // The public response already handles invalid configuration without
    // exposing the connection string.
  }
  const detail = {
    stage,
    code: typeof error?.code === "string" ? error.code.slice(0, 32) : "unknown",
    category: databaseErrorCategory(error),
    configuredRole: configuredRole.slice(0, 64),
    constraint: typeof error?.constraint_name === "string"
      ? error.constraint_name.slice(0, 100)
      : null,
    routine: typeof error?.routine === "string" ? error.routine.slice(0, 100) : null,
  };
  console.error("[booking-request] Database operation failed", detail);
}

export async function processBookingRequest(payload, environment = process.env, options = {}) {
  const validation = validateBookingRequest(payload, options.today);
  if (!validation.ok) return { ok: false, status: 400, body: { error: validation.error } };
  if (!validation.request) return { ok: true, status: 200, body: { ok: true } };

  let repository;
  try {
    repository = options.repository ?? await getBookingRepository(environment);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      body: {
        error: configurationError(error)
          ? "Приём заявок временно не настроен. Позвоните нам по телефону +7 920 020-15-16."
          : "Не удалось проверить заявку. Попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16.",
      },
    };
  }

  const metadata = bookingMetadata(validation.request, createRequestId());
  let stored;
  let databaseStage = "find-existing-request";
  try {
    const existing = await repository.getRequestByRequestKey(validation.request.requestKey);
    if (existing) {
      if (existing.metadataHash !== metadata.metadataHash) {
        return {
          ok: false,
          status: 409,
          body: { error: "Эта заявка уже была отправлена с другими параметрами. Обновите страницу и попробуйте снова." },
        };
      }
      if (
        existing.status !== "notification_failed"
        && !(existing.status === "pending" && existing.telegramMessageId === null)
      ) {
        return {
          ok: true,
          status: 200,
          body: { ok: true, requestId: existing.id, status: existing.status },
        };
      }
    }

    databaseStage = "check-availability";
    const availability = await repository.checkAvailability({
      stayId: validation.request.stayId,
      unitCount: validation.request.unitCount,
      selectedUnitIds: validation.request.selectedUnitIds,
      checkIn: validation.request.checkIn,
      checkOut: validation.request.checkOut,
    });
    if (!availability.available) {
      return {
        ok: false,
        status: 409,
        body: { error: "Выбранные даты уже заняты. Обновите календарь и выберите другой период." },
      };
    }
    databaseStage = "create-request";
    stored = await repository.createOrGetRequest(metadata);
  } catch (error) {
    logDatabaseFailure(databaseStage, error, environment);
    return {
      ok: false,
      status: 503,
      body: { error: "Не удалось сохранить заявку. Попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16." },
    };
  }

  if (!stored.request) {
    return { ok: false, status: 503, body: { error: "Не удалось сохранить заявку." } };
  }
  if (stored.request.metadataHash !== metadata.metadataHash) {
    return {
      ok: false,
      status: 409,
      body: { error: "Эта заявка уже была отправлена с другими параметрами. Обновите страницу и попробуйте снова." },
    };
  }

  if (
    !stored.created
    && stored.request.status !== "notification_failed"
    && !(stored.request.status === "pending" && stored.request.telegramMessageId === null)
  ) {
    return {
      ok: true,
      status: 200,
      body: { ok: true, requestId: stored.request.id, status: stored.request.status },
    };
  }

  let deliveryClaim;
  try {
    deliveryClaim = await repository.claimNotificationDelivery(stored.request.id);
  } catch {
    return {
      ok: false,
      status: 503,
      body: { error: "Не удалось подготовить заявку к отправке. Попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16." },
    };
  }
  if (!deliveryClaim) {
    return {
      ok: true,
      status: 200,
      body: { ok: true, requestId: stored.request.id, status: "pending" },
    };
  }

  let telegram;
  try {
    telegram = options.sendBookingRequest
      ? await options.sendBookingRequest(validation.request, stored.request.id)
      : await sendBookingRequest(
        validation.request,
        stored.request.id,
        environment,
        options.fetchImpl ?? fetch,
      );
  } catch (error) {
    try {
      await repository.markNotificationFailed(stored.request.id, error?.code ?? error?.message);
    } catch {
      // The delivery error remains the primary failure; a database outage must not escape the handler.
    }
    const missingConfiguration = error?.code === "TELEGRAM_NOT_CONFIGURED"
      || error?.message === "TELEGRAM_NOT_CONFIGURED";
    return {
      ok: false,
      status: 502,
      body: {
        error: missingConfiguration
          ? "Отправка формы пока не настроена. Позвоните нам по телефону +7 920 020-15-16."
          : "Не удалось отправить запрос. Введённые данные сохранены в форме — попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16.",
      },
    };
  }

  try {
    const delivered = await repository.markTelegramDelivered(stored.request.id, telegram);
    if (!delivered) throw new Error("BOOKING_TELEGRAM_DELIVERY_NOT_RECORDED");
  } catch (error) {
    try {
      const removeMessage = options.deleteTelegramMessage ?? deleteTelegramMessage;
      await removeMessage(
        telegram.chatId,
        telegram.messageId,
        environment,
        options.fetchImpl ?? fetch,
      );
    } catch {
      // Best effort: the request must still return a controlled error if Telegram cleanup fails.
    }

    try {
      await repository.markNotificationFailed(stored.request.id, error?.code ?? error?.message);
    } catch {
      // A secondary database failure must not turn the API response into an unhandled rejection.
    }

    return {
      ok: false,
      status: 503,
      body: {
        error: "Не удалось зарегистрировать заявку. Введённые данные сохранены в форме — попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16.",
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { ok: true, requestId: stored.request.id, status: "pending" },
  };
}
