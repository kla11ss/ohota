import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryBookingRepository } from "../server/booking-database.js";
import { processTelegramWebhook, validateTelegramWebhookAccess } from "../server/telegram-webhook.js";

const WEBHOOK_SECRET = "w".repeat(32);
const ENVIRONMENT = {
  TELEGRAM_BOT_TOKEN: "secret-token",
  TELEGRAM_CHAT_ID: "-1001",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  TELEGRAM_OWNER_USER_ID: "99",
  TELEGRAM_ADMIN_USER_IDS: "100",
  TELEGRAM_NEW_TOPIC_ID: "10",
  TELEGRAM_CONFIRMED_TOPIC_ID: "20",
  TELEGRAM_ARCHIVE_TOPIC_ID: "30",
  TELEGRAM_TRIP_TOPIC_ID: "40",
};
const REQUEST_ID = "51111111-1111-4111-8111-111111111111";

function metadata(overrides = {}) {
  return {
    id: REQUEST_ID,
    requestKey: "61111111-1111-4111-8111-111111111111",
    metadataHash: "metadata-hash",
    stayId: "cottage",
    unitCount: 1,
    selectedUnitIds: [],
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    adults: 4,
    children: 0,
    capacity: 15,
    nights: 3,
    nightlyRate: 45_000,
    total: 135_000,
    ...overrides,
  };
}

async function pendingRepository(overrides = {}) {
  const repository = createMemoryBookingRepository();
  await repository.createOrGetRequest(metadata(overrides));
  await repository.markTelegramDelivered(REQUEST_ID, {
    chatId: "-1001",
    messageId: 100,
    topicId: 10,
  });
  return repository;
}

function callbackUpdate(action, {
  updateId = 1,
  messageId = 100,
  topicId = action === "cancel" ? 20 : 10,
  userId = 99,
  requestId = REQUEST_ID,
  text = "Новый запрос\nСтатус: требует подтверждения\nТелефон: +7 999 123-45-67",
} = {}) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: userId },
      data: `booking:${action}:${requestId}`,
      message: {
        message_id: messageId,
        message_thread_id: topicId,
        chat: { id: -1001, type: "supergroup" },
        text,
      },
    },
  };
}

function tripCallbackUpdate({
  updateId = 101,
  messageId = 500,
  topicId = 40,
  userId = 99,
  text = "Новая заявка с сайта «Великовское»\n\nИмя: Олег\nТелефон: +7 999 123-45-67",
} = {}) {
  return {
    update_id: updateId,
    callback_query: {
      id: `trip-callback-${updateId}`,
      from: { id: userId },
      data: "trip:reviewed",
      message: {
        message_id: messageId,
        message_thread_id: topicId,
        chat: { id: -1001, type: "supergroup" },
        text,
      },
    },
  };
}

function telegramFetch(calls, messageIds = [200, 201]) {
  return async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    const messageId = method === "sendMessage" ? messageIds.shift() : undefined;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: method === "sendMessage"
          ? { message_id: messageId, chat: { id: -1001 } }
          : true,
      }),
    };
  };
}

test("webhook rejects a wrong secret, chat, or manager before touching storage", () => {
  const update = callbackUpdate("confirm");
  assert.equal(validateTelegramWebhookAccess(update, "wrong", ENVIRONMENT).status, 401);
  assert.equal(validateTelegramWebhookAccess(callbackUpdate("confirm", { userId: 7 }), WEBHOOK_SECRET, ENVIRONMENT).status, 403);
  assert.equal(validateTelegramWebhookAccess(callbackUpdate("confirm", { userId: 100 }), WEBHOOK_SECRET, ENVIRONMENT).status, 403);
  const wrongChat = structuredClone(update);
  wrongChat.callback_query.message.chat.id = -2002;
  assert.equal(validateTelegramWebhookAccess(wrongChat, WEBHOOK_SECRET, ENVIRONMENT).status, 403);
});

test("webhook fails closed when the configured secret is weak or still a placeholder", () => {
  const update = callbackUpdate("confirm");
  assert.equal(validateTelegramWebhookAccess(update, "weak", {
    ...ENVIRONMENT,
    TELEGRAM_WEBHOOK_SECRET: "weak",
  }).status, 503);
  const placeholder = "replace-with-random-a-z-A-Z-0-9-_-secret";
  assert.equal(validateTelegramWebhookAccess(update, placeholder, {
    ...ENVIRONMENT,
    TELEGRAM_WEBHOOK_SECRET: placeholder,
  }).status, 503);
});

