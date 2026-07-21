function trustedClientIp(context) {
  const value = typeof context?.ip === "string" ? context.ip.trim() : "";
  return value && value.length <= 100 ? value : null;
}

function createNodeRequest(request, context) {
  const headers = new Headers(request.headers);
  const clientIp = trustedClientIp(context);

  // Forwarding headers are client-controlled at this adapter boundary. Only
  // Netlify's request context is trusted for the server-side limiter key.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }

  return {
    method: request.method,
    headers,
    url: request.url,
    socket: { remoteAddress: clientIp ?? "unknown" },
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;

      const reader = request.body.getReader();
      let finished = false;
      try {
        while (!finished) {
          const chunk = await reader.read();
          finished = chunk.done;
          if (!finished) yield Buffer.from(chunk.value);
        }
      } finally {
        if (!finished) {
          try {
            await reader.cancel();
          } catch {
            // The owning API handler already has the authoritative error.
          }
        }
        reader.releaseLock();
      }
    },
  };
}

function createNodeResponse() {
  const headers = new Headers();
  let body = null;

  const response = {
    statusCode: 200,

    setHeader(name, value) {
      headers.delete(name);
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, String(item));
      } else {
        headers.set(name, String(value));
      }
      return response;
    },

    getHeader(name) {
      return headers.get(name);
    },

    status(code) {
      response.statusCode = code;
      return response;
    },

    json(value) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json; charset=utf-8");
      }
      body = JSON.stringify(value);
      return response;
    },

    end(value = null) {
      body = value;
      return response;
    },

    toWebResponse() {
      headers.set("cache-control", "no-store");
      return new Response(body, {
        status: response.statusCode,
        headers,
      });
    },
  };

  return response;
}

function internalErrorResponse() {
  return new Response(JSON.stringify({ error: "Internal server error" }), {
    status: 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function createNetlifyFunction(nodeHandler) {
  return async function netlifyFunction(request, context = {}) {
    const nodeRequest = createNodeRequest(request, context);
    const nodeResponse = createNodeResponse();

    try {
      const returned = await nodeHandler(nodeRequest, nodeResponse);
      if (returned instanceof Response) {
        const headers = new Headers(returned.headers);
        headers.set("cache-control", "no-store");
        return new Response(returned.body, {
          status: returned.status,
          statusText: returned.statusText,
          headers,
        });
      }
      return nodeResponse.toWebResponse();
    } catch {
      return internalErrorResponse();
    }
  };
}
