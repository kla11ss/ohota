import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import {
  addDays,
  addMonths,
  canSelectBookingDate,
  buildMonthGrid,
  compareDateKeys,
  formatDateRu,
  formatMonthRu,
  getBookingDateWindow,
  isDateKey,
  millisecondsUntilNextBookingDay,
  nightsBetween,
  reconcileBookingCalendarState,
  startOfMonth,
  updateBookingRange,
  weekdayIndexMondayFirst,
} from "../booking/date-utils.js";

const WEEKDAYS = [
  ["Пн", "Понедельник"],
  ["Вт", "Вторник"],
  ["Ср", "Среда"],
  ["Чт", "Четверг"],
  ["Пт", "Пятница"],
  ["Сб", "Суббота"],
  ["Вс", "Воскресенье"],
];

const WEEKDAYS_ARIA = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];

function clampDateKey(dateKey, minDate, maxDate) {
  if (compareDateKeys(dateKey, minDate) < 0) return minDate;
  if (compareDateKeys(dateKey, maxDate) > 0) return maxDate;
  return dateKey;
}

function pluralizeNights(value) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${value} ночей`;
  if (mod10 === 1) return `${value} ночь`;
  if (mod10 >= 2 && mod10 <= 4) return `${value} ночи`;
  return `${value} ночей`;
}

function chunkWeekRows(days) {
  return Array.from({ length: 6 }, (_, rowIndex) => days.slice(rowIndex * 7, rowIndex * 7 + 7));
}

export function getBookingDayAvailability(dayRecord, {
  stayId,
  quantity = 1,
  unitIds = [],
} = {}) {
  if (!dayRecord || typeof dayRecord !== "object") {
    return { known: false, available: true, remainingUnits: null };
  }

  if (stayId === "hotel-room") {
    const remaining = dayRecord.hotelRoom?.remaining;
    const known = Number.isInteger(remaining) && typeof dayRecord.hotelRoom?.available === "boolean";
    return {
      known,
      available: !known || (dayRecord.hotelRoom.available && remaining >= quantity),
      remainingUnits: known ? Math.max(0, remaining) : null,
    };
  }

  if (stayId === "cottage") {
    const available = dayRecord.cottage?.available;
    return {
      known: typeof available === "boolean",
      available: typeof available !== "boolean" || available,
      remainingUnits: typeof available === "boolean" ? Number(available) : null,
    };
  }

  if (stayId === "hunter-house") {
    const uniqueUnitIds = [...new Set(unitIds)];
    const unitStates = uniqueUnitIds.map((unitId) => dayRecord.hunterHouses?.[unitId]?.available);
    const known = unitStates.length > 0 && unitStates.every((available) => typeof available === "boolean");
    return {
      known,
      available: !known || unitStates.every(Boolean),
      remainingUnits: known ? unitStates.filter(Boolean).length : null,
    };
  }

  return { known: false, available: true, remainingUnits: null };
}

export function BookingCalendar({
  checkIn = "",
  checkOut = "",
  onChange,
  priceLabel = "",
  unknownPrice = false,
  stayId = "hotel-room",
  quantity = 1,
  unitIds = [],
  availabilityDays = {},
  availabilityStatus = "idle",
  availabilityError = "",
  onRetryAvailability,
  onVisibleRangeChange,
}) {
  const [dateWindow, setDateWindow] = useState(getBookingDateWindow);
  const { minDate, maxDate } = dateWindow;
  const minMonth = useMemo(() => startOfMonth(minDate), [minDate]);
  const maxMonth = useMemo(() => startOfMonth(addDays(maxDate, -1)), [maxDate]);
  const validInitialDate = isDateKey(checkIn)
    && compareDateKeys(checkIn, minDate) >= 0
    && compareDateKeys(checkIn, maxDate) <= 0
    ? checkIn
    : minDate;
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(validInitialDate));
  const [focusedDate, setFocusedDate] = useState(validInitialDate);
  const dateButtonRefs = useRef(new Map());
  const shouldRestoreDayFocus = useRef(false);
  const rolloverFocusTargetRef = useRef("");
  const previousDateWindowRef = useRef("");
  const calendarRef = useRef(null);
  const instructionId = useId();
  const secondMonth = useMemo(() => addMonths(visibleMonth, 1), [visibleMonth]);
  const monthKeys = useMemo(() => [visibleMonth, secondMonth], [visibleMonth, secondMonth]);
  const monthGrids = useMemo(
    () => monthKeys.map((monthKey) => buildMonthGrid(monthKey, { minDate, maxDate })),
    [maxDate, minDate, monthKeys],
  );

  const unitIdsKey = unitIds.join("|");
  const requestedUnitIds = useMemo(
    () => unitIdsKey ? unitIdsKey.split("|") : [],
    [unitIdsKey],
  );
  const selectionStart = isDateKey(checkIn) ? checkIn : "";
  const selectionEnd = isDateKey(checkOut) ? checkOut : "";
  const getDateAvailability = useCallback(
    (dateKey) => getBookingDayAvailability(availabilityDays[dateKey], {
      stayId,
      quantity,
      unitIds: requestedUnitIds,
    }),
    [availabilityDays, quantity, requestedUnitIds, stayId],
  );
  const isNightAvailable = useCallback(
    (dateKey) => getDateAvailability(dateKey).available,
    [getDateAvailability],
  );
  const canChooseDate = useCallback(
    (dateKey) => canSelectBookingDate(
      selectionStart,
      selectionEnd,
      dateKey,
      isNightAvailable,
      maxDate,
    ),
    [isNightAvailable, maxDate, selectionEnd, selectionStart],
  );

  useEffect(() => {
    let timeoutId;
    let disposed = false;

    const syncBookingWindow = () => {
      if (disposed) return;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);

      const now = new Date();
      const nextWindow = getBookingDateWindow(now);
      setDateWindow((currentWindow) => (
        currentWindow.minDate === nextWindow.minDate
        && currentWindow.maxDate === nextWindow.maxDate
          ? currentWindow
          : nextWindow
      ));

      timeoutId = window.setTimeout(
        syncBookingWindow,
        millisecondsUntilNextBookingDay(now),
      );
    };
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") syncBookingWindow();
    };

    syncBookingWindow();
    window.addEventListener("focus", syncBookingWindow);
    document.addEventListener("visibilitychange", syncWhenVisible);

    return () => {
      disposed = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", syncBookingWindow);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    const windowKey = `${minDate}|${maxDate}`;
    if (previousDateWindowRef.current === windowKey) return;
    previousDateWindowRef.current = windowKey;

    const nextState = reconcileBookingCalendarState({
      checkIn: selectionStart,
      checkOut: selectionEnd,
      visibleMonth,
      focusedDate,
    }, { minDate, maxDate });

    if (calendarRef.current?.contains(document.activeElement)) {
      rolloverFocusTargetRef.current = nextState.focusedDate;
    }
    setVisibleMonth((current) => (
      current === nextState.visibleMonth ? current : nextState.visibleMonth
    ));
    setFocusedDate((current) => (
      current === nextState.focusedDate ? current : nextState.focusedDate
    ));

    if (nextState.checkIn !== selectionStart || nextState.checkOut !== selectionEnd) {
      onChange?.({ checkIn: nextState.checkIn, checkOut: nextState.checkOut });
    }
  }, [
    focusedDate,
    maxDate,
    minDate,
    onChange,
    selectionEnd,
    selectionStart,
    visibleMonth,
  ]);

  useEffect(() => {
    const visibleEndExclusive = addMonths(visibleMonth, 2);
    onVisibleRangeChange?.({
      from: compareDateKeys(visibleMonth, minDate) < 0 ? minDate : visibleMonth,
      to: compareDateKeys(visibleEndExclusive, maxDate) > 0
        ? maxDate
        : visibleEndExclusive,
    });
  }, [maxDate, minDate, onVisibleRangeChange, visibleMonth]);

  useEffect(() => {
    if (!shouldRestoreDayFocus.current) return;
    shouldRestoreDayFocus.current = false;
    dateButtonRefs.current.get(focusedDate)?.focus();
  }, [focusedDate, visibleMonth]);

  useEffect(() => {
    if (canChooseDate(focusedDate)) return;

    const nextFocusableDay = monthGrids
      .flat()
      .find((day) => !day.disabled && canChooseDate(day.key));
    if (nextFocusableDay) {
      if (rolloverFocusTargetRef.current) {
        rolloverFocusTargetRef.current = nextFocusableDay.key;
      }
      setFocusedDate(nextFocusableDay.key);
    }
  }, [canChooseDate, focusedDate, monthGrids]);

  useEffect(() => {
    const targetDate = rolloverFocusTargetRef.current;
    if (!targetDate || targetDate !== focusedDate || !canChooseDate(focusedDate)) return;

    rolloverFocusTargetRef.current = "";
    dateButtonRefs.current.get(focusedDate)?.focus();
  }, [canChooseDate, focusedDate, visibleMonth]);

  const canGoPrevious = compareDateKeys(visibleMonth, minMonth) > 0;
  const canGoNext = compareDateKeys(visibleMonth, maxMonth) < 0;
  const visiblePrice = priceLabel || (unknownPrice ? "По запросу" : "Цена уточняется");
  const ariaPrice = unknownPrice || !priceLabel
    ? "стоимость за сутки уточняется"
    : `${priceLabel} за сутки`;

  let selectionInstruction = "Выберите дату заезда.";
  if (selectionStart && !selectionEnd) {
    selectionInstruction = `Заезд ${formatDateRu(selectionStart)}. Выберите дату выезда.`;
  } else if (selectionStart && selectionEnd) {
    selectionInstruction = `Выбрано: с ${formatDateRu(selectionStart)} по ${formatDateRu(selectionEnd)}, ${pluralizeNights(nightsBetween(selectionStart, selectionEnd))}. Выберите более позднюю дату, чтобы продлить проживание.`;
  }

  const moveVisibleMonth = (amount) => {
    const nextMonth = addMonths(visibleMonth, amount);
    if (compareDateKeys(nextMonth, minMonth) < 0 || compareDateKeys(nextMonth, maxMonth) > 0) return;

    setVisibleMonth(nextMonth);
    setFocusedDate((current) => clampDateKey(addMonths(current, amount), minDate, maxDate));
  };

  const selectDate = (dateKey) => {
    if (dateKey === maxDate && selectionEnd === maxDate) return;
    setFocusedDate(dateKey);
    onChange?.(updateBookingRange(selectionStart, selectionEnd, dateKey));
  };

  const moveDayFocus = (currentDate, event) => {
    let targetDate = currentDate;
    const weekdayIndex = weekdayIndexMondayFirst(currentDate);

    switch (event.key) {
      case "ArrowLeft":
        targetDate = addDays(currentDate, -1);
        break;
      case "ArrowRight":
        targetDate = addDays(currentDate, 1);
        break;
      case "ArrowUp":
        targetDate = addDays(currentDate, -7);
        break;
      case "ArrowDown":
        targetDate = addDays(currentDate, 7);
        break;
      case "Home":
        targetDate = addDays(currentDate, -weekdayIndex);
        break;
      case "End":
        targetDate = addDays(currentDate, 6 - weekdayIndex);
        break;
      case "PageUp":
        targetDate = addMonths(currentDate, -1);
        break;
      case "PageDown":
        targetDate = addMonths(currentDate, 1);
        break;
      default:
        return;
    }

    event.preventDefault();
    targetDate = clampDateKey(targetDate, minDate, maxDate);

    if (!canChooseDate(targetDate)) {
      const direction = compareDateKeys(targetDate, currentDate) < 0 ? -1 : 1;
      let candidate = targetDate;

      while (
        compareDateKeys(candidate, minDate) >= 0
        && compareDateKeys(candidate, maxDate) <= 0
        && !canChooseDate(candidate)
      ) {
        candidate = addDays(candidate, direction);
      }

      if (compareDateKeys(candidate, minDate) < 0 || compareDateKeys(candidate, maxDate) > 0) return;
      targetDate = candidate;
    }

    shouldRestoreDayFocus.current = true;
    setFocusedDate(targetDate);

    const targetMonth = startOfMonth(targetDate);
    const currentMonth = startOfMonth(currentDate);
    if (targetMonth !== currentMonth) {
      setVisibleMonth(targetMonth);
    }
  };

  return (
    <div className="booking-calendar" aria-describedby={instructionId} ref={calendarRef}>
      <div className="booking-calendar__toolbar">
        <button
          className="booking-calendar__nav booking-calendar__nav--previous"
          type="button"
          aria-label="Показать предыдущий месяц"
          disabled={!canGoPrevious}
          onClick={() => moveVisibleMonth(-1)}
        >
          <CaretLeft size={18} weight="regular" aria-hidden="true" />
        </button>
        <p className="booking-calendar__range-label" aria-live="polite">
          <span className="booking-calendar__range-month booking-calendar__range-month--first">
            {formatMonthRu(visibleMonth)}
          </span>
          <span className="booking-calendar__range-separator" aria-hidden="true"> — </span>
          <span className="booking-calendar__range-month booking-calendar__range-month--second">
            {formatMonthRu(secondMonth)}
          </span>
        </p>
        <button
          className="booking-calendar__nav booking-calendar__nav--next"
          type="button"
          aria-label="Показать следующий месяц"
          disabled={!canGoNext}
          onClick={() => moveVisibleMonth(1)}
        >
          <CaretRight size={18} weight="regular" aria-hidden="true" />
        </button>
      </div>

      {availabilityStatus === "loading" ? (
        <p className="booking-calendar__status" role="status">
          Проверяем занятые даты…
        </p>
      ) : null}

      {availabilityStatus === "refreshing" ? (
        <span className="booking-calendar__sr-status" role="status">Обновляем доступность…</span>
      ) : null}

      {availabilityError ? (
        <div className="booking-calendar__status booking-calendar__status--error" role="alert">
          <span>{availabilityError}</span>
          {onRetryAvailability ? (
            <button type="button" onClick={onRetryAvailability}>Повторить</button>
          ) : null}
        </div>
      ) : null}

      <div className="booking-calendar__months">
        {monthKeys.map((monthKey, monthIndex) => (
          <section className="booking-calendar__month" key={monthKey} aria-labelledby={`${instructionId}-month-${monthIndex}`}>
            <h3 className="booking-calendar__month-title" id={`${instructionId}-month-${monthIndex}`}>
              {formatMonthRu(monthKey)}
            </h3>
            <table className="booking-calendar__table" role="grid" aria-describedby={instructionId}>
              <thead>
                <tr>
                  {WEEKDAYS.map(([shortLabel, fullLabel]) => (
                    <th className="booking-calendar__weekday" scope="col" key={shortLabel}>
                      <abbr title={fullLabel}>{shortLabel}</abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chunkWeekRows(monthGrids[monthIndex]).map((week) => (
                  <tr key={week[0].key}>
                    {week.map((day) => {
                      if (!day.inMonth) {
                        return <td className="booking-calendar__day-cell is-outside-month" key={day.key} aria-hidden="true" />;
                      }

                      const isCheckIn = day.key === selectionStart;
                      const isCheckOut = day.key === selectionEnd;
                      const isInRange = Boolean(
                        selectionStart
                        && selectionEnd
                        && compareDateKeys(day.key, selectionStart) >= 0
                        && compareDateKeys(day.key, selectionEnd) <= 0,
                      );
                      const isSelected = isCheckIn || isCheckOut || isInRange;
                      const isToday = day.key === minDate;
                      const availability = getDateAvailability(day.key);
                      const canChoose = !day.disabled && canChooseDate(day.key);
                      const isOccupied = availability.known && !availability.available;
                      const isMaximumCheckoutBoundary = day.key === maxDate;
                      const isCheckoutOnly = (isOccupied || isMaximumCheckoutBoundary) && canChoose;
                      const isHotelLimited = stayId === "hotel-room"
                        && availability.known
                        && availability.remainingUnits > 0
                        && availability.remainingUnits < 6;
                      const availabilityDescription = isMaximumCheckoutBoundary
                        ? canChoose
                          ? "можно выбрать только как дату выезда"
                          : "доступно только как дата выезда после выбора заезда"
                        : !availability.known
                          ? "доступность уточняется"
                        : availability.available
                          ? stayId === "hotel-room"
                            ? `осталось номеров: ${availability.remainingUnits}`
                            : "доступно для запроса"
                          : isCheckoutOnly
                            ? "занято для заезда, можно выбрать как дату выезда"
                            : "занято, недоступно для выбора";
                      const stateDescription = [
                        isToday ? "сегодня" : "",
                        isCheckIn ? "дата заезда" : "",
                        isCheckOut ? "дата выезда" : "",
                        isInRange && !isCheckIn && !isCheckOut ? "в выбранном диапазоне" : "",
                      ].filter(Boolean).join(", ");
                      const ariaLabel = [
                        `${WEEKDAYS_ARIA[weekdayIndexMondayFirst(day.key)]}, ${formatDateRu(day.key)}`,
                        !day.disabled && !isMaximumCheckoutBoundary && !isOccupied ? ariaPrice : "",
                        day.disabled ? "недоступно для выбора" : "",
                        !day.disabled ? availabilityDescription : "",
                        stateDescription,
                      ].filter(Boolean).join(", ");
                      const classNames = [
                        "booking-calendar__day",
                        day.disabled || !canChoose ? "is-disabled" : "",
                        isOccupied ? "is-occupied" : "",
                        isCheckoutOnly ? "is-checkout-only" : "",
                        isHotelLimited ? "is-limited" : "",
                        isToday ? "is-today" : "",
                        isInRange ? "is-in-range" : "",
                        isCheckIn ? "is-check-in" : "",
                        isCheckOut ? "is-check-out" : "",
                      ].filter(Boolean).join(" ");

                      return (
                        <td
                          className="booking-calendar__day-cell"
                          role="gridcell"
                          aria-selected={isSelected}
                          key={day.key}
                        >
                          <button
                            className={classNames}
                            ref={(node) => {
                              if (node) dateButtonRefs.current.set(day.key, node);
                              else dateButtonRefs.current.delete(day.key);
                            }}
                            type="button"
                            disabled={!canChoose}
                            tabIndex={canChoose && day.key === focusedDate ? 0 : -1}
                            aria-label={ariaLabel}
                            aria-pressed={isSelected}
                            onClick={() => selectDate(day.key)}
                            onFocus={() => setFocusedDate(day.key)}
                            onKeyDown={(event) => moveDayFocus(day.key, event)}
                          >
                            <span className="booking-calendar__day-number">{day.day}</span>
                            {!day.disabled ? (
                              <>
                                <span className="booking-calendar__day-price" aria-hidden="true">
                                  {isMaximumCheckoutBoundary ? "Только выезд" : isOccupied ? "Занято" : visiblePrice}
                                </span>
                                {isHotelLimited ? (
                                  <span className="booking-calendar__day-remaining" aria-hidden="true">
                                    Осталось {availability.remainingUnits}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <ul className="booking-calendar__legend" aria-label="Обозначения доступности">
        <li><span className="booking-calendar__legend-mark is-available" aria-hidden="true" />Доступно для запроса</li>
        {stayId === "hotel-room" ? (
          <li><span className="booking-calendar__legend-mark is-limited" aria-hidden="true" />Осталось несколько номеров</li>
        ) : null}
        <li><span className="booking-calendar__legend-mark is-occupied" aria-hidden="true" />Занято</li>
      </ul>

      <p className="booking-calendar__instruction" id={instructionId} aria-live="polite">
        {selectionInstruction} Занятые ночи недоступны; остальные даты менеджер подтвердит после запроса.
      </p>
    </div>
  );
}
