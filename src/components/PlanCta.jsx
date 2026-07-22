import { ArrowRight } from "@phosphor-icons/react";

export function PlanCta({ onClick, variant = "hero" }) {
  const className = variant === "floating"
    ? "floating-plan-cta__button"
    : "pill-button hero__cta";

  return (
    <button type="button" className={className} onClick={onClick}>
      Запланировать поездку <ArrowRight size={17} weight="regular" />
    </button>
  );
}
