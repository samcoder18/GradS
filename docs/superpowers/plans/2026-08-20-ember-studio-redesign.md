# Ember Studio Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the audit tracker's current red/cream interface with the approved Ember Studio shell and component system while preserving all current task, report, chat, attachment, reaction, reply, and fullscreen behavior.

**Architecture:** Keep the existing single-page HTML and DOM-driven `src/app.js` architecture. Add a semantic app shell around the existing panels, retain all behavior-critical IDs/data attributes, and consolidate the visual layer in `styles.css` using Ember CSS custom properties and responsive media queries. No runtime dependency or Supabase/API change is required.

**Tech Stack:** Semantic HTML, CSS custom properties, responsive CSS, Google Fonts (Playfair Display, Source Sans 3, Fira Code), existing vanilla JavaScript, Vitest, static build script.

**Spec:** `docs/superpowers/specs/2026-08-20-ember-studio-redesign.md`

## Global Constraints

- Use `#C2410C` terracotta for primary actions and active states; use `#9A3412` for hover and `#F59E0B` sparingly for attention.
- Use `#FAFAF9`, `#F5F5F4`, `#E7E5E4`, `#D6D3D1`, `#1C1917`, `#57534E`, and `#78716C` as the warm neutral system; do not introduce cool-gray or pure black/white replacements.
- Use Playfair Display for display/headings, Source Sans 3 for interface/body, and Fira Code for code.
- Keep 4px spacing increments, 8px control radii, 12px card/panel radii, and pill radii only for chips, avatars, and progress bars.
- Preserve current IDs, `role`/`aria` relationships, `data-*` mutation hooks, Supabase calls, and chat state behavior.
- Honor `prefers-reduced-motion`; keep keyboard focus, Escape, fullscreen, and mobile no-overflow behavior accessible.

---

### Task 1: Add the Ember shell contract and semantic navigation

**Files:**
- Modify: `test/build.test.js`
- Modify: `test/app.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: Existing `#tracker-tab`, `#report-tab`, `.brand`, `#main-content`, and view panel IDs used by `src/app.js`.
- Produces: `.app-shell`, `.site-sidebar`, `.workspace-identity`, `.topbar-context`, and a single `.view-tabs` navigation that remain stable for the CSS and tests.

- [ ] **Step 1: Write failing structural tests**

Add a build test that reads `index.html` and asserts the shell contract:

```js
test('ships the Ember Studio shell and typography hooks', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  expect(html).toContain('class="app-shell"');
  expect(html).toContain('class="site-sidebar"');
  expect(html).toContain('class="workspace-identity"');
  expect(html).toContain('class="topbar-context"');
  expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Playfair\+Display/);
  expect(html).toMatch(/family=Source\+Sans\+3/);
});
```

Add a DOM assertion to the first app rendering test:

```js
expect(document.querySelector('.site-sidebar .view-tabs')).not.toBeNull();
expect(document.querySelector('.topbar-context')).not.toBeNull();
expect(document.querySelector('.workspace-identity')).not.toBeNull();
```

- [ ] **Step 2: Run the focused tests and confirm the expected RED failure**

