import { randomBytes } from "node:crypto";

const TELEGRAM_API_ROOT = "https://api.telegram.org";
const SETUP_COMMAND_PATTERN = /^\/setup(?:@[A-Za-z0-9_]+)?(?:\s|$)/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export const TELEGRAM_TOPICS = Object.freeze([
  { key: "TELEGRAM_NEW_TOPIC_ID", name: "Новые заявки" },
  { key: "TELEGRAM_CONFIRMED_TOPIC_ID", name: "Подтверждённые" },
  { key: "TELEGRAM_ARCHIVE_TOPIC_ID", name: "Архив" },
  { key: "TELEGRAM_TRIP_TOPIC_ID", name: "Запросы на поездку" },
]);

function configured(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^replace-with/i.test(normalized) ? normalized : "";
}

function positiveTelegramId(value) {
  const normalized = configured(value);
  return /^\d+$/.test(normalized) && BigInt(normalized) > 0n ? normalized : null;
}

function forumChatId(value) {
  const normalized = configured(value);
  return /^-\d+$/.test(normalized) ? normalized : null;
}

export function resolveOwnerUserId(environment) {
  const explicit = positiveTelegramId(environment.TELEGRAM_OWNER_USER_ID);
  if (explicit) return explicit;

  const compatibleAdmin = String(environment.TELEGRAM_ADMIN_USER_IDS ?? "")
    .split(/[\s,;]+/)
    .map(positiveTelegramId)
    .find(Boolean);
  if (compatibleAdmin) return compatibleAdmin;

  const legacyPrivateChat = positiveTelegramId(environment.TELEGRAM_CHAT_ID);
  if (legacyPrivateChat) return legacyPrivateChat;
  throw new Error(
    "Configure TELEGRAM_OWNER_USER_ID, TELEGRAM_ADMIN_USER_IDS, or a positive pre-setup TELEGRAM_CHAT_ID",
  );
}

export function parseOptionalPublicOrigin(argumentsList, environment) {
  const explicit = argumentsList.find((argument) => argument.startsWith("--url="));
  const raw = explicit?.slice("--url=".length) || configured(environment.PUBLIC_SITE_URL);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.origin;
  } catch {
    throw new Error("Public URL must be an HTTPS origin (--url=https://example.ru)");
  }
}

export function findSetupCommand(updates, ownerUserId) {
  const owner = String(ownerUserId);
  return [...updates]
    .sort((left, right) => Number(right.update_id) - Number(left.update_id))
    .map((update) => update?.message)
    .find((message) => (
      String(message?.from?.id ?? "") === owner
      && message?.chat?.type === "supergroup"
      && SETUP_COMMAND_PATTERN.test(String(message?.text ?? ""))
    )) ?? null;
}

export function discoverCreatedTopics(updates, chatId) {
  const discovered = new Map();
  const knownNames = new Set(TELEGRAM_TOPICS.map((topic) => topic.name));
  for (const update of [...updates].sort((left, right) => Number(left.update_id) - Number(right.update_id))) {
    const message = update?.message;
    const name = message?.forum_topic_created?.name;
    const topicId = positiveTelegramId(message?.message_thread_id);
    if (String(message?.chat?.id ?? "") === String(chatId) && knownNames.has(name) && topicId) {
      discovered.set(name, topicId);
    }
  }
  return discovered;
}

