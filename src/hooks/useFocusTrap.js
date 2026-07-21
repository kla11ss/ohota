import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(active, containerRef, onEscape, initialFocusRef) {
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    previousFocusRef.current = document.activeElement;

    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      window.requestAnimationFrame(() => previousFocus?.focus?.());
    };
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return undefined;

    const getFocusable = () =>
      Array.from(container.querySelectorAll(focusableSelector)).filter(
        (element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true",
      );

    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? getFocusable()[0])?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, containerRef, initialFocusRef, onEscape]);
}
