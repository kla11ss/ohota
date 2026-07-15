import { ArrowDown, ArrowRight } from "@phosphor-icons/react";
import { heroStories } from "../content.js";

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <img
        className="hero__background"
        src="/images/hero-forest.webp"
        alt="Человек идёт по туманному сосновому лесу"
        fetchPriority="high"
      />

      <div className="hero__copy">
        <p className="hero__location">Нижегородское Заволжье</p>
        <p>
          «Великовское» — индивидуально согласуемые сценарии охоты, рыбалки, размещения и
          природного отдыха на левом берегу Волги.
        </p>
      </div>

      <span className="hero__image-note">Иллюстративное изображение</span>

      <div className="hero__stories" aria-label="Основные направления">
        <div className="hero__stories-intro">
          <span>Одна поездка</span>
          <p>Несколько способов прожить Заволжье</p>
        </div>
        <div className="hero__stories-grid">
          {heroStories.map((story) => (
            <a className="story-card" href={story.href} key={story.label}>
              <img src={story.image} alt="" />
              <span className="story-card__label">
                <strong>{story.label}</strong>
                <small>{story.meta}</small>
              </span>
              <ArrowRight size={16} weight="regular" />
            </a>
          ))}
        </div>
      </div>

      <a className="hero__scroll" href="#intro">
        Листайте <ArrowDown size={16} weight="regular" />
      </a>

      <h1 className="hero__wordmark" id="hero-title">
        ВЕЛИКОВСКОЕ
      </h1>
    </section>
  );
}
