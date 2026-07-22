import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createNetlifyFunction } from "../netlify/adapter.mjs";
import availabilityFunction from "../netlify/functions/availability.mjs";
import availabilityCheckFunction from "../netlify/functions/availability-check.mjs";
import accommodationMapFunction from "../netlify/functions/accommodation-map.mjs";
import accommodationMapDraftFunction from "../netlify/functions/admin-accommodation-map-draft.mjs";
import accommodationMapPublishFunction from "../netlify/functions/admin-accommodation-map-publish.mjs";
import accommodationMapSessionFunction from "../netlify/functions/admin-accommodation-map-session.mjs";
import bookingRequestFunction from "../netlify/functions/booking-request.mjs";
import telegramWebhookFunction from "../netlify/functions/telegram-webhook.mjs";
import tripRequestFunction from "../netlify/functions/trip-request.mjs";
import { handleTripRequest } from "../api/trip-request.js";
import { createMemoryBookingRepository } from "../server/booking-database.js";

const NETLIFY_CONFIG = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");

test("Netlify config builds with Node 22, publishes dist, and keeps API rewrites before SPA", () => {
  assert.match(NETLIFY_CONFIG, /\[build\][\s\S]*?command\s*=\s*"pnpm build"/);
  assert.match(NETLIFY_CONFIG, /\[build\][\s\S]*?publish\s*=\s*"dist"/);
  assert.match(NETLIFY_CONFIG, /\[build\.environment\][\s\S]*?NODE_VERSION\s*=\s*"22"/);
  assert.match(NETLIFY_CONFIG, /\[functions\][\s\S]*?directory\s*=\s*"netlify\/functions"/);
  assert.match(NETLIFY_CONFIG, /\[functions\][\s\S]*?node_bundler\s*=\s*"esbuild"/);
  assert.doesNotMatch(NETLIFY_CONFIG, /^\s*region\s*=/m);

  const routes = new Map([
    ["/api/booking-request", "/.netlify/functions/booking-request"],
    ["/api/availability/check", "/.netlify/functions/availability-check"],
    ["/api/availability-check", "/.netlify/functions/availability-check"],
    ["/api/availability", "/.netlify/functions/availability"],
    ["/api/telegram-webhook", "/.netlify/functions/telegram-webhook"],
    ["/api/trip-request", "/.netlify/functions/trip-request"],
    ["/api/accommodation-map", "/.netlify/functions/accommodation-map"],
    ["/api/admin/accommodation-map/session", "/.netlify/functions/admin-accommodation-map-session"],
    ["/api/admin/accommodation-map/draft", "/.netlify/functions/admin-accommodation-map-draft"],
    ["/api/admin/accommodation-map/publish", "/.netlify/functions/admin-accommodation-map-publish"],
  ]);
  const spaIndex = NETLIFY_CONFIG.lastIndexOf('from = "/*"');
  assert.notEqual(spaIndex, -1);

  for (const [from, to] of routes) {
    const fromIndex = NETLIFY_CONFIG.indexOf(`from = "${from}"`);
    assert.notEqual(fromIndex, -1, `missing rewrite for ${from}`);
    assert.ok(fromIndex < spaIndex, `${from} must be routed before the SPA fallback`);
    const nextRedirect = NETLIFY_CONFIG.indexOf("[[redirects]]", fromIndex + 1);
    const block = NETLIFY_CONFIG.slice(fromIndex, nextRedirect === -1 ? undefined : nextRedirect);
    assert.match(block, new RegExp(`to\\s*=\\s*"${to.replaceAll("/", "\\/")}"`));
    assert.match(block, /status\s*=\s*200/);
    assert.match(block, /force\s*=\s*true/);
  }

  const spaBlock = NETLIFY_CONFIG.slice(spaIndex);
  assert.match(spaBlock, /to\s*=\s*"\/index\.html"/);
  assert.match(spaBlock, /status\s*=\s*200/);
  assert.doesNotMatch(spaBlock, /force\s*=\s*true/);
});

test("adapter trusts only Netlify context.ip and preserves the full query string", async () => {
  const inspect = createNetlifyFunction(async (request, response) => {
    const url = new URL(request.url);
    response.status(200).json({
      forwarded: request.headers.get("x-forwarded-for"),
      real: request.headers.get("x-real-ip"),
      socket: request.socket.remoteAddress,
      query: Object.fromEntries(url.searchParams),
    });
  });

  const result = await inspect(new Request(
    "https://example.net/api/availability?from=2026-08-01&to=2026-08-12",
    {
      headers: {
        "x-forwarded-for": "192.0.2.200",
        "x-real-ip": "192.0.2.201",
      },
    },
  ), { ip: "203.0.113.8" });

  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), {
    forwarded: "203.0.113.8",
    real: "203.0.113.8",
    socket: "203.0.113.8",
    query: { from: "2026-08-01", to: "2026-08-12" },
  });

  const withoutContext = await inspect(new Request("https://example.net/api/test", {
    headers: { "x-forwarded-for": "192.0.2.200" },
  }));
  const anonymous = await withoutContext.json();
  assert.equal(anonymous.forwarded, null);
  assert.equal(anonymous.socket, "unknown");
});

