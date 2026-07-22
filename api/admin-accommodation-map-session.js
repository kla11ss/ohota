import {
  checkAccommodationEditorLoginLimit,
  clearAccommodationEditorLoginFailures,
  clearAccommodationEditorSessionCookie,
  createAccommodationEditorSessionCookie,
  getAccommodationEditorConfiguration,
  hasAccommodationEditorSession,
  isSameOriginWrite,
  registerAccommodationEditorLoginFailure,
  verifyAccommodationEditorPassword,
} from "../server/accommodation-map.js";
import {
  bodyReadError,
  readJsonBody,
  requestMethodNotAllowed,
  sendJson,
} from "../server/http.js";

function unavailable(response) {
  return sendJson(response, 503, {
    error: "Редактор схемы ещё не настроен на сервере.",
  });
}

export async function handleAccommodationMapSession(request, response, options = {}) {
  const environment = options.environment ?? process.env;
  if (!getAccommodationEditorConfiguration(environment).ok) return unavailable(response);

  if (request.method === "GET") {
    return sendJson(response, 200, { authenticated: hasAccommodationEditorSession(request, environment) });
  }

  if (request.method === "DELETE") {
    if (!isSameOriginWrite(request)) return sendJson(response, 403, { error: "Недопустимый источник запроса." });
    return sendJson(response, 200, { authenticated: false }, {
      "Set-Cookie": clearAccommodationEditorSessionCookie(),
    });
  }

  if (request.method !== "POST") return requestMethodNotAllowed(response, ["GET", "POST", "DELETE"]);
  if (!isSameOriginWrite(request)) return sendJson(response, 403, { error: "Недопустимый источник запроса." });

  const limit = checkAccommodationEditorLoginLimit(request, environment, options.now?.() ?? Date.now());
  if (!limit.allowed) {
    return sendJson(response, 429, {
      error: "Слишком много попыток. Повторите вход позднее.",
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const result = bodyReadError(error);
    return sendJson(response, result.status, result.body);
  }

  if (!verifyAccommodationEditorPassword(body?.password, environment)) {
    registerAccommodationEditorLoginFailure(request, environment, options.now?.() ?? Date.now());
    return sendJson(response, 401, { error: "Неверный пароль." });
  }

  clearAccommodationEditorLoginFailures(request, environment);
  return sendJson(response, 200, { authenticated: true }, {
    "Set-Cookie": createAccommodationEditorSessionCookie(environment, options.now?.() ?? Date.now()),
  });
}

export default function handler(request, response) {
  return handleAccommodationMapSession(request, response);
}
