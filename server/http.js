import { createHmac } from "node:crypto";

export const MAX_REQUEST_BODY_SIZE = 12 * 1024;
const RATE_LIMIT_ROTATION_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function getHeader(request, name) {
  if (typeof request?.headers?.get === "function") return request.headers.get(name);
  const direct = request?.headers?.[name.toLowerCase()] ?? request?.headers?.[name];
  return Array.isArray(direct) ? direct[0] : direct;
}

export async function readJsonBody(request, maxBytes = MAX_REQUEST_BODY_SIZE) {
  const contentLength = Number(getHeader(request, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("REQUEST_TOO_LARGE");

  let raw;
  if (request?.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) raw = request.body.toString("utf8");
    else if (typeof request.body === "string") raw = request.body;
    else {
      raw = JSON.stringify(request.body);
      if (Buffer.byteLength(raw) > maxBytes) throw new Error("REQUEST_TOO_LARGE");
      return request.body;
    }
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > maxBytes) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }

  if (Buffer.byteLength(raw) > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export function sendJson(response, status, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  for (const [name, value] of Object.entries(headers)) response.setHeader?.(name, value);
  if (typeof response.status === "function" && typeof response.json === "function") {
    response.status(status).json(body);
    return;
  }
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

export function requestMethodNotAllowed(response, allowed) {
  sendJson(response, 405, { error: "Method not allowed" }, { Allow: allowed.join(", ") });
}

function clientAddress(request) {
  const forwarded = getHeader(request, "x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  const realIp = getHeader(request, "x-real-ip");
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return request?.socket?.remoteAddress ?? "unknown";
}

export function clientRateLimitHashes(
  request,
  environment = process.env,
  timestamp = Date.now(),
) {
  const secret = typeof environment.BOOKING_RATE_LIMIT_SECRET === "string"
    ? environment.BOOKING_RATE_LIMIT_SECRET.trim()
    : "";
  if (
    !RATE_LIMIT_SECRET_PATTERN.test(secret)
    || secret.toLowerCase().startsWith("replace-with-")
  ) {
    throw new Error("BOOKING_RATE_LIMIT_NOT_CONFIGURED");
  }
  const address = clientAddress(request).trim().toLowerCase();
  const currentBucket = Math.floor(timestamp / RATE_LIMIT_ROTATION_MS);

  // The adjacent generations close both arrival orders at a day boundary:
  // previous catches an older reservation, while next catches a newer one
  // that reached storage before a just-pre-boundary request. Only current is
  // persisted, so the database still has no long-lived client identifier.
  return [currentBucket, currentBucket - 1, currentBucket + 1].map((bucket) => createHmac("sha256", secret)
    .update(`booking-rate-limit:v2:${bucket}:${address}`)
    .digest("base64url"));
}

export function queryParameters(request) {
  if (request?.query && typeof request.query === "object") return request.query;
  try {
    const url = new URL(request?.url ?? "", "http://localhost");
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

export function bodyReadError(error) {
  return error?.message === "REQUEST_TOO_LARGE"
    ? { status: 413, body: { error: "Слишком большой объём данных." } }
    : { status: 400, body: { error: "Не удалось обработать запрос. Проверьте данные формы." } };
}