test("webhook falls back to the legacy manager list only when owner is absent", () => {
  const compatibleEnvironment = {
    ...ENVIRONMENT,
    TELEGRAM_OWNER_USER_ID: undefined,
    TELEGRAM_ADMIN_USER_IDS: "100",
  };
  assert.equal(validateTelegramWebhookAccess(
    callbackUpdate("confirm", { userId: 100 }),
    WEBHOOK_SECRET,
    compatibleEnvironment,
  ).ok, true);
});

test("trip review callbacks still require the configured owner and chat", () => {
  assert.equal(validateTelegramWebhookAccess(
    tripCallbackUpdate({ userId: 7 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
  ).status, 403);
  const wrongChat = tripCallbackUpdate();
  wrongChat.callback_query.message.chat.id = -2002;
  assert.equal(validateTelegramWebhookAccess(
    wrongChat,
    WEBHOOK_SECRET,
    ENVIRONMENT,
  ).status, 403);
});

test("reviewed trip requests move to archive without buttons or stored guest data", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  const result = await processTelegramWebhook(
    tripCallbackUpdate(),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl: telegramFetch(calls, [600]) },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.result, "trip_reviewed");
  const archiveSend = calls.find((call) => call.method === "sendMessage");
  assert.equal(archiveSend.body.message_thread_id, 30);
  assert.match(archiveSend.body.text, /^✅ ЗАПРОС РАССМОТРЕН/);
  assert.match(archiveSend.body.text, /Телефон: \+7 999 123-45-67/);
  assert.equal(archiveSend.body.reply_markup, undefined);
  assert.ok(calls.some((call) => (
    call.method === "deleteMessage" && call.body.message_id === 500
  )));

  const [route] = repository.snapshot().tripRoutes;
  assert.deepEqual(
    Object.keys(route).sort(),
    [
      "claimToken",
      "claimedAt",
      "completedAt",
      "createdAt",
      "sourceChatId",
      "sourceMessageId",
      "sourceTopicId",
      "state",
      "targetMessageId",
      "targetTopicId",
      "updatedAt",
    ].sort(),
  );
  assert.equal(route.state, "completed");
  assert.equal(route.targetMessageId, 600);
  assert.doesNotMatch(JSON.stringify(route), /Олег|Телефон|999 123/);
});

test("trip review callback from another topic is rejected before route claim", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  const result = await processTelegramWebhook(
    tripCallbackUpdate({ updateId: 102, topicId: 10 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl: telegramFetch(calls) },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.result, "wrong_topic");
  assert.equal(repository.snapshot().tripRoutes.length, 0);
  assert.equal(calls.some((call) => call.method === "sendMessage"), false);
  assert.equal(calls.find((call) => call.method === "answerCallbackQuery").body.show_alert, true);
});

test("repeating the same trip update is a no-op", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  const update = tripCallbackUpdate({ updateId: 109 });
  await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls, [600]),
  });
  const repeated = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls, [601]),
  });

  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.duplicate, true);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
});

test("confirm closes inventory, routes to confirmed topic, and cancel releases it", async () => {
  const repository = await pendingRepository();
  const calls = [];
  const fetchImpl = telegramFetch(calls);

  const confirmed = await processTelegramWebhook(
    callbackUpdate("confirm"),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );
  assert.equal(confirmed.status, 200);
  assert.equal((await repository.getRequest(REQUEST_ID)).status, "confirmed");
  assert.equal((await repository.checkAvailability({
    stayId: "cottage",
    unitCount: 1,
    selectedUnitIds: [],
    checkIn: "2026-08-02",
    checkOut: "2026-08-03",
  })).available, false);
  const confirmSend = calls.find((call) => call.method === "sendMessage");
  assert.equal(confirmSend.body.message_thread_id, 20);
  assert.equal(confirmSend.body.reply_markup.inline_keyboard[0][0].text, "Отменить бронь");
  assert.match(confirmSend.body.text, /ПОДТВЕРЖДЕНА/);

  calls.length = 0;
  const cancelled = await processTelegramWebhook(
    callbackUpdate("cancel", {
      updateId: 2,
      messageId: 200,
      topicId: 20,
      text: confirmSend.body.text,
    }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );
  assert.equal(cancelled.status, 200);
  assert.equal((await repository.getRequest(REQUEST_ID)).status, "cancelled");
  assert.equal((await repository.checkAvailability({
    stayId: "cottage",
    unitCount: 1,
    selectedUnitIds: [],
    checkIn: "2026-08-02",
    checkOut: "2026-08-03",
  })).available, true);
  assert.equal(calls.find((call) => call.method === "sendMessage").body.message_thread_id, 30);
});

test("reject archives a pending request without allocating inventory", async () => {
  const repository = await pendingRepository();
  const calls = [];
  const result = await processTelegramWebhook(
    callbackUpdate("reject"),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl: telegramFetch(calls) },
  );
  assert.equal(result.status, 200);
  assert.equal((await repository.getRequest(REQUEST_ID)).status, "rejected");
  assert.equal(repository.snapshot().allocations.length, 0);
  assert.equal(calls.find((call) => call.method === "sendMessage").body.message_thread_id, 30);
});

