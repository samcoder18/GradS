# Audit Tracker Implementation Plan

**Goal:** Publish a responsive, public-by-link audit tracker with a static report view and shared Supabase-backed task discussions.

**Architecture:** A vanilla HTML/CSS/JavaScript app renders the report and uses a capability token from the URL fragment to call protected PostgreSQL RPC functions. Supabase tables remain inaccessible to `anon`; only security-definer RPCs expose the deliberately limited board operations. GitHub Pages hosts the static frontend.

**Tech stack:** Semantic HTML, CSS, browser JavaScript modules, Vitest + jsdom, Supabase Postgres RPC, GitHub Actions.

**Source report:** `/Users/albina/grad/AUDIT.md`

## Global constraints

- The source audit is content only; do not apply its site-fix recommendations to `/Users/albina/grad`.
- The seeded board contains the 15 roadmap recommendations, grouped P0 through P3.
- Anyone holding a valid opaque board link may read, add tasks, toggle task completion, and post immutable plain-text comments without authentication.
- New tasks require a title and priority, default to P1 and open; they cannot be renamed or deleted.
- A visitor supplies a display name before their first mutation; it is retained only in browser local storage.
- Do not implement spam throttling, CAPTCHA, comment editing, or comment deletion.
- `SUPABASE_ANON_KEY` is public configuration; service-role credentials must never be committed or shipped to the browser.

### Task 1: Project foundation and tested client domain helpers

**Files:** package tooling, `src/domain.js`, unit tests, base app shell.

- Set up npm scripts for unit tests, coverage, and static build validation.
- Write failing tests for task filtering, audit progress totals, input normalization/validation, and safe board-token parsing from the URL fragment.
- Implement minimal pure JavaScript helpers satisfying those tests.
- Add the semantic shell and configuration example used by later UI work.

### Task 2: Supabase persistence contract

**Files:** `supabase/migrations/`, `supabase/seed.sql`, `scripts/create-board.mjs`, security checks/tests.

- Write the schema for boards, tasks, task events, task comments, and board comments.
- Seed the 15 audit recommendations with their P0–P3 groups.
- Enable RLS and revoke public table access; expose only token-validated security-definer RPC functions named in the user-approved interface.
- Generate an opaque board token locally, store only its SHA-256 hash, and output a fragment-based share link.

### Task 3: Responsive audit tracker interface

**Files:** `index.html`, `styles.css`, `src/app.js`, static audit content, DOM tests.

- Implement the tracker dashboard, filters, progress display, new-task dialog, name dialog, task-detail drawer, task comments, and general chat.
- Render the full source report in a dedicated accessible report tab with section navigation and disclosure controls.
- Integrate the Supabase RPC client, optimistic refresh after mutations, focus refresh, and a 20-second polling refresh.
- Preserve keyboard operation, focus management, and a mobile bottom-sheet adaptation.

### Task 4: Publishability and handoff

**Files:** `README.md`, `.github/workflows/deploy.yml`, configuration examples.

- Document Supabase project provisioning, migration/seed application, secure board creation, configuration, local preview, and GitHub Pages deployment.
- Add a GitHub Pages workflow that installs dependencies, runs tests, builds, and deploys the static site.
- Run the complete automated test and build suite plus a local browser accessibility/mobile smoke check.
