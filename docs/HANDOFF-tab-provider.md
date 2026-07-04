# Handoff — plugin bring-up, 2-state UX, and tab-provider model (2026-07-03/04)

Session handoff for the SayMore audio-annotation plugin running inside lameta. Pairs with
`docs/HANDOFF.md` + `docs/PLAN.md`. Cross-agent design record lives in
`D:/saymore-plugin-agent-comms/` (esp. `2state-contract.md` and `tab-provider-contract-proposal.md`).

## What shipped this session (all on branch `main`, uncommitted working tree)

1. **Plugin bring-up in lameta — VERIFIED LIVE.** The SPA loads in lameta's plugin iframe and
   renders the manual segmenter. Root-caused + fixed a handshake timeout: the client kit now
   attaches its message listener synchronously and **re-posts `lameta:ready` every 150ms until
   `lameta:init`** (`src/plugin/lametaPluginClient.ts`). (The host also had a MobX-observable
   `grantedPermissions` → `DataCloneError` bug, fixed host-side.)

2. **State A create flow — VERIFIED LIVE + on-disk parity checked.** An audio file with no
   `.eaf` shows a "SayMore: Start Annotating" button; clicking it writes a SayMore-parity
   `<media>.annotations.eaf` (seeded from `annotationTemplate.etf`) and `api.selectFile`s it so the
   segmenter opens. Verified the created EAF byte-for-byte (media descriptor, empty TIME_ORDER,
   both tiers, `lastUsedAnnotationId=0`) and a from-scratch save (ts1..ts6, a1–a3, integer-ms).

3. **State B eaf-selection — VERIFIED LIVE.** Selecting a `<media>.annotations.eaf` opens the
   segmenter. `PluginHostAdapter` anchors on the media (derived from the eaf name), decodes the
   selected eaf via `getFileBytes`, and reads the media + `_Annotations/` through the host's
   eaf-scoped companions.

4. **Contract lock.** Deleted the client-side `companionAllowlist.ts` mirror — the **host is the
   single source of truth** for companion scoping (generic first-dot-stem rule). `PluginHostAdapter`
   is now a thin passthrough using only the documented API.

5. **Tab-provider model (John's Option A) — IMPLEMENTED, NOT YET LIVE-TESTED.** The host asks the
   plugin which tabs to show, per selection, **uncached**. Plugin side:
   - `src/plugin/tabProvider.ts` — `computeTabs` (pure) + `resolveSaymoreTabs` (checks live via
     `companions.exists`): `.eaf` → `[Segments, claimDefault]`; audio & no eaf → `[Start Annotating]`;
     audio & eaf exists → `[]`; else `[]`.
   - `src/plugin/lametaPluginClient.ts` — `serveTabProvider(handler)`.
   - `src/App.tsx` — one handshake, branch on `context.role` ("tabProvider" serves getTabs and
     renders nothing; "tab" builds the adapter and does State A/B). Button guards against
     overwriting an existing `.eaf`.
   - `public/plugin.json5` — static `tabs[]` replaced with
     `tabProvider:{ entry, handles:{ lametaTypes:["Audio"], extensions:["eaf"] } }`.
   - `src/plugin/PluginApiTypes.ts` — `role`/`tab` on init; `lameta:getTabs`/`lameta:tabs` messages;
     `TabDescriptor`, `TabProviderQuery`.
   This delivers the requirement: **audio that already has an `.eaf` gets NO plugin tab**, and after
   the button creates+selects the eaf, returning to the audio shows no Start-Annotating tab.

## Health
- `pnpm exec tsc --noEmit` clean; `vp test` **153 specs green** (8 new tab-provider tests +
  eaf-selection adapter test); `vp check` clean for touched files. `dist/` is a fresh watch build
  (`index-Du4OmjHk.js`) with the `tabProvider` manifest.

## Open / next
- **End-to-end test of the tab-provider model.** The host-side CONTRACT is done + unit-tested +
  documented (getTabs RPC with per-query companion scoping, role-in-init, types, manifest schema).
  The remaining host piece is the RUNTIME WIRING — a provider-iframe manager + FolderPane async tab
  render + PluginManager exposure — which is **not built yet**. **Consequence: with this
  `tabProvider`-only `dist/`, lameta shows NO SayMore tab in the app until that host wiring lands.**
  Host next-steps: `C:/Users/hatto/AppData/Local/Temp/lameta-plugin-system-handoff-3.md`. Once live,
  drive: audio-no-eaf → Start Annotating; create → auto-select → Segments; back to audio → no tab.
- **Client-kit helper reconciliation (cosmetic):** the canonical host kit exposes
  `connectAsTabProvider(handler)`; our vendored copy splits it as `connectToLameta()` (surfaces
  `context.role`) + `serveTabProvider(handler)` because of the single-entry + role-in-init
  constraint. On-the-wire protocol is identical. Align naming when the canonical kit is published.
- **Known issue (deprioritized):** mouse click on a boundary line may only place the cursor
  (`D:/saymore-plugin-agent-comms/known-issue-boundary-click-zorder.md`). Worked around by the added
  **Tab/Shift+Tab** keyboard boundary selection; boundary divs carry `data-testid`/`data-boundary-*`.
- The maintainer-owned `README.md`/`docs/HANDOFF.md` have pre-existing Oxfmt formatting nits — left
  untouched intentionally.

## Toolchain reminder
Vite+ (`vp`) + pnpm ONLY (never npm/yarn). `vp build --watch` keeps `dist/` fresh for lameta's
Developer-plugin-folder hot-reload; `dist/plugin.json5` must be re-copied from `public/` after a
manifest edit (watch does not re-copy `public/` on incremental rebuilds).
