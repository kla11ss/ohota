function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) {
          result[key] = canonicalizeJson(value[key]);
        }
        return result;
      }, {});
  }

  return value;
}

export function fingerprintBookingPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("fingerprintBookingPayload expects a payload object");
  }

  const { requestKey: _requestKey, ...requestBody } = payload;
  return JSON.stringify(canonicalizeJson(requestBody));
}

export function resolveBookingRequestKey({
  currentRequestKey,
  failedPayloadFingerprint,
  payload,
  createRequestKey,
}) {
  if (typeof currentRequestKey !== "string" || !currentRequestKey) {
    throw new TypeError("currentRequestKey must be a non-empty string");
  }
  if (typeof createRequestKey !== "function") {
    throw new TypeError("createRequestKey must be a function");
  }

  const payloadFingerprint = fingerprintBookingPayload(payload);
  const shouldRotate = Boolean(
    failedPayloadFingerprint
    && failedPayloadFingerprint !== payloadFingerprint,
  );

  return {
    requestKey: shouldRotate ? createRequestKey() : currentRequestKey,
    payloadFingerprint,
    rotated: shouldRotate,
  };
}