Run:

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false test/build.test.js test/app.test.js
```

Expected: the new shell assertions fail because the current document has no Ember shell wrappers or Google Fonts links.

- [ ] **Step 3: Add semantic shell markup without changing behavior hooks**

Update `index.html` so the body contains this structural order while retaining all existing IDs and `data-*` attributes:

```html
<div class="app-shell">
  <aside class="site-sidebar" aria-label="Навигация по рабочей области">
    <div class="workspace-identity">
      <a class="brand" href="./" aria-label="Трекер аудита — главная">
        <span class="brand-mark" aria-hidden="true">АГ</span>
        <span class="brand-copy"><strong>Сладкий Град</strong><small>Audit workspace</small></span>
      </a>
    </div>
    <nav class="view-tabs" aria-label="Основная навигация" role="tablist">
      <button id="tracker-tab" type="button" role="tab" aria-selected="true" aria-controls="tracker">Доска</button>
      <button id="report-tab" type="button" role="tab" aria-selected="false" aria-controls="report" tabindex="-1">Отчёт</button>
    </nav>
    <div class="sidebar-footer"><span class="status-dot" aria-hidden="true"></span><span>Общая доска активна</span></div>
  </aside>
  <div class="app-content">
    <header class="site-header">
      <div class="topbar-context"><span class="topbar-kicker">Общая доска</span><strong>Аудит · Сладкий Град</strong></div>
      <div class="topbar-meta"><span>19 августа 2026</span><span class="topbar-status"><span class="status-dot" aria-hidden="true"></span>Синхронизировано</span></div>
    </header>
    <main id="main-content" tabindex="-1"></main>
  </div>
</div>
```

Move the existing `#tracker` section, `#report` section, and all dialogs/drawer verbatim into `#main-content`; the empty `main` body in the shell excerpt only represents that move and is not a literal final file. Keep `.brand`, `#tracker`, `#report`, and every dialog ID intact. Add the Google Fonts stylesheet link in `<head>` with `display=swap`, and keep the existing local stylesheet as the only runtime CSS file.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command from Step 2. Expected: all existing app/build tests and the new shell assertions pass.

- [ ] **Step 5: Commit the semantic shell**

```bash
git add -- index.html test/app.test.js test/build.test.js
git commit -m "feat: add Ember Studio app shell"
```

### Task 2: Replace the base stylesheet with the Ember token and shell system

**Files:**
- Modify: `test/build.test.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: The shell classes from Task 1 and existing component classes in `index.html`/`src/app.js`.
- Produces: CSS tokens, typography, focus states, shell layout, sticky top bar, sidebar behavior, and responsive foundations used by all later component styling.

- [ ] **Step 1: Write failing CSS contract tests**

Extend the build test to read `styles.css` and assert the agreed system:

```js
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
expect(styles).toContain('--primary: #C2410C');
expect(styles).toContain('--surface-raised: #E7E5E4');
expect(styles).toContain('font-family: "Playfair Display"');
expect(styles).toContain('.site-sidebar');
expect(styles).toContain('@media (max-width: 900px)');
expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
```

- [ ] **Step 2: Run the focused build test and confirm RED**

Run:

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false test/build.test.js
```

Expected: the new CSS contract assertions fail against the existing red/cream token names and typography.

- [ ] **Step 3: Implement the base Ember stylesheet**

Replace the legacy root tokens and global rules with:

```css
:root {
  color-scheme: light;
  --primary: #C2410C;
  --primary-hover: #9A3412;
  --accent: #F59E0B;
  --background: #FAFAF9;
  --surface: #F5F5F4;
  --surface-raised: #E7E5E4;
  --text-primary: #1C1917;
  --text-secondary: #57534E;
  --text-muted: #78716C;
  --border: #D6D3D1;
  --success: #16A34A;
  --warning: #D97706;
  --error: #DC2626;
  --font-display: "Playfair Display", Georgia, serif;
  --font-body: "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
  --font-code: "Fira Code", ui-monospace, monospace;
  --shadow-hover: 0 4px 16px rgb(28 25 23 / 6%);
  --shadow-dialog: 0 24px 48px rgb(28 25 23 / 12%);
  font-family: var(--font-body);
}
```

Implement a 256px `.site-sidebar` with a 1px right border, `.app-content` as the flexible column, `.site-header` as the translucent sticky top bar, and `main` capped at 1200px with 24px horizontal padding. Set terracotta focus rings, 150ms control transitions, 4px/8px/12px/16px spacing primitives, and the reduced-motion override. Do not add a second navigation instance or new runtime script.

- [ ] **Step 4: Run the CSS/build checks and existing suite**

