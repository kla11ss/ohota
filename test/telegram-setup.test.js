import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeEnvText, persistEnvFile } from "../scripts/env-file.mjs";
import { main as runTelegramSetup } from "../scripts/setup-telegram-webhook.mjs";
import {
  discoverCreatedTopics,
  findSetupCommand,
  provisionTelegram,
  resolveOwnerUserId,
  TELEGRAM_TOPICS,
} from "../scripts/telegram-provisioning.mjs";

function forumSetupUpdates(ownerId = 123, chatId = -1001) {
  return [
    {
      update_id: 10,
      message: {
        from: { id: 999 },
        chat: { id: chatId, type: "supergroup" },
        text: "/setup",
      },
    },
    {
      update_id: 11,
      message: {
        from: { id: ownerId },
        chat: { id: chatId, type: "supergroup" },
        text: "/setup@velikovskoe_bot",
      },
    },
  ];
}

function sequentialRandomBytes() {
  let byte = 1;
  return (size) => {
    const value = Buffer.alloc(size, byte);
    byte += 1;
    return value;
  };
}

test("owner resolution keeps backward-compatible bootstrap precedence", () => {
  assert.equal(resolveOwnerUserId({
    TELEGRAM_OWNER_USER_ID: "101",
    TELEGRAM_ADMIN_USER_IDS: "202,303",
    TELEGRAM_CHAT_ID: "404",
  }), "101");
  assert.equal(resolveOwnerUserId({
    TELEGRAM_ADMIN_USER_IDS: "202,303",
    TELEGRAM_CHAT_ID: "404",
  }), "202");
  assert.equal(resolveOwnerUserId({ TELEGRAM_CHAT_ID: "404" }), "404");
  assert.throws(
    () => resolveOwnerUserId({ TELEGRAM_CHAT_ID: "-1001" }),
    /TELEGRAM_OWNER_USER_ID/,
  );
});

test("setup discovery accepts only the expected owner's command in a supergroup", () => {
  const updates = forumSetupUpdates();
  assert.equal(findSetupCommand(updates, "123")?.chat.id, -1001);
  assert.equal(findSetupCommand(updates, "321"), null);
  const privateCommand = structuredClone(updates);
  privateCommand[1].message.chat.type = "private";
  assert.equal(findSetupCommand(privateCommand, "123"), null);
});

test("service updates can recover exact setup topics after an interrupted run", () => {
  const updates = [{
    update_id: 20,
    message: {
      chat: { id: -1001, type: "supergroup" },
      message_thread_id: 33,
      forum_topic_created: { name: "Архив" },
    },
  }];
  assert.equal(discoverCreatedTopics(updates, "-1001").get("Архив"), "33");
  assert.equal(discoverCreatedTopics(updates, "-2002").size, 0);
});

test("ignored env updates are merged without duplicate keys and replaced atomically", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-setup-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  await fs.writeFile(envPath, "KEEP=yes\r\nDUP=old\r\nDUP=older\r\n# comment\r\n", "utf8");

  await persistEnvFile(envPath, { DUP: "new", SECRET: "value-with-#" });
  const result = await fs.readFile(envPath, "utf8");
  assert.equal((result.match(/^DUP=/gm) ?? []).length, 1);
  assert.match(result, /^KEEP=yes$/m);
  assert.match(result, /^DUP=new$/m);
  assert.match(result, /^SECRET="value-with-#"$/m);
  assert.match(result, /^# comment$/m);
  assert.equal((await fs.readdir(directory)).some((name) => name.includes(".tmp-")), false);

  assert.equal(mergeEnvText("A=1\n", { A: "2", B: "3" }), "A=2\nB=3\n");
});

