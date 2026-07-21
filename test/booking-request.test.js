import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateNights,
  formatBookingRequest,
  getBookingDateWindow,
  processBookingRequest,
  validateBookingRequest,
} from "../server/booking-request.js";
import { createMemoryBookingRepository } from "../server/booking-database.js";

const TODAY = "2026-07-21";

function validRoomPayload(overrides = {}) {
  return {
    requestKey: "11111111-1111-4111-8111-111111111111",
    stayId: "hotel-room",
    quantity: 2,
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    adults: 3,
    children: 1,
    phone: "+7 (999) 123-45-67",
    name: "Олег",
    comment: "Нужен ранний заезд",
    website: "",
    ...overrides,
  };
}

test("date helpers calculate nights and clamp a twelve-month leap-day window", () => {
  assert.equal(calculateNights("2026-08-01", "2026-08-04"), 3);
  assert.equal(calculateNights("2026-02-30", "2026-03-02"), 0);
  assert.deepEqual(getBookingDateWindow("2024-02-29"), {
    minDate: "2024-02-29",
    maxDate: "2025-02-28",
  });
});

test("valid room booking is canonicalized and ignores a client-supplied price", () => {
  const validation = validateBookingRequest(validRoomPayload({
    pricePerNight: 1,
    total: 1,
  }), TODAY);

  assert.equal(validation.ok, true);
  assert.equal(validation.request.nights, 3);
  assert.equal(validation.request.capacity, 4);
  assert.equal(validation.request.total, 39_000);
  assert.equal(validation.request.stay.pricePerNight, 6_500);
  assert.deepEqual(validation.request.selection, { quantity: 2 });
});

test("cottage and hunter-house selections use their canonical capacity", () => {
  const cottage = validateBookingRequest(validRoomPayload({
    stayId: "cottage",
    quantity: 1,
    adults: 12,
    children: 3,
  }), TODAY);
  const hunterHouses = validateBookingRequest(validRoomPayload({
    stayId: "hunter-house",
    quantity: undefined,
    unitIds: ["hunter-house-1", "hunter-house-2"],
    adults: 10,
    children: 2,
  }), TODAY);

  assert.equal(cottage.ok, true);
  assert.equal(cottage.request.capacity, 15);
  assert.equal(cottage.request.total, 135_000);
  assert.equal(hunterHouses.ok, true);
  assert.equal(hunterHouses.request.capacity, 12);
  assert.equal(hunterHouses.request.total, null);
});

test("selection and capacity validation rejects impossible bookings", () => {
  assert.equal(validateBookingRequest(validRoomPayload({ quantity: 7 }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({
    stayId: "hunter-house",
    unitIds: ["hunter-house-1", "hunter-house-1"],
    quantity: undefined,
  }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({
    quantity: 1,
    adults: 2,
    children: 1,
  }), TODAY).ok, false);
});

test("dates must be valid, ordered, and inside the next twelve months", () => {
  const invalidDate = validateBookingRequest(validRoomPayload({ checkIn: "2026-02-30" }), TODAY);
  const nonIsoDate = validateBookingRequest(validRoomPayload({ checkIn: "2026-08-01T12:00:00Z" }), TODAY);
  const past = validateBookingRequest(validRoomPayload({
    checkIn: "2026-07-20",
    checkOut: "2026-07-22",
  }), TODAY);
  const sameDay = validateBookingRequest(validRoomPayload({
    checkIn: "2026-08-01",
    checkOut: "2026-08-01",
  }), TODAY);
  const tooFar = validateBookingRequest(validRoomPayload({
    checkIn: "2027-07-20",
    checkOut: "2027-07-22",
  }), TODAY);

  assert.equal(invalidDate.ok, false);
  assert.equal(nonIsoDate.ok, false);
  assert.equal(past.ok, false);
  assert.equal(sameDay.ok, false);
  assert.equal(tooFar.ok, false);
});

test("guest counts and phone are validated", () => {
  assert.equal(validateBookingRequest(validRoomPayload({ adults: 0 }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({ children: -1 }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({ phone: "+7 abc 999 123-45-67" }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({ phone: "123456789" }), TODAY).ok, false);
  assert.equal(validateBookingRequest(validRoomPayload({ phone: "+1234567890123456" }), TODAY).ok, false);
});

test("honeypot submissions succeed without producing a request", () => {
  const validation = validateBookingRequest(validRoomPayload({ website: "spam.example" }), TODAY);
  assert.deepEqual(validation, { ok: true, request: null });
});

test("Telegram message contains the canonical calculation and escapes user text", () => {
  const validation = validateBookingRequest(validRoomPayload({
    name: "<Олег>",
    comment: "Камин & <баня>",
  }), TODAY);
  const message = formatBookingRequest(validation.request);

  assert.match(message, /требует подтверждения/);
  assert.match(message, /39[^\d]000 ₽/);
  assert.match(message, /&lt;Олег&gt;/);
  assert.match(message, /Камин &amp; &lt;баня&gt;/);
  assert.doesNotMatch(message, /<Олег>/);
});

test("process sends Telegram through an injected fetch and returns the anonymous request id", async () => {
  let call;
  const fetchImpl = async (url, options) => {
    call = { url, options };
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42, chat: { id: 123 } } }),
    };
  };
  const repository = createMemoryBookingRepository();
  const result = await processBookingRequest(
    validRoomPayload({ pricePerNight: 1 }),
    {
      TELEGRAM_BOT_TOKEN: "secret-token",
      TELEGRAM_CHAT_ID: "123",
      TELEGRAM_NEW_TOPIC_ID: "10",
    },
    { today: TODAY, fetchImpl, repository },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "pending");
  assert.match(result.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(call.url, "https://api.telegram.org/botsecret-token/sendMessage");
  assert.equal(call.options.signal instanceof AbortSignal, true);
  const telegramBody = JSON.parse(call.options.body);
  assert.equal(telegramBody.chat_id, "123");
  assert.equal(telegramBody.message_thread_id, 10);
  assert.equal(telegramBody.reply_markup.inline_keyboard[0][0].callback_data, `booking:confirm:${result.body.requestId}`);
  assert.match(telegramBody.text, /39[^\d]000 ₽/);
  assert.doesNotMatch(telegramBody.text, /secret-token/);

  const snapshot = repository.snapshot();
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].phone, undefined);
  assert.equal(snapshot.requests[0].name, undefined);
  assert.equal(snapshot.requests[0].comment, undefined);
});

