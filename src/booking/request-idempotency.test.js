import test from "node:test";
import assert from "node:assert/strict";

import {
  fingerprintBookingPayload,
  resolveBookingRequestKey,
} from "./request-idempotency.js";

const BASE_PAYLOAD = {
  requestKey: "11111111-1111-4111-8111-111111111111",
  stayId: "hotel-room",
  quantity: 1,
  checkIn: "2026-08-01",
  checkOut: "2026-08-05",
  adults: 2,
  children: 0,
  phone: "+7 900 000-00-00",
  name: "Иван",
  comment: "",
  website: "",
};

test("payload fingerprint ignores requestKey and object key order", () => {
  const reorderedPayload = Object.fromEntries(
    Object.entries({
      ...BASE_PAYLOAD,
      requestKey: "22222222-2222-4222-8222-222222222222",
    }).reverse(),
  );

  assert.equal(
    fingerprintBookingPayload(BASE_PAYLOAD),
    fingerprintBookingPayload(reorderedPayload),
  );
});

test("an unchanged retry keeps the failed attempt requestKey", () => {
  const failedPayloadFingerprint = fingerprintBookingPayload(BASE_PAYLOAD);
  let generatedKeys = 0;
  const result = resolveBookingRequestKey({
    currentRequestKey: BASE_PAYLOAD.requestKey,
    failedPayloadFingerprint,
    payload: { ...BASE_PAYLOAD },
    createRequestKey: () => {
      generatedKeys += 1;
      return "33333333-3333-4333-8333-333333333333";
    },
  });

  assert.equal(result.requestKey, BASE_PAYLOAD.requestKey);
  assert.equal(result.rotated, false);
  assert.equal(generatedKeys, 0);
});

test("a corrected contact field after failure rotates requestKey", () => {
  const failedPayloadFingerprint = fingerprintBookingPayload(BASE_PAYLOAD);
  const result = resolveBookingRequestKey({
    currentRequestKey: BASE_PAYLOAD.requestKey,
    failedPayloadFingerprint,
    payload: { ...BASE_PAYLOAD, phone: "+7 911 111-11-11" },
    createRequestKey: () => "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(result.requestKey, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.rotated, true);
});

test("any changed booking selection after failure rotates requestKey", () => {
  const housePayload = {
    ...BASE_PAYLOAD,
    stayId: "hunter-house",
    quantity: undefined,
    unitIds: ["hunter-house-1"],
  };
  const failedPayloadFingerprint = fingerprintBookingPayload(housePayload);
  const result = resolveBookingRequestKey({
    currentRequestKey: BASE_PAYLOAD.requestKey,
    failedPayloadFingerprint,
    payload: {
      ...housePayload,
      unitIds: ["hunter-house-1", "hunter-house-2"],
    },
    createRequestKey: () => "44444444-4444-4444-8444-444444444444",
  });

  assert.equal(result.requestKey, "44444444-4444-4444-8444-444444444444");
  assert.equal(result.rotated, true);
});
