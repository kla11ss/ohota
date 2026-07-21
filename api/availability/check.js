import { processAvailabilityCheck } from "../../server/availability.js";
import {
  bodyReadError,
  readJsonBody,
  requestMethodNotAllowed,
  sendJson,
} from "../../server/http.js";

export async function handleAvailabilityCheck(request, response, options = {}) {
  if (request.method !== "POST") return requestMethodNotAllowed(response, ["POST"]);
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const result = bodyReadError(error);
    return sendJson(response, result.status, result.body);
  }
  const result = await processAvailabilityCheck(
    payload,
    options.environment ?? process.env,
    options,
  );
  return sendJson(response, result.status, result.body);
}

export default function handler(request, response) {
  return handleAvailabilityCheck(request, response);
}
