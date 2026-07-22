import { parseTopicId, sendTopicMessage } from "./telegram.js";

const interestLabels = {
  hunt: "Охота",
  fishing: "Рыбалка",
  family: "Семейный отдых",
  group: "Групповая поездка",
  combined: "Комбинированная программа",
};

const limits = {
  name: 100,
  phone: 80,
  interest: 40,
  details: 1_000,
  website: 120,
};

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function escapeHtml(value) {
  return value.replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character]);
}

export function validateTripRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Некорректные данные формы." };
  }

  const request = {
    name: clean(payload.name, limits.name),
    phone: clean(payload.phone, limits.phone),
    interest: clean(payload.interest, limits.interest),
    details: clean(payload.details, limits.details),
    website: clean(payload.website, limits.website),
  };

  if (request.website) {
    return { ok: true, request: null };
  }

  if (!request.name || !request.phone) {
    return { ok: false, error: "Укажите имя и телефон." };
  }

  if (!interestLabels[request.interest]) {
    return { ok: false, error: "Выберите формат поездки." };
  }

  return { ok: true, request };
}

export function formatTripRequest(request) {
  const rows = [
    "<b>Новая заявка с сайта «Великовское»</b>",
    "",
    `<b>Имя:</b> ${escapeHtml(request.name)}`,
    `<b>Телефон:</b> ${escapeHtml(request.phone)}`,
    `<b>Интерес:</b> ${escapeHtml(interestLabels[request.interest])}`,
  ];

  if (request.details) {
    rows.push(`<b>Даты и состав:</b> ${escapeHtml(request.details)}`);
  }

  return rows.join("\n");
}

export async function sendTripRequest(
  request,
  environment = process.env,
  fetchImpl = fetch,
) {
  const topicId = parseTopicId(
    environment.TELEGRAM_TRIP_TOPIC_ID,
    "TELEGRAM_TRIP_TOPIC_ID",
  );
  return sendTopicMessage({
    text: formatTripRequest(request),
    topicId,
    parseMode: "HTML",
    replyMarkup: {
      inline_keyboard: [[
        { text: "✅ Рассмотрено", callback_data: "trip:reviewed" },
      ]],
    },
  }, environment, fetchImpl);
}

export async function processTripRequest(payload, environment = process.env, options = {}) {
  const validation = validateTripRequest(payload);

  if (!validation.ok) {
    return { ok: false, status: 400, body: { error: validation.error } };
  }

  if (!validation.request) {
    return { ok: true, status: 200, body: { ok: true } };
  }

  try {
    if (options.sendTripRequest) {
      await options.sendTripRequest(validation.request, environment);
    } else {
      await sendTripRequest(
        validation.request,
        environment,
        options.fetchImpl ?? fetch,
      );
    }
    return { ok: true, status: 200, body: { ok: true } };
  } catch (error) {
    const errorMessage = error.message === "TELEGRAM_NOT_CONFIGURED"
      ? "Отправка формы пока не настроена. Позвоните нам, чтобы согласовать поездку."
      : "Не удалось отправить запрос. Попробуйте ещё раз или позвоните нам.";

    return { ok: false, status: 502, body: { error: errorMessage } };
  }
}
