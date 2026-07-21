import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  processAvailabilityCheck,
  processAvailabilityRequest,
} from "./server/availability.js";
import { handleBookingRequest } from "./api/booking-request.js";
import { createMemoryBookingRepository } from "./server/booking-database.js";
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

function bookingRequestApi(environment, repository) {
  return {
    name: "booking-request-api",
    configureServer(server) {
      server.middlewares.use("/api/booking-request", async (request, response, next) => {
        if (request.method !== "POST") {
          return next();
        }
        return handleBookingRequest(request, response, { environment, repository });
      });
    },
  };
}

function bookingAvailabilityApi(environment, repository) {
  return {
    name: "booking-availability-api",
    configureServer(server) {
      server.middlewares.use("/api/availability/check", async (request, response, next) => {
        if (request.method !== "POST") return next();

        try {
          const payload = await readJsonBody(request);
          const result = await processAvailabilityCheck(payload, environment, { repository });
          return jsonResponse(response, result.status, result.body);
        } catch (error) {
          const message = error.message === "REQUEST_TOO_LARGE"
            ? "Слишком большой объём данных."
            : "Не удалось обработать запрос. Попробуйте ещё раз.";
          return jsonResponse(response, error.message === "REQUEST_TOO_LARGE" ? 413 : 400, { error: message });
        }
      });

      server.middlewares.use("/api/availability", async (request, response, next) => {
        if (request.method !== "GET") return next();

        const requestUrl = new URL(request.url ?? "", "http://localhost");
        const query = Object.fromEntries(requestUrl.searchParams.entries());
        const result = await processAvailabilityRequest(query, environment, { repository });
        return jsonResponse(response, result.status, result.body);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const bookingRepository = createMemoryBookingRepository();

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
    plugins: [
      react(),
      tripRequestApi(environment),
      bookingRequestApi(environment, bookingRepository),
      bookingAvailabilityApi(environment, bookingRepository),
    ],
  };
});
