import { handleTelegramWebhook } from "../../api/telegram-webhook.js";
import { createNetlifyFunction } from "../adapter.mjs";

export default createNetlifyFunction(handleTelegramWebhook);
