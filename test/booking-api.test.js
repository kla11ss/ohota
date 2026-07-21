import test from "node:test";
import assert from "node:assert/strict";

import { handleBookingRequest } from "../api/booking-request.js";
import { createMemoryBookingRepository } from "../server/booking-database.js";
import { clientRateLimitHashes } from "../server/http.js";

const ENVIRONMENT = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_CHAT_ID: "-1001",
  TELEGRAM_NEW_TOPIC_ID: "10",
  BOOKING_RATE_LIMIT_SECRET: "a-long-server-only-rate-limit-secret",
};

function payload(overrides = {}) {
  return {
    requestKey: "91111111-1111-4111-8111-111111111111",
    stayId: "hotel-room",
    quantity: 1,
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    adults: 2,
    children: 0,
    phone: "+7 999 123-45-67",
    website: "",
    ...overrides,
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
  };
}

test("production handler enforces the 12 KiB JSON limit", async () => {
  const request = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10" },
    body: payload({ comment: "x".repeat(13 * 1024) }),
  };
  const response = responseRecorder();
  await handleBookingRequest(request, response, {
    environment: ENVIRONMENT,
    repository: createMemoryBookingRepository(),
  });
  assert.equal(response.statusCode, 413);
});

test("successful submissions are rate-limited by HMAC without storing the address", async () => {
  const repository = createMemoryBookingRepository();
  const options = {
    today: "2026-07-21",
    environment: ENVIRONMENT,
    repository,
    sendBookingRequest: async () => ({ chatId: "-1001", messageId: 100, topicId: 10 }),
  };
  const request = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10" },
    body: payload(),
  };
  const firstResponse = responseRecorder();
  await handleBookingRequest(request, firstResponse, options);
  assert.equal(firstResponse.statusCode, 200);

  const secondResponse = responseRecorder();
  await handleBookingRequest(request, secondResponse, options);
  assert.equal(secondResponse.statusCode, 429);

  const storedKey = repository.snapshot().rateLimits[0][0];
  assert.match(storedKey, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(storedKey.includes("203.0.113.10"), false);
});

test("parallel submissions from one client atomically reserve only one Telegram delivery", async () => {
  const repository = createMemoryBookingRepository();
  let releaseDelivery;
  let markDeliveryStarted;
  let deliveries = 0;
  const deliveryStarted = new Promise((resolve) => { markDeliveryStarted = resolve; });
  const deliveryGate = new Promise((resolve) => { releaseDelivery = resolve; });
  const options = {
    today: "2026-07-21",
    environment: ENVIRONMENT,
    repository,
    sendBookingRequest: async () => {
      deliveries += 1;
      markDeliveryStarted();
      await deliveryGate;
      return { chatId: "-1001", messageId: 100, topicId: 10 };
    },
  };
  const firstResponse = responseRecorder();
  const secondResponse = responseRecorder();
  const firstRequest = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.20" },
    body: payload(),
  };
  const secondRequest = {
    ...firstRequest,
    body: payload({ requestKey: "92222222-2222-4222-8222-222222222222" }),
  };

  const firstPending = handleBookingRequest(firstRequest, firstResponse, options);
  await deliveryStarted;
  await handleBookingRequest(secondRequest, secondResponse, options);
  releaseDelivery();
  await firstPending;

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 429);
  assert.equal(deliveries, 1);
});

test("a failed Telegram delivery releases its exact limiter reservation for retry", async () => {
  const repository = createMemoryBookingRepository();
  let deliveries = 0;
  const options = {
    today: "2026-07-21",
    environment: ENVIRONMENT,
    repository,
    sendBookingRequest: async () => {
      deliveries += 1;
      if (deliveries === 1) throw new Error("TELEGRAM_DELIVERY_FAILED");
      return { chatId: "-1001", messageId: 101, topicId: 10 };
    },
  };
  const request = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.30" },
    body: payload(),
  };
  const failedResponse = responseRecorder();
  await handleBookingRequest(request, failedResponse, options);
  assert.equal(failedResponse.statusCode, 502);
  assert.equal(repository.snapshot().rateLimits.length, 0);

  const retriedResponse = responseRecorder();
  await handleBookingRequest({
    ...request,
    body: payload({ requestKey: "93333333-3333-4333-8333-333333333333" }),
  }, retriedResponse, options);

  assert.equal(retriedResponse.statusCode, 200);
  assert.equal(deliveries, 2);
  assert.equal(repository.snapshot().rateLimits.length, 1);
});

