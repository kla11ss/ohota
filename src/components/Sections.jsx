import { useState } from "react";
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  MapPin,
  Phone,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  confirmationItems,
  directions,
  huntingGroups,
  journeySteps,
  natureItems,
  stays,
} from "../content.js";

function handleTabKey(event, items, activeId, onSelect, prefix) {
  const currentIndex = items.findIndex((item) => item.id === activeId);
  let nextIndex = currentIndex;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else return;

  event.preventDefault();
  const nextId = items[nextIndex].id;
  onSelect(nextId);
  window.requestAnimationFrame(() => document.getElementById(`${prefix}-${nextId}`)?.focus());
}

export function IntroSection() {
  return (
    <section className="intro-section page-shell" id="intro" aria-labelledby="intro-title">
      <h2 className="section-label" id="intro-title">О хозяйстве</h2>
      <p className="intro-statement">
        Здесь охота задумана как путешествие: подготовка, сопровождение, проживание и
        время для тех, кто приехал вместе с вами — после подтверждения возможностей.
      </p>
      <div className="intro-notes">
        <p>
          «Великовское» объединяет охоту, рыбалку, природные маршруты и отдых на берегу
          Волги в одной индивидуально согласованной программе.
        </p>
        <p className="editorial-copy">
          Фактический состав поездки зависит от сезона, действующих правил, погоды,
          состояния угодий и доступности команды.
        </p>
      </div>
    </section>
  );
}

