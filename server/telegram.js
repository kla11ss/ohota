const TELEGRAM_API_ROOT = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(code, details = "") {
    super(code);
    this.name = "TelegramApiError";
    this.code = code;
    this.details = details;
  }
}

function requiredTelegramConfiguration(environment) {
  const token = environment.TELEGRAM_BOT_TOKEN;
  const chatId = environment.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new TelegramApiError("TELEGRAM_NOT_CONFIGURED");
  return { token, chatId: String(chatId) };
}

export function parseTopicId(value, name) {
  const topicId = Number(value);
  if (!Number.isSafeInteger(topicId) || topicId < 1) {
    throw new TelegramApiError("TELEGRAM_NOT_CONFIGURED", `${name} is missing`);
  }
  return topicId;
}

export async function callTelegram(method, payload, environment = process.env, fetchImpl = fetch) {
  const { token } = requiredTelegramConfiguration(environment);
  let response;
  try {
    response = await fetchImpl(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TelegramApiError("TELEGRAM_DELIVERY_FAILED", error?.message);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Telegram normally returns JSON; a proxy error may not.
  }

  if (!response.ok || body?.ok === false) {
    throw new TelegramApiError(
      "TELEGRAM_DELIVERY_FAILED",
      body?.description ?? `HTTP ${response.status ?? "error"}`,
    );
  }

  return body?.result ?? null;
}

export function getTelegramChatId(environment = process.env) {
  return requiredTelegramConfiguration(environment).chatId;
}

export async function answerCallbackQuery(callbackQueryId, text, environment, fetchImpl, options = {}) {
  return callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: Boolean(options.showAlert),
    cache_time: 0,
  }, environment, fetchImpl);
}

export async function deleteTelegramMessage(chatId, messageId, environment, fetchImpl) {
  return callTelegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  }, environment, fetchImpl);
}

export async function editTelegramReplyMarkup(chatId, messageId, replyMarkup, environment, fetchImpl) {
  return callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  }, environment, fetchImpl);
}

export async function editTelegramMessageText(
  chatId,
  messageId,
  text,
  replyMarkup,
  environment,
  fetchImpl,
) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return callTelegram("editMessageText", payload, environment, fetchImpl);
}

export async function sendTopicMessage({
  text,
  topicId,
  replyMarkup,
  parseMode,
}, environment = process.env, fetchImpl = fetch) {
  const chatId = getTelegramChatId(environment);
  const normalizedTopicId = parseTopicId(topicId, "Telegram topic ID");
  const payload = {
    chat_id: chatId,
    message_thread_id: normalizedTopicId,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (parseMode) payload.parse_mode = parseMode;

  const result = await callTelegram("sendMessage", payload, environment, fetchImpl);
  if (!Number.isSafeInteger(result?.message_id)) {
    throw new TelegramApiError("TELEGRAM_DELIVERY_FAILED", "Missing message_id");
  }

  return {
    chatId: String(result.chat?.id ?? chatId),
    messageId: result.message_id,
    topicId: normalizedTopicId,
  };
}
