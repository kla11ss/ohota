import test from "node:test";
import assert from "node:assert/strict";

import {
  HUNTER_HOUSE_PRICE_PER_NIGHT,
  calculateBookingTotal,
  formatNightlyRate,
  formatRubles,
  getSelectionCapacity,
  getStayById,
  stayCatalog,
} from "../src/booking/catalog.js";

test("catalog keeps canonical rates and accommodation limits", () => {
  const room = getStayById("hotel-room");
  const cottage = getStayById("cottage");
  const hunterHouse = getStayById("hunter-house");

  assert.equal(stayCatalog.length, 3);
  assert.equal(room.pricePerNight, 6_500);
  assert.equal(room.capacityPerUnit, 2);
  assert.equal(room.maxUnits, 6);
  assert.equal(cottage.pricePerNight, 45_000);
  assert.equal(cottage.capacityPerUnit, 15);
  assert.equal(hunterHouse.pricePerNight, HUNTER_HOUSE_PRICE_PER_NIGHT);
  assert.equal(hunterHouse.pricePerNight, null);
  assert.equal(hunterHouse.capacityPerUnit, 6);
  assert.deepEqual(hunterHouse.unitOptions.map((unit) => unit.id), [
    "hunter-house-1",
    "hunter-house-2",
  ]);
});

test("capacity follows selected room quantity or hunter-house units", () => {
  assert.equal(getSelectionCapacity("hotel-room", { quantity: 3 }), 6);
  assert.equal(getSelectionCapacity("cottage", { quantity: 1 }), 15);
  assert.equal(getSelectionCapacity("hunter-house", { unitIds: ["hunter-house-2"] }), 6);
  assert.equal(getSelectionCapacity("hunter-house", {
    unitIds: ["hunter-house-1", "hunter-house-2"],
  }), 12);
});

test("known totals use nightly rate, nights, and selected unit count", () => {
  assert.equal(calculateBookingTotal("hotel-room", 3, { quantity: 2 }), 39_000);
  assert.equal(calculateBookingTotal("cottage", 2, { quantity: 1 }), 90_000);
  assert.equal(calculateBookingTotal("hunter-house", 4, {
    unitIds: ["hunter-house-1", "hunter-house-2"],
  }), null);
});

test("price formatters expose the temporary hunter-house rate as X", () => {
  assert.equal(formatRubles(6_500).replace(/\s/g, " "), "6 500 ₽");
  assert.equal(formatNightlyRate("hotel-room").replace(/\s/g, " "), "6 500 ₽/сутки");
  assert.equal(formatNightlyRate("hunter-house"), "X ₽/сутки");
});
