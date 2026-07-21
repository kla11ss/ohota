import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryBookingRepository } from "../server/booking-database.js";
import { processBookingRequest } from "../server/booking-request.js";

const TODAY = "2026-07-21";
const ENVIRONMENT = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_CHAT_ID: "-1001",
  TELEGRAM_NEW_TOPIC_ID: "10",
};

function payload(overrides = {}) {
  return {
    requestKey: "31111111-1111-4111-8111-111111111111",
    stayId: "hotel-room",
    quantity: 2,
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
    adults: 3,
    children: 1,
    phone: "+7 999 123-45-67",
    name: "Олег",
    comment: "С персональными данными",
    website: "",
    ...overrides,
  };
}

function successfulDelivery(counter) {
  return async () => {
    counter.count += 1;
    return { chatId: "-1001", messageId: 100 + counter.count, topicId: 10 };
  };
}

test("requestKey makes delivery idempotent without persisting contact fields", async () => {
  const repository = createMemoryBookingRepository();
  const counter = { count: 0 };
  const options = { today: TODAY, repository, sendBookingRequest: successfulDelivery(counter) };

  const first = await processBookingRequest(payload(), ENVIRONMENT, options);
  const retry = await processBookingRequest(payload({ phone: "+7 900 000-00-00" }), ENVIRONMENT, options);

  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.body.requestId, first.body.requestId);
  assert.equal(counter.count, 1);
  const stored = repository.snapshot().requests[0];
  assert.equal(stored.phone, undefined);
  assert.equal(stored.name, undefined);
  assert.equal(stored.comment, undefined);
});

test("reusing an idempotency key for different booking metadata is rejected", async () => {
  const repository = createMemoryBookingRepository();
  const counter = { count: 0 };
  const options = { today: TODAY, repository, sendBookingRequest: successfulDelivery(counter) };
  await processBookingRequest(payload(), ENVIRONMENT, options);

  const result = await processBookingRequest(payload({ checkOut: "2026-08-06" }), ENVIRONMENT, options);
  assert.equal(result.status, 409);
  assert.equal(counter.count, 1);
});

test("server rejects an unavailable range before storing or notifying", async () => {
  const repository = createMemoryBookingRepository();
  const counter = { count: 0 };
  const options = { today: TODAY, repository, sendBookingRequest: successfulDelivery(counter) };
  const first = await processBookingRequest(payload({ quantity: 2 }), ENVIRONMENT, options);
  await repository.confirmRequest(first.body.requestId, 99);

  const second = await processBookingRequest(payload({
    requestKey: "41111111-1111-4111-8111-111111111111",
    quantity: 5,
    adults: 5,
    children: 0,
  }), ENVIRONMENT, options);

  assert.equal(second.status, 409);
  assert.match(second.body.error, /заняты/);
  assert.equal(counter.count, 1);
  assert.equal(repository.snapshot().requests.length, 1);
});

test("failed Telegram notification is retryable once and keeps one anonymous row", async () => {
  const repository = createMemoryBookingRepository();
  let attempts = 0;
  const options = {
    today: TODAY,
    repository,
    sendBookingRequest: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("TELEGRAM_DELIVERY_FAILED");
      return { chatId: "-1001", messageId: 101, topicId: 10 };
    },
  };

  const failed = await processBookingRequest(payload(), ENVIRONMENT, options);
  const retried = await processBookingRequest(payload(), ENVIRONMENT, options);
  assert.equal(failed.status, 502);
  assert.equal(retried.ok, true);
  assert.equal(retried.body.status, "pending");
  assert.equal(attempts, 2);
  assert.equal(repository.snapshot().requests.length, 1);
});
