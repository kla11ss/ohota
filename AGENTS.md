# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Keep the hero and footer «ВЕЛИКОВСКОЕ» wordmarks with clear, non-overlapping glyph spacing; never tighten «Е» over «Л».
- The «Организация поездки» block uses an interactive roadmap of the six trip-planning stages, rather than a static card grid.
- Keep the roadmap minimal: no decorative separator lines or horizontal scrollers; on phones, stage numbers are a vertical rail on the left with the selected stage information on the right.
- Place an interactive Yandex Maps widget for «Охотхозяйство Великовское» directly below the contact cards.
- Place the stay section before the static Yandex Maps reviews section, and include «Отзывы» in the main menu; use eight more substantive exact review quotations and an accessible, swipeable rail that advances one card every 3 seconds, wrapping continuously from the final review back to the first and pausing on hover and keyboard focus.
- On mobile, keep the hero links for «Охота», «Рыбалка» and «Размещение» visible together as three equal cards; do not hide accommodation behind a horizontal rail.
  - Keep a clear «Запланировать поездку» CTA on the hero, place FAQ before contacts, centralize trip conditions in «Важно перед поездкой», keep the mobile map compact, and ensure the mobile wordmark fits fully without overlapping letters.
  - Send «Запланировать поездку» form submissions through a server-side Telegram endpoint using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; never expose either value in client code or Git.
