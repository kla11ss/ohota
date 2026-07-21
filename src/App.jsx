import { useCallback, useEffect, useRef, useState } from "react";
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

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planView, setPlanView] = useState("trip");
  const [planStayId, setPlanStayId] = useState("hotel-room");
  const shellRef = useRef(null);

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
  const openStayPlan = useCallback((stayId = "hotel-room") => {
    setMenuOpen(false);
    setPlanStayId(stayId);
    setPlanView("stay");
    setPlanOpen(true);
  }, []);

  return (
    <>
      <div ref={shellRef}>
        <a className="skip-link" href="#main-content">Перейти к содержанию</a>
        <SiteHeader
          menuOpen={menuOpen}
          onMenuToggle={toggleMenu}
          onMenuClose={closeMenu}
          onPlan={openPlan}
        />
        <main id="main-content">
          <Hero onPlan={openPlan} />
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
        onClose={closePlan}
      />
    </>
  );
}
