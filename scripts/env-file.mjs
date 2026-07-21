import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function serializeEnvValue(value) {
  const normalized = String(value);
  if (/\r|\n/.test(normalized)) throw new Error("Environment values cannot contain newlines");
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

export function mergeEnvText(source, updates) {
  const entries = Object.entries(updates);
  for (const [key] of entries) {
    if (!ENV_KEY_PATTERN.test(key)) throw new Error(`Invalid environment key: ${key}`);
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = source.endsWith("\n");
  const lines = source ? source.split(/\r?\n/) : [];
  if (hadTrailingNewline) lines.pop();
  const pending = new Map(entries.map(([key, value]) => [key, serializeEnvValue(value)]));
  const written = new Set();
  const result = [];

  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (!key || !pending.has(key)) {
      result.push(line);
      continue;
    }
    if (written.has(key)) continue;
    result.push(`${key}=${pending.get(key)}`);
    written.add(key);
  }

  for (const [key, value] of pending) {
    if (!written.has(key)) result.push(`${key}=${value}`);
  }

  return `${result.join(newline)}${result.length ? newline : ""}`;
}

export async function persistEnvFile(filePath, updates, options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  let source = "";
  try {
    source = await fileSystem.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const contents = mergeEnvText(source, updates);
  const suffix = randomBytes(8).toString("hex");
  // For `.env` this produces `.env.tmp-*`, which is covered by the repository's
  // `.env.*` ignore rule even if the process stops before the atomic rename.
  const temporaryPath = path.join(directory, `${basename}.tmp-${process.pid}-${suffix}`);
  let handle = null;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, absolutePath);
    try {
      await fileSystem.chmod(absolutePath, 0o600);
    } catch {
      // Windows and some mounted filesystems may not implement POSIX modes.
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
