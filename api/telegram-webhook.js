import { bodyReadError, getHeader, readJsonBody, requestMethodNotAllowed, sendJson } from "../server/http.js";
import { processTelegramWebhook } from "../server/telegram-webhook.js";

export async function handleTelegramWebhook(request, response, options = {}) {
  if (request.method !== "POST") return requestMethodNotAllowed(response, ["POST"]);
  let update;
  try {
    update = await readJsonBody(request);
  } catch (error) {
    const result = bodyReadError(error);
    return sendJson(response, result.status, result.body);
  }
  const secret = getHeader(request, "x-telegram-bot-api-secret-token");
  const result = await processTelegramWebhook(
    update,
    secret,
    options.environment ?? process.env,
    options,
  );
  return sendJson(response, result.status, result.body);
}

export default function handler(request, response) {
  return handleTelegramWebhook(request, response);
}
