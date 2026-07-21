import { getBookingRepository } from "../server/booking-database.js";
import { processBookingRequest } from "../server/booking-request.js";
import {
  bodyReadError,
  clientRateLimitHashes,
  readJsonBody,
  requestMethodNotAllowed,
  sendJson,
} from "../server/http.js";

export async function handleBookingRequest(request, response, options = {}) {
  if (request.method !== "POST") return requestMethodNotAllowed(response, ["POST"]);

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const result = bodyReadError(error);
    return sendJson(response, result.status, result.body);
  }

  const environment = options.environment ?? process.env;
  const honeypotValue = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload.website ?? payload.honeypot
    : null;
  if (typeof honeypotValue === "string" && honeypotValue.trim().slice(0, 120)) {
    const result = await processBookingRequest(payload, environment, options);
    return sendJson(response, result.status, result.body);
  }

  let repository;
  try {
    repository = options.repository ?? await getBookingRepository(environment);
  } catch {
    return sendJson(response, 503, {
      error: "Приём заявок временно не настроен. Позвоните нам по телефону +7 920 020-15-16.",
    });
  }

  let clientHashes;
  try {
    clientHashes = clientRateLimitHashes(request, environment);
  } catch {
    return sendJson(response, 503, {
      error: "Приём заявок временно не настроен. Позвоните нам по телефону +7 920 020-15-16.",
    });
  }
  const currentClientHash = clientHashes[0];
  let reservationToken = null;
  try {
    const reservation = await repository.reserveRateLimit(clientHashes, 20);
    if (!reservation.allowed) {
      return sendJson(response, 429, { error: "Подождите немного перед повторной отправкой." });
    }
    reservationToken = reservation.reservationToken;
    if (!reservationToken) throw new Error("RATE_LIMIT_RESERVATION_TOKEN_MISSING");
  } catch {
    return sendJson(response, 503, { error: "Не удалось проверить заявку. Попробуйте ещё раз." });
  }

  let keepReservation = false;
  try {
    const result = await processBookingRequest(payload, environment, {
      ...options,
      repository,
    });
    keepReservation = result.ok;
    return sendJson(response, result.status, result.body);
  } catch {
    return sendJson(response, 503, {
      error: "Не удалось обработать заявку. Введённые данные сохранены в форме — попробуйте ещё раз или позвоните нам по телефону +7 920 020-15-16.",
    });
  } finally {
    if (!keepReservation) {
      try {
        await repository.releaseRateLimit(currentClientHash, reservationToken);
      } catch {
        // A short-lived reservation is safer than masking the original error.
      }
    }
  }
}

export default function handler(request, response) {
  return handleBookingRequest(request, response);
}
