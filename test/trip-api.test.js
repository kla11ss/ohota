import test from "node:test";
import assert from "node:assert/strict";

import { handleTripRequest } from "../api/trip-request.js";
import { createMemoryBookingRepository } from "../server/booking-database.js";

const ENVIRONMENT = {
  BOOKING_RATE_LIMIT_SECRET: "a-long-server-only-trip-rate-limit-secret",
};

function payload(overrides = {}) {
  return {
    name: "Иван",
    phone: "+7 999 123-45-67",
    interest: "hunt",
    details: "Два гостя на выходные",
    website: "",
    ...overrides,
  };
}

function request(body = payload(), ip = "203.0.113.70", method = "POST") {
  return {
    method,
    headers: { "x-forwarded-for": ip },
    body,
  };
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test("trip API preserves POST-only behavior and enforces the 12 KiB body limit", async () => {
  const methodResponse = responseRecorder();
  await handleTripRequest(request(undefined, undefined, "GET"), methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, "POST");
  assert.equal(methodResponse.headers["Cache-Control"], "no-store");

  const largeResponse = responseRecorder();
  await handleTripRequest(
    request(JSON.stringify(payload({ details: "x".repeat(13 * 1024) }))),
    largeResponse,
  );
  assert.equal(largeResponse.statusCode, 413);
  assert.equal(largeResponse.headers["Cache-Control"], "no-store");
});

test("trip API honeypot succeeds before database and Telegram access", async () => {
  let deliveries = 0;
  const response = responseRecorder();
  await handleTripRequest(request(payload({ website: "spam.example" })), response, {
    environment: ENVIRONMENT,
    repository: {
      async reserveRateLimit() {
        throw new Error("honeypot must not reach the limiter");
      },
    },
    async sendTripRequest() {
      deliveries += 1;
      throw new Error("honeypot must not reach Telegram");
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(deliveries, 0);
});

test("successful trip submission retains one atomic limiter reservation", async () => {
  const repository = createMemoryBookingRepository();
  let deliveries = 0;
  const options = {
    environment: ENVIRONMENT,
    repository,
    async sendTripRequest() {
      deliveries += 1;
    },
  };

  const firstResponse = responseRecorder();
  await handleTripRequest(request(), firstResponse, options);
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(repository.snapshot().rateLimits.length, 1);

  const repeatedResponse = responseRecorder();
  await handleTripRequest(request(), repeatedResponse, options);
  assert.equal(repeatedResponse.statusCode, 429);
  assert.equal(deliveries, 1);
});

test("failed trip delivery releases its exact reservation for retry", async () => {
  const repository = createMemoryBookingRepository();
  let deliveries = 0;
  const options = {
    environment: ENVIRONMENT,
    repository,
    async sendTripRequest() {
      deliveries += 1;
      if (deliveries === 1) throw new Error("TELEGRAM_DELIVERY_FAILED");
    },
  };

  const failedResponse = responseRecorder();
  await handleTripRequest(request(), failedResponse, options);
  assert.equal(failedResponse.statusCode, 502);
  assert.equal(repository.snapshot().rateLimits.length, 0);

  const retryResponse = responseRecorder();
  await handleTripRequest(request(), retryResponse, options);
  assert.equal(retryResponse.statusCode, 200);
  assert.equal(deliveries, 2);
  assert.equal(repository.snapshot().rateLimits.length, 1);
});

test("trip submissions fail closed without the dedicated rate-limit secret", async () => {
  let limiterReached = false;
  const response = responseRecorder();
  await handleTripRequest(request(), response, {
    environment: {},
    repository: {
      async reserveRateLimit() {
        limiterReached = true;
        throw new Error("must not reserve without a configured secret");
      },
    },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(limiterReached, false);
});
