import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Star } from "@phosphor-icons/react";

const reviewsSourceUrl =
  "https://yandex.ru/maps/org/okhotkhozyaystvo_velikovskoye/240564135810/reviews/";

const reviews = [
  {
    author: "Анонимный отзыв",
    initials: "А",
    rating: 5,
    date: "29 августа 2019",
    text: "Прекрасное место, отличная организация охоты и отдыха, профессиональный и заботливый персонал.",
  },
  {
    author: "Евгений Недошивин",
    initials: "ЕН",
    rating: 5,
    date: "30 октября 2023",
    text: "Бываем каждый год! Всё нравится!",
  },
  {
    author: "АЛЕК СЕЙП",
    initials: "АС",
    rating: 5,
    date: "8 октября 2023",
    text: "Очень уютное место, Волга рядом.",
  },
  {
    author: "Алексей М.",
    initials: "АМ",
    rating: 5,
    date: "14 марта 2019",
    text: "Хорошее сопровождение. Хорошая охота.",
  },
  {
    author: "Екатерина Огородникова",
    initials: "ЕО",
    rating: 5,
    date: "26 января 2019",
    text: "Природа супер! Персонал супер! Охота и рыбалка на высоте! Очень рекомендую! Даже просто с семьёй можно приехать отдыхать!",
  },
  {
    author: "Инкогнито 4579",
    initials: "И4",
    rating: 5,
    date: "29 декабря 2023",
    text: "Лучшее охотхозяйство, радушный персонал,адекватные цены",
  },
  {
    author: "Александр",
    initials: "А",
    rating: 5,
    date: "1 апреля 2025",
    text: "Супер классное место. Для души и тела. Побольше бы таких мест для отдыха.",
  },
  {
    author: "Алексей Володин",
    initials: "АВ",
    rating: 5,
    date: "22 августа 2018",
    text: "Много мест для охоты. Приветливый персонал. Всё отлично.",
  },
];

const loopedReviews = Array.from({ length: 3 }, (_, loopIndex) =>
  reviews.map((review, reviewIndex) => ({
    ...review,
    isClone: loopIndex > 0,
    loopIndex,
    reviewIndex,
  })),
).flat();

function Rating({ value }) {
  return (
    <div className="review-card__rating" aria-label={`Оценка ${value} из 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          className={index < value ? "is-filled" : ""}
          key={index}
          size={15}
          weight={index < value ? "fill" : "regular"}
        />
      ))}
    </div>
  );
}

export function ReviewsSection() {
  const listRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!list || isPaused || reduceMotion.matches) return undefined;

    const advance = () => {
      if (document.hidden) return;
      const firstCard = list.querySelector(".review-card");
      if (!firstCard) return;
      const gap = Number.parseFloat(window.getComputedStyle(list).columnGap) || 0;
      const stride = firstCard.getBoundingClientRect().width + gap;
      const loopLength = stride * reviews.length;
      const nextPosition = list.scrollLeft + stride;

      if (nextPosition > loopLength + 1) {
        list.style.scrollBehavior = "auto";
        list.scrollLeft = 0;
        list.style.removeProperty("scroll-behavior");
        return;
      }

      list.scrollTo({ left: nextPosition, behavior: "smooth" });
    };

    const intervalId = window.setInterval(advance, 3000);
    return () => window.clearInterval(intervalId);
  }, [isPaused]);

  return (
    <section className="reviews-section page-shell" id="reviews" aria-labelledby="reviews-title">
      <div className="reviews-section__head">
        <div>
          <p className="section-label">Отзывы гостей</p>
          <h2 id="reviews-title">О впечатлениях после поездки</h2>
        </div>
        <div className="reviews-section__source">
          <p>8 цитат из 21 отзыва на Яндекс Картах</p>
          <a href={reviewsSourceUrl} target="_blank" rel="noreferrer">
            Все отзывы в Яндекс Картах <ArrowUpRight size={17} weight="regular" />
          </a>
        </div>
      </div>

      <div
        className="reviews-list"
        aria-label="Отзывы гостей"
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsPaused(false);
        }}
        onFocusCapture={() => setIsPaused(true)}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        ref={listRef}
      >
        {loopedReviews.map((review) => (
          <article
            aria-hidden={review.isClone}
            aria-label={review.isClone ? undefined : `Отзыв ${review.reviewIndex + 1} из ${reviews.length}`}
            className="review-card"
            key={`${review.author}-${review.date}-${review.loopIndex}`}
          >
            <div className="review-card__meta">
              <div className="review-card__person">
                <span aria-hidden="true" className="review-card__initials">
                  {review.initials}
                </span>
                <div>
                  <p className="review-card__author">{review.author}</p>
                  <p className="review-card__date">{review.date}</p>
                </div>
              </div>
              <Rating value={review.rating} />
            </div>

            <p className="review-card__text">«{review.text}»</p>

            <a
              className="review-card__source"
              href={reviewsSourceUrl}
              rel="noreferrer"
              tabIndex={review.isClone ? -1 : undefined}
              target="_blank"
            >
              Яндекс Карты <ArrowUpRight size={13} weight="regular" />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
