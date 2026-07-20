import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { processTripRequest } from "./server/trip-request.js";

const maxRequestBodySize = 12 * 1024;

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxRequestBodySize) {
      throw new Error("REQUEST_TOO_LARGE");
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function tripRequestApi(environment) {
  const requestTimes = new Map();

  return {
    name: "trip-request-api",
    configureServer(server) {
      server.middlewares.use("/api/trip-request", async (request, response, next) => {
        if (request.method !== "POST") {
          return next();
        }

        const address = request.socket.remoteAddress ?? "unknown";
        const now = Date.now();
        const lastRequestAt = requestTimes.get(address) ?? 0;

        if (now - lastRequestAt < 20_000) {
          return jsonResponse(response, 429, {
            error: "Подождите немного перед повторной отправкой.",
          });
        }

        try {
          const payload = await readJsonBody(request);
          const result = await processTripRequest(payload, environment);

          if (result.ok) requestTimes.set(address, now);
          return jsonResponse(response, result.status, result.body);
        } catch (error) {
          const message = error.message === "REQUEST_TOO_LARGE"
            ? "Слишком большой объём данных."
            : "Не удалось обработать запрос. Попробуйте ещё раз.";
          return jsonResponse(response, 400, { error: message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");

  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react(), tripRequestApi(environment)],
  };
});