test("booking delivery requires the new-requests topic and never falls back to a private chat", async () => {
  let contacted = false;
  const fetchImpl = async (url, options) => {
    contacted = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const repository = createMemoryBookingRepository();
  const result = await processBookingRequest(
    validRoomPayload({ requestKey: "93333333-3333-4333-8333-333333333333" }),
    {
      TELEGRAM_BOT_TOKEN: "secret-token",
      TELEGRAM_CHAT_ID: "123",
    },
    { today: TODAY, fetchImpl, repository },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(contacted, false);
  const snapshot = repository.snapshot();
  assert.equal(snapshot.requests[0].status, "notification_failed");
  assert.equal(snapshot.requests[0].telegramMessageId, null);
  assert.equal(snapshot.requests[0].telegramTopicId, null);
});

test("process returns a user-facing error when Telegram delivery fails", async () => {
  const repository = createMemoryBookingRepository();
  const result = await processBookingRequest(
    validRoomPayload(),
    { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123", TELEGRAM_NEW_TOPIC_ID: "10" },
    {
      today: TODAY,
      repository,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.match(result.body.error, /\+7 920 020-15-16/);
  assert.equal(repository.snapshot().requests[0].status, "notification_failed");
});

test("process removes an orphaned Telegram message when delivery metadata cannot be stored", async () => {
  const baseRepository = createMemoryBookingRepository();
  const repository = {
    ...baseRepository,
    async markTelegramDelivered() {
      throw new Error("database write failed");
    },
  };
  let deletedMessage = null;

  const result = await processBookingRequest(
    validRoomPayload(),
    {},
    {
      today: TODAY,
      repository,
      sendBookingRequest: async () => ({ chatId: "-1001", messageId: 42, topicId: 10 }),
      deleteTelegramMessage: async (chatId, messageId) => {
        deletedMessage = { chatId, messageId };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /\+7 920 020-15-16/);
  assert.deepEqual(deletedMessage, { chatId: "-1001", messageId: 42 });
  assert.equal(baseRepository.snapshot().requests[0].status, "notification_failed");
});

test("process returns a controlled error when orphan cleanup and failure-status writes fail", async () => {
  const baseRepository = createMemoryBookingRepository();
  const repository = {
    ...baseRepository,
    async markTelegramDelivered() {
      throw new Error("database write failed");
    },
    async markNotificationFailed() {
      throw new Error("database unavailable");
    },
  };
  let cleanupAttempted = false;

  const result = await processBookingRequest(
    validRoomPayload(),
    {},
    {
      today: TODAY,
      repository,
      sendBookingRequest: async () => ({ chatId: "-1001", messageId: 43, topicId: 10 }),
      deleteTelegramMessage: async () => {
        cleanupAttempted = true;
        throw new Error("Telegram delete failed");
      },
    },
  );

  assert.equal(cleanupAttempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /\+7 920 020-15-16/);
});

test("process preserves a controlled Telegram error when recording notification failure throws", async () => {
  const baseRepository = createMemoryBookingRepository();
  const repository = {
    ...baseRepository,
    async markNotificationFailed() {
      throw new Error("database unavailable");
    },
  };

  const result = await processBookingRequest(
    validRoomPayload(),
    {},
    {
      today: TODAY,
      repository,
      sendBookingRequest: async () => {
        throw new Error("Telegram unavailable");
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.match(result.body.error, /\+7 920 020-15-16/);
});

test("process does not contact Telegram for a honeypot submission", async () => {
  let contacted = false;
  const result = await processBookingRequest(
    validRoomPayload({ website: "bot" }),
    {},
    {
      today: TODAY,
      repository: createMemoryBookingRepository(),
      fetchImpl: async () => {
        contacted = true;
        return { ok: true };
      },
    },
  );

  assert.deepEqual(result, { ok: true, status: 200, body: { ok: true } });
  assert.equal(contacted, false);
});