test("Netlify functions preserve API methods, query validation, and no-store responses", async () => {
  const availabilityMethod = await availabilityFunction(new Request(
    "https://example.net/api/availability?from=2026-08-01&to=2026-08-12",
    { method: "POST" },
  ), { ip: "203.0.113.9" });
  assert.equal(availabilityMethod.status, 405);
  assert.equal(availabilityMethod.headers.get("allow"), "GET");
  assert.equal(availabilityMethod.headers.get("cache-control"), "no-store");

  const invalidQuery = await availabilityFunction(new Request(
    "https://example.net/api/availability?from=2026-08-01&to=not-a-date",
  ), { ip: "203.0.113.9" });
  assert.equal(invalidQuery.status, 400);
  assert.equal(invalidQuery.headers.get("cache-control"), "no-store");

  const publicMapMethod = await accommodationMapFunction(new Request(
    "https://example.net/api/accommodation-map",
    { method: "POST" },
  ), { ip: "203.0.113.9" });
  assert.equal(publicMapMethod.status, 405);
  assert.equal(publicMapMethod.headers.get("allow"), "GET");
  assert.equal(publicMapMethod.headers.get("cache-control"), "no-store");

  const adminMethodChecks = [
    [accommodationMapDraftFunction, "POST", "GET, PUT"],
    [accommodationMapPublishFunction, "GET", "POST"],
  ];
  for (const [handler, method, allowed] of adminMethodChecks) {
    const result = await handler(new Request("https://example.net/api/admin/accommodation-map/test", { method }), {
      ip: "203.0.113.9",
    });
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("allow"), allowed);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }

  const sessionNotConfigured = await accommodationMapSessionFunction(new Request(
    "https://example.net/api/admin/accommodation-map/session",
  ), { ip: "203.0.113.9" });
  assert.equal(sessionNotConfigured.status, 503);
  assert.equal(sessionNotConfigured.headers.get("cache-control"), "no-store");

  const postOnlyFunctions = [
    bookingRequestFunction,
    availabilityCheckFunction,
    telegramWebhookFunction,
    tripRequestFunction,
  ];
  for (const handler of postOnlyFunctions) {
    const response = await handler(new Request("https://example.net/api/test"), {
      ip: "203.0.113.9",
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("streaming adapters enforce the 12 KiB JSON limit", async () => {
  const oversizedBody = JSON.stringify({ padding: "x".repeat(13 * 1024) });
  const request = (url) => new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversizedBody,
  });

  const streamingResponse = await availabilityCheckFunction(
    request("https://example.net/api/availability/check"),
    { ip: "203.0.113.10" },
  );
  assert.equal(streamingResponse.status, 413);
  assert.equal(streamingResponse.headers.get("cache-control"), "no-store");

  const parsedResponse = await tripRequestFunction(
    request("https://example.net/api/trip-request"),
    { ip: "203.0.113.10" },
  );
  assert.equal(parsedResponse.status, 413);
  assert.equal(parsedResponse.headers.get("cache-control"), "no-store");

  const malformedResponse = await availabilityCheckFunction(new Request(
    "https://example.net/api/availability/check",
    { method: "POST", body: "{" },
  ), { ip: "203.0.113.10" });
  assert.equal(malformedResponse.status, 400);
});

test("booking and trip Netlify streams pass valid honeypot payloads to existing handlers", async () => {
  const honeypotRequest = (url) => new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ website: "spam.example" }),
  });

  const bookingResponse = await bookingRequestFunction(
    honeypotRequest("https://example.net/api/booking-request"),
    { ip: "203.0.113.11" },
  );
  assert.equal(bookingResponse.status, 200);
  assert.deepEqual(await bookingResponse.json(), { ok: true });

  const tripResponse = await tripRequestFunction(
    honeypotRequest("https://example.net/api/trip-request"),
    { ip: "203.0.113.11" },
  );
  assert.equal(tripResponse.status, 200);
  assert.deepEqual(await tripResponse.json(), { ok: true });
});

test("Netlify context.ip, not spoofed headers, feeds the trip limiter", async () => {
  const repository = createMemoryBookingRepository();
  let deliveries = 0;
  const handler = createNetlifyFunction((request, response) => handleTripRequest(
    request,
    response,
    {
      environment: {
        BOOKING_RATE_LIMIT_SECRET: "a-long-netlify-trip-rate-limit-secret",
      },
      repository,
      async sendTripRequest() {
        deliveries += 1;
      },
    },
  ));
  const body = JSON.stringify({
    name: "Иван",
    phone: "+7 999 123-45-67",
    interest: "fishing",
    details: "",
    website: "",
  });
  const request = (spoofedIp) => new Request("https://example.net/api/trip-request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": spoofedIp,
    },
    body,
  });

  const first = await handler(request("192.0.2.10"), { ip: "203.0.113.80" });
  assert.equal(first.status, 200);

  const sameClient = await handler(request("192.0.2.11"), { ip: "203.0.113.80" });
  assert.equal(sameClient.status, 429);

  const otherClient = await handler(request("203.0.113.80"), { ip: "203.0.113.81" });
  assert.equal(otherClient.status, 200);
  assert.equal(deliveries, 2);
  assert.equal(repository.snapshot().rateLimits.length, 2);
});
