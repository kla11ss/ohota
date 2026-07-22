# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Keep the hero and footer «ВЕЛИКОВСКОЕ» wordmarks with clear, non-overlapping glyph spacing; never tighten «Е» over «Л».
- The «Организация поездки» block uses an interactive roadmap of the six trip-planning stages, rather than a static card grid.
- Keep the roadmap minimal: no decorative separator lines or horizontal scrollers; on phones, stage numbers are a vertical rail on the left with the selected stage information on the right.
- Place an interactive Yandex Maps widget for «Охотхозяйство Великовское» directly below the contact cards.
- Use one shared accommodation-request screen inside the trip-planning modal, opened both from «Размещение» and from the trip form; mirror the reference’s two-month calendar logic while keeping the site’s visual language, treat dates and prices as a request pending manager confirmation, and require a phone number.
- Place the stay section before the static Yandex Maps reviews section, and include «Отзывы» in the main menu; use eight more substantive exact review quotations and an accessible, swipeable rail that advances one card every 3 seconds, wrapping continuously from the final review back to the first and pausing on hover and keyboard focus.
- On mobile, keep the hero links for «Охота», «Рыбалка» and «Размещение» visible together as three equal cards; do not hide accommodation behind a horizontal rail.
  - Keep a clear «Запланировать поездку» CTA on the hero, place FAQ before contacts, centralize trip conditions in «Важно перед поездкой», keep the mobile map compact, and ensure the mobile wordmark fits fully without overlapping letters.
  - Send «Запланировать поездку» form submissions through a server-side Telegram endpoint using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; never expose either value in client code or Git.
- Use a private Telegram forum as the manager UI: accommodation requests go to «Новые заявки», approved bookings to «Подтверждённые», rejected/cancelled requests to «Архив», and ordinary trip forms to «Запросы на поездку»; only the owner can use booking-management buttons.
- Only a Telegram-confirmed accommodation request blocks dates. Rejection never creates occupancy; cancellation archives the request and releases its half-open `[check-in, check-out)` interval.
- Keep accommodation range selection contiguous for any duration inside the 12-month window: successive clicks on later dates extend checkout beyond two nights; confirmed nights cannot be stayed on, while an occupied date may still serve as the checkout boundary when every preceding night is free.
- Keep booking occupancy in server-only Neon/Postgres and deploy the public app/API through Netlify. Store no guest phone, name or comment in Postgres; those details remain only in Telegram.
- Ordinary trip requests in «Запросы на поездку» include an owner-only «✅ Рассмотрено» action that moves a single buttonless copy to «Архив» and removes or compacts the source message; persist only technical routing IDs and state, never guest text or contact data.
- Keep one accessible «Запланировать поездку» CTA: it stays in its original hero position until that anchor passes 70 px, then floats at the right below the menu with the same graphite pill styling and full label on desktop and mobile; hide it while the menu is open and restore focus after the planning dialog closes.
- The accommodation scheme is guest-visible only after an owner publishes a valid version. Use a prepared, licensed site-relative image path for the plan and individual accommodation photos; do not use the Yandex Static API or publish a placeholder as a real territory plan.
- Keep the desktop accommodation list and mobile native select synchronized with four scheme markers. Selecting «Дома охотника» highlights both houses; selecting one house opens accommodation booking with that exact house preselected.
- The temporary owner editor remains at `/admin/accommodation-map`; it accepts no browser uploads and is protected by server-only `ACCOMMODATION_EDITOR_PASSWORD` and `ACCOMMODATION_EDITOR_SESSION_SECRET` values.
- Use native vertical `scroll-snap-type: y proximity` only above 700 px and outside reduced-motion, menu, and modal states. Never replace native scrolling with JavaScript auto-scroll or mandatory snapping.
