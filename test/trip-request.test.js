import test from "node:test";
import assert from "node:assert/strict";

import { processTripRequest } from "../server/trip-request.js";

const VALID_REQUEST = {
  name: "Олег",
  phone: "+7 999 123-45-67",
  interest: "hunt",
  details: "Два гостя в августе",
  website: "",
};

test("trip requests are delivered only to TELEGRAM_TRIP_TOPIC_ID", async () => {
  let telegramCall = null;
  const result = await processTripRequest(
    VALID_REQUEST,
    {
      TELEGRAM_BOT_TOKEN: "secret-token",
      TELEGRAM_CHAT_ID: "-1001",
      TELEGRAM_TRIP_TOPIC_ID: "40",
    },
    {
      fetchImpl: async (url, options) => {
        telegramCall = { url, body: JSON.parse(options.body) };
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 500, chat: { id: -1001 } } }),
        };
      },
    },
  );

  assert.equal(result.status, 200);
  assert.equal(telegramCall.url, "https://api.telegram.org/botsecret-token/sendMessage");
  assert.equal(telegramCall.body.chat_id, "-1001");
  assert.equal(telegramCall.body.message_thread_id, 40);
  assert.equal(telegramCall.body.parse_mode, "HTML");
});

test("trip requests fail closed when TELEGRAM_TRIP_TOPIC_ID is missing", async () => {
  let contacted = false;
  const result = await processTripRequest(
    VALID_REQUEST,
    {
      TELEGRAM_BOT_TOKEN: "secret-token",
      TELEGRAM_CHAT_ID: "-1001",
    },
    {
      fetchImpl: async () => {
        contacted = true;
        return { ok: true, json: async () => ({ ok: true }) };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(contacted, false);
});
