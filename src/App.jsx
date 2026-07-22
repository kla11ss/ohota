import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hero } from "./components/Hero.jsx";
import { FaqSection } from "./components/FaqSection.jsx";
import { ReviewsSection } from "./components/ReviewsSection.jsx";
import { SiteHeader } from "./components/SiteHeader.jsx";
import { SiteFooter } from "./components/SiteFooter.jsx";
import {
  ContactSection,
  DirectionsSection,
  HistorySection,
  HuntingSection,
  IntroSection,
  JourneySection,
  NatureSection,
  StaySection,
  TerritorySection,
  TransparencySection,
} from "./components/Sections.jsx";
import { TripModal } from "./components/TripModal.jsx";
import { AccommodationMapAdmin } from "./components/AccommodationMapAdmin.jsx";

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planView, setPlanView] = useState("trip");
  const [planStayId, setPlanStayId] = useState("hotel-room");
  const [planStayUnitIds, setPlanStayUnitIds] = useState([]);
  const [floatingPlanCta, setFloatingPlanCta] = useState(() => (
    typeof window !== "undefined"
    && window.location.hash !== ""
    && window.location.hash !== "#top"
  ));
  const shellRef = useRef(null);
  const planAnchorRef = useRef(null);

  useLayoutEffect(() => {
    const anchor = planAnchorRef.current;
    if (!anchor) return undefined;

    let observer;
    let firstFrame;
    let secondFrame;

    const updateFromPosition = () => {
      setFloatingPlanCta(anchor.getBoundingClientRect().bottom <= 70);
    };

    const startTracking = () => {
      updateFromPosition();

      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(
          ([entry]) => setFloatingPlanCta(entry.boundingClientRect.bottom <= 70),
          {
            root: null,
            rootMargin: "-70px 0px 0px 0px",
            threshold: [0, 1],
          },
        );
        observer.observe(anchor);
      } else {
        window.addEventListener("scroll", updateFromPosition, { passive: true });
      }

      window.addEventListener("resize", updateFromPosition, { passive: true });
      window.addEventListener("hashchange", updateFromPosition);
    };

    const scrollToInitialHashTarget = () => {
      const rawTargetId = window.location.hash.slice(1);
      if (!rawTargetId) return;

      let targetId = rawTargetId;
      try {
        targetId = decodeURIComponent(rawTargetId);
      } catch {
        // Keep the literal hash for malformed percent-encoding.
      }

      document.getElementById(targetId)?.scrollIntoView();
    };

    const startsAtSectionHash = window.location.hash !== "" && window.location.hash !== "#top";
    if (startsAtSectionHash) {
      firstFrame = window.requestAnimationFrame(() => {
        scrollToInitialHashTarget();
        secondFrame = window.requestAnimationFrame(startTracking);
      });
    } else {
      startTracking();
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      observer?.disconnect();
      window.removeEventListener("scroll", updateFromPosition);
      window.removeEventListener("resize", updateFromPosition);
      window.removeEventListener("hashchange", updateFromPosition);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-locked", menuOpen || planOpen);
    return () => document.body.classList.remove("is-locked");
  }, [menuOpen, planOpen]);

  useEffect(() => {
    shellRef.current?.toggleAttribute("inert", planOpen);
    return () => shellRef.current?.removeAttribute("inert");
  }, [planOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closePlan = useCallback(() => setPlanOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((value) => !value), []);
  const openPlan = useCallback(() => {
    setMenuOpen(false);
    setPlanView("trip");
    setPlanOpen(true);
  }, []);
  const openStayPlan = useCallback((stayId = "hotel-room", unitIds = []) => {
    setMenuOpen(false);
    setPlanStayId(stayId);
    setPlanStayUnitIds(Array.isArray(unitIds) ? unitIds : []);
    setPlanView("stay");
    setPlanOpen(true);
  }, []);

  if (typeof window !== "undefined" && window.location.pathname === "/admin/accommodation-map") {
    return <AccommodationMapAdmin />;
  }

  return (
    <>
      <div ref={shellRef}>
        <a className="skip-link" href="#main-content">Перейти к содержанию</a>
        <SiteHeader
          menuOpen={menuOpen}
          onMenuToggle={toggleMenu}
          onMenuClose={closeMenu}
          onPlan={openPlan}
          showFloatingPlanCta={floatingPlanCta}
        />
        <main id="main-content">
          <Hero
            onPlan={openPlan}
            planAnchorRef={planAnchorRef}
            showPlanCta={!floatingPlanCta}
          />
          <IntroSection />
          <DirectionsSection />
          <TerritorySection />
          <HuntingSection />
          <JourneySection onPlan={openPlan} />
          <NatureSection />
          <StaySection onBook={openStayPlan} />
          <ReviewsSection />
          <HistorySection />
          <TransparencySection />
          <FaqSection />
          <ContactSection onPlan={openPlan} />
        </main>
        <SiteFooter />
      </div>
      <TripModal
        open={planOpen}
        initialView={planView}
        initialStayId={planStayId}
        initialUnitIds={planStayUnitIds}
        onClose={closePlan}
      />
    </>
  );
}