Run:

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false test/build.test.js test/app.test.js
```

Expected: focused tests pass and no existing DOM behavior regresses.

- [ ] **Step 5: Commit the base system**

```bash
git add -- styles.css test/build.test.js
git commit -m "feat: establish Ember Studio design system"
```

### Task 3: Polish board, progress, tasks, report, dialogs, and forms

**Files:**
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `index.html` only if a label/wrapper is needed for an existing visual region

**Interfaces:**
- Consumes: Existing `.hero-row`, `.progress-panel`, `.filters`, `.task-list`, `.task-card`, `.report-*`, dialog, drawer, form, and status selectors.
- Produces: Premium board/report surfaces with stable scan order and consistent control states; no changes to mutation selectors or app logic.

- [ ] **Step 1: Write a failing source-level component contract**

Add CSS assertions to the build test:

```js
expect(styles).toContain('.task-card::before');
expect(styles).toContain('.task-card:hover');
expect(styles).toContain('.report-navigation a[aria-current="true"]');
expect(styles).toContain('.dialog-card');
expect(styles).toContain('border-radius: 12px');
```

Extend the report navigation DOM test so a clicked section link becomes the current item:

```js
const reportLink = document.querySelector('#report-navigation a');
reportLink.click();
expect(reportLink.getAttribute('aria-current')).toBe('true');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run the build test command from Task 2, Step 2 and verify it fails on the new component assertions.

- [ ] **Step 3: Implement the board and report components**

Style the approved surfaces as follows:

- `.view-panel` uses 32–48px section spacing; `.hero-row` and `.report-header` use a readable max-width and one primary action.
- `.progress-panel`, `.task-card`, `.chat-panel`, `.report-navigation`, `.report-section`, `.dialog-card`, and `.drawer-card` use `--surface`, `--border`, 12px radius, and flat elevation by default.
- `.progress-percent` and major `h1`/`h2` use `var(--font-display)` with tight but readable tracking; body and controls use `var(--font-body)`.
- `.filters` becomes a unified toolbar card with labels in 14px semibold text, 40px inputs, terracotta focus, and clear disabled/error states.
- `.task-card` uses the 4px left priority stripe, `--surface` background, 16px padding, 2px hover lift, and a compact footer; P0/P1/P2/P3 use semantic color plus text labels, not color alone.
- `.priority-progress`, `.priority-stat`, `.priority-badge`, `.count-badge`, completion states, empty states, and error banners use the Ember semantic colors and no cool blue.
- `.report-layout` uses a narrow sticky navigation rail and a readable content column; disclosure summaries, headings, tables, links, blockquotes, and code use the same warm system. In `src/app.js`, the report navigation click handler removes `aria-current` from sibling links and sets `aria-current="true"` on the activated link so the active style is semantic.
- `.dialog-card` and `.drawer-card` use the 24px/48px dialog shadow, 12px radius, 24px padding, clear heading/action rows, and mobile-safe widths.

- [ ] **Step 4: Run existing DOM and build tests**

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false test/app.test.js test/build.test.js
```

Expected: all tests pass; rendered content remains text-only and task/report behavior is unchanged.

- [ ] **Step 5: Commit the board/report component layer**

```bash
git add -- styles.css index.html test/build.test.js
git commit -m "feat: polish board and report surfaces"
```

### Task 4: Make the chat a premium first-class work surface

**Files:**
- Modify: `styles.css`
- Modify: `index.html` only if existing chat labels need a semantic wrapper

**Interfaces:**
- Consumes: Existing `.chat-panel`, `.comment-list`, `.comment`, `.comment-reply-quote`, `.comment-attachments`, `.reaction-chip`, `.comment-form`, `.attachment-drafts`, `.reply-banner`, `.record-button`, and fullscreen state classes.
- Produces: A comfortable chat rail/fullscreen layout that keeps all existing chat controls and state transitions intact.

- [ ] **Step 1: Add a failing chat style contract**

Add build assertions:

```js
expect(styles).toContain('.chat-panel.is-fullscreen');
expect(styles).toContain('.comment[data-parent-comment-id]');
expect(styles).toContain('.reaction-chip.is-active');
expect(styles).toContain('.chat-composer');
expect(styles).toContain('.record-button[data-recording-time]');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run the build test command and verify the new chat assertions fail before styling.

