import { timingSafeEqual } from "node:crypto";

import { DATABASE_NOT_CONFIGURED, getBookingRepository } from "./booking-database.js";
import {
  answerCallbackQuery,
  deleteTelegramMessage,
  editTelegramReplyMarkup,
  getTelegramChatId,
  parseTopicId,
  sendTopicMessage,
} from "./telegram.js";

const CALLBACK_PATTERN = /^booking:(confirm|reject|cancel):([0-9a-f-]{36})$/i;
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseTelegramAdminIds(value) {
  return new Set(String(value ?? "")
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter((id) => /^-?\d+$/.test(id)));
}

export function getTelegramManagerIds(environment = process.env) {
  const ownerId = String(environment.TELEGRAM_OWNER_USER_ID ?? "").trim();
  if (ownerId) return /^\d+$/.test(ownerId) ? new Set([ownerId]) : new Set();
  return parseTelegramAdminIds(environment.TELEGRAM_ADMIN_USER_IDS);
}

export function validateTelegramWebhookAccess(update, secretHeader, environment = process.env) {
  const configuredSecret = typeof environment.TELEGRAM_WEBHOOK_SECRET === "string"
    ? environment.TELEGRAM_WEBHOOK_SECRET.trim()
    : "";
  if (
    !WEBHOOK_SECRET_PATTERN.test(configuredSecret)
    || configuredSecret.toLowerCase().startsWith("replace-with-")
  ) {
    return { ok: false, status: 503, error: "Telegram webhook is not configured" };
  }
  if (!safeEqual(secretHeader, configuredSecret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const callback = update?.callback_query;
  if (!callback) return { ok: true, callback: null };

  let configuredChatId;
  try {
    configuredChatId = getTelegramChatId(environment);
  } catch {
    return { ok: false, status: 503, error: "Telegram is not configured" };
  }
  if (String(callback.message?.chat?.id ?? "") !== configuredChatId) {
    return { ok: false, status: 403, error: "Forbidden chat" };
  }

  const managers = getTelegramManagerIds(environment);
  if (managers.size === 0 || !managers.has(String(callback.from?.id ?? ""))) {
    return { ok: false, status: 403, error: "Forbidden manager" };
  }

  const match = CALLBACK_PATTERN.exec(callback.data ?? "");
  if (!match) return { ok: false, status: 400, error: "Unsupported callback" };
  return {
    ok: true,
    callback,
    action: match[1].toLowerCase(),
    requestId: match[2].toLowerCase(),
  };
}

function callbackKeyboard(action, requestId) {
  if (action !== "confirm") return undefined;
  return {
    inline_keyboard: [[
      { text: "Отменить бронь", callback_data: `booking:cancel:${requestId}` },
    ]],
  };
}

const statusLabels = {
  confirm: { heading: "✅ БРОНЬ ПОДТВЕРЖДЕНА", line: "подтверждено" },
  reject: { heading: "❌ ЗАЯВКА ОТКЛОНЕНА", line: "отклонено" },
  cancel: { heading: "↩️ БРОНЬ ОТМЕНЕНА", line: "отменено, даты освобождены" },
};

function routedMessageText(originalText, action, requestId) {
  const label = statusLabels[action];
  const fallback = `Заявка ${requestId}`;
  const original = typeof originalText === "string" && originalText.trim() ? originalText.trim() : fallback;
  const withStatus = /^Статус:.*$/mi.test(original)
    ? original.replace(/^Статус:.*$/mi, `Статус: ${label.line}`)
    : `${original}\nСтатус: ${label.line}`;
  return `${label.heading}\n\n${withStatus}`;
}

async function bestEffortAnswer(callbackId, text, environment, fetchImpl, showAlert = false) {
  try {
    await answerCallbackQuery(callbackId, text, environment, fetchImpl, { showAlert });
  } catch {
    // The database transition is authoritative even if Telegram's short-lived callback expires.
  }
}

async function routeMessage({
  callback,
  action,
  requestId,
  request,
  repository,
  environment,
  fetchImpl,
}) {
  const targetTopicId = action === "confirm"
    ? parseTopicId(environment.TELEGRAM_CONFIRMED_TOPIC_ID, "TELEGRAM_CONFIRMED_TOPIC_ID")
    : parseTopicId(environment.TELEGRAM_ARCHIVE_TOPIC_ID, "TELEGRAM_ARCHIVE_TOPIC_ID");
  const sourceChatId = String(callback.message.chat.id);
  const sourceMessageId = callback.message.message_id;

  // A repeated action on an old message must not create another copy in the destination topic.
  if (
    request.telegramMessageId !== null
    && Number(request.telegramMessageId) !== Number(sourceMessageId)
  ) {
    return { alreadyRouted: true };
  }

  const routingClaim = await repository.claimTelegramRouting(requestId, {
    chatId: sourceChatId,
    messageId: sourceMessageId,
    topicId: callback.message.message_thread_id,
  });
  if (!routingClaim?.claimed) return { alreadyRouted: true };

  let telegram = null;
  try {
    telegram = await sendTopicMessage({
      text: routedMessageText(callback.message.text, action, requestId),
      topicId: targetTopicId,
      replyMarkup: callbackKeyboard(action, requestId),
    }, environment, fetchImpl);
    const routedRequest = await repository.completeTelegramRouting(
      requestId,
      routingClaim.claimToken,
      telegram,
    );
    if (!routedRequest) throw new Error("TELEGRAM_ROUTING_CLAIM_LOST");
  } catch (error) {
    if (telegram) {
      try {
        await deleteTelegramMessage(telegram.chatId, telegram.messageId, environment, fetchImpl);
      } catch {
        // Keep the original exception; the source message still has the actionable button.
      }
    }
    try {
      await repository.releaseTelegramRouting(requestId, routingClaim.claimToken);
    } catch {
      // The routing lease expires, allowing a later Telegram retry to recover.
    }
    throw error;
  }

  try {
    await deleteTelegramMessage(sourceChatId, sourceMessageId, environment, fetchImpl);
  } catch (error) {
    try {
      await repository.recordNotificationError(requestId, "source_message_delete_failed");
    } catch {
      // Diagnostics are best-effort; disabling the stale source button is still required.
    }
    try {
      await editTelegramReplyMarkup(sourceChatId, sourceMessageId, { inline_keyboard: [] }, environment, fetchImpl);
    } catch {
      // The destination copy is already authoritative and contains the current controls.
    }
  }
  return { alreadyRouted: false, telegram };
}

function transitionMessage(action, result) {
  if (result.code === "conflict") {
    return "Не удалось подтвердить: выбранные даты уже заняты.";
  }
  if (result.code === "not_found") return "Заявка не найдена.";
  if (result.code === "invalid_status" || result.code === "invalid_transition") {
    return `Действие уже недоступно: статус ${result.status}.`;
  }
  if (action === "confirm") return "Бронь подтверждена, даты закрыты на сайте.";
  if (action === "reject") return "Заявка отклонена.";
  return "Бронь отменена, даты снова доступны.";
}

export async function processTelegramWebhook(update, secretHeader, environment = process.env, options = {}) {
  const access = validateTelegramWebhookAccess(update, secretHeader, environment);
  if (!access.ok) return { ok: false, status: access.status, body: { error: access.error } };
  if (!access.callback) return { ok: true, status: 200, body: { ok: true } };
  if (!Number.isSafeInteger(update.update_id)) {
    return { ok: false, status: 400, body: { error: "Invalid update id" } };
  }

  let repository;
  try {
    repository = options.repository ?? await getBookingRepository(environment);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      body: { error: error?.message === DATABASE_NOT_CONFIGURED ? "Database is not configured" : "Database unavailable" },
    };
  }

  let claimed = false;
  try {
    const claimState = await repository.claimTelegramUpdate(update.update_id);
    if (claimState === "completed") {
      return { ok: true, status: 200, body: { ok: true, duplicate: true } };
    }
    if (claimState === "processing") {
      return {
        ok: false,
        status: 503,
        body: { error: "Telegram update is already processing" },
      };
    }
    if (claimState !== "claimed") throw new Error("INVALID_TELEGRAM_UPDATE_CLAIM_STATE");
    claimed = true;

    const expectedTopicId = access.action === "cancel"
      ? parseTopicId(environment.TELEGRAM_CONFIRMED_TOPIC_ID, "TELEGRAM_CONFIRMED_TOPIC_ID")
      : parseTopicId(environment.TELEGRAM_NEW_TOPIC_ID, "TELEGRAM_NEW_TOPIC_ID");
    if (Number(access.callback.message.message_thread_id) !== expectedTopicId) {
      await bestEffortAnswer(
        access.callback.id,
        "Эта кнопка находится не в той теме.",
        environment,
        options.fetchImpl ?? fetch,
        true,
      );
      await repository.completeTelegramUpdate(update.update_id);
      return { ok: true, status: 200, body: { ok: true } };
    }

    const requestBefore = await repository.getRequest(access.requestId);
    if (!requestBefore) {
      await bestEffortAnswer(access.callback.id, "Заявка не найдена.", environment, options.fetchImpl ?? fetch, true);
      await repository.completeTelegramUpdate(update.update_id);
      return { ok: true, status: 200, body: { ok: true } };
    }

    if (
      String(requestBefore.telegramChatId ?? "") !== String(access.callback.message.chat.id)
      || Number(requestBefore.telegramMessageId) !== Number(access.callback.message.message_id)
      || Number(requestBefore.telegramTopicId) !== expectedTopicId
    ) {
      await bestEffortAnswer(
        access.callback.id,
        "Эта кнопка устарела или не относится к заявке.",
        environment,
        options.fetchImpl ?? fetch,
        true,
      );
      await repository.completeTelegramUpdate(update.update_id);
      return { ok: true, status: 200, body: { ok: true, result: "stale_callback" } };
    }

    const result = access.action === "confirm"
      ? await repository.confirmRequest(access.requestId, Number(access.callback.from.id))
      : await repository.transitionRequest(
        access.requestId,
        access.action === "reject" ? "rejected" : "cancelled",
        Number(access.callback.from.id),
      );

    if (!result.ok) {
      await bestEffortAnswer(
        access.callback.id,
        transitionMessage(access.action, result),
        environment,
        options.fetchImpl ?? fetch,
        true,
      );
      await repository.completeTelegramUpdate(update.update_id);
      return { ok: true, status: 200, body: { ok: true, result: result.code } };
    }

    const requestAfter = await repository.getRequest(access.requestId);
    const routing = await routeMessage({
      callback: access.callback,
      action: access.action,
      requestId: access.requestId,
      request: requestAfter ?? requestBefore,
      repository,
      environment,
      fetchImpl: options.fetchImpl ?? fetch,
    });
    if (routing.alreadyRouted) {
      await bestEffortAnswer(
        access.callback.id,
        "Сообщение уже перенесено или обрабатывается.",
        environment,
        options.fetchImpl ?? fetch,
      );
      await repository.completeTelegramUpdate(update.update_id);
      return { ok: true, status: 200, body: { ok: true, result: "already_routed" } };
    }
    await bestEffortAnswer(
      access.callback.id,
      transitionMessage(access.action, result),
      environment,
      options.fetchImpl ?? fetch,
    );
    await repository.completeTelegramUpdate(update.update_id);
    return { ok: true, status: 200, body: { ok: true, result: result.code } };
  } catch (error) {
    if (claimed) {
      try {
        await repository.releaseTelegramUpdate(update.update_id);
      } catch {
        // The two-minute processing lease allows a later retry even if release fails.
      }
    }
    return {
      ok: false,
      status: 502,
      body: { error: "Telegram callback processing failed" },
    };
  }
}