test("first provisioning discovers /setup, creates four topics, and persists every result", async () => {
  const calls = [];
  const persisted = [];
  let nextTopicId = 10;
  const callTelegram = async (method, payload = {}) => {
    calls.push({ method, payload });
    if (method === "getMe") return { id: 777, is_bot: true, username: "velikovskoe_bot" };
    if (method === "getUpdates") return forumSetupUpdates();
    if (method === "getChat") {
      return { id: -1001, type: "supergroup", is_forum: true, title: "Managers" };
    }
    if (method === "getChatMember") {
      if (payload.user_id === 123) return { status: "creator" };
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: true,
      };
    }
    if (method === "createForumTopic") {
      const messageThreadId = nextTopicId;
      nextTopicId += 10;
      return { message_thread_id: messageThreadId, name: payload.name };
    }
    if (method === "sendChatAction") return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  const result = await provisionTelegram({
    environment: {
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_CHAT_ID: "123",
      TELEGRAM_WEBHOOK_SECRET: "replace-with-random-a-z-A-Z-0-9-_-secret",
      BOOKING_RATE_LIMIT_SECRET: "replace-with-a-different-long-random-secret",
    },
    callTelegram,
    persist: async (updates) => persisted.push(structuredClone(updates)),
    randomBytesImpl: sequentialRandomBytes(),
  });

  assert.equal(result.webhookConfigured, false);
  assert.deepEqual(
    calls.filter((call) => call.method === "createForumTopic").map((call) => call.payload.name),
    TELEGRAM_TOPICS.map((topic) => topic.name),
  );
  assert.equal(calls.filter((call) => call.method === "sendChatAction").length, 4);
  assert.equal(calls.some((call) => (
    call.method === "getChatMember" && call.payload.user_id === 123
  )), true);
  assert.equal(calls.some((call) => call.method === "setWebhook"), false);
  assert.equal(persisted.length, 5);
  assert.equal(persisted[0].TELEGRAM_OWNER_USER_ID, "123");
  assert.equal(persisted[0].TELEGRAM_ADMIN_USER_IDS, "123");
  assert.equal(persisted[0].TELEGRAM_CHAT_ID, "-1001");
  assert.match(persisted[0].TELEGRAM_WEBHOOK_SECRET, /^[A-Za-z0-9_-]{32,256}$/);
  assert.match(persisted[0].BOOKING_RATE_LIMIT_SECRET, /^[A-Za-z0-9_-]{32,256}$/);
  assert.notEqual(
    persisted[0].TELEGRAM_WEBHOOK_SECRET,
    "replace-with-random-a-z-A-Z-0-9-_-secret",
  );
  assert.notEqual(
    persisted[0].BOOKING_RATE_LIMIT_SECRET,
    "replace-with-a-different-long-random-secret",
  );
  assert.notEqual(
    persisted[0].TELEGRAM_WEBHOOK_SECRET,
    persisted[0].BOOKING_RATE_LIMIT_SECRET,
  );
  assert.deepEqual(
    persisted.slice(1).map((entry) => Object.keys(entry)[0]),
    TELEGRAM_TOPICS.map((topic) => topic.key),
  );
  assert.deepEqual(Object.keys(result).sort(), [
    "botUsername",
    "chatTitle",
    "topicNames",
    "webhookConfigured",
  ]);
});

test("resumable provisioning validates existing topics and registers a callback-only webhook", async () => {
  const calls = [];
  const persisted = [];
  const environment = {
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_OWNER_USER_ID: "123",
    TELEGRAM_CHAT_ID: "-1001",
    TELEGRAM_NEW_TOPIC_ID: "10",
    TELEGRAM_CONFIRMED_TOPIC_ID: "20",
    TELEGRAM_ARCHIVE_TOPIC_ID: "30",
    TELEGRAM_TRIP_TOPIC_ID: "40",
    TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
    BOOKING_RATE_LIMIT_SECRET: "r".repeat(32),
  };
  const webhookUrl = "https://example.com/api/telegram-webhook";
  const callTelegram = async (method, payload = {}) => {
    calls.push({ method, payload });
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getChat") return { id: -1001, type: "supergroup", is_forum: true };
    if (method === "getChatMember") {
      if (payload.user_id === 123) return { status: "creator" };
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: true,
      };
    }
    if (method === "sendChatAction") return true;
    if (method === "setWebhook") return true;
    if (method === "getWebhookInfo") return { url: webhookUrl };
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  const result = await provisionTelegram({
    environment,
    argumentsList: ["--url=https://example.com/a/path"],
    callTelegram,
    persist: async (updates) => persisted.push(structuredClone(updates)),
  });

  assert.equal(result.webhookConfigured, true);
  assert.equal(calls.some((call) => call.method === "getUpdates"), false);
  assert.equal(calls.some((call) => call.method === "createForumTopic"), false);
  assert.equal(calls.filter((call) => call.method === "sendChatAction").length, 4);
  const setWebhook = calls.find((call) => call.method === "setWebhook").payload;
  assert.equal(setWebhook.url, webhookUrl);
  assert.equal(setWebhook.secret_token, environment.TELEGRAM_WEBHOOK_SECRET);
  assert.deepEqual(setWebhook.allowed_updates, ["callback_query"]);
  assert.equal(persisted.length, 1);
});

test("an interrupted topic creation is recovered from updates instead of duplicated", async () => {
  const calls = [];
  const persisted = [];
  let nextTopicId = 20;
  const callTelegram = async (method, payload = {}) => {
    calls.push({ method, payload });
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getUpdates") {
      return [{
        update_id: 50,
        message: {
          chat: { id: -1001, type: "supergroup" },
          message_thread_id: 10,
          forum_topic_created: { name: "Новые заявки" },
        },
      }];
    }
    if (method === "getChat") return { id: -1001, type: "supergroup", is_forum: true };
    if (method === "getChatMember") {
      if (payload.user_id === 123) return { status: "creator" };
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: true,
      };
    }
    if (method === "createForumTopic") {
      const messageThreadId = nextTopicId;
      nextTopicId += 10;
      return { message_thread_id: messageThreadId };
    }
    if (method === "sendChatAction") return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  await provisionTelegram({
    environment: {
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_OWNER_USER_ID: "123",
      TELEGRAM_CHAT_ID: "-1001",
    },
    callTelegram,
    persist: async (updates) => persisted.push(structuredClone(updates)),
    randomBytesImpl: sequentialRandomBytes(),
  });

  assert.equal(calls.filter((call) => call.method === "createForumTopic").length, 3);
  assert.equal(calls.some((call) => (
    call.method === "createForumTopic" && call.payload.name === "Новые заявки"
  )), false);
  assert.deepEqual(persisted[1], { TELEGRAM_NEW_TOPIC_ID: "10" });
});