test("honeypot submissions neither reserve a limiter slot nor contact Telegram", async () => {
  const repository = createMemoryBookingRepository();
  let contacted = false;
  const response = responseRecorder();
  await handleBookingRequest({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.40" },
    body: payload({ website: "spam.example" }),
  }, response, {
    today: "2026-07-21",
    environment: ENVIRONMENT,
    repository,
    sendBookingRequest: async () => {
      contacted = true;
      throw new Error("honeypot must not be delivered");
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(contacted, false);
  assert.equal(repository.snapshot().rateLimits.length, 0);
  assert.equal(repository.snapshot().requests.length, 0);
});

test("production submissions fail closed without a strong rate-limit secret", async () => {
  let limiterReached = false;
  const response = responseRecorder();
  await handleBookingRequest({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.41" },
    body: payload(),
  }, response, {
    today: "2026-07-21",
    environment: { ...ENVIRONMENT, BOOKING_RATE_LIMIT_SECRET: "too-short" },
    repository: {
      async reserveRateLimit() {
        limiterReached = true;
        throw new Error("must not reserve with an invalid secret");
      },
    },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(limiterReached, false);
  assert.throws(
    () => clientRateLimitHashes({}, {}),
    /BOOKING_RATE_LIMIT_NOT_CONFIGURED/,
  );
  assert.throws(
    () => clientRateLimitHashes({}, {
      BOOKING_RATE_LIMIT_SECRET: "replace-with-a-different-long-random-secret",
    }),
    /BOOKING_RATE_LIMIT_NOT_CONFIGURED/,
  );
});

test("rate-limit HMAC rotates daily while carrying adjacent generations", () => {
  const request = { headers: { "x-forwarded-for": "2001:DB8::1" } };
  const firstDay = Date.UTC(2026, 6, 21, 12);
  const sameDay = firstDay + 60 * 60 * 1_000;
  const nextDay = firstDay + 24 * 60 * 60 * 1_000;
  const thirdDay = nextDay + 24 * 60 * 60 * 1_000;

  const firstHashes = clientRateLimitHashes(request, ENVIRONMENT, firstDay);
  const sameDayHashes = clientRateLimitHashes(request, ENVIRONMENT, sameDay);
  const nextHashes = clientRateLimitHashes(request, ENVIRONMENT, nextDay);
  const thirdHashes = clientRateLimitHashes(request, ENVIRONMENT, thirdDay);

  assert.deepEqual(sameDayHashes, firstHashes);
  assert.notEqual(nextHashes[0], firstHashes[0]);
  assert.equal(nextHashes[1], firstHashes[0]);
  assert.equal(firstHashes[2], nextHashes[0]);
  assert.equal(thirdHashes[1], nextHashes[0]);
  assert.equal(thirdHashes.includes(firstHashes[0]), false);
  assert.equal(firstHashes.some((hash) => hash.includes("2001:db8::1")), false);
});

test("rotating HMAC generations cannot bypass the window at midnight", async () => {
  const request = { headers: { "x-forwarded-for": "203.0.113.50" } };
  let timestamp = Date.UTC(2026, 6, 21, 23, 59, 59, 999);
  const repository = createMemoryBookingRepository({ now: () => timestamp });
  const beforeBoundary = clientRateLimitHashes(request, ENVIRONMENT, timestamp);

  const first = await repository.reserveRateLimit(beforeBoundary, 20);
  assert.equal(first.allowed, true);

  timestamp += 2;
  const afterBoundary = clientRateLimitHashes(request, ENVIRONMENT, timestamp);
  assert.equal(afterBoundary[1], beforeBoundary[0]);
  const blocked = await repository.reserveRateLimit(afterBoundary, 20);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 20);

  timestamp += 20_001;
  const allowedAfterWindow = await repository.reserveRateLimit(afterBoundary, 20);
  assert.equal(allowedAfterWindow.allowed, true);
});

test("a post-midnight reservation blocks a delayed pre-midnight generation", async () => {
  const request = { headers: { "x-forwarded-for": "203.0.113.55" } };
  const beforeTimestamp = Date.UTC(2026, 6, 21, 23, 59, 59, 999);
  const afterTimestamp = beforeTimestamp + 2;
  const repository = createMemoryBookingRepository({ now: () => afterTimestamp });
  const beforeBoundary = clientRateLimitHashes(request, ENVIRONMENT, beforeTimestamp);
  const afterBoundary = clientRateLimitHashes(request, ENVIRONMENT, afterTimestamp);

  assert.equal(beforeBoundary[2], afterBoundary[0]);
  assert.equal((await repository.reserveRateLimit(afterBoundary, 20)).allowed, true);
  assert.equal((await repository.reserveRateLimit(beforeBoundary, 20)).allowed, false);
});

test("parallel reservations atomically allow only one rotating-HMAC slot", async () => {
  const repository = createMemoryBookingRepository();
  const hashes = clientRateLimitHashes(
    { headers: { "x-forwarded-for": "203.0.113.60" } },
    ENVIRONMENT,
    Date.UTC(2026, 6, 21, 12),
  );

  const reservations = await Promise.all([
    repository.reserveRateLimit(hashes, 20),
    repository.reserveRateLimit(hashes, 20),
  ]);
  assert.equal(reservations.filter((reservation) => reservation.allowed).length, 1);
  assert.equal(reservations.filter((reservation) => !reservation.allowed).length, 1);
});

test("memory limiter cleanup is retention-bound, batched, and token-safe", async () => {
  let timestamp = 1_000_000;
  const repository = createMemoryBookingRepository({ now: () => timestamp });
  const hashes = ["a".repeat(43), "b".repeat(43), "c".repeat(43)];
  for (const [index, hash] of hashes.entries()) {
    await repository.reserveRateLimit([
      hash,
      String(index).repeat(43),
      String(index + 3).repeat(43),
    ], 20);
    timestamp += 1;
  }

  timestamp += 61_000;
  assert.equal(await repository.cleanupRateLimits(60, 2), 2);
  assert.equal(repository.snapshot().rateLimits.length, 1);
  assert.equal(await repository.cleanupRateLimits(60, 2), 1);
  assert.equal(repository.snapshot().rateLimits.length, 0);

  const rotatingHashes = [hashes[0], "d".repeat(43), "e".repeat(43)];
  const first = await repository.reserveRateLimit(rotatingHashes, 20);
  timestamp += 21_000;
  const replacement = await repository.reserveRateLimit(rotatingHashes, 20);
  assert.equal(first.allowed, true);
  assert.equal(replacement.allowed, true);
  assert.notEqual(first.reservationToken, replacement.reservationToken);
  assert.equal(await repository.releaseRateLimit(hashes[0], first.reservationToken), false);
  assert.equal(repository.snapshot().rateLimits[0][1].reservationToken, replacement.reservationToken);
});
