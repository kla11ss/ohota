import { getBookingRepository } from "../server/booking-database.js";
import {
  getAccommodationEditorConfiguration,
  hasAccommodationEditorSession,
  isSameOriginWrite,
} from "../server/accommodation-map.js";
import { requestMethodNotAllowed, sendJson } from "../server/http.js";
import { validateAccommodationMap } from "../src/accommodation-map/config.js";

export async function handleAccommodationMapPublish(request, response, options = {}) {
  if (request.method !== "POST") return requestMethodNotAllowed(response, ["POST"]);
  const environment = options.environment ?? process.env;
  if (!getAccommodationEditorConfiguration(environment).ok) {
    return sendJson(response, 503, { error: "Редактор схемы ещё не настроен на сервере." });
  }
  if (!hasAccommodationEditorSession(request, environment)) {
    return sendJson(response, 401, { error: "Требуется вход в редактор." });
  }
  if (!isSameOriginWrite(request)) return sendJson(response, 403, { error: "Недопустимый источник запроса." });

  try {
    const repository = options.repository ?? await getBookingRepository(environment);
    const config = await repository.publishAccommodationMap();
    const validated = validateAccommodationMap(config);
    if (!validated.ok) throw new Error("INVALID_PUBLISHED_MAP");
    return sendJson(response, 200, { published: true, config: validated.value });
  } catch {
    return sendJson(response, 503, { error: "Не удалось опубликовать схему. Сохраните корректный черновик и повторите." });
  }
}

export default function handler(request, response) {
  return handleAccommodationMapPublish(request, response);
}
