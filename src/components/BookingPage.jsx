import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bed,
  Buildings,
  CalendarBlank,
  HouseLine,
  Minus,
  Phone,
  Plus,
  UsersThree,
} from "@phosphor-icons/react";
import {
  calculateBookingTotal,
  formatNightlyRate,
  formatRubles,
  getSelectionCapacity,
  getStayById,
  stayCatalog,
} from "../booking/catalog.js";
import {
  BookingCalendar,
  getBookingDayAvailability,
} from "./BookingCalendar.jsx";
import {
  addMonths,
  areBookingNightsAvailable,
  bookingNightKeys,
  compareDateKeys,
  formatDateRu,
  nightsBetween,
  todayKey,
} from "../booking/date-utils.js";
import { resolveBookingRequestKey } from "../booking/request-idempotency.js";

const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const AVAILABILITY_REFRESH_MS = 30_000;

function createRequestKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getApiError(result, fallback) {
  return typeof result?.error === "string" && result.error.trim()
    ? result.error.trim()
    : fallback;
}

function pluralize(value, forms) {
  const absolute = Math.abs(value) % 100;
  const lastDigit = absolute % 10;

  if (absolute > 10 && absolute < 20) return forms[2];
  if (lastDigit === 1) return forms[0];
  if (lastDigit > 1 && lastDigit < 5) return forms[1];
  return forms[2];
}

function getStayIcon(stayId) {
  if (stayId === "hotel-room") return Bed;
  if (stayId === "cottage") return Buildings;
  return HouseLine;
}

function getStayMeta(stay) {
  if (stay.id === "hotel-room") {
    return `До ${stay.maxUnits} ${pluralize(stay.maxUnits, ["номера", "номеров", "номеров"])} по ${stay.capacityPerUnit} гостя`;
  }

  if (stay.id === "hunter-house") {
    const houseCount = stay.unitOptions?.length ?? stay.maxUnits;
    return `${houseCount} ${pluralize(houseCount, ["дом", "дома", "домов"])} · до ${stay.capacityPerUnit} гостей каждый`;
  }

  return `До ${stay.capacityPerUnit} гостей`;
}