test("provisioning stops before persistence when the bot lacks required forum rights", async () => {
  let persisted = false;
  const callTelegram = async (method) => {
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getChat") return { id: -1001, type: "supergroup", is_forum: true };
    if (method === "getChatMember") {
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: false,
      };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  await assert.rejects(
    provisionTelegram({
      environment: {
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_OWNER_USER_ID: "123",
        TELEGRAM_CHAT_ID: "-1001",
        TELEGRAM_NEW_TOPIC_ID: "10",
        TELEGRAM_CONFIRMED_TOPIC_ID: "20",
        TELEGRAM_ARCHIVE_TOPIC_ID: "30",
        TELEGRAM_TRIP_TOPIC_ID: "40",
      },
      callTelegram,
      persist: async () => { persisted = true; },
    }),
    /delete-messages/,
  );
  assert.equal(persisted, false);
});

test("provisioning rejects a public forum before persisting secrets or creating topics", async () => {
  let persisted = false;
  let topicCreated = false;
  const callTelegram = async (method) => {
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getChat") {
      return {
        id: -1001,
        type: "supergroup",
        is_forum: true,
        username: "public_booking_managers",
      };
    }
    if (method === "createForumTopic") {
      topicCreated = true;
      return { message_thread_id: 50 };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  await assert.rejects(
    provisionTelegram({
      environment: {
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_OWNER_USER_ID: "123",
        TELEGRAM_CHAT_ID: "-1001",
        TELEGRAM_NEW_TOPIC_ID: "10",
        TELEGRAM_CONFIRMED_TOPIC_ID: "20",
        TELEGRAM_ARCHIVE_TOPIC_ID: "30",
        TELEGRAM_TRIP_TOPIC_ID: "40",
      },
      callTelegram,
      persist: async () => { persisted = true; },
    }),
    /private Telegram forum supergroup/,
  );
  assert.equal(persisted, false);
  assert.equal(topicCreated, false);
});

test("provisioning requires TELEGRAM_OWNER_USER_ID to be the forum creator", async () => {
  let persisted = false;
  let topicCreated = false;
  const callTelegram = async (method, payload = {}) => {
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getChat") return { id: -1001, type: "supergroup", is_forum: true };
    if (method === "getChatMember" && payload.user_id === 777) {
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: true,
      };
    }
    if (method === "getChatMember" && payload.user_id === 123) {
      return { status: "administrator" };
    }
    if (method === "createForumTopic") {
      topicCreated = true;
      return { message_thread_id: 50 };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  await assert.rejects(
    provisionTelegram({
      environment: {
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_OWNER_USER_ID: "123",
        TELEGRAM_CHAT_ID: "-1001",
        TELEGRAM_NEW_TOPIC_ID: "10",
        TELEGRAM_CONFIRMED_TOPIC_ID: "20",
        TELEGRAM_ARCHIVE_TOPIC_ID: "30",
        TELEGRAM_TRIP_TOPIC_ID: "40",
      },
      callTelegram,
      persist: async () => { persisted = true; },
    }),
    /must be the creator/,
  );
  assert.equal(persisted, false);
  assert.equal(topicCreated, false);
});

test("setup output never prints tokens, IDs, or generated secret values", async () => {
  const messages = [];
  const environment = {
    TELEGRAM_BOT_TOKEN: "private-bot-token",
    TELEGRAM_OWNER_USER_ID: "123",
    TELEGRAM_CHAT_ID: "-1001",
    TELEGRAM_NEW_TOPIC_ID: "10",
    TELEGRAM_CONFIRMED_TOPIC_ID: "20",
    TELEGRAM_ARCHIVE_TOPIC_ID: "30",
    TELEGRAM_TRIP_TOPIC_ID: "40",
    TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
    BOOKING_RATE_LIMIT_SECRET: "r".repeat(32),
  };
  const callTelegram = async (method, payload = {}) => {
    if (method === "getMe") return { id: 777, is_bot: true };
    if (method === "getChat") return { id: -1001, type: "supergroup", is_forum: true };
    if (method === "getChatMember" && payload.user_id === 123) return { status: "creator" };
    if (method === "getChatMember") {
      return {
        status: "administrator",
        can_manage_topics: true,
        can_delete_messages: true,
      };
    }
    if (method === "sendChatAction") return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  };

  await runTelegramSetup({
    environment,
    argumentsList: [],
    callTelegram,
    persist: async () => {},
    log: (message) => messages.push(message),
  });

  const output = messages.join("\n");
  for (const sensitiveValue of Object.values(environment)) {
    assert.equal(output.includes(sensitiveValue), false);
  }
});
