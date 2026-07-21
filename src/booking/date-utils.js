const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const BOOKING_TIME_ZONE = "Europe/Moscow";

const RU_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const bookingDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BOOKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function createUtcDate(year, monthIndex, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function dateToKey(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(dateKey) {
  const match = typeof dateKey === "string" ? DATE_KEY_PATTERN.exec(dateKey) : null;
  if (!match) {
    throw new TypeError(`Expected a date key in YYYY-MM-DD format, received: ${String(dateKey)}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = createUtcDate(year, monthIndex, day);

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== monthIndex
    || date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${dateKey}`);
  }

  return date;
}

function normalizeMonthKey(monthKey) {
  if (typeof monthKey === "string" && MONTH_KEY_PATTERN.test(monthKey)) {
    return `${monthKey}-01`;
  }

  const date = parseDateKey(monthKey);
  return dateToKey(createUtcDate(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function isDateKey(value) {
  try {
    parseDateKey(value);
    return true;
  } catch {
    return false;
  }
}

export function todayKey(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("todayKey expects a valid Date instance");
  }

  const parts = bookingDateKeyFormatter.formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getBookingDateWindow(now = new Date()) {
  const minDate = todayKey(now);
  return {
    minDate,
    maxDate: addMonths(minDate, 12),
  };
}

export function millisecondsUntilNextBookingDay(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("millisecondsUntilNextBookingDay expects a valid Date instance");
  }

  const nextDateKey = addDays(todayKey(now), 1);
  const targetUtc = parseDateKey(nextDateKey).getTime();
  let lowerBound = targetUtc - 18 * 60 * 60 * 1000;
  let upperBound = targetUtc + 18 * 60 * 60 * 1000;

  // Find the first instant whose calendar date in Europe/Moscow is the next day.
  // The binary search avoids baking the current UTC offset into the timer logic.
  while (lowerBound < upperBound) {
    const candidate = Math.floor((lowerBound + upperBound) / 2);
    if (todayKey(new Date(candidate)) < nextDateKey) {
      lowerBound = candidate + 1;
    } else {
      upperBound = candidate;
    }
  }

  return Math.max(1, lowerBound - now.getTime());
}

export function compareDateKeys(left, right) {
  parseDateKey(left);
  parseDateKey(right);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function addDays(dateKey, amount) {
  if (!Number.isInteger(amount)) {
    throw new TypeError("addDays expects an integer amount");
  }

  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateToKey(date);
}

export function addMonths(dateKey, amount) {
  if (!Number.isInteger(amount)) {
    throw new TypeError("addMonths expects an integer amount");
  }

  const date = parseDateKey(dateKey);
  const sourceDay = date.getUTCDate();
  const targetFirst = createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + amount, 1);
  const lastTargetDay = createUtcDate(
    targetFirst.getUTCFullYear(),
    targetFirst.getUTCMonth() + 1,
    0,
  ).getUTCDate();

  targetFirst.setUTCDate(Math.min(sourceDay, lastTargetDay));
  return dateToKey(targetFirst);
}

export function startOfMonth(dateKey) {
  return normalizeMonthKey(dateKey);
}

export function reconcileBookingCalendarState({
  checkIn = "",
  checkOut = "",
  visibleMonth = "",
  focusedDate = "",
} = {}, {
  minDate,
  maxDate,
} = {}) {
  parseDateKey(minDate);
  parseDateKey(maxDate);
  if (compareDateKeys(minDate, maxDate) >= 0) {
    throw new RangeError("minDate must be before maxDate");
  }

  let nextCheckIn = isDateKey(checkIn) ? checkIn : "";
  let nextCheckOut = isDateKey(checkOut) ? checkOut : "";

  if (!nextCheckIn) {
    nextCheckOut = "";
  } else if (compareDateKeys(nextCheckIn, minDate) < 0) {
    if (nextCheckOut && compareDateKeys(nextCheckOut, minDate) > 0) {
      nextCheckIn = minDate;
    } else {
      nextCheckIn = "";
      nextCheckOut = "";
    }
  }

  // maxDate is a checkout-only boundary, never a valid new check-in.
  if (nextCheckIn && compareDateKeys(nextCheckIn, maxDate) >= 0) {
    nextCheckIn = "";
    nextCheckOut = "";
  }

  if (nextCheckOut && compareDateKeys(nextCheckOut, maxDate) > 0) {
    nextCheckOut = maxDate;
  }
  if (nextCheckOut && (!nextCheckIn || compareDateKeys(nextCheckOut, nextCheckIn) <= 0)) {
    nextCheckOut = "";
  }

  const minMonth = startOfMonth(minDate);
  const lastCheckInDate = addDays(maxDate, -1);
  const maxMonth = startOfMonth(lastCheckInDate);
  let nextVisibleMonth;

  try {
    nextVisibleMonth = startOfMonth(visibleMonth);
  } catch {
    nextVisibleMonth = startOfMonth(nextCheckIn || minDate);
  }

  if (compareDateKeys(nextVisibleMonth, minMonth) < 0) nextVisibleMonth = minMonth;
  if (compareDateKeys(nextVisibleMonth, maxMonth) > 0) nextVisibleMonth = maxMonth;

  let nextFocusedDate = isDateKey(focusedDate)
    ? focusedDate
    : (nextCheckIn || minDate);
  if (compareDateKeys(nextFocusedDate, minDate) < 0) nextFocusedDate = minDate;
  if (compareDateKeys(nextFocusedDate, lastCheckInDate) > 0) {
    nextFocusedDate = lastCheckInDate;
  }

  return {
    checkIn: nextCheckIn,
    checkOut: nextCheckOut,
    visibleMonth: nextVisibleMonth,
    focusedDate: nextFocusedDate,
  };
}

export function buildMonthGrid(monthKey, { minDate, maxDate } = {}) {
  const monthStart = normalizeMonthKey(monthKey);
  if (minDate) parseDateKey(minDate);
  if (maxDate) parseDateKey(maxDate);
  if (minDate && maxDate && compareDateKeys(minDate, maxDate) > 0) {
    throw new RangeError("minDate must not be after maxDate");
  }

  const firstOfMonth = parseDateKey(monthStart);
  const mondayFirstOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const gridStart = addDays(monthStart, -mondayFirstOffset);
  const monthPrefix = monthStart.slice(0, 7);

  return Array.from({ length: 42 }, (_, index) => {
    const key = addDays(gridStart, index);
    const date = parseDateKey(key);
    const isBeforeMin = Boolean(minDate && compareDateKeys(key, minDate) < 0);
    const isAfterMax = Boolean(maxDate && compareDateKeys(key, maxDate) > 0);
    const inMonth = key.startsWith(monthPrefix);

    return {
      key,
      day: date.getUTCDate(),
      inMonth,
      isBeforeMin,
      isAfterMax,
      disabled: !inMonth || isBeforeMin || isAfterMax,
    };
  });
}

export function nightsBetween(checkIn, checkOut) {
  const start = parseDateKey(checkIn);
  const end = parseDateKey(checkOut);
  return (end.getTime() - start.getTime()) / DAY_IN_MS;
}

export function bookingNightKeys(checkIn, checkOut) {
  parseDateKey(checkIn);
  parseDateKey(checkOut);

  if (compareDateKeys(checkIn, checkOut) >= 0) return [];

  const keys = [];
  for (let dateKey = checkIn; compareDateKeys(dateKey, checkOut) < 0; dateKey = addDays(dateKey, 1)) {
    keys.push(dateKey);
  }

  return keys;
}

export function areBookingNightsAvailable(checkIn, checkOut, isNightAvailable) {
  if (typeof isNightAvailable !== "function") {
    throw new TypeError("areBookingNightsAvailable expects an availability function");
  }

  const nightKeys = bookingNightKeys(checkIn, checkOut);
  return nightKeys.length > 0 && nightKeys.every((dateKey) => isNightAvailable(dateKey));
}

export function canSelectBookingDate(
  checkIn,
  checkOut,
  selectedDate,
  isNightAvailable,
  maximumCheckoutDate = "",
) {
  parseDateKey(selectedDate);
  if (typeof isNightAvailable !== "function") {
    throw new TypeError("canSelectBookingDate expects an availability function");
  }

  const start = isDateKey(checkIn) ? checkIn : "";
  const hasCompleteRange = start
    && isDateKey(checkOut)
    && compareDateKeys(checkOut, start) > 0;

  if (
    isDateKey(maximumCheckoutDate)
    && selectedDate === maximumCheckoutDate
    && (!start || compareDateKeys(selectedDate, start) <= 0)
  ) {
    return false;
  }

  if (!start) return Boolean(isNightAvailable(selectedDate));

  const extendsRange = compareDateKeys(selectedDate, start) > 0
    && (!hasCompleteRange || compareDateKeys(selectedDate, checkOut) > 0);

  if (extendsRange) {
    return areBookingNightsAvailable(start, selectedDate, isNightAvailable);
  }

  return Boolean(isNightAvailable(selectedDate));
}

export function updateBookingRange(checkIn, checkOut, selectedDate) {
  parseDateKey(selectedDate);

  const start = isDateKey(checkIn) ? checkIn : "";
  const hasCompleteRange = start
    && isDateKey(checkOut)
    && compareDateKeys(checkOut, start) > 0;

  if (!start) {
    return { checkIn: selectedDate, checkOut: "" };
  }

  if (!hasCompleteRange) {
    return compareDateKeys(selectedDate, start) > 0
      ? { checkIn: start, checkOut: selectedDate }
      : { checkIn: selectedDate, checkOut: "" };
  }

  if (compareDateKeys(selectedDate, checkOut) > 0) {
    return { checkIn: start, checkOut: selectedDate };
  }

  return { checkIn: selectedDate, checkOut: "" };
}

export function formatDateRu(dateKey) {
  return dateFormatter.format(parseDateKey(dateKey));
}

export function formatMonthRu(monthKey) {
  const date = parseDateKey(normalizeMonthKey(monthKey));
  return `${RU_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function weekdayIndexMondayFirst(dateKey) {
  return (parseDateKey(dateKey).getUTCDay() + 6) % 7;
}