function Stepper({ id, label, hint, value, min, max, onChange }) {
  const decrease = () => onChange(Math.max(min, value - 1));
  const increase = () => onChange(Math.min(max, value + 1));

  return (
    <div className="booking-stepper">
      <div>
        <span className="booking-stepper__label" id={`${id}-label`}>{label}</span>
        {hint ? <span className="booking-stepper__hint">{hint}</span> : null}
      </div>
      <div className="booking-stepper__controls" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          onClick={decrease}
          disabled={value <= min}
          aria-label={`Уменьшить: ${label.toLocaleLowerCase("ru-RU")}`}
        >
          <Minus size={16} weight="regular" aria-hidden="true" />
        </button>
        <output className="booking-stepper__value" id={id} aria-live="polite">{value}</output>
        <button
          type="button"
          onClick={increase}
          disabled={value >= max}
          aria-label={`Увеличить: ${label.toLocaleLowerCase("ru-RU")}`}
        >
          <Plus size={16} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function BookingPage({
  initialStayId,
  onSubmit,
  isSubmitting = false,
  submitError = "",
}) {
  const defaultStay = getStayById(initialStayId) ?? stayCatalog[0];
  const [stayId, setStayId] = useState(defaultStay.id);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomQuantity, setRoomQuantity] = useState(1);
  const [selectedUnitIds, setSelectedUnitIds] = useState(["hunter-house-1"]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState("");
  const [validationError, setValidationError] = useState(null);
  const [dispatchError, setDispatchError] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [requestKey, setRequestKey] = useState(createRequestKey);
  const [visibleRange, setVisibleRange] = useState(null);
  const [availabilityDays, setAvailabilityDays] = useState({});
  const [availabilityStatus, setAvailabilityStatus] = useState("idle");
  const [availabilityError, setAvailabilityError] = useState("");
  const [isStayScreenActive, setIsStayScreenActive] = useState(false);
  const pageRef = useRef(null);
  const availabilityAbortRef = useRef(null);
  const availabilityRequestIdRef = useRef(0);
  const hasLoadedAvailabilityRef = useRef(false);
  const failedPayloadFingerprintRef = useRef("");

  const selectedStay = getStayById(stayId) ?? stayCatalog[0];
  const staySelection = useMemo(
    () => selectedStay.id === "hunter-house"
      ? { unitIds: selectedUnitIds }
      : { quantity: selectedStay.id === "cottage" ? 1 : roomQuantity },
    [roomQuantity, selectedStay, selectedUnitIds],
  );
  const capacity = getSelectionCapacity(selectedStay, staySelection);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const total = nights > 0
    ? calculateBookingTotal(selectedStay, nights, staySelection)
    : null;
  const pending = isSubmitting || isDispatching;

  const availabilitySelection = useMemo(() => ({
    stayId: selectedStay.id,
    quantity: selectedStay.id === "cottage" ? 1 : roomQuantity,
    unitIds: selectedStay.id === "hunter-house" ? selectedUnitIds : [],
  }), [roomQuantity, selectedStay.id, selectedUnitIds]);
  const isNightAvailableForSelection = useCallback((dateKey) => (
    getBookingDayAvailability(availabilityDays[dateKey], availabilitySelection).available
  ), [availabilityDays, availabilitySelection]);
  const selectedRangeHasConflict = Boolean(
    checkIn
    && checkOut
    && !areBookingNightsAvailable(checkIn, checkOut, isNightAvailableForSelection)
  );

  useEffect(() => {
    const nextStay = getStayById(initialStayId);
    if (nextStay) setStayId(nextStay.id);
  }, [initialStayId]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;

    const tabPanel = root.closest('[role="tabpanel"]');
    const updateActiveState = () => {
      setIsStayScreenActive(Boolean(root.isConnected && (!tabPanel || !tabPanel.hidden)));
    };

    updateActiveState();
    if (!tabPanel || typeof MutationObserver === "undefined") return undefined;

    const observer = new MutationObserver(updateActiveState);
    observer.observe(tabPanel, { attributes: true, attributeFilter: ["hidden"] });
    return () => observer.disconnect();
  }, []);

  const handleVisibleRangeChange = useCallback((nextRange) => {
    setVisibleRange((currentRange) => (
      currentRange?.from === nextRange.from && currentRange?.to === nextRange.to
        ? currentRange
        : nextRange
    ));
  }, []);

  const loadAvailability = useCallback(async ({ background = false } = {}) => {
    if (!visibleRange || !isStayScreenActive) return;

    availabilityAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = availabilityRequestIdRef.current + 1;
    availabilityAbortRef.current = controller;
    availabilityRequestIdRef.current = requestId;

    if (!background || !hasLoadedAvailabilityRef.current) {
      setAvailabilityStatus("loading");
    } else {
      setAvailabilityStatus("refreshing");
    }
    setAvailabilityError("");

    try {
      const search = new URLSearchParams(visibleRange);
      const response = await fetch(`/api/availability?${search}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(getApiError(result, "Не удалось обновить занятые даты."));
      }
      if (!result.days || typeof result.days !== "object" || Array.isArray(result.days)) {
        throw new Error("Сервис доступности вернул некорректный ответ.");
      }
      if (availabilityRequestIdRef.current !== requestId) return;

      setAvailabilityDays((currentDays) => {
        const nextDays = { ...currentDays };
        bookingNightKeys(visibleRange.from, visibleRange.to).forEach((dateKey) => {
          delete nextDays[dateKey];
        });
        Object.entries(result.days).forEach(([dateKey, day]) => {
          if (
            compareDateKeys(dateKey, visibleRange.from) >= 0
            && compareDateKeys(dateKey, visibleRange.to) < 0
          ) {
            nextDays[dateKey] = day;
          }
        });
        return nextDays;
      });
      hasLoadedAvailabilityRef.current = true;
      setAvailabilityStatus("ready");
    } catch (error) {
      if (error?.name === "AbortError" || availabilityRequestIdRef.current !== requestId) return;
      setAvailabilityStatus("error");
      setAvailabilityError(
        error instanceof Error
          ? error.message
          : "Не удалось обновить занятые даты.",
      );
    }
  }, [isStayScreenActive, visibleRange]);

  useEffect(() => {
    if (!isStayScreenActive || !visibleRange) return undefined;
    loadAvailability();
    return () => availabilityAbortRef.current?.abort();
  }, [isStayScreenActive, loadAvailability, visibleRange]);

  useEffect(() => {
    if (!isStayScreenActive || !visibleRange) return undefined;

    const refresh = () => {
      if (document.visibilityState === "visible") loadAvailability({ background: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const intervalId = window.setInterval(refresh, AVAILABILITY_REFRESH_MS);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isStayScreenActive, loadAvailability, visibleRange]);

  const clearValidationError = () => {
    if (validationError) setValidationError(null);
    if (dispatchError) setDispatchError("");
  };

  const selectStay = (nextStayId) => {
    setStayId(nextStayId);
    clearValidationError();
  };

  const handleDateChange = ({ checkIn: nextCheckIn, checkOut: nextCheckOut }) => {
    setCheckIn(nextCheckIn);
    setCheckOut(nextCheckOut);
    clearValidationError();
  };

  const toggleHunterUnit = (unitId) => {
    setSelectedUnitIds((currentIds) => {
      if (currentIds.includes(unitId)) {
        return currentIds.length === 1 ? currentIds : currentIds.filter((id) => id !== unitId);
      }

      const validIds = new Set(selectedStay.unitOptions?.map((option) => option.id) ?? []);
      return validIds.has(unitId) ? [...currentIds, unitId] : currentIds;
    });
    clearValidationError();
  };

  const selectionLabel = useMemo(() => {
    if (selectedStay.id === "hotel-room") {
      return `${roomQuantity} ${pluralize(roomQuantity, ["номер", "номера", "номеров"])}`;
    }

    if (selectedStay.id === "hunter-house") {
      return (selectedStay.unitOptions ?? [])
        .filter((option) => selectedUnitIds.includes(option.id))
        .map((option) => option.label)
        .join(", ");
    }

    return "Коттедж целиком";
  }, [roomQuantity, selectedStay, selectedUnitIds]);

  const validate = () => {
    const minimumDate = todayKey();
    const maximumDate = addMonths(minimumDate, 12);

    if (!checkIn || !checkOut) {
      return { fieldId: "booking-calendar-heading", message: "Выберите даты заезда и выезда." };
    }

    if (
      compareDateKeys(checkIn, minimumDate) < 0
      || compareDateKeys(checkOut, maximumDate) > 0
      || nightsBetween(checkIn, checkOut) < 1
    ) {
      return {
        fieldId: "booking-calendar-heading",
        message: "Выберите период минимум на одну ночь в пределах ближайших 12 месяцев.",
      };
    }

    if (
      selectedStay.id === "hotel-room"
      && (!Number.isInteger(roomQuantity)
        || roomQuantity < selectedStay.minUnits
        || roomQuantity > selectedStay.maxUnits)
    ) {
      return { fieldId: "booking-rooms", message: "Выберите от одного до шести номеров." };
    }

    if (selectedStay.id === "hunter-house") {
      const allowedUnitIds = new Set(selectedStay.unitOptions?.map((option) => option.id) ?? []);
      const uniqueUnitIds = new Set(selectedUnitIds);
      if (
        uniqueUnitIds.size < selectedStay.minUnits
        || uniqueUnitIds.size > selectedStay.maxUnits
        || [...uniqueUnitIds].some((id) => !allowedUnitIds.has(id))
      ) {
        return { fieldId: "booking-unit-hunter-house-1", message: "Выберите один или оба дома охотника." };
      }
    }

    if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) {
      return { fieldId: "booking-adults", message: "Укажите корректное количество взрослых и детей." };
    }

    if (adults + children > capacity) {
      return {
        fieldId: "booking-adults",
        message: `Для выбранного размещения доступно ${capacity} ${pluralize(capacity, ["место", "места", "мест"])}.`,
      };
    }

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < PHONE_MIN_DIGITS || phoneDigits.length > PHONE_MAX_DIGITS) {
      return { fieldId: "booking-phone", message: "Введите номер телефона из 10–15 цифр." };
    }

    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;

    const nextValidationError = validate();
    setValidationError(nextValidationError);
    setDispatchError("");

    if (nextValidationError) {
      window.requestAnimationFrame(() => {
        document.getElementById(nextValidationError.fieldId)?.focus();
      });
      return;
    }

    const selectionPayload = selectedStay.id === "hunter-house"
      ? {
          unitIds: (selectedStay.unitOptions ?? [])
            .filter((option) => selectedUnitIds.includes(option.id))
            .map((option) => option.id),
        }
      : { quantity: selectedStay.id === "cottage" ? 1 : roomQuantity };
    const payloadWithoutRequestKey = {
      stayId: selectedStay.id,
      ...selectionPayload,
      checkIn,
      checkOut,
      adults,
      children,
      phone: phone.trim(),
      name: name.trim(),
      comment: comment.trim(),
      website,
    };
    const requestAttempt = resolveBookingRequestKey({
      currentRequestKey: requestKey,
      failedPayloadFingerprint: failedPayloadFingerprintRef.current,
      payload: payloadWithoutRequestKey,
      createRequestKey,
    });
    if (requestAttempt.rotated) setRequestKey(requestAttempt.requestKey);
    const payload = {
      requestKey: requestAttempt.requestKey,
      ...payloadWithoutRequestKey,
    };

    setIsDispatching(true);
    try {
      const availabilityResponse = await fetch("/api/availability/check", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stayId: selectedStay.id,
          ...selectionPayload,
          checkIn,
          checkOut,
        }),
      });
      const availabilityResult = await availabilityResponse.json().catch(() => ({}));
      const isAvailabilityConflict = availabilityResponse.status === 409
        || availabilityResult.available === false;

      if (!availabilityResponse.ok || isAvailabilityConflict) {
        const error = new Error(getApiError(
          availabilityResult,
          isAvailabilityConflict
            ? "Выбранные даты уже заняты. Проверьте календарь и выберите другой период."
            : "Не удалось проверить даты. Попробуйте ещё раз.",
        ));
        error.isAvailabilityConflict = isAvailabilityConflict;
        throw error;
      }
      if (availabilityResult.available !== true) {
        throw new Error("Не удалось подтвердить доступность выбранных дат. Попробуйте ещё раз.");
      }

      await onSubmit?.(payload);
      failedPayloadFingerprintRef.current = "";
      setRequestKey(createRequestKey());
    } catch (error) {
      failedPayloadFingerprintRef.current = requestAttempt.payloadFingerprint;
      if (error?.isAvailabilityConflict) loadAvailability({ background: true });
      setDispatchError(error instanceof Error ? error.message : "Не удалось отправить запрос. Попробуйте ещё раз.");
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="booking-page" ref={pageRef}>
      <header className="booking-page__intro">
        <p className="booking-page__eyebrow">Запрос на размещение</p>
        <h2 className="booking-page__title" id="booking-modal-title">Выберите дом и даты</h2>
        <p className="booking-page__description" id="booking-modal-description">
          Соберите подходящий вариант — менеджер проверит доступность и подтвердит бронирование по телефону.
        </p>
      </header>

      <form className="booking-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <section className="booking-section" aria-labelledby="booking-stay-heading">
          <div className="booking-section__heading">
            <HouseLine size={22} weight="light" aria-hidden="true" />
            <div>
              <h3 id="booking-stay-heading">Вариант размещения</h3>
              <p className="booking-section__hint">Выберите номер, коттедж или один из домов охотника.</p>
            </div>
          </div>

          <div className="booking-stay-grid" role="radiogroup" aria-labelledby="booking-stay-heading">
            {stayCatalog.map((stay) => {
              const StayIcon = getStayIcon(stay.id);
              const isSelected = stay.id === selectedStay.id;

              return (
                <label className={`booking-stay-card${isSelected ? " is-selected" : ""}`} key={stay.id}>
                  <input
                    className="booking-stay-card__control"
                    type="radio"
                    name="booking-stay"
                    value={stay.id}
                    checked={isSelected}
                    onChange={() => selectStay(stay.id)}
                    aria-describedby={`booking-stay-description-${stay.id}`}
                  />
                  <span className="booking-stay-card__head">
                    <span className="booking-stay-card__icon" aria-hidden="true">
                      <StayIcon size={23} weight="light" />
                    </span>
                    <span className="booking-stay-card__copy">
                      <strong className="booking-stay-card__title">{stay.label}</strong>
                      <span className="booking-stay-card__meta">{getStayMeta(stay)}</span>
                    </span>
                  </span>
                  <span className="booking-stay-card__description" id={`booking-stay-description-${stay.id}`}>
                    {stay.description}
                  </span>
                  <span className="booking-stay-card__price">{formatNightlyRate(stay)}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="booking-section" aria-labelledby="booking-calendar-heading">
          <div className="booking-section__heading">
            <CalendarBlank size={22} weight="light" aria-hidden="true" />
            <div>
              <h3 id="booking-calendar-heading" tabIndex={-1}>Даты проживания</h3>
              <p className="booking-section__hint">Сначала выберите заезд, затем — день выезда.</p>
            </div>
          </div>

          <div className="booking-calendar-wrap">
            <BookingCalendar
              checkIn={checkIn}
              checkOut={checkOut}
              onChange={handleDateChange}
              priceLabel={selectedStay.pricePerNight == null ? "X ₽" : formatRubles(selectedStay.pricePerNight)}
              unknownPrice={selectedStay.pricePerNight == null}
              stayId={selectedStay.id}
              quantity={selectedStay.id === "cottage" ? 1 : roomQuantity}
              unitIds={selectedStay.id === "hunter-house" ? selectedUnitIds : []}
              availabilityDays={availabilityDays}
              availabilityStatus={availabilityStatus}
              availabilityError={availabilityError}
              onRetryAvailability={() => loadAvailability()}
              onVisibleRangeChange={handleVisibleRangeChange}
            />
          </div>
          {selectedRangeHasConflict ? (
            <p className="booking-availability-note booking-availability-note--error" role="alert">
              Выбранный диапазон больше недоступен для этого варианта. Данные формы сохранены — выберите другие даты или количество мест.
            </p>
          ) : (
            <p className="booking-availability-note">
              Серые даты уже подтверждены другими гостями. Остальные доступны для запроса и окончательно подтверждаются менеджером.
            </p>
          )}
        </section>

        <section className="booking-section" aria-labelledby="booking-guests-heading">
          <div className="booking-section__heading">
            <UsersThree size={22} weight="light" aria-hidden="true" />
            <div>
              <h3 id="booking-guests-heading">Гости и количество мест</h3>
              <p className="booking-section__hint">
                Сейчас выбрано до {capacity} {pluralize(capacity, ["гостя", "гостей", "гостей"])}.
              </p>
            </div>
          </div>

          <div className="booking-config">
            <div className="booking-config__group">
              <Stepper
                id="booking-adults"
                label="Взрослые"
                hint="От 18 лет"
                value={adults}
                min={1}
                max={Math.max(1, capacity - children)}
                onChange={(value) => {
                  setAdults(value);
                  clearValidationError();
                }}
              />
              <Stepper
                id="booking-children"
                label="Дети"
                hint="До 17 лет"
                value={children}
                min={0}
                max={Math.max(0, capacity - adults)}
                onChange={(value) => {
                  setChildren(value);
                  clearValidationError();
                }}
              />
            </div>

            <div className="booking-config__group">
              {selectedStay.id === "hotel-room" ? (
                <Stepper
                  id="booking-rooms"
                  label="Двухместные номера"
                  hint={`Доступно до ${selectedStay.maxUnits}`}
                  value={roomQuantity}
                  min={selectedStay.minUnits}
                  max={selectedStay.maxUnits}
                  onChange={(value) => {
                    setRoomQuantity(value);
                    clearValidationError();
                  }}
                />
              ) : null}

              {selectedStay.id === "cottage" ? (
                <p className="booking-section__hint">Коттедж бронируется целиком для группы до {capacity} гостей.</p>
              ) : null}

              {selectedStay.id === "hunter-house" ? (
                <fieldset className="booking-unit-list">
                  <legend>Выберите дом</legend>
                  {(selectedStay.unitOptions ?? []).map((option) => {
                    const isSelected = selectedUnitIds.includes(option.id);
                    return (
                      <label
                        className={`booking-unit-option${isSelected ? " is-selected" : ""}`}
                        key={option.id}
                      >
                        <input
                          id={`booking-unit-${option.id}`}
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleHunterUnit(option.id)}
                          disabled={isSelected && selectedUnitIds.length === 1}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="booking-summary" aria-labelledby="booking-summary-heading">
          <h3 className="booking-summary__heading" id="booking-summary-heading">Ваш запрос</h3>
          <dl className="booking-summary__list">
            <div className="booking-summary__row">
              <dt>Размещение</dt>
              <dd>{selectedStay.label}</dd>
            </div>
            <div className="booking-summary__row">
              <dt>Выбрано</dt>
              <dd>{selectionLabel}</dd>
            </div>
            <div className="booking-summary__row">
              <dt>Даты</dt>
              <dd>{checkIn && checkOut ? `${formatDateRu(checkIn)} — ${formatDateRu(checkOut)}` : "Выберите даты"}</dd>
            </div>
            <div className="booking-summary__row">
              <dt>Продолжительность</dt>
              <dd>{nights > 0 ? `${nights} ${pluralize(nights, ["ночь", "ночи", "ночей"])}` : "—"}</dd>
            </div>
            <div className="booking-summary__row">
              <dt>Гости</dt>
              <dd>{adults} взр. · {children} дет.</dd>
            </div>
            <div className="booking-summary__row booking-summary__total">
              <dt>Ориентировочный итог</dt>
              <dd>
                {selectedStay.pricePerNight == null
                  ? "Итог уточняется"
                  : nights > 0
                    ? formatRubles(total)
                    : "После выбора дат"}
              </dd>
            </div>
          </dl>
          <p className="booking-summary__notice">
            Это запрос на подтверждение, а не мгновенная бронь. Итоговую цену и доступность менеджер подтвердит по телефону.
          </p>
        </aside>

        <section className="booking-section" aria-labelledby="booking-contact-heading">
          <div className="booking-section__heading">
            <Phone size={22} weight="light" aria-hidden="true" />
            <div>
              <h3 id="booking-contact-heading">Контакты для подтверждения</h3>
              <p className="booking-section__hint">Телефон обязателен; имя и комментарий можно не заполнять.</p>
            </div>
          </div>

          <div className="booking-contact-grid">
            <label className="booking-field">
              <span className="booking-field__label">Телефон</span>
              <input
                id="booking-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+7 900 000-00-00"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  clearValidationError();
                }}
                aria-invalid={validationError?.fieldId === "booking-phone" || undefined}
                required
              />
            </label>

            <label className="booking-field">
              <span className="booking-field__label">
                Имя <span className="booking-field__optional">необязательно</span>
              </span>
              <input
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Как к вам обращаться"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className="booking-field booking-field--wide">
              <span className="booking-field__label">
                Комментарий <span className="booking-field__optional">необязательно</span>
              </span>
              <textarea
                name="comment"
                rows="3"
                placeholder="Пожелания по размещению или удобное время для звонка"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
          </div>
        </section>

        <input
          className="booking-honeypot"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />

        {validationError ? (
          <p className="booking-form__error" role="alert">{validationError.message}</p>
        ) : null}
        {dispatchError || submitError ? (
          <p className="booking-form__error" role="alert">{dispatchError || submitError}</p>
        ) : null}

        <div className="booking-submit">
          <p className="booking-submit__note">
            Отправляя запрос, вы соглашаетесь на звонок для подтверждения дат и стоимости.
          </p>
          <button type="submit" disabled={pending}>
            {pending ? "Отправляем…" : "Отправить запрос"}
            <ArrowRight size={18} weight="regular" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
