import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  areBookingNightsAvailable,
  bookingNightKeys,
  buildMonthGrid,
  canSelectBookingDate,
  compareDateKeys,
  formatDateRu,
  getBookingDateWindow,
  millisecondsUntilNextBookingDay,
  nightsBetween,
  reconcileBookingCalendarState,
  startOfMonth,
  todayKey,
  updateBookingRange,
} from "./date-utils.js";

test("todayKey uses the Europe/Moscow booking date", () => {
  assert.equal(todayKey(new Date("2026-07-20T20:59:59.999Z")), "2026-07-20");
  assert.equal(todayKey(new Date("2026-07-20T21:00:00.000Z")), "2026-07-21");
  assert.equal(todayKey(new Date("2026-07-21T22:30:00.000Z")), "2026-07-22");
});

test("booking window rolls over exactly at Europe/Moscow midnight", () => {
  const beforeMidnight = new Date("2026-07-20T20:59:59.999Z");
  assert.deepEqual(getBookingDateWindow(beforeMidnight), {
    minDate: "2026-07-20",
    maxDate: "2027-07-20",
  });
  assert.equal(millisecondsUntilNextBookingDay(beforeMidnight), 1);

  const atMidnight = new Date("2026-07-20T21:00:00.000Z");
  assert.deepEqual(getBookingDateWindow(atMidnight), {
    minDate: "2026-07-21",
    maxDate: "2027-07-21",
  });
  assert.equal(millisecondsUntilNextBookingDay(atMidnight), 24 * 60 * 60 * 1000);
});

test("booking window keeps month-clamping semantics across a leap day", () => {
  assert.deepEqual(getBookingDateWindow(new Date("2024-02-28T21:00:00.000Z")), {
    minDate: "2024-02-29",
    maxDate: "2025-02-28",
  });
});

test("calendar state keeps the valid remainder of a stay after midnight rollover", () => {
  assert.deepEqual(reconcileBookingCalendarState({
    checkIn: "2026-07-31",
    checkOut: "2026-08-03",
    visibleMonth: "2026-07-01",
    focusedDate: "2026-07-31",
  }, {
    minDate: "2026-08-01",
    maxDate: "2027-08-01",
  }), {
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
    visibleMonth: "2026-08-01",
    focusedDate: "2026-08-01",
  });
});

test("calendar state clears an elapsed range and clamps the checkout-only horizon", () => {
  assert.deepEqual(reconcileBookingCalendarState({
    checkIn: "2026-07-31",
    checkOut: "2026-08-01",
    visibleMonth: "2026-07-01",
    focusedDate: "2026-07-31",
  }, {
    minDate: "2026-08-01",
    maxDate: "2027-08-01",
  }), {
    checkIn: "",
    checkOut: "",
    visibleMonth: "2026-08-01",
    focusedDate: "2026-08-01",
  });

  assert.deepEqual(reconcileBookingCalendarState({
    checkIn: "2027-07-31",
    checkOut: "2027-08-04",
    visibleMonth: "2027-09-01",
    focusedDate: "2027-08-04",
  }, {
    minDate: "2026-08-01",
    maxDate: "2027-08-01",
  }), {
    checkIn: "2027-07-31",
    checkOut: "2027-08-01",
    visibleMonth: "2027-07-01",
    focusedDate: "2027-07-31",
  });
});

test("date-only arithmetic crosses month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(startOfMonth("2026-07-21"), "2026-07-01");
});

test("comparison rejects malformed dates and compares valid keys", () => {
  assert.equal(compareDateKeys("2026-07-21", "2026-07-21"), 0);
  assert.equal(compareDateKeys("2026-07-20", "2026-07-21"), -1);
  assert.equal(compareDateKeys("2026-07-22", "2026-07-21"), 1);
  assert.throws(() => compareDateKeys("2026-02-30", "2026-03-01"), RangeError);
});

test("buildMonthGrid is Monday-first and always returns six weeks", () => {
  const days = buildMonthGrid("2026-08", {
    minDate: "2026-08-03",
    maxDate: "2026-08-30",
  });

  assert.equal(days.length, 42);
  assert.equal(days[0].key, "2026-07-27");
  assert.equal(days[5].key, "2026-08-01");
  assert.equal(days[5].inMonth, true);
  assert.equal(days[5].isBeforeMin, true);
  assert.equal(days[5].disabled, true);
  assert.equal(days[7].key, "2026-08-03");
  assert.equal(days[7].disabled, false);
  assert.equal(days[34].key, "2026-08-30");
  assert.equal(days[34].disabled, false);
  assert.equal(days[35].key, "2026-08-31");
  assert.equal(days[35].isAfterMax, true);
});

test("nightsBetween stays exact across DST and leap days", () => {
  assert.equal(nightsBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(nightsBetween("2024-02-28", "2024-03-01"), 2);
  assert.equal(nightsBetween("2027-01-01", "2026-12-31"), -1);
});

test("booking nights include check-in and exclude check-out", () => {
  assert.deepEqual(bookingNightKeys("2026-08-30", "2026-09-03"), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
  ]);
  assert.deepEqual(bookingNightKeys("2026-09-03", "2026-09-03"), []);
});

test("range availability checks every night but not the checkout date", () => {
  const occupied = new Set(["2026-08-24"]);
  const isAvailable = (dateKey) => !occupied.has(dateKey);

  assert.equal(areBookingNightsAvailable("2026-08-21", "2026-08-24", isAvailable), true);
  assert.equal(areBookingNightsAvailable("2026-08-21", "2026-08-25", isAvailable), false);
});

test("an occupied date remains selectable as a checkout boundary", () => {
  const occupied = new Set(["2026-08-24"]);
  const isAvailable = (dateKey) => !occupied.has(dateKey);

  assert.equal(canSelectBookingDate("2026-08-21", "", "2026-08-24", isAvailable), true);
  assert.equal(canSelectBookingDate("", "", "2026-08-24", isAvailable), false);
  assert.equal(canSelectBookingDate("2026-08-21", "2026-08-24", "2026-08-25", isAvailable), false);
});

test("the maximum date is checkout-only", () => {
  const isAvailable = () => true;

  assert.equal(canSelectBookingDate("", "", "2027-07-21", isAvailable, "2027-07-21"), false);
  assert.equal(canSelectBookingDate("2027-07-18", "", "2027-07-21", isAvailable, "2027-07-21"), true);
});

test("formatDateRu returns a Russian long date", () => {
  assert.match(formatDateRu("2026-07-21"), /^21 июля 2026/);
});

test("booking range grows when guests click successive later dates", () => {
  assert.deepEqual(updateBookingRange("", "", "2026-07-22"), {
    checkIn: "2026-07-22",
    checkOut: "",
  });
  assert.deepEqual(updateBookingRange("2026-07-22", "", "2026-07-23"), {
    checkIn: "2026-07-22",
    checkOut: "2026-07-23",
  });
  assert.deepEqual(updateBookingRange("2026-07-22", "2026-07-23", "2026-07-27"), {
    checkIn: "2026-07-22",
    checkOut: "2026-07-27",
  });
});

test("booking range restarts when a selected or earlier date is clicked", () => {
  assert.deepEqual(updateBookingRange("2026-07-22", "2026-07-27", "2026-07-24"), {
    checkIn: "2026-07-24",
    checkOut: "",
  });
  assert.deepEqual(updateBookingRange("2026-07-22", "2026-07-27", "2026-07-20"), {
    checkIn: "2026-07-20",
    checkOut: "",
  });
});
