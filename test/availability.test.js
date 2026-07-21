import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryBookingRepository,
  createPostgresBookingRepository,
} from "../server/booking-database.js";
import {
  formatAvailability,
  processAvailabilityCheck,
  processAvailabilityRequest,
  validateAvailabilityRange,
} from "../server/availability.js";

const TODAY = "2026-07-21";

function anonymousRequest(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    requestKey: "21111111-1111-4111-8111-111111111111",
    metadataHash: "hash",
    stayId: "hotel-room",
    unitCount: 2,
    selectedUnitIds: [],
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    adults: 3,
    children: 0,
    capacity: 4,
    nights: 3,
    nightlyRate: 6_500,
    total: 39_000,
    ...overrides,
  };
}

test("availability range is ISO, bounded, and uses an exclusive `to`", () => {
  assert.deepEqual(validateAvailabilityRange({
    from: "2026-07-21",
    to: "2026-07-24",
  }, TODAY), {
    ok: true,
    from: "2026-07-21",
    to: "2026-07-24",
    days: 3,
  });
  assert.equal(validateAvailabilityRange({ from: "2026-07-20", to: "2026-07-22" }, TODAY).ok, false);
  assert.equal(validateAvailabilityRange({ from: "2026-07-21", to: "2027-07-22" }, TODAY).ok, false);
});

test("public calendar aggregates hotel inventory and keeps house units anonymous", () => {
  const result = formatAvailability("2026-08-01", "2026-08-03", [
    { date: "2026-08-01", unitId: "hotel-room-1", stayId: "hotel-room", available: false },
    { date: "2026-08-01", unitId: "hotel-room-2", stayId: "hotel-room", available: false },
    { date: "2026-08-02", unitId: "cottage", stayId: "cottage", available: false },
    { date: "2026-08-02", unitId: "hunter-house-1", stayId: "hunter-house", available: false },
  ]);

  assert.deepEqual(Object.keys(result.days), ["2026-08-01", "2026-08-02"]);
  assert.equal(result.days["2026-08-01"].hotelRoom.remaining, 4);
  assert.equal(result.days["2026-08-01"].hotelRoom.available, true);
  assert.equal(result.days["2026-08-02"].cottage.available, false);
  assert.equal(result.days["2026-08-02"].hunterHouses["hunter-house-1"].available, false);
  assert.equal(JSON.stringify(result).includes("requestId"), false);
});

test("Postgres date objects are normalized before calendar aggregation", async () => {
  const sql = async () => [{
    night_date: new Date("2027-06-10T00:00:00.000Z"),
    unit_id: "cottage",
    stay_id: "cottage",
    available: false,
  }];
  const repository = createPostgresBookingRepository(sql);

  const rows = await repository.listAvailability("2027-06-10", "2027-06-11");
  const calendar = formatAvailability("2027-06-10", "2027-06-11", rows);

  assert.equal(rows[0].date, "2027-06-10");
  assert.equal(calendar.days["2027-06-10"].cottage.available, false);
});

test("confirmed [check-in, check-out) allocation blocks nights but not the checkout boundary", async () => {
  const repository = createMemoryBookingRepository();
  await repository.createOrGetRequest(anonymousRequest());
  assert.equal((await repository.confirmRequest(
    "11111111-1111-4111-8111-111111111111",
    99,
  )).ok, true);

  const calendar = await processAvailabilityRequest({
    from: "2026-08-01",
    to: "2026-08-05",
  }, {}, { today: TODAY, repository });
  assert.equal(calendar.body.days["2026-08-01"].hotelRoom.remaining, 4);
  assert.equal(calendar.body.days["2026-08-03"].hotelRoom.remaining, 4);
  assert.equal(calendar.body.days["2026-08-04"].hotelRoom.remaining, 6);
});

test("range preflight accounts for requested hotel quantity and selected hunter houses", async () => {
  const repository = createMemoryBookingRepository();
  await repository.createOrGetRequest(anonymousRequest({ unitCount: 2 }));
  await repository.confirmRequest("11111111-1111-4111-8111-111111111111", 99);

  const hotel = await processAvailabilityCheck({
    stayId: "hotel-room",
    quantity: 5,
    checkIn: "2026-08-02",
    checkOut: "2026-08-06",
  }, {}, { today: TODAY, repository });
  const boundary = await processAvailabilityCheck({
    stayId: "hotel-room",
    quantity: 6,
    checkIn: "2026-08-04",
    checkOut: "2026-08-06",
  }, {}, { today: TODAY, repository });

  assert.equal(hotel.body.available, false);
  assert.equal(boundary.body.available, true);
  assert.equal(Object.hasOwn(hotel.body, "availableUnitIds"), false);
});
