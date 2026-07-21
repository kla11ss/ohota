import { processAvailabilityRequest } from "../server/availability.js";
import { queryParameters, requestMethodNotAllowed, sendJson } from "../server/http.js";

export async function handleAvailability(request, response, options = {}) {
  if (request.method !== "GET") return requestMethodNotAllowed(response, ["GET"]);
  const result = await processAvailabilityRequest(
    queryParameters(request),
    options.environment ?? process.env,
    options,
  );
  return sendJson(response, result.status, result.body);
}

export default function handler(request, response) {
  return handleAvailability(request, response);
}
