import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";

export function JourneyRoadmap({ items, onPlan }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = items[activeIndex];

  return (
    <div className="journey-roadmap" aria-label="Этапы организации поездки">
      <ol className="journey-roadmap__track">
        {items.map((item, index) => {
          const isActive = index === activeIndex;

          return (
            <li className="journey-roadmap__step" key={item.number}>
              <button
                type="button"
                aria-pressed={isActive}
                aria-label={`Этап ${item.number}: ${item.title}`}
                className={isActive ? "is-active" : ""}
                onClick={() => setActiveIndex(index)}
              >
                <span className="journey-roadmap__number">{item.number}</span>
                <span className="journey-roadmap__marker" aria-hidden="true" />
                <span className="journey-roadmap__step-title">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="journey-roadmap__detail" aria-live="polite" key={activeItem.number}>
        <div className="journey-roadmap__meta">
          <span>
            {String(activeIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
          </span>
        </div>

        <div className="journey-roadmap__copy">
          <h3>{activeItem.title}</h3>
          <div>
            <p>{activeItem.text}</p>
            <button type="button" className="journey-roadmap__action" onClick={onPlan}>
              Обсудить этот этап <ArrowRight size={17} weight="regular" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
