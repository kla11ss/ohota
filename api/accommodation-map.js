import { getBookingRepository } from "../server/booking-database.js";
import { requestMethodNotAllowed, sendJson } from "../server/http.js";
import { validateAccommodationMap } from "../src/accommodation-map/config.js";

export async function handleAccommodationMap(request, response, options = {}) {
  if (request.method !== "GET") return requestMethodNotAllowed(response, ["GET"]);

  try {
    const repository = options.repository ?? await getBookingRepository(options.environment ?? process.env);
    const rawConfig = await repository.getPublishedAccommodationMap();
    const validated = rawConfig ? validateAccommodationMap(rawConfig) : { ok: false };
    return sendJson(response, 200, {
      published: Boolean(validated.ok),
      config: validated.ok ? validated.value : null,
    });
  } catch {
    return sendJson(response, 503, {
      published: false,
      config: null,
      error: "Схема размещения временно недоступна.",
    });
  }
}

export default function handler(request, response) {
  return handleAccommodationMap(request, response);
}
