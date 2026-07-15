# Design QA — «Великовское»

## Visual truth and implementation

- Reference: `C:/Users/ОЛЕГ!/Downloads/Telegram Desktop/screenshot-56c5c31b-df91-4ad6-9b8a-ee65789b2021.png`
- Reference native size: `1920 × 11935`; reference first viewport: `1920 × 1080`.
- Implementation: `http://localhost:4173/`
- Native implementation first viewport: `qa/screenshots/native-hero-final.png` at `1920 × 1080`.
- Direct first-screen comparison: `qa/hero-comparison-final.jpg`.
- Long-page section comparison: `qa/full-view-montage-final.jpg`.
- Mobile evidence: `qa/screenshots/mobile-hero-final.png`, `mobile-directions-final.png`, `mobile-hunting-final.png`, `mobile-contact-final.png`, `mobile-menu-final.png`, `mobile-modal-final.png` at `390 × 844`.

The source reference, the latest native implementation screenshot, the direct side-by-side comparison, and the long-page montage were inspected with `view_image`. The page was also rendered and exercised in the Codex in-app Browser.

## Comparison points

1. The hero keeps the reference composition: full-bleed moody forest, short editorial copy at left, compact dark story cluster at right, a small menu pill in the upper-right corner, and an oversized thin wordmark at the bottom.
2. The implementation preserves the reference cadence of expansive white editorial sections interrupted by full-bleed dark or photographic sections.
3. The type hierarchy follows the reference: very large light-weight display headlines, compact uppercase labels, restrained serif editorial copy, and micro-copy for captions and caveats.
4. Components use the supplied design-system language: flat surfaces, hairline dividers, 8 px image/card radii, pill actions, no shadows, and the Ink/Paper/Mist/Pine/Ember palette.
5. Direction rows retain the reference's numbered editorial grid and right-aligned photographic media; the hunting, nature, and accommodation sections repeat the same disciplined split-layout rhythm.
6. The final CTA pair now matches the reference more closely: a quiet pale card beside a photo-dominant card with overlaid white copy, followed by an oversized footer wordmark.
7. Long-page heights are closely aligned: the source is 11935 px and the implementation measured 11876 px at the native desktop viewport.

## Above-the-fold copy difference

The reference's investment-company copy (`Aker invests...`, `The Creative`, `Our team`, `Contact`, `Locations`, `Careers`, `AKER`) is intentionally replaced with content from the supplied hunting-estate materials: the Zavolzhye location, an individually agreed trip proposition, three trip directions, the scroll cue, an illustrative-image disclosure, and the `ВЕЛИКОВСКОЕ` wordmark. The structural positions and hierarchy are preserved; the words are domain-specific rather than copied from Aker.

## Findings fixed during QA

- Removed the extra fixed brand badge from lower sections.
- Changed the right contact card from a split black/photo card to a photo-dominant composition matching the reference.
- Added visible disclosure that generated photography is illustrative.
- Reworded unverified services, accommodation, hunting formats, and trip steps so they are not presented as guaranteed current offers.
- Preserved the explicit no-guarantee language for trophy and catch, and kept 1673 as the company's unverified historical version.
- Added focus traps, Escape handling, focus restoration, and `inert` background handling to the menu and request dialog.
- Added complete ARIA relationships and arrow-key navigation to tabs; disclosures now expose `aria-expanded` and controlled regions.
- Added a skip link and a proper heading for the introductory section.
- Increased small-text contrast, restored strong form focus rings, and increased mobile touch targets.
- Converted large PNGs to optimized WebP assets and introduced small story-card thumbnails; the hero is about 213 KB instead of about 2.5 MB.

## Browser verification

- Desktop/native: `1920 × 1080`; no horizontal document overflow (`scrollWidth = clientWidth = 1905`, excluding the browser scrollbar).
- Mobile: `390 × 844`; no document overflow (`scrollWidth = clientWidth = 375`, excluding the browser scrollbar). The horizontal story rail is intentionally scrollable inside its own container.
- Menu: opens, traps focus, marks the page inert, closes with Escape, and restores focus to `Меню`.
- Hunting tabs: arrow-key navigation selects `Птица и малая дичь`; the first disclosure updates and exposes its content.
- Nature disclosures and accommodation tabs update their visible and ARIA states.
- Request path: opens from `Составить запрос`, focuses the name input, accepts realistic mock data, changes the interest selection, reaches the honest local success state, closes with Escape, and restores focus to the initiating CTA.
- Browser console: no warnings or errors.
- Production build: passed with Vite 6.4.2.

## Intentional deviations

- The investment map, team section, and financial metrics are replaced with territory, trip organization, accommodation, historical context, and confirmation checks because no verified map coordinates, team roster, current animal counts, or commercial statistics were supplied.
- Proxima Nova was not supplied; Montserrat is used for the geometric display system and Lora for editorial body accents.
- The request form is a local prototype and explicitly states that it does not send or save data. The confirmed phone number remains the only real contact action.
- Photos are generated art-directed illustrations, visibly labeled as such, not claimed as documentary photography of the estate.

No actionable P0, P1, or P2 visual, responsive, interaction, accessibility, or content-truth issues remain.

final result: passed
