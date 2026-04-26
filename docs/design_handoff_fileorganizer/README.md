# Handoff: FileOrganizer

## Overview

FileOrganizer is a local Windows tool for indexing, deduplicating, and organizing personal files across multiple drives (including a NAS), in preparation for a machine migration. The design prototype covers three core surfaces:

- **Dashboard** — drive cards, action queue, live activity, library breakdown
- **Duplicates** — group list, keeper-scoring breakdown, per-copy actions
- **Organize** — rules editor with live planner, plan/review queue, unsorted bucket

The full product spec is the source of truth for behavior, schemas, and non-goals; this handoff covers the **UI layer only**.

## About the Design Files

The files in this bundle are **design references created in HTML/React (Babel-transpiled)** — a prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's environment**.

Per the spec, the engine is **Node 22 + TypeScript**, the UI is **TypeScript + Preact + Vite**, served by the engine on `127.0.0.1:<port>`. Implement these designs in that stack, using the engine's HTTP+WebSocket API (defined in `shared/`) for real data instead of the mock data in `fo-data.js`.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, density, and interaction patterns are intentional. Recreate pixel-faithfully, swapping mock data for live engine data.

## Design tokens

All tokens live in `styles.css` as CSS custom properties. Lift these values directly.

### Colors (dark theme — only theme in v1, light is post-v1)

```
--bg-0: #0e0f12   /* canvas */
--bg-1: #14161a   /* panels, sidebar */
--bg-2: #1a1d22   /* raised surfaces, search input */
--bg-3: #22262d   /* hover, dot backdrop */
--bg-4: #2a2f37   /* selected (rarely used) */

--line:        #24272d   /* hairlines */
--line-strong: #2e333b   /* button borders */

--fg-0: #e8e9ec   /* primary text */
--fg-1: #b4b7be   /* secondary text */
--fg-2: #7e828a   /* tertiary, label text */
--fg-3: #565a62   /* muted, placeholder */

--accent:      oklch(0.74 0.14 70)        /* warm amber/copper */
--accent-bg:   oklch(0.74 0.14 70 / 0.14) /* selected row, accent pill bg */
--accent-line: oklch(0.74 0.14 70 / 0.5)  /* accent borders */

--ok:     oklch(0.78 0.13 155)  /* keeper, success */
--warn:   oklch(0.80 0.14 80)   /* throttle, cross-drive */
--danger: oklch(0.70 0.18 25)   /* offline, full disk */
--info:   oklch(0.74 0.10 230)  /* dedupe, info pills */
```

Status pills use the accent/ok/warn/danger/info hues at `/0.14` for background and full strength for text.

### Per-drive accent colors

Drives have unique identity colors used in pill chips, drive-letter glyphs, and bar fills:

```
C: #a78ce8  D: #69b8d4  E: #e89a4d  N: #d47878  X: #8a8e96
```

### Typography

- **Sans**: `Inter Tight`, weights 400/500/600/700 — UI body, labels, headings
- **Mono**: `JetBrains Mono`, weights 400/500/600 — paths, hashes, numbers, code, throttle/scan readouts

Base font-size is **12.5px** with `line-height: 1.4` and `letter-spacing: -0.005em`. Tabular numbers via `.tnum { font-variant-numeric: tabular-nums }` everywhere a number is shown next to text.

Caps labels: 10px, uppercase, `letter-spacing: 0.08em`, color `--fg-2`.

### Radii

```
--r-sm: 3px   /* pills, buttons, table rows */
--r-md: 5px   /* cards */
--r-lg: 8px   /* outer stage frame only */
```

### Spacing

Cards use 10–14px padding, table cells 6×10px, sidebar items 5×8px. Card gaps are 10–14px in grid layouts.

## Layout system

### App shell

Two columns: **220px sidebar** + **flex content**. The content area is `display: flex; flex-direction: column` with a 38px topbar and a flex-1 main area. The whole shell sits in a `.fo-root` container that owns the dark theme variables.