test("stale message id cannot transition a request", async () => {
  const repository = await pendingRepository();
  const calls = [];
  const result = await processTelegramWebhook(
    callbackUpdate("confirm", { messageId: 999 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl: telegramFetch(calls) },
  );
  assert.equal(result.body.result, "stale_callback");
  assert.equal((await repository.getRequest(REQUEST_ID)).status, "pending");
  assert.equal(calls.some((call) => call.method === "sendMessage"), false);
});

test("completed Telegram update is idempotent", async () => {
  const repository = await pendingRepository();
  const calls = [];
  const update = callbackUpdate("reject");
  await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls),
  });
  const second = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls),
  });
  assert.equal(second.body.duplicate, true);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
});

test("an in-flight Telegram update returns retryable 503 until it completes", async () => {
  const repository = await pendingRepository();
  const calls = [];
  let releaseSend;
  let notifySendStarted;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendStarted = new Promise((resolve) => { notifySendStarted = resolve; });
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      notifySendStarted();
      await sendGate;
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 200, chat: { id: -1001 } } }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };
  const update = callbackUpdate("confirm", { updateId: 9 });

  const first = processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl,
  });
  await sendStarted;
  const busy = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl,
  });
  assert.equal(busy.status, 503);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);

  releaseSend();
  assert.equal((await first).status, 200);
  const completed = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl,
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.duplicate, true);
});

test("a stale in-flight update claim is reclaimed after the crash lease", async () => {
  let timestamp = 1_000_000;
  const repository = createMemoryBookingRepository({ now: () => timestamp });
  assert.equal(await repository.claimTelegramUpdate(77), "claimed");
  assert.equal(await repository.claimTelegramUpdate(77), "processing");
  timestamp += 120_001;
  assert.equal(await repository.claimTelegramUpdate(77), "claimed");
});

test("a stale trip route claim is reclaimed after the crash lease", async () => {
  let timestamp = 1_000_000;
  const repository = createMemoryBookingRepository({ now: () => timestamp });
  const source = { chatId: "-1001", messageId: 500, topicId: 40 };
  const first = await repository.claimTripMessageRouting(source, 30);
  assert.equal(first.state, "claimed");
  assert.equal((await repository.claimTripMessageRouting(source, 30)).state, "processing");
  timestamp += 120_001;
  const reclaimed = await repository.claimTripMessageRouting(source, 30);
  assert.equal(reclaimed.state, "claimed");
  assert.notEqual(reclaimed.claimToken, first.claimToken);
});

test("concurrent callbacks with different update ids route exactly one message", async () => {
  const repository = await pendingRepository();
  const calls = [];
  let releaseSend;
  let notifySendStarted;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendStarted = new Promise((resolve) => { notifySendStarted = resolve; });
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      notifySendStarted();
      await sendGate;
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 200, chat: { id: -1001 } } }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const first = processTelegramWebhook(
    callbackUpdate("confirm", { updateId: 10 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );
  await sendStarted;
  const second = processTelegramWebhook(
    callbackUpdate("confirm", { updateId: 11 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  releaseSend();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 200);
  assert.equal(secondResult.body.result, "already_routed");
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  assert.equal((await repository.getRequest(REQUEST_ID)).telegramMessageId, 200);
});

test("concurrent trip callbacks with different update ids create one archive copy", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  let releaseSend;
  let notifySendStarted;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendStarted = new Promise((resolve) => { notifySendStarted = resolve; });
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      notifySendStarted();
      await sendGate;
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 600, chat: { id: -1001 } } }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const first = processTelegramWebhook(
    tripCallbackUpdate({ updateId: 103 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );
  await sendStarted;
  const second = await processTelegramWebhook(
    tripCallbackUpdate({ updateId: 104 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );

  assert.equal(second.status, 200);
  assert.equal(second.body.result, "trip_processing");
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  releaseSend();
  assert.equal((await first).status, 200);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  assert.equal(repository.snapshot().tripRoutes[0].state, "completed");
});

test("failed trip archive delivery releases both claims and leaves the button retryable", async () => {
  const repository = createMemoryBookingRepository();
  const update = tripCallbackUpdate({ updateId: 105 });
  const failed = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, description: "temporary failure" }),
    }),
  });
  assert.equal(failed.status, 502);
  assert.equal(repository.snapshot().tripRoutes.length, 0);
  assert.equal(repository.snapshot().telegramUpdates.length, 0);

  const calls = [];
  const retried = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls, [600]),
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.result, "trip_reviewed");
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
});

