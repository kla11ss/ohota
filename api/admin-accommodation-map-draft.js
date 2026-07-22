import { getBookingRepository } from "../server/booking-database.js";
import {
  getAccommodationEditorConfiguration,
  hasAccommodationEditorSession,
  isSameOriginWrite,
  validateAccommodationMapPayload,
} from "../server/accommodation-map.js";
import {
  bodyReadError,
  readJsonBody,
  requestMethodNotAllowed,
  sendJson,
} from "../server/http.js";
import { createAccommodationMapDraft, validateAccommodationMap } from "../src/accommodation-map/config.js";

function authorized(request, response, environment) {
  if (!getAccommodationEditorConfiguration(environment).ok) {
    sendJson(response, 503, { error: "Редактор схемы ещё не настроен на сервере." });
    return false;
  }
  if (!hasAccommodationEditorSession(request, environment)) {
    sendJson(response, 401, { error: "Требуется вход в редактор." });
    return false;
  }
  return true;
}

export async function handleAccommodationMapDraft(request, response, options = {}) {
  const environment = options.environment ?? process.env;
  if (request.method !== "GET" && request.method !== "PUT") {
    return requestMethodNotAllowed(response, ["GET", "PUT"]);
  }
  if (!authorized(request, response, environment)) return undefined;
  if (request.method === "PUT" && !isSameOriginWrite(request)) {
    return sendJson(response, 403, { error: "Недопустимый источник запроса." });
  }

  let repository;
  try {
    repository = options.repository ?? await getBookingRepository(environment);
  } catch {
    return sendJson(response, 503, { error: "Хранилище схемы временно недоступно." });
  }

  if (request.method === "GET") {
    try {
      const draft = await repository.getAccommodationMapDraft();
      const validated = draft ? validateAccommodationMap(draft) : null;
      return sendJson(response, 200, {
        config: validated?.ok ? validated.value : createAccommodationMapDraft(),
        hasSavedDraft: Boolean(validated?.ok),
      });
    } catch {
      return sendJson(response, 503, { error: "Не удалось прочитать черновик схемы." });
    }
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const result = bodyReadError(error);
    return sendJson(response, result.status, result.body);
  }
  const validated = validateAccommodationMapPayload(payload);
  if (!validated.ok) return sendJson(response, 400, { error: validated.error });

  try {
    const saved = await repository.saveAccommodationMapDraft(validated.value);
    return sendJson(response, 200, { config: saved ?? validated.value, saved: true });
  } catch {
    return sendJson(response, 503, { error: "Не удалось сохранить черновик схемы." });
  }
}

export default function handler(request, response) {
  return handleAccommodationMapDraft(request, response);
}