export function createTelegramSetupClient(token, options = {}) {
  const normalizedToken = configured(token);
  if (!normalizedToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  return async function callTelegram(method, payload = {}) {
    let response;
    try {
      response = await fetchImpl(`${TELEGRAM_API_ROOT}/bot${normalizedToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new Error(`${method} failed: ${error?.message ?? "network error"}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(`${method} failed: ${body?.description ?? `HTTP ${response.status}`}`);
    }
    return body?.result;
  };
}

function ensureSecret(value, randomBytesImpl) {
  const existing = configured(value);
  if (SECRET_PATTERN.test(existing) && !existing.toLowerCase().startsWith("replace-with-")) {
    return existing;
  }
  return randomBytesImpl(32).toString("base64url");
}

function validateConfiguredTopicIds(environment) {
  const ids = new Set();
  for (const topic of TELEGRAM_TOPICS) {
    const raw = configured(environment[topic.key]);
    if (!raw) continue;
    const id = positiveTelegramId(raw);
    if (!id) throw new Error(`${topic.key} must be a positive integer`);
    if (ids.has(id)) throw new Error("Telegram topic IDs must be distinct");
    ids.add(id);
  }
}

async function verifyTopic(callTelegram, chatId, topicId) {
  await callTelegram("sendChatAction", {
    chat_id: chatId,
    message_thread_id: Number(topicId),
    action: "typing",
  });
}

export async function provisionTelegram(options) {
  const environment = { ...options.environment };
  const callTelegram = options.callTelegram;
  const persist = options.persist;
  const argumentsList = options.argumentsList ?? [];
  const randomBytesImpl = options.randomBytesImpl ?? randomBytes;
  if (typeof callTelegram !== "function") throw new TypeError("callTelegram is required");
  if (typeof persist !== "function") throw new TypeError("persist is required");
  if (!configured(environment.TELEGRAM_BOT_TOKEN)) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const ownerUserId = resolveOwnerUserId(environment);
  validateConfiguredTopicIds(environment);
  const bot = await callTelegram("getMe");
  if (!bot?.is_bot || !positiveTelegramId(bot.id)) throw new Error("Telegram getMe returned an invalid bot");

  let updates = [];
  let chatId = forumChatId(environment.TELEGRAM_CHAT_ID);
  const topicConfigurationIncomplete = TELEGRAM_TOPICS.some(
    (topic) => !positiveTelegramId(environment[topic.key]),
  );
  if (!chatId || topicConfigurationIncomplete) {
    updates = await callTelegram("getUpdates", {
      allowed_updates: ["message"],
      limit: 100,
      timeout: 0,
    });
    if (!Array.isArray(updates)) throw new Error("Telegram getUpdates returned an invalid result");
  }
  if (!chatId) {
    const setupMessage = findSetupCommand(updates, ownerUserId);
    if (!setupMessage) {
      throw new Error("Send /setup in the target forum supergroup from TELEGRAM_OWNER_USER_ID, then retry");
    }
    chatId = String(setupMessage.chat.id);
  }

  const chat = await callTelegram("getChat", { chat_id: chatId });
  const publicUsername = typeof chat?.username === "string" ? chat.username.trim() : "";
  if (
    chat?.type !== "supergroup"
    || chat?.is_forum !== true
    || String(chat.id) !== chatId
    || publicUsername
  ) {
    throw new Error("The setup chat must be a private Telegram forum supergroup without a public username");
  }
  const botMembership = await callTelegram("getChatMember", {
    chat_id: chatId,
    user_id: bot.id,
  });
  const botIsCreator = botMembership?.status === "creator";
  const botHasRequiredRights = botIsCreator || (
    botMembership?.status === "administrator"
    && botMembership.can_manage_topics === true
    && botMembership.can_delete_messages === true
  );
  if (!botHasRequiredRights) {
    throw new Error("The bot must be an administrator with manage-topics and delete-messages rights");
  }
  const ownerMembership = await callTelegram("getChatMember", {
    chat_id: chatId,
    user_id: Number(ownerUserId),
  });
  if (ownerMembership?.status !== "creator") {
    throw new Error("TELEGRAM_OWNER_USER_ID must be the creator of the forum supergroup");
  }

  const webhookSecret = ensureSecret(environment.TELEGRAM_WEBHOOK_SECRET, randomBytesImpl);
  let rateLimitSecret = ensureSecret(environment.BOOKING_RATE_LIMIT_SECRET, randomBytesImpl);
  let attempts = 0;
  while (rateLimitSecret === webhookSecret && attempts < 4) {
    rateLimitSecret = randomBytesImpl(32).toString("base64url");
    attempts += 1;
  }
  if (rateLimitSecret === webhookSecret) throw new Error("Unable to generate separate setup secrets");

  const baseConfiguration = {
    TELEGRAM_OWNER_USER_ID: ownerUserId,
    TELEGRAM_ADMIN_USER_IDS: ownerUserId,
    TELEGRAM_CHAT_ID: chatId,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    BOOKING_RATE_LIMIT_SECRET: rateLimitSecret,
  };
  Object.assign(environment, baseConfiguration);
  await persist(baseConfiguration);

  const recoveredTopics = discoverCreatedTopics(updates, chatId);
  const usedTopicIds = new Set();
  for (const topic of TELEGRAM_TOPICS) {
    const configuredId = positiveTelegramId(environment[topic.key]);
    const recoveredId = recoveredTopics.get(topic.name);
    let topicId = configuredId ?? recoveredId ?? null;

    if (!topicId) {
      const created = await callTelegram("createForumTopic", {
        chat_id: chatId,
        name: topic.name,
      });
      topicId = positiveTelegramId(created?.message_thread_id);
      if (!topicId) throw new Error(`Telegram did not return an ID for topic: ${topic.name}`);
    }
    if (usedTopicIds.has(topicId)) throw new Error("Telegram topic IDs must be distinct");
    usedTopicIds.add(topicId);

    if (!configuredId || environment[topic.key] !== topicId) {
      environment[topic.key] = topicId;
      // Persist the returned ID before any further Telegram call so a retry
      // resumes from this exact topic instead of creating a duplicate.
      await persist({ [topic.key]: topicId });
    }
    await verifyTopic(callTelegram, chatId, topicId);
  }

  const publicOrigin = parseOptionalPublicOrigin(argumentsList, environment);
  let webhookConfigured = false;
  if (publicOrigin) {
    const webhookUrl = `${publicOrigin}/api/telegram-webhook`;
    await callTelegram("setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["callback_query"],
      drop_pending_updates: false,
    });
    const webhook = await callTelegram("getWebhookInfo");
    if (webhook?.url !== webhookUrl) throw new Error("Telegram returned an unexpected webhook URL");
    webhookConfigured = true;
  }

  return {
    botUsername: bot.username ?? null,
    chatTitle: chat.title ?? null,
    webhookConfigured,
    topicNames: TELEGRAM_TOPICS.map((topic) => topic.name),
  };
}
