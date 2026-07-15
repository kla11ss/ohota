import { useEffect, useRef } from "react";
import { ArrowRight, List, Phone, X } from "@phosphor-icons/react";
import { navItems } from "../content.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

export function SiteHeader({ menuOpen, onMenuToggle, onMenuClose, onPlan }) {
  const headerRef = useRef(null);
  const handleNav = () => onMenuClose();
  useFocusTrap(menuOpen, headerRef, onMenuClose);

  useEffect(() => {
    const background = [document.querySelector("main"), document.querySelector(".site-footer")];
    background.forEach((element) => element?.toggleAttribute("inert", menuOpen));
    return () => background.forEach((element) => element?.removeAttribute("inert"));
  }, [menuOpen]);

  return (
    <header className="site-header" ref={headerRef}>
      <button
        className="menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-menu"
        onClick={onMenuToggle}
      >
        <span>{menuOpen ? "Закрыть" : "Меню"}</span>
        {menuOpen ? <X size={16} weight="regular" /> : <List size={17} weight="regular" />}
      </button>

      <div
        id="site-menu"
        className={`menu-panel ${menuOpen ? "is-open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <div className="menu-panel__top">
          <p>Охота, рыбалка и отдых на Волге</p>
          <span>Село Великовское</span>
        </div>

        <nav className="menu-panel__nav" aria-label="Основная навигация">
          {navItems.map((item, index) => (
            <a key={item.href} href={item.href} onClick={handleNav} tabIndex={menuOpen ? 0 : -1}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <ArrowRight size={18} weight="light" />
            </a>
          ))}
        </nav>

        <div className="menu-panel__actions">
          <button type="button" className="text-link text-link--light" onClick={onPlan} tabIndex={menuOpen ? 0 : -1}>
            Обсудить программу <ArrowRight size={17} weight="regular" />
          </button>
          <a href="tel:+79200201516" className="menu-phone" tabIndex={menuOpen ? 0 : -1}>
            <Phone size={16} weight="regular" />
            +7 920 020-15-16
          </a>
        </div>
      </div>

      {menuOpen ? (
        <button
          className="menu-scrim"
          type="button"
          tabIndex={-1}
          aria-label="Закрыть меню"
          onClick={onMenuClose}
        />
      ) : null}
    </header>
  );
}
