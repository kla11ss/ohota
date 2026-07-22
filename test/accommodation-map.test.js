import test from "node:test";
import assert from "node:assert/strict";

import { handleAccommodationMap } from "../api/accommodation-map.js";
import { handleAccommodationMapDraft } from "../api/admin-accommodation-map-draft.js";
import { handleAccommodationMapPublish } from "../api/admin-accommodation-map-publish.js";
import { handleAccommodationMapSession } from "../api/admin-accommodation-map-session.js";
import {
  createAccommodationEditorSessionCookie,
  hasAccommodationEditorSession,
  validateAccommodationMapPayload,
} from "../server/accommodation-map.js";
import { createMemoryBookingRepository } from "../server/booking-database.js";
import {
  createAccommodationMapDraft,
  getAccommodationMarker,
  getAccommodationMarkersForStay,
  validateAccommodationMap,
} from "../src/accommodation-map/config.js";

const ENVIRONMENT = {
  ACCOMMODATION_EDITOR_PASSWORD: "a private editor password",
  ACCOMMODATION_EDITOR_SESSION_SECRET: "editor-session-secret-that-is-long-enough-for-hmac-123",
};

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function request({
  method = "GET",
  body,
  cookie = "",
  origin = "https://example.test",
  url = "https://example.test/api/admin/accommodation-map/draft",
  ip = "203.0.113.181",
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      "x-forwarded-for": ip,
    },
  };
}

test("map configuration requires four known markers, prepared image paths, and normalized percentage coordinates", () => {
  const draft = createAccommodationMapDraft();
  draft.markers[0].x = -7.198;
  draft.markers[1].y = 122.992;
  const result = validateAccommodationMap(draft);

  assert.equal(result.ok, true);
  assert.equal(result.value.markers[0].x, 0);
  assert.equal(result.value.markers[1].y, 100);
  assert.deepEqual(
    getAccommodationMarkersForStay(result.value, "hunter-house").map((marker) => marker.id),
    ["hunter-house-1", "hunter-house-2"],
  );
  assert.deepEqual(getAccommodationMarker(result.value, "hunter-house-2").unitIds, ["hunter-house-2"]);

  const invalid = structuredClone(draft);
  invalid.markers.pop();
  invalid.baseImageUrl = "https://untrusted.example/plan.webp";
  assert.equal(validateAccommodationMap(invalid).ok, false);
  assert.equal(validateAccommodationMapPayload({ config: invalid }).ok, false);
});

test("public map API never exposes a draft before it is published", async () => {
  const repository = createMemoryBookingRepository();
  const draft = validateAccommodationMap(createAccommodationMapDraft()).value;
  await repository.saveAccommodationMapDraft(draft);

  const before = responseRecorder();
  await handleAccommodationMap(request({
    url: "https://example.test/api/accommodation-map",
    origin: "",
  }), before, { environment: ENVIRONMENT, repository });
  assert.equal(before.statusCode, 200);
  assert.deepEqual(before.body, { published: false, config: null });

  await repository.publishAccommodationMap();
  const after = responseRecorder();
  await handleAccommodationMap(request({
    url: "https://example.test/api/accommodation-map",
    origin: "",
  }), after, { environment: ENVIRONMENT, repository });
  assert.equal(after.statusCode, 200);
  assert.equal(after.body.published, true);
  assert.equal(after.body.config.markers.length, 4);
});

test("editor login, session, origin gate, draft save, and atomic publish are protected", async () => {
  const repository = createMemoryBookingRepository();
  const denied = responseRecorder();
  await handleAccommodationMapDraft(request(), denied, { environment: ENVIRONMENT, repository });
  assert.equal(denied.statusCode, 401);

  const crossOrigin = responseRecorder();
  await handleAccommodationMapSession(request({
    method: "POST",
    body: { password: ENVIRONMENT.ACCOMMODATION_EDITOR_PASSWORD },
    origin: "https://other.example",
    ip: "203.0.113.182",
  }), crossOrigin, { environment: ENVIRONMENT });
  assert.equal(crossOrigin.statusCode, 403);

  const wrongPassword = responseRecorder();
  await handleAccommodationMapSession(request({
    method: "POST",
    body: { password: "wrong password" },
    ip: "203.0.113.183",
  }), wrongPassword, { environment: ENVIRONMENT });
  assert.equal(wrongPassword.statusCode, 401);

  const login = responseRecorder();
  await handleAccommodationMapSession(request({
    method: "POST",
    body: { password: ENVIRONMENT.ACCOMMODATION_EDITOR_PASSWORD },
    ip: "203.0.113.184",
  }), login, { environment: ENVIRONMENT });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Strict/);
  const cookie = login.headers["Set-Cookie"].split(";")[0];

  const draft = createAccommodationMapDraft();
  const deniedWrite = responseRecorder();
  await handleAccommodationMapDraft(request({
    method: "PUT",
    body: { config: draft },
    cookie,
    origin: "https://other.example",
  }), deniedWrite, { environment: ENVIRONMENT, repository });
  assert.equal(deniedWrite.statusCode, 403);

  const saved = responseRecorder();
  await handleAccommodationMapDraft(request({ method: "PUT", body: { config: draft }, cookie }), saved, {
    environment: ENVIRONMENT,
    repository,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal((await repository.getPublishedAccommodationMap()), null);

  const published = responseRecorder();
  await handleAccommodationMapPublish(request({
    method: "POST",
    body: {},
    cookie,
    url: "https://example.test/api/admin/accommodation-map/publish",
  }), published, { environment: ENVIRONMENT, repository });
  assert.equal(published.statusCode, 200);
  assert.equal(published.body.published, true);
});

test("editor session is signed and expires without exposing the editor password", () => {
  const now = Date.UTC(2026, 6, 22, 12);
  const cookie = createAccommodationEditorSessionCookie(ENVIRONMENT, now).split(";")[0];
  const signedRequest = request({ cookie, origin: "" });
  assert.equal(hasAccommodationEditorSession(signedRequest, ENVIRONMENT, now + 1), true);
  assert.equal(hasAccommodationEditorSession(signedRequest, ENVIRONMENT, now + 9 * 60 * 60 * 1_000), false);
  assert.equal(cookie.includes(ENVIRONMENT.ACCOMMODATION_EDITOR_PASSWORD), false);
});
