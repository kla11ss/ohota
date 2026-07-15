import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle, Phone, X } from "@phosphor-icons/react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

export function TripModal({ open, onClose }) {
  const [sent, setSent] = useState(false);
  const modalRef = useRef(null);
  const nameRef = useRef(null);
  const successTitleRef = useRef(null);
  useFocusTrap(open, modalRef, onClose, nameRef);

  useEffect(() => {
    if (!open) setSent(false);
  }, [open]);

  useEffect(() => {
    if (sent) successTitleRef.current?.focus();
  }, [sent]);

  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    setSent(true);
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
            <h2 id="trip-modal-title" ref={successTitleRef} tabIndex={-1}>Продолжим по телефону</h2>
            <p id="trip-modal-description">
              Ничего не было отправлено или сохранено. Канал отправки формы ещё не подтверждён,
              поэтому для передачи запроса позвоните по номеру исходного сайта.
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

            <form className="trip-form" onSubmit={handleSubmit}>
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

              <p className="form-note">
                Отправка будет подключена после подтверждения канала связи. Сейчас форма
                демонстрирует сценарий подготовки запроса.
              </p>
              <button className="pill-button pill-button--light" type="submit">
                Подготовить запрос <ArrowRight size={17} weight="regular" />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
