import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle, Phone, X } from "@phosphor-icons/react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

export function TripModal({ open, onClose }) {
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const modalRef = useRef(null);
  const nameRef = useRef(null);
  const successTitleRef = useRef(null);
  useFocusTrap(open, modalRef, onClose, nameRef);

  useEffect(() => {
    if (!open) {
      setSent(false);
      setIsSubmitting(false);
      setSubmitError("");
    }
  }, [open]);

  useEffect(() => {
    if (sent) successTitleRef.current?.focus();
  }, [sent]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch("/api/trip-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Не удалось отправить запрос. Попробуйте ещё раз.");
      }

      form.reset();
      setSent(true);
    } catch (error) {
      setSubmitError(error.message || "Не удалось отправить запрос. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
        className="trip-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-modal-title"
        aria-describedby="trip-modal-description"
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Закрыть">
          <X size={19} weight="regular" />
        </button>

        {sent ? (
          <div className="trip-success" aria-live="polite">
            <CheckCircle size={34} weight="light" />
            <p className="section-label section-label--light">Запрос сформирован</p>
            <h2 id="trip-modal-title" ref={successTitleRef} tabIndex={-1}>Запрос уже у команды</h2>
            <p id="trip-modal-description">
              Заявка отправлена ответственному менеджеру. Он свяжется с вами, чтобы согласовать
              сезон, даты, программу и размещение.
            </p>
            <a className="pill-button pill-button--light" href="tel:+79200201516">
              <Phone size={17} weight="regular" /> +7 920 020-15-16
            </a>
          </div>
        ) : (
          <>
            <div className="trip-modal__intro">
              <p className="section-label section-label--light">Индивидуальная программа</p>
              <h2 id="trip-modal-title">Расскажите о поездке</h2>
              <p id="trip-modal-description">
                Состав программы подтверждается после проверки сезона, правил, команды,
                транспорта и размещения.
              </p>
            </div>

            <form className="trip-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
              <label>
                <span>Как к вам обращаться</span>
                <input ref={nameRef} name="name" type="text" autoComplete="name" placeholder="Имя" required />
              </label>
              <label>
                <span>Телефон</span>
                <input
                  name="phone"
                  type="tel"
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
              <button className="pill-button pill-button--light" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Отправляем…" : "Отправить запрос"} <ArrowRight size={17} weight="regular" />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
