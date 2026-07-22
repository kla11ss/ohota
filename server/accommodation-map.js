import { createHmac, timingSafeEqual } from "node:crypto";

import {
  getHeader,
  queryParameters,
} from "./http.js";
import { validateAccommodationMap } from "../src/accommodation-map/config.js";

const COOKIE_NAME = "velikovskoe_accommodation_editor";
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 10 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const loginAttempts = new Map();

function editorPassword(environment) {
  return typeof environment.ACCOMMODATION_EDITOR_PASSWORD === "string"
    ? environment.ACCOMMODATION_EDITOR_PASSWORD
    : "";
}

function sessionSecret(environment) {
  const value = typeof environment.ACCOMMODATION_EDITOR_SESSION_SECRET === "string"
    ? environment.ACCOMMODATION_EDITOR_SESSION_SECRET.trim()
    : "";
  return SECRET_PATTERN.test(value) && !value.toLowerCase().startsWith("replace-with-")
    ? value
    : "";
}

export function getAccommodationEditorConfiguration(environment = process.env) {
  const password = editorPassword(environment);
  const secret = sessionSecret(environment);
  return {
    ok: Boolean(password && secret),
    password,
    secret,
  };
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left ?? ""));
  const second = Buffer.from(String(right ?? ""));
  return first.length === second.length && timingSafeEqual(first, second);
}

function encodeSession(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${signature(data, secret)}`;
}

function decodeSession(value, secret, now = Date.now()) {
  const [data, suppliedSignature, ...rest] = String(value ?? "").split(".");
  if (!data || !suppliedSignature || rest.length || !safeEqual(signature(data, secret), suppliedSignature)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return Number.isFinite(payload?.expiresAt) && payload.expiresAt > now ? payload : null;
  } catch {
    return null;
  }
}

function cookieValue(request, name) {
  const source = getHeader(request, "cookie") ?? "";
  for (const entry of String(source).split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function hasAccommodationEditorSession(request, environment = process.env, now = Date.now()) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (!configuration.ok) return false;
  return Boolean(decodeSession(cookieValue(request, COOKIE_NAME), configuration.secret, now));
}

export function createAccommodationEditorSessionCookie(environment = process.env, now = Date.now()) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (!configuration.ok) throw new Error("ACCOMMODATION_EDITOR_NOT_CONFIGURED");
  const expiresAt = now + SESSION_TTL_MS;
  const value = encodeSession({ expiresAt }, configuration.secret);
  return `${COOKIE_NAME}=${value}; Path=/api/admin/accommodation-map; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAccommodationEditorSessionCookie() {
  return `${COOKIE_NAME}=; Path=/api/admin/accommodation-map; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function sourceAddress(request) {
  const forwarded = String(getHeader(request, "x-forwarded-for") ?? "").split(",")[0].trim();
  return forwarded || String(request?.socket?.remoteAddress ?? "unknown");
}

function loginAttemptKey(request, secret) {
  return createHmac("sha256", secret)
    .update(`accommodation-editor-login:${sourceAddress(request).toLowerCase()}`)
    .digest("base64url");
}

function getLoginAttempt(request, secret, now) {
  const key = loginAttemptKey(request, secret);
  const current = loginAttempts.get(key);
  if (!current || current.startedAt + LOGIN_WINDOW_MS <= now) {
    loginAttempts.delete(key);
    return { key, count: 0 };
  }
  return { key, count: current.count };
}

export function checkAccommodationEditorLoginLimit(request, environment = process.env, now = Date.now()) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (!configuration.ok) return { allowed: false, retryAfterSeconds: 0 };
  const attempt = getLoginAttempt(request, configuration.secret, now);
  return {
    allowed: attempt.count < MAX_LOGIN_ATTEMPTS,
    retryAfterSeconds: attempt.count < MAX_LOGIN_ATTEMPTS
      ? 0
      : Math.max(1, Math.ceil((loginAttempts.get(attempt.key).startedAt + LOGIN_WINDOW_MS - now) / 1_000)),
  };
}

export function registerAccommodationEditorLoginFailure(request, environment = process.env, now = Date.now()) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (!configuration.ok) return;
  const attempt = getLoginAttempt(request, configuration.secret, now);
  loginAttempts.set(attempt.key, {
    count: attempt.count + 1,
    startedAt: loginAttempts.get(attempt.key)?.startedAt ?? now,
  });
}

export function clearAccommodationEditorLoginFailures(request, environment = process.env) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (configuration.ok) loginAttempts.delete(loginAttemptKey(request, configuration.secret));
}

export function verifyAccommodationEditorPassword(password, environment = process.env) {
  const configuration = getAccommodationEditorConfiguration(environment);
  if (!configuration.ok || typeof password !== "string") return false;
  return safeEqual(password, configuration.password);
}

export function isSameOriginWrite(request) {
  const origin = getHeader(request, "origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request?.url ?? "", "https://invalid.local");
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function validateAccommodationMapPayload(payload) {
  const candidate = payload?.config ?? payload;
  return validateAccommodationMap(candidate);
}

export function isPublicAccommodationMapRequest(request) {
  return request?.method === "GET" && Object.keys(queryParameters(request)).length === 0;
}
