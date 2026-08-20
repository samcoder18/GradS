# Ember Studio Visual Redesign — Design Specification

## Goal

Rework the audit tracker into a polished, calm creative-studio workspace: premium in visual tone, fast to scan, comfortable for recurring chat and task work, and reliable on desktop and mobile. Preserve the existing Supabase data contract and all current chat behaviors.

## Inputs and boundaries

The product request is to fully improve the design and usability. The attached `ember-studio-DESIGN.md` is treated as the visual contract: warm terracotta and amber palette, Playfair Display for display type, Source Sans 3 for interface text, Fira Code for code, a 4px spacing grid, 8px controls, 12px cards/panels, restrained elevation, 256px navigation, and no decorative clutter or cool-gray/pure-black/pure-white substitutions.

This work changes the presentation layer and interaction clarity. It does not change the Supabase schema, RPC names, attachment rules, message semantics, report parser, or task workflow. Existing IDs and data attributes used by `src/app.js` remain stable unless a semantic wrapper is required.

## Experience direction

The interface should feel like a focused project room rather than a generic admin panel:

- Warm white canvas with stone surfaces and clear terracotta active states.
- Editorial serif hierarchy for context and key metrics, paired with a legible sans-serif for dense operational UI.
- Flat bordered cards by default; elevation appears only for hover, dialogs, drawers, and the sticky shell.
- One clear primary action per view. Secondary actions stay quiet and grouped by context.
- Chat is a first-class work surface, not a narrow utility column: messages, reply context, media, reactions, and composer controls must remain easy to distinguish.
- Every state (loading, empty, error, disabled, recording, uploading, fullscreen) uses the same vocabulary and spacing.

## Layout

### App shell

- Desktop shell uses a 256px left navigation rail and a fluid content area capped at 1200px.
- The navigation rail contains the brand mark, workspace label, primary views, and a compact status/footer area. The active item has a 3px terracotta edge and a warm-tinted surface.
- The top bar is sticky, translucent, and gains its bottom border as content scrolls. It exposes the current view context and keeps the most relevant action within reach.
- On widths below 900px, the rail collapses into a compact top navigation without introducing horizontal scroll.

### Board view

- Intro header uses an editorial title, concise supporting copy, and one primary `Добавить задачу` action.
- Progress becomes a deliberate status module: large completion figure, percentage, full-width 4px bar, and four priority summaries with consistent semantic chips.
- Search and filters live in one toolbar card. Labels remain visible above controls on desktop and become compact but accessible on mobile.
- Task cards use a 4px colored left stripe, title/description hierarchy, priority chip, status, metadata, and a clear affordance for opening the task drawer. Hover lifts the card by 2px with a soft shadow.
- The board grid gives the task stream the majority of space while keeping chat visible on desktop. The chat rail has a minimum comfortable width and can become fullscreen without reflowing the page underneath.

### Report view

- Report header follows the same title/eyebrow/action pattern as the board.
- Section navigation is visually subordinate but easy to scan; active sections use terracotta text and a left accent.
- Disclosure content uses readable line length, consistent headings, tables, blockquotes, links, and code styling from the Ember system.

## Chat redesign

- Header combines the chat label, message count, collaboration context, and fullscreen action in a single balanced row.
- Message cards show author, timestamp, body, reply quote, attachments, reactions, and actions in a stable order. The message body remains the strongest visual element.
- Reply quotes use a 3px terracotta edge and a warm surface. Activating a quote scrolls to and briefly highlights the source message.
- Photo attachments use a restrained thumbnail grid with predictable aspect ratios. Audio uses a native player inside a labeled warm surface.
- Reactions are compact chips: 👍, ❤️, 🎉, 👀, with count and active state. They remain usable by keyboard and have accessible labels.
- The composer is a layered control: reply banner, attachment drafts, text field, and action row. Photo/audio selection, voice recording, upload errors, and submit state share one visual language.
- Fullscreen mode fills the viewport, locks page scrolling, preserves Escape handling, and restores focus to the trigger. The fullscreen shell has a wider reading column and a composer anchored to the bottom edge without covering messages.

## Design tokens

Use CSS custom properties so every surface and state uses the same source of truth:

- Primary terracotta: `#C2410C`; hover/burnt sienna: `#9A3412`.
- Amber attention accent: `#F59E0B`.
- Warm neutrals: background `#FAFAF9`, surface `#F5F5F4`, raised surface `#E7E5E4`, border `#D6D3D1`.
- Text: primary `#1C1917`, secondary `#57534E`, muted stone `#78716C`.
- Semantic states: success `#16A34A`, warning `#D97706`, error `#DC2626`.
- Type: Playfair Display for display/headings, Source Sans 3 for UI/body, Fira Code for code.
- Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px.
- Radius: 8px controls, 12px cards/panels/dialogs, pill radius only for chips/avatars/progress.
- Motion: 150ms control transitions, 300ms progress transitions; honor `prefers-reduced-motion`.

## Accessibility and responsive rules

- Keep semantic landmarks, tab/tabpanel relationships, dialog labels, live status regions, and skip-link behavior intact.
- Focus rings use terracotta with sufficient contrast and 3px offset.
- Interactive targets are at least 40px on touch layouts.
- At 900px and below, board columns stack intentionally; at 640px and below, cards and composer actions fit within the viewport with no horizontal overflow.
- Fullscreen Escape, reply cancellation, file selection, recording errors, and upload errors must remain keyboard reachable and screen-reader announced.
- Do not depend on color alone for priority, status, recording, or active reactions.

## Implementation scope

Expected primary files:

- `index.html`: semantic shell/navigation wrappers, font loading, improved labels and icon text where needed.
- `styles.css`: complete Ember token layer, shell/layout/component styling, responsive states, reduced-motion rules.
- `src/app.js`: only presentation markup changes required for the new message/task hierarchy and state classes; preserve behavior and selectors.
- `test/app.test.js`, `test/build.test.js`, and focused DOM/build assertions: verify semantic hooks, responsive-safe markup, and critical state affordances.
- `docs/superpowers/plans/2026-08-20-ember-studio-redesign.md`: implementation plan.

No new runtime dependency or icon package is needed; use accessible text/inline SVG only where the existing glyph controls are insufficient.

## Validation

- Run the existing Node/Vitest suite after each implementation task and the full suite before handoff.
- Build the static artifact with `scripts/build.mjs` and run its validation checks.
- Manually inspect the running app at desktop and 390px mobile widths: shell hierarchy, task scanability, report readability, chat composer, attachments, reactions, reply focus, fullscreen, Escape, and no horizontal overflow.
- Verify the final worktree is clean apart from the intended commit(s), and document any environment-only limitations.
