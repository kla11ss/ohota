import { pathToFileURL } from "node:url";

import { persistEnvFile } from "./env-file.mjs";
import {
  createTelegramSetupClient,
  provisionTelegram,
} from "./telegram-provisioning.mjs";

function fail(message) {
  console.error(`Telegram setup failed: ${message}`);
  process.exitCode = 1;
}

export async function main(options = {}) {
  const environment = options.environment ?? process.env;
  const log = options.log ?? console.log;
  const callTelegram = options.callTelegram ?? createTelegramSetupClient(
    environment.TELEGRAM_BOT_TOKEN,
    { fetchImpl: options.fetchImpl ?? fetch },
  );
  const persist = options.persist ?? ((updates) => persistEnvFile(
    options.envFilePath ?? ".env",
    updates,
  ));

  const result = await provisionTelegram({
    environment,
    argumentsList: options.argumentsList ?? process.argv.slice(2),
    callTelegram,
    persist,
    randomBytesImpl: options.randomBytesImpl,
  });

  log("Telegram bot, forum, and required permissions verified.");
  log(`Topics ready: ${result.topicNames.join(", ")}.`);
  log("Local ignored configuration was updated atomically; secret values were not printed.");
  log(result.webhookConfigured
    ? "Telegram callback webhook registered and verified."
    : "Webhook skipped: rerun with --url=https://your-site.example after deployment.");
  return result;
}

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (directInvocation) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