- [ ] **Step 3: Implement chat hierarchy and composer styling**

- Set the desktop board grid to give the task stream the majority of space and the chat a minimum 320px rail; keep the chat sticky below the top bar.
- Use a warm surface, 1px border, 12px radius, and balanced 16px padding for the panel. Header actions remain 40px controls with explicit accessible labels.
- Style `.comment` with author/time metadata, readable 15px body text, stable spacing, and a warm raised surface. Replies gain a 3px terracotta quote edge and a compact left offset.
- Make attachment images a restrained thumbnail grid and audio players full-width inside a raised attachment card. Keep filenames readable but truncated safely.
- Style reply/reaction actions as 32–40px controls; active reactions use terracotta tint and dark text plus `aria-pressed` state.
- Make `.chat-composer` a bordered lower surface with a reply banner, attachment draft grid, textarea, error area, and action row. Recording state uses amber and a visible time label from `data-recording-time`.
- For `.chat-panel.is-fullscreen`, use fixed inset, `100dvh`, a 960px reading max-width, `body.chat-is-fullscreen { overflow: hidden; }`, a scrollable message list, and a composer that stays visible without overlaying content.

- [ ] **Step 4: Run all tests and confirm chat behavior remains green**

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false
```

Expected: 63 existing tests plus the new source-contract assertions pass.

- [ ] **Step 5: Commit the chat layer**

```bash
git add -- styles.css index.html test/build.test.js
git commit -m "feat: elevate chat workspace styling"
```

### Task 5: Responsive and production verification

**Files:**
- Modify: `styles.css` if visual verification finds a responsive defect
- Modify: `test/build.test.js` only for a specific regression discovered during verification

**Interfaces:**
- Consumes: All completed shell, board, report, dialog, and chat styles.
- Produces: Verified desktop/mobile artifact with clean accessibility and build checks.

- [ ] **Step 1: Run the full automated suite and build**

```bash
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --no-file-parallelism --environment=node --isolate=false
SUPABASE_URL=https://audit-project.supabase.co SUPABASE_ANON_KEY=public-anon-key npm run build
git diff --check
```

Expected: all tests pass, the static artifact is created, and `git diff --check` emits no output.

- [ ] **Step 2: Start the local preview for visual QA**

```bash
SUPABASE_URL=https://audit-project.supabase.co SUPABASE_ANON_KEY=public-anon-key npm run preview -- --host 127.0.0.1
```

Open the preview and inspect at desktop width and 390px width. Check the board shell, progress, task card scanability, report disclosure layout, chat messages, attachment previews, reaction states, reply quote, dialogs, and empty/error states.

- [ ] **Step 3: Verify interaction-critical states**

Use the running preview to confirm:

- `Доска`/`Отчёт` tab switching retains `aria-selected` and panel visibility.
- The brand link still returns to the board without hash navigation.
- Chat fullscreen locks page scroll, shows the chat composer, closes with Escape, and restores focus to the trigger.
- Reply and reaction controls are keyboard reachable; file inputs remain `image/*,audio/*`.
- No horizontal overflow exists at 390px, including dialogs, drawer, composer, reports, and fullscreen chat.
- `prefers-reduced-motion` removes nonessential transitions.

- [ ] **Step 4: Re-run tests after any responsive fix**

Run the full suite and build commands from Step 1 again. Expected: same passing result with no new warnings.

- [ ] **Step 5: Commit final verification fixes**

```bash
git add -- styles.css index.html test/build.test.js
git commit -m "fix: finish Ember Studio responsive polish"
```