export function DirectionsSection() {
  return (
    <section className="directions page-shell" id="directions" aria-labelledby="directions-title">
      <div className="section-head">
        <div>
          <p className="section-label">Основные направления</p>
          <h2 id="directions-title">Что можно объединить</h2>
        </div>
        <p>Программа собирается вокруг интересов всей группы, а не одной услуги.</p>
      </div>

      <div className="direction-list">
        {directions.map((direction) => (
          <a className="direction-row" href={direction.href} key={direction.number}>
            <span className="direction-row__number">{direction.number}</span>
            <div className="direction-row__copy">
              <h3>{direction.title}</h3>
              <p>{direction.text}</p>
            </div>
            <div className="direction-row__media">
              <img src={direction.image} alt={direction.alt} loading="lazy" />
              <small>Иллюстративное изображение</small>
              <ArrowRight size={18} weight="light" />
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export function TerritorySection() {
  return (
    <section className="territory" id="territory" aria-labelledby="territory-title">
      <img
        className="territory__image"
        src="/images/volga-aerial.webp"
        alt="Вид с воздуха на Волгу, острова и леса"
        loading="lazy"
      />
      <span className="territory__caption">Иллюстративное изображение</span>
      <div className="territory__panel">
        <p className="section-label section-label--light">Территория</p>
        <h2 id="territory-title">На левом берегу Волги</h2>
        <p>
          Село Великовское, Лысковский район Нижегородской области. Леса, пойменные
          протоки, острова, песчаные косы, старицы и лесные озёра.
        </p>
        <span className="territory__place">
          <MapPin size={17} weight="regular" /> Нижегородское Заволжье
        </span>
      </div>
    </section>
  );
}

export function HuntingSection() {
  const [groupId, setGroupId] = useState(huntingGroups[0].id);
  const [openItem, setOpenItem] = useState(huntingGroups[0].items[0].title);
  const activeGroup = huntingGroups.find((group) => group.id === groupId) ?? huntingGroups[0];

  const selectGroup = (id) => {
    const next = huntingGroups.find((group) => group.id === id);
    setGroupId(id);
    setOpenItem(next?.items[0].title ?? "");
  };

  return (
    <section className="hunting-section page-shell" id="hunting" aria-labelledby="hunting-title">
      <div className="section-head section-head--wide">
        <div>
          <p className="section-label">Ключевая специализация</p>
          <h2 id="hunting-title">Охота</h2>
        </div>
        <p>
          Формат, даты и допустимые способы определяются только после проверки актуальных
          региональных правил и возможностей хозяйства.
        </p>
      </div>

      <div className="hunting-layout">
        <figure className="hunting-media">
          <img
            src="/images/hunting-guide.webp"
            alt="Иллюстративная сцена: охотники с проводником идут по лесу"
            loading="lazy"
          />
          <figcaption>Иллюстративная фотография</figcaption>
        </figure>

        <div className="hunting-catalog">
          <div className="catalog-tabs" role="tablist" aria-label="Категории охоты">
            {huntingGroups.map((group) => (
              <button
                type="button"
                role="tab"
                id={`hunting-tab-${group.id}`}
                aria-controls="hunting-panel"
                aria-selected={group.id === groupId}
                tabIndex={group.id === groupId ? 0 : -1}
                className={group.id === groupId ? "is-active" : ""}
                onClick={() => selectGroup(group.id)}
                onKeyDown={(event) => handleTabKey(event, huntingGroups, groupId, selectGroup, "hunting-tab")}
                key={group.id}
              >
                {group.label}
              </button>
            ))}
          </div>

          <div
            className="catalog-list"
            role="tabpanel"
            id="hunting-panel"
            aria-labelledby={`hunting-tab-${groupId}`}
          >
            {activeGroup.items.map((item, itemIndex) => {
              const isOpen = item.title === openItem;
              const buttonId = `hunting-item-${groupId}-${itemIndex}`;
              const detailId = `hunting-detail-${groupId}-${itemIndex}`;
              return (
                <article className={`catalog-item ${isOpen ? "is-open" : ""}`} key={item.title}>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={detailId}
                    onClick={() => setOpenItem(isOpen ? "" : item.title)}
                  >
                    <span>{item.title}</span>
                    <CaretDown size={17} weight="regular" />
                  </button>
                  <div
                    className="catalog-item__detail"
                    id={detailId}
                    role="region"
                    aria-labelledby={buttonId}
                    hidden={!isOpen}
                  >
                    <p>{item.detail}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="catalog-note">
            Мы не обещаем гарантированный выход животного или трофей: результат зависит от
            природы, погоды, правил и действий участника.
          </p>
        </div>
      </div>
    </section>
  );
}

export function JourneySection({ onPlan }) {
  return (
    <section className="journey" id="journey" aria-labelledby="journey-title">
      <div className="page-shell journey__inner">
        <div className="journey__head">
          <div>
            <p className="section-label section-label--light">Организация поездки</p>
            <h2 id="journey-title">От идеи до возвращения на базу</h2>
          </div>
          <button type="button" className="text-link text-link--light" onClick={onPlan}>
            Обсудить программу <ArrowRight size={17} weight="regular" />
          </button>
        </div>

        <div className="journey-grid">
          {journeySteps.map((step) => (
            <article className="journey-step" key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function NatureSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section className="nature-section page-shell" id="nature" aria-labelledby="nature-title">
      <div className="nature-layout">
        <figure className="nature-media">
          <img
            src="/images/fishing-dawn.webp"
            alt="Иллюстративная сцена рыбалки на спокойной воде"
            loading="lazy"
          />
          <figcaption>Иллюстративная фотография</figcaption>
        </figure>

        <div className="nature-content">
          <p className="section-label">Рыбалка и природа</p>
          <h2 id="nature-title">Вода меняет ритм поездки</h2>
          <p className="nature-lead">
            Рыбалка — второе важное направление «Великовского» и самостоятельный сценарий
            для сопровождающих гостей.
          </p>

          <div className="nature-list">
            {natureItems.map((item, index) => (
              <button
                type="button"
                className={activeIndex === index ? "is-active" : ""}
                aria-expanded={activeIndex === index}
                aria-controls={`nature-detail-${index}`}
                onClick={() => setActiveIndex(index)}
                key={item.title}
              >
                <span className="nature-list__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="nature-list__copy">
                  <strong>{item.title}</strong>
                  <small id={`nature-detail-${index}`} hidden={activeIndex !== index}>{item.text}</small>
                </span>
                <ArrowRight size={17} weight="light" />
              </button>
            ))}
          </div>

          <p className="nature-disclaimer">
            Виды рыбы, правила вылова, сезонные ограничения и доступность плавсредств
            подтверждаются перед поездкой. Гарантированный улов не обещается.
          </p>
        </div>
      </div>
    </section>
  );
}

export function StaySection() {
  const [activeStay, setActiveStay] = useState(stays[0].id);
  const stay = stays.find((item) => item.id === activeStay) ?? stays[0];

  return (
    <section className="stay-section" id="stay" aria-labelledby="stay-title">
      <div className="page-shell stay-section__head">
        <div>
          <p className="section-label">Размещение</p>
          <h2 id="stay-title">Вернуться в тёплый дом</h2>
        </div>
        <p>
          Ниже — состав объектов по материалам исходного сайта, а не подтверждённое на
          сегодня предложение.
        </p>
      </div>

      <div className="page-shell stay-layout">
        <figure className="stay-media">
          <img
            src="/images/lodge-interior.webp"
            alt="Иллюстративный интерьер деревянного дома с камином"
            loading="lazy"
          />
          <figcaption>Иллюстративная фотография</figcaption>
        </figure>

        <div className="stay-selector">
          <div className="stay-tabs" role="tablist" aria-label="Варианты размещения">
            {stays.map((item) => (
              <button
                type="button"
                role="tab"
                id={`stay-tab-${item.id}`}
                aria-controls="stay-panel"
                aria-selected={item.id === activeStay}
                tabIndex={item.id === activeStay ? 0 : -1}
                className={item.id === activeStay ? "is-active" : ""}
                onClick={() => setActiveStay(item.id)}
                onKeyDown={(event) => handleTabKey(event, stays, activeStay, setActiveStay, "stay-tab")}
                key={item.id}
              >
                {item.label}
              </button>
            ))}
          </div>

          <article
            className="stay-detail"
            role="tabpanel"
            id="stay-panel"
            aria-labelledby={`stay-tab-${activeStay}`}
          >
            <span className="stay-detail__status">Архивное описание</span>
            <h3>{stay.stat}</h3>
            <p>{stay.text}</p>
            <div className="stay-detail__note">
              <CheckCircle size={18} weight="regular" />
              <span>{stay.note}</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

export function HistorySection() {
  return (
    <section className="history-section" id="history" aria-labelledby="history-title">
      <div className="page-shell history-grid">
        <div className="history-number" aria-hidden="true">
          1673<span>*</span>
        </div>
        <div className="history-copy">
          <p className="section-label section-label--light">Историческая версия компании</p>
          <h2 id="history-title">Охотничья традиция Заволжья</h2>
          <p className="editorial-copy editorial-copy--light">
            По версии, изложенной компанией, история хозяйства связана с освоением
            заволжских угодий, лесными промыслами и указом царя Алексея Михайловича.
          </p>
          <p>
            Утверждение об основании в 1673 году и непрерывности существования не имеет в
            предоставленных материалах независимого архивного подтверждения. Поэтому мы
            показываем его только как часть исторического рассказа компании.
          </p>
          <span className="history-footnote">* Требует документального подтверждения</span>
        </div>
      </div>
    </section>
  );
}

export function TransparencySection() {
  return (
    <section className="transparency page-shell" id="transparency" aria-labelledby="transparency-title">
      <div className="transparency__intro">
        <p className="section-label">До публикации и до поездки</p>
        <h2 id="transparency-title">Сначала уточняем факты</h2>
        <p>
          Архивные цены, сроки, статистика животных и правила не выдаются за актуальные.
          Каждая поездка формируется только после подтверждения условий.
        </p>
      </div>

      <div className="confirmation-list">
        {confirmationItems.map((item, index) => (
          <div className="confirmation-row" key={item}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{item}</p>
            <ShieldCheck size={20} weight="light" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ContactSection({ onPlan }) {
  return (
    <section className="contact-section page-shell" id="contact" aria-labelledby="contact-title">
      <div className="contact-card contact-card--light">
        <p className="section-label">Индивидуальная программа</p>
        <h2 id="contact-title">Обсудить поездку</h2>
        <p>
          Расскажите о составе группы и интересах — охоте, рыбалке, семейном или
          коллективном отдыхе.
        </p>
        <button type="button" className="pill-button" onClick={onPlan}>
          Составить запрос <ArrowRight size={17} weight="regular" />
        </button>
      </div>

      <div className="contact-card contact-card--photo">
        <img
          src="/images/riverside-rest.webp"
          alt="Иллюстративная сцена отдыха семьи на берегу Волги"
          loading="lazy"
        />
        <span className="contact-card__caption">Иллюстративное изображение</span>
        <div className="contact-card__photo-copy">
          <p className="section-label section-label--light">Подтверждённый контакт</p>
          <h2>Позвонить напрямую</h2>
          <a className="pill-button pill-button--light" href="tel:+79200201516">
            <Phone size={17} weight="regular" /> +7 920 020-15-16
          </a>
        </div>
      </div>
    </section>
  );
}
