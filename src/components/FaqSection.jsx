import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { faqItems } from "../content.js";

export function FaqSection() {
  const [openId, setOpenId] = useState(faqItems[0].id);

  return (
    <section className="faq-section page-shell" id="faq" aria-labelledby="faq-title">
      <div className="faq-section__intro">
        <p className="section-label">Перед поездкой</p>
        <h2 id="faq-title">Частые вопросы</h2>
        <p>Коротко о том, что обычно важно согласовать до выбора дат.</p>
      </div>

      <div className="faq-list">
        {faqItems.map((item, index) => {
          const isOpen = item.id === openId;
          const buttonId = `faq-question-${item.id}`;
          const panelId = `faq-answer-${item.id}`;

          return (
            <article className={`faq-item ${isOpen ? "is-open" : ""}`} key={item.id}>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? "" : item.id)}
              >
                <span className="faq-item__number">{String(index + 1).padStart(2, "0")}</span>
                <span>{item.question}</span>
                <CaretDown size={18} weight="regular" />
              </button>
              <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen}>
                <p>{item.answer}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