test("trip archive completion deletes a stray destination if database completion fails", async () => {
  const repository = createMemoryBookingRepository();
  repository.completeTripMessageRouting = async () => false;
  const calls = [];
  const result = await processTelegramWebhook(
    tripCallbackUpdate({ updateId: 106 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl: telegramFetch(calls, [600]) },
  );

  assert.equal(result.status, 502);
  assert.ok(calls.some((call) => (
    call.method === "deleteMessage" && call.body.message_id === 600
  )));
  assert.equal(calls.some((call) => (
    call.method === "deleteMessage" && call.body.message_id === 500
  )), false);
  assert.equal(repository.snapshot().tripRoutes.length, 0);
});

test("failed routing releases the update claim so Telegram can retry", async () => {
  const repository = await pendingRepository();
  const update = callbackUpdate("confirm");
  const failed = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, description: "temporary failure" }),
    }),
  });
  assert.equal(failed.status, 502);
  assert.equal((await repository.getRequest(REQUEST_ID)).status, "confirmed");

  const calls = [];
  const retried = await processTelegramWebhook(update, WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls),
  });
  assert.equal(retried.status, 200);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
});

test("notification error storage failure does not prevent stale button removal", async () => {
  const repository = await pendingRepository();
  repository.recordNotificationError = async () => {
    throw new Error("database unavailable");
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 200, chat: { id: -1001 } } }),
      };
    }
    if (method === "deleteMessage" && body.message_id === 100) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ ok: false, description: "temporary delete failure" }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const result = await processTelegramWebhook(
    callbackUpdate("confirm", { updateId: 12 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );

  assert.equal(result.status, 200);
  const edit = calls.find((call) => call.method === "editMessageReplyMarkup");
  assert.ok(edit);
  assert.equal(edit.body.message_id, 100);
  assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] });
});

test("failed trip source deletion replaces it with a compact buttonless stub", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 600, chat: { id: -1001 } } }),
      };
    }
    if (method === "deleteMessage" && body.message_id === 500) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "message can't be deleted" }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const result = await processTelegramWebhook(
    tripCallbackUpdate({ updateId: 107 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );

  assert.equal(result.status, 200);
  const edit = calls.find((call) => call.method === "editMessageText");
  assert.ok(edit);
  assert.equal(edit.body.message_id, 500);
  assert.equal(edit.body.text, "✅ Рассмотрено — перенесено в архив");
  assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] });
});

test("failed trip source text edit falls back to removing only the button", async () => {
  const repository = createMemoryBookingRepository();
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === "sendMessage") {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 600, chat: { id: -1001 } } }),
      };
    }
    if (
      (method === "deleteMessage" && body.message_id === 500)
      || method === "editMessageText"
    ) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "message is not editable" }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const result = await processTelegramWebhook(
    tripCallbackUpdate({ updateId: 108 }),
    WEBHOOK_SECRET,
    ENVIRONMENT,
    { repository, fetchImpl },
  );

  assert.equal(result.status, 200);
  const markupEdit = calls.find((call) => call.method === "editMessageReplyMarkup");
  assert.ok(markupEdit);
  assert.equal(markupEdit.body.message_id, 500);
  assert.deepEqual(markupEdit.body.reply_markup, { inline_keyboard: [] });
});

test("second overlapping confirmation reports conflict and remains pending", async () => {
  const repository = await pendingRepository();
  const firstCalls = [];
  await processTelegramWebhook(callbackUpdate("confirm"), WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(firstCalls),
  });

  const secondId = "71111111-1111-4111-8111-111111111111";
  await repository.createOrGetRequest(metadata({
    id: secondId,
    requestKey: "81111111-1111-4111-8111-111111111111",
    metadataHash: "second",
  }));
  await repository.markTelegramDelivered(secondId, { chatId: "-1001", messageId: 300, topicId: 10 });
  const calls = [];
  const result = await processTelegramWebhook(callbackUpdate("confirm", {
    updateId: 2,
    requestId: secondId,
    messageId: 300,
  }), WEBHOOK_SECRET, ENVIRONMENT, {
    repository,
    fetchImpl: telegramFetch(calls),
  });

  assert.equal(result.body.result, "conflict");
  assert.equal((await repository.getRequest(secondId)).status, "pending");
  assert.equal(calls.some((call) => call.method === "sendMessage"), false);
  assert.equal(calls.find((call) => call.method === "answerCallbackQuery").body.show_alert, true);
});