```
┌──────────┬──────────────────────────────────────────┐
│          │ TopBar (38px)                            │
│ Sidebar  ├──────────────────────────────────────────┤
│ (220px)  │                                          │
│          │ Main content (per-section)               │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Sidebar (`Sidebar` component, `var-a.jsx`)

- **Brand block** (top, 14px padding): 22×22 gradient-amber tile with `fo` mono mark, product name, `v0.6.2 · localhost:51842` mono caption.
- **Search row**: pseudo-input styled like a button — `--bg-2` background, mono `/` keycap on the right. Wires to a real command palette / catalog search later.
- **Nav items**: 5×8 padding, 4px radius, 13px icon + 12px label. Active = `--bg-3` background; hover = `--bg-2`. Right-side trailing badge supports: count (mono, 10.5px), live-scan dot (animated), or "4.2 GB" mono caption.
  - Sections: Dashboard, Drives (5), Scans (live), Browse, ─, Organize (6 rules), Duplicates (412 — `highlight: true` shows accent emphasis), ─, History, Quarantine (4.2 GB).
- **Throttle widget** (bottom, border-top): caps "throttle" label, three segmented chips for `idle / balanced / full-send`, mono caption "auto · workday window · until 18:00". Clicking a chip swaps the active throttle profile via the engine API (`PATCH /api/throttle`).

### TopBar (`TopBar` component)

38px high, `--bg-1` background, 14px horizontal padding. Three regions:

- **Breadcrumb**: "FileOrganizer › <section>", chevron between, current section in `--fg-0`, rest in `--fg-2`.
- **Drive status pills** (right-aligned, gap 6px): one mono pill per drive with status dot + drive letter + percent. Disconnected drives at 50% opacity. Re-renders from a websocket subscription to drive events.
- **Settings icon button** at far right.

## Surface 1: Dashboard

Layout: vertical `gap: 14px` flex column, 16px padding, scrolls vertically.

### Action strip (top)

4-column grid of `ActionCard`s. Each card is:
- 12px padding, `--bg-1` card background, `--line` border, `--r-md` radius
- Status dot (kind-keyed: warn/info/muted/ok), 13px bold title, 11px secondary subtitle
- Full-width "<cta> →" button with `.btn.sm` styling at the bottom

Default content reflects current state of the system:
- **warn**: "412 duplicate groups" / "28.4 GB reclaimable" → Review
- **info**: "2,103 cross-drive moves" / "from current plan" → Open queue
- **muted**: "24,102 unsorted files" / "no rule matches" → Triage
- **ok**: "Quarantine: 4.2 GB" / "1,284 files · 30d retention" → Manage

### Two-column row

`grid-template-columns: 1.4fr 1fr; gap: 14px`

**Left — Drive cards** (`DriveCardGrid` + `DriveRow`):

Card with header "Drives [count] [Add+]" and a list of rows. Each row uses a 4-col grid `32px 1fr auto auto`:

1. 26×26 drive glyph: `--bg-3` square with 3px left border in the drive's identity color and a `drive`/`nas` icon
2. Main: status dot + drive label + mono drive letter + kind label + status pill (e.g., `scanning · 42%`, `offline`); row 2 is a 280px-max progress bar + mono "1.42 / 4.0 TB" readout. Bar color: `--danger` >90%, `--warn` >75%, drive color otherwise.
3. Up to 2 role pills stacked, "+N" overflow indicator
4. Caps "scanned" + mono "12m ago"

**Right — ActivityFeed**:

Card with header "Activity [pulse-dot]" + "live" caption. Each entry is a 3-col grid: mono timestamp (10px, `--fg-3`), kind pill (uppercase, 9.5px, kind-tinted), 11.5px message text. Real implementation streams from the engine WS (`scanProgress`, `applyProgress`, `throttleChanged`, `driveConnected/Disconnected`, `batchStatusChanged`).

### CategoryBreakdown

Full-width card. Header has a "1,284,921 files · 14.21 TB" pill summary.
- **Segmented bar** (`.seg-bar`, height 6px): one stripe per category, width proportional to size. Categories: Photos (amber), Video (red-orange), Audio (green), Documents (blue), Code (purple), Archives (warm-grey), Other (grey).
- **7-column grid** of legend tiles below: 8×8 swatch + name + mono size (TB) + mono file count.

## Surface 2: Duplicates

2-column grid `380px 1fr` filling the available height.

### Left pane — group list (`DuplicatesView` left side)

- **Header** (10×14 padding, border-bottom): "412 groups" + warn pill "28.4 GB" + filters button.
- **Filter chips row** (6×10, border-bottom): all / image / video / document, with sort indicator on the right ("sort: reclaim ↓").
- **Group list** (scrollable). Each row is `padding: 10×14`, `border-bottom: 1px --line`, with 2px left border in `--accent` and `--accent-bg` background when selected:
  - Row 1: mono hash (10px, `--fg-2`) + category pill, right-aligned mono "+25 GB" reclaim in accent color.
  - Row 2: 11.5px filename.
  - Row 3: secondary line — "<count> copies · <size> each", right-aligned mini drive-letter chips (14×14, identity color, mono `D` initial).
- **Bulk action bar** (footer): "approve all keepers" + "exclude NAS" + "<100 KB" buttons.

### Right pane — group detail (`DupDetail`)

- **Header** (border-bottom): "Group · <hash>" headline, "<count> byte-identical copies · <size> each · reclaim <accent>" subtitle, buttons "exclude group", "change keeper…", primary "approve · quarantine N".
- **Preview row**: 4-col grid of preview cards (or `repeat(group.copies.length, 1fr)` if fewer). Each:
  - 4:3 aspect-ratio header: keeper gets a warm gradient (`oklch(0.74 0.14 70 / 0.4)` to `oklch(0.5 0.08 50 / 0.4)`); others get plain `--bg-3`. Centered category icon (28px) inside.
  - Body: keeper pill ("✓ keeper · score 92") or score pill ("score 41"), drive-letter chip + mono path on a single line (truncates), mono "mtime YYYY-MM-DD".
- **Score breakdown card**: header "Why this keeper?" + "tiebreaker order" caption. 6 rows for the spec's tiebreakers, in priority order. Each: ✓ (or muted dot) + name (160px), mono value (left-aligned, `--fg-2`), mono weight (60px right). Final row "Lexicographic" is muted.
- **All copies table**: 6 columns — selection (★ for keeper, checkbox for others), drive chip, mono path, mtime, score (right-aligned, ok-tinted for keeper), action pill ("keep" / "→ quarantine"). Use `.tbl` styling — sticky header, `.selected` row gets `--accent-bg` background.

## Surface 3: Organize

3 tabs at the top: **Rules** (count = rules.length), **Plan / Review** (count = pending review ops), **Unsorted** (count = unmatched files). Active tab gets a 2px `--accent` bottom border. Right-side actions change per tab:

- Rules: primary "+ New rule"
- Plan: ghost "dry run" + primary "approve <N>"

### Rules tab — `RulesEditor`

2-column `420px 1fr`.

**Left column — rule list** (scrollable). Each row: 4-col grid `20px 24px 1fr auto`:
1. Drag handle (`⋮⋮`, `--fg-3`, cursor grab) — wire to a real drag-reorder library; reorder updates `rule.priority` server-side.
2. Mono priority number, 0-padded.
3. Main:
   - Title row: rule name + "shadowed" warn pill if `wouldMatch > matches`.
   - Mono detail line: "<category> → <role> · <template>" (truncates).
   - Stats line: "matches <accent-fg-1>N</> · planned <accent>M</>" (10px).
4. Toggle pill (24×14 rounded): on = `--accent` track + dark thumb at 11px; off = `--bg-3` track + muted thumb at 1px.

Selected row: `--accent-bg` background + 2px `--accent` left border. Disabled rules at 50% opacity.

**Right column — rule editor** (scrollable, 18px padding):

- **Header**: caps "priority N" + 18px rule name. Shadow warning pill inline if applicable.
- **2-column form grid** with `Match` and `Destination` sections. Each `Section` has caps title + bordered block; each `Field` is a 110px label + value row, border-bottom hairlines:
  - Match fields: Category (accent pill), Date source min, Source drives, Path glob, Size range
  - Destination fields: Role (accent pill), Template (mono code chip — render `{year}` etc as «year» tokens), Move policy (warn pill: `cross-drive-review`), Quarantine (`default`)
- **Live planner card** below. Header: "Live planner" + mono "recomputed 0.4s ago".
  - Stats row: 5 stat blocks — "would match", "actually matches" (accent), "planned ops", "cross-drive", "estimated bytes". Each stat is caps label + 18px mono tabular numeral.
  - Segmented bar (height 8px) showing the auto/review/no-op split with green/accent/grey colors. Legend row beneath.

### Plan / Review tab — `PlanReview`

- **Filter bar** (`--bg-1` background, border-bottom): "filter" label + chips (accent "all rules", "cross-drive only", "size > 100 MB") + right-aligned "showing 1–N of M".
- **Table** (`.tbl`):
  - Columns: checkbox / Source / arrow / Destination / Rule / Kind / Size
  - Source/destination cells: drive chip (16×16) + mono path. Source uses normal text color; destination path uses `--accent` to signal target.
  - Kind pill: warn for `cross-drive`, ok for `same-drive`.
  - Right-align mono Size.

### Unsorted tab — `UnsortedView`

Centered card showing the count in big accent mono numerals, "files match no rule" caption, primary "create rule from filter" button.

## Shared atoms

All defined in `styles.css`:

- `.btn` — base button. Variants: `.primary` (accent fill), `.ghost` (transparent), `.danger`, `.sm` (smaller).
- `.pill` — small status chip. Variants: accent / ok / warn / danger / info.
- `.dot` — 6px circle. Variants: ok / warn / danger / muted / scanning (pulse animation).
- `.kbd` — keycap-styled span for keyboard shortcuts.
- `.bar` — slim progress bar with optional warn/danger/ok variants.
- `.seg-bar` — multi-segment colored bar.
- `.tbl` — dense data table; sticky header, `.selected` row highlight.
- `.card` + `.card-hd` — panel + header pattern.
- `.label-cap` — uppercase caps label.
- `.stripe` — diagonal-stripe placeholder background (used in dup previews).

`Icon` component is an inline SVG renderer with named paths (drive, folder, search, scan, rules, dupes, history, quarantine, settings, chevron, play, pause, plus, check, x, file, image, video, nas).

## Behavior & state

- **Sidebar nav** drives the main view. Single source of truth: `section` state in `VarA`. Real implementation should use the router (the spec calls out `g d` / `g b` etc. keyboard shortcuts — implement as global keydown handlers).
- **Duplicates view**: `selected` group ID drives the right panel. Apply button kicks off a dedup batch; spec says non-keepers go to quarantine, keeper stays put.
- **Rules editor**: `selected` rule ID drives the right pane. Rule list is drag-reorderable (updates `priority`); toggle flips `enabled`. Live planner re-runs whenever any rule changes — debounce 200–400ms.
- **Plan/Review**: All cross-drive operations land here. Approval kicks the engine's apply pipeline (atomic copy → verify hash → quarantine source → catalog update).
- **Throttle widget**: clicking a chip in the sidebar swaps the live throttle profile. The schedule editor lives in the Drives section (not in this prototype).

## Mock data location

`fo-data.js` exposes `window.FOData` with: `drives`, `driveMap`, `dupGroups`, `rules`, `planSample`, `activity`, `summary`. Replace each with a typed engine API call:

- `drives` → `GET /api/drives`
- `dupGroups` → `GET /api/duplicates/groups?sort=reclaim`
- `rules` → `GET /api/rules`
- `planSample` → `GET /api/plan?limit=N`
- `activity` → WS subscription
- `summary` → `GET /api/summary`

## Files in this bundle

- `FileOrganizer.html` — entry point. Stage frame + dark page background + mounts `<VarA />` at 1440×900.
- `var-a.jsx` — all components: Sidebar, TopBar, Dashboard, DuplicatesView/DupDetail, OrganizeView/RulesEditor/PlanReview/UnsortedView, plus mock-data atoms (`fmtSize`, `fmtNum`, `driveColor`, `Icon`).
- `fo-data.js` — mock data only.
- `styles.css` — all design tokens, `.fo-root` theme container, every shared atom class.

## Notes for the implementer

- The HTML prototype uses Babel-transpiled JSX inline — your Preact + Vite build will be cleaner. Lift the visual structure, not the script-tag setup.
- `oklch()` is used for accent + status colors. Modern Chrome/Edge/Safari support it natively; if you need fallback, compute hex equivalents for older targets — but the spec says desktop browser only, so this should be fine.
- All number renderings use `font-variant-numeric: tabular-nums`. Don't forget when you swap mono for sans or vice versa.
- The 220px sidebar is fixed; no responsive collapse is needed (desktop browser only per spec).
- Quarantine, History, Browse, Drives, and Scans surfaces are **not** in this prototype — design those in a follow-up using the same vocabulary.
