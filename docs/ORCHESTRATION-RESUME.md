# Dual-agent lameta-plugin bring-up — coordinator resume record

**Wound down:** 2026-07-04 (~00:20). **Goal:** bring up the SayMore audio-annotation plugin in a
running lameta and get the plugin/host API right. Two Opus 4.8 agents collaborated (one per repo)
under an Orca-orchestration coordinator.

## Status at wind-down

**DONE + verified live (end-to-end in the running app, on-disk SayMore parity confirmed):**
- Plugin loads and renders in lameta; iframe init-handshake bug fixed (init context's MobX-observable
  `grantedPermissions` threw `DataCloneError` in `postMessage` → deep-plain via JSON round-trip on the
  host; client also retries `ready`).
- Two-state create flow: audio with no `.eaf` → **"SayMore: Start Annotating"** + button → button
  creates `<media>.annotations.eaf` (byte-perfect SayMore ELAN 2.7 skeleton) → `api.selectFile`
  auto-selects it → **"Segments"** segmenter renders; adding boundaries + Save writes a valid
  `TIME_ORDER` + annotations.
- Generic **first-dot-stem** companion scoping in lameta core (`companions.ts`) — SayMore-specific
  allowlist + eaf re-anchoring deleted (subsumed); SayMore naming is OUT of lameta core.
- New host API `api.selectFile(relPath)` (create-and-select) across types/bridge/client-kit +
  `Folder.registerExistingFile` + FolderPane wiring.
- **Tab-provider CONTRACT (Option A) built + unit-tested + documented** (host side): `getTabs` RPC with
  per-query companion scoping (uncached, graceful timeout→`[]`), `role` in init context, client-kit
  `connectToLameta`/`serveTabProvider`, manifest `tabProvider{entry,handles}` schema, docs rewritten.
- Plugin side of Option A fully implemented (manifest `tabProvider` + `serveTabProvider` +
  `resolveSaymoreTabs`, decides live/uncached), wire/type-verified against the contract.

**REMAINING (next session):**
1. **Tab-provider RUNTIME wiring in lameta** (host): provider-iframe manager (one hidden iframe+bridge
   per plugin), FolderPane async tab render querying the manager per selection, PluginManager exposure.
   Exact next-steps are in the lameta handoff.
2. **Live end-to-end test of the provider model** (audio→Start Annotating from the provider; after
   create+re-query→Segments), using SayMore's provider build already in `dist/`.
3. **Deferred — Exercise 2** (oral-annotation 1.25s rename/permanence parity): needs an actual segment
   **boundary drag**, which CANNOT be driven via headless CDP. `companions.rename` is implemented +
   unit-tested; the on-disk parity just isn't UI-verified. Do by hand or a targeted unit/integration
   test — NOT by trying to script the canvas.

## DECISION LOCKED (John): tab architecture = **Option A**
Host **asks the plugin** for tabs/labels on **every file selection**, **UNCACHED** (answers vary by
live `.eaf`/companion state). All tab/label logic lives in the plugin; host stays generic. Contract:
`D:/saymore-plugin-agent-comms/tab-provider-contract-proposal.md` (marked `## LOCKED`). Trade-off John
accepted: this implies a persistent hidden provider-iframe per plugin.

## Verification at wind-down
- **lameta** (`D:/lameta/plugins`, branch `plugins`): tsc clean; full unit suite **1164 passed / 7
  skipped** (plugin suite 97, incl. a 26-test `PluginHostBridge` contract suite).
- **saymore** (`D:/saymore-plugin`, branch `main`): tsc clean; **153 specs green**; `dist/` fresh.

## Commit status
**Everything is UNCOMMITTED** working-tree state on both sides. Both agents recommend committing a
coherent green checkpoint (saymore on `main`, lameta on `plugins`). Do **NOT** auto-promote to Peer
Review (personal-board rule). As of this doc, not committed — awaiting John's go.

## Handoff docs (authoritative detail)
- lameta: `C:/Users/hatto/AppData/Local/Temp/lameta-plugin-system-handoff-3.md`
- saymore: `D:/saymore-plugin/docs/HANDOFF-tab-provider.md`
- earlier context: `C:/Users/hatto/AppData/Local/Temp/lameta-plugin-system-handoff-2.md`,
  `D:/saymore-plugin/docs/HANDOFF.md`, `docs/PLAN.md`

## How to RESUME the orchestration
Terminal handles below are runtime-scoped and go STALE when the terminals/Orca restart, so resuming =
spawn fresh agents:
1. Coordinator (this session's role): `orca status`, then re-read this doc.
2. Spawn two fresh Opus 4.8 agents:
   `orca terminal create --worktree path:D:/lameta/plugins --command "claude"` and
   `orca terminal create --worktree path:D:/saymore-plugin --command "claude"`; wait for tui-idle.
3. Point each at its handoff doc + the locked contract; give each the other's fresh handle + the
   coordinator's fresh handle. Comms rule: deliver peer messages via BOTH `orca orchestration send`
   AND `orca terminal send` (see the memory notes); `terminal send` bodies must be a single paragraph.
4. First runtime task: lameta builds the tab-provider runtime wiring (remaining item 1), then the two
   live-test the provider model end-to-end against SayMore's `dist/` build (item 2).

### This session's IDs/paths (mostly historical after restart)
- lameta task `task_0aacefd58394`, dispatch `ctx_7f855c30243b`; brief `…/orca-lameta-brief.md`
- saymore task `task_c73b0474e7f5`, dispatch `ctx_ffe6de1cf02e`; brief `…/orca-saymore-brief.md`
- feature spec `C:/Users/hatto/AppData/Local/Temp/orca-feature-spec-tabs.md`
- stale handles: coordinator `term_80640de3…`, lameta `term_14723bc8…`, saymore `term_fae60fdf…`

## Gotchas
- **Toolchains differ:** saymore = Vite+ (`vp`) + pnpm ONLY (never npm/yarn); lameta = yarn classic ONLY.
- **Dev loop, no zip:** lameta's *Developer plugin folder* points at `D:/saymore-plugin/dist`; SayMore
  keeps it fresh with `vp build --watch`. The `.lmplug` zip is for final install only.
- **Tab provider = query-per-selection, UNCACHED** (answers change as the `.eaf` appears/disappears).
- **Headless CDP cannot grab/drag a segment boundary** in the segmenter canvas — don't retry it.
- `py` not `python`. Attribution `[<model name>]` on anything under John's name.
