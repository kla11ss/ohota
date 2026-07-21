import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarBlank, CheckCircle, Phone, X } from "@phosphor-icons/react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { BookingPage } from "./BookingPage.jsx";

function PlannerTabs({ view, onChange, tripTabRef, stayTabRef }) {
  return (
    <div className="planner-tabs" role="tablist" aria-label="Разделы планирования поездки">
      <button
        ref={tripTabRef}
        id="planner-tab-trip"
        type="button"
        role="tab"
        aria-controls="planner-page-trip"
        aria-selected={view === "trip"}
        className={view === "trip" ? "is-active" : ""}
        onClick={() => onChange("trip")}
      >
        <span>01</span> Поездка
      </button>
      <button
        ref={stayTabRef}
        id="planner-tab-stay"
        type="button"
        role="tab"
        aria-controls="planner-page-stay"
        aria-selected={view === "stay"}
        className={view === "stay" ? "is-active" : ""}
        onClick={() => onChange("stay")}
      >
        <span>02</span> Размещение
      </button>
    </div>
  );
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Не удалось отправить запрос. Попробуйте ещё раз.");
  }

  return result;
}

export function TripModal({ open, initialView = "trip", initialStayId = "hotel-room", onClose }) {
  const [view, setView] = useState(initialView);
  const [sent, setSent] = useState(false);
  const [sentKind, setSentKind] = useState("trip");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const modalRef = useRef(null);
  const tripTabRef = useRef(null);
  const stayTabRef = useRef(null);
  const successTitleRef = useRef(null);
  const initialFocusRef = view === "stay" ? stayTabRef : tripTabRef;
  useFocusTrap(open, modalRef, onClose, initialFocusRef);

  useEffect(() => {
    if (open) {
      setView(initialView);
      setSent(false);
      setSentKind(initialView === "stay" ? "stay" : "trip");
      setIsSubmitting(false);
      setSubmitError("");
      return;
    }

    setSent(false);
    setIsSubmitting(false);
    setSubmitError("");
  }, [initialView, open]);

  useEffect(() => {
    if (sent) successTitleRef.current?.focus();
  }, [sent]);

  if (!open) return null;

  const changeView = (nextView) => {
    if (isSubmitting || nextView === view) return;
    setSubmitError("");
    setView(nextView);
    window.requestAnimationFrame(() => {
      (nextView === "stay" ? stayTabRef : tripTabRef).current?.focus();
    });
  };

  const handleTripSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    setIsSubmitting(true);
    setSubmitError("");

    try {
      await postJson("/api/trip-request", values);
      form.reset();
      setSentKind("trip");
      setSent(true);
    } catch (error) {
      setSubmitError(error.message || "Не удалось отправить запрос. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBookingSubmit = async (payload) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError("");

    try {
      await postJson("/api/booking-request", payload);
      setSentKind("stay");
      setSent(true);
    } catch (error) {
      setSubmitError(error.message || "Не удалось отправить запрос. Попробуйте ещё раз.");
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const dialogTitleId = sent
    ? "trip-modal-success-title"
    : view === "stay"
      ? "booking-modal-title"
      : "trip-modal-title";
  const dialogDescriptionId = sent
    ? "trip-modal-success-description"
    : view === "stay"
      ? "booking-modal-description"
      : "trip-modal-description";

  return (
    <div className="modal-layer" role="presentation">
      <button
        className="modal-backdrop"
        type="button"
        tabIndex={-1}
        aria-label="Закрыть форму"
        onClick={onClose}
      />
      <section
        className={`trip-modal ${view === "stay" ? "trip-modal--booking" : ""}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">
          <X size={19} weight="regular" />
        </button>

        {sent ? (
          <div className="trip-success" aria-live="polite">
            <CheckCircle size={34} weight="light" />
            <p className="section-label section-label--light">
              {sentKind === "stay" ? "Запрос на размещение сформирован" : "Запрос сформирован"}
            </p>
            <h2 id="trip-modal-success-title" ref={successTitleRef} tabIndex={-1}>
              {sentKind === "stay" ? "Даты уже у команды" : "Запрос уже у команды"}
            </h2>
            <p id="trip-modal-success-description">
              {sentKind === "stay"
                ? "Менеджер проверит размещение на выбранные даты, уточнит итоговую стоимость и свяжется с вами по телефону."
                : "Заявка отправлена ответственному менеджеру. Он свяжется с вами, чтобы согласовать сезон, даты, программу и размещение."}
            </p>
            <a className="pill-button pill-button--light" href="tel:+79200201516">
              <Phone size={17} weight="regular" /> +7 920 020-15-16
            </a>
          </div>
        ) : (
          <>
            <div className="planner-tabs-shell">
              <PlannerTabs
                view={view}
                onChange={changeView}
                tripTabRef={tripTabRef}
                stayTabRef={stayTabRef}
              />
            </div>

            <div
              className="planner-page planner-page--trip"
              id="planner-page-trip"
              role="tabpanel"
              aria-labelledby="planner-tab-trip"
              hidden={view !== "trip"}
            >
              <div className="trip-modal__intro">
                <p className="section-label section-label--light">Индивидуальная программа</p>
                <h2 id="trip-modal-title">Расскажите о поездке</h2>
                <p id="trip-modal-description">
                  Состав программы подтверждается после проверки сезона, правил, команды,
                  транспорта и размещения.
                </p>
              </div>

              <form className="trip-form" onSubmit={handleTripSubmit} aria-busy={isSubmitting}>
                <label>
                  <span>Как к вам обращаться</span>
                  <input name="name" type="text" autoComplete="name" placeholder="Имя" required />
                </label>
                <label>
                  <span>Телефон</span>
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+7 900 000-00-00"
                    required
                  />
                </label>
                <label>
                  <span>Что вас интересует</span>
                  <select name="interest" defaultValue="hunt">
                    <option value="hunt">Охота</option>
                    <option value="fishing">Рыбалка</option>
                    <option value="family">Семейный отдых</option>
                    <option value="group">Групповая поездка</option>
                    <option value="combined">Комбинированная программа</option>
                  </select>
                </label>
                <label>
                  <span>Ориентировочные даты и состав группы</span>
                  <textarea
                    name="details"
                    rows="4"
                    placeholder="Например: сентябрь, 4 взрослых; охота и два дня рыбалки"
                  />
                </label>

                <input
                  className="trip-form__honeypot"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />

                <p className="form-note">
                  Заявка поступит ответственному менеджеру в Telegram. Он уточнит детали по телефону.
                </p>
                {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
                <div className="trip-form__actions">
                  <button className="pill-button pill-button--light" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Отправляем…" : "Отправить запрос"} <ArrowRight size={17} weight="regular" />
                  </button>
                  <button className="trip-form__stay-link" type="button" onClick={() => changeView("stay")}>
                    <CalendarBlank size={17} weight="regular" /> Выбрать размещение
                  </button>
                </div>
              </form>
            </div>

            <div
              className="planner-page planner-page--stay"
              id="planner-page-stay"
              role="tabpanel"
              aria-labelledby="planner-tab-stay"
              hidden={view !== "stay"}
            >
              <BookingPage
                initialStayId={initialStayId}
                onSubmit={handleBookingSubmit}
                isSubmitting={isSubmitting}
                submitError={submitError}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
