/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import { gridPreferences } from "../../state/GridPreferences";
import { gridFonts } from "../../state/GridFonts";
import { GridViewModel, type GridColumn } from "../../state/GridViewModel";
import type { TimeRange } from "../../model/TimeRange";
import { LAMETA_UI_FONT } from "../../lametaTheme";
import { gridFontStyle, gridRowHeight } from "./gridFontStyle";
import { FontDialog } from "./FontDialog";
import { playbackFillFraction, segmentTooltip } from "./segmentCell";

/** Rows rendered above and below the ones on screen. */
const OVERSCAN_ROWS = 8;
/** Viewport height assumed until the scroll container has been measured. */
const UNMEASURED_VIEWPORT_PX = 900;
const COLUMNS = "84px minmax(0, 1fr) minmax(0, 1fr)";

/**
 * The SayMore transcription grid (`TextAnnotationEditorGrid`): one row per
 * segment of the `.eaf`, with Transcription and Free Translation cells that save
 * straight back to the eaf. Behaviour (autoplay, keyboard movement, playback
 * options, ignored rows) lives in {@link GridViewModel}; this view renders it.
 *
 * Only the rows near the scroll position are in the DOM: every row has the same
 * height (see {@link gridRowHeight}) and is absolutely positioned, so a session with
 * thousands of segments costs about the same as one with thirty. The header is
 * sticky inside the same scroll container, so its columns line up with the rows'.
 */
export const TranscriptionGrid = observer(function TranscriptionGrid(props: {
  store: ProjectStore;
}) {
  const { store } = props;
  const [vm] = useState(() => new GridViewModel(store, gridPreferences));
  useEffect(() => vm.attach(), [vm]);

  if (!store.document)
    return (
      <p
        css={css`
          padding: 12px;
        `}
      >
        {t("harness.loading", "Loading…")}
      </p>
    );
  return <GridBody store={store} vm={vm} />;
});

const GridBody = observer(function GridBody(props: { store: ProjectStore; vm: GridViewModel }) {
  const { store, vm } = props;
  const doc = store.document!;
  const segmentCount = doc.segments.length;
  // `rev` in the cell keys makes external changes (reload/undo) reset the inputs.
  const rev = doc.version;
  const rowHeight = gridRowHeight([gridFonts.transcription, gridFonts.freeTranslation]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(0);
  const [menu, setMenu] = useState<{ row: number; x: number; y: number } | undefined>();
  const pendingFocus = useRef<{ row: number; column: GridColumn } | undefined>(undefined);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportPx(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function focusPending(): void {
    const target = pendingFocus.current;
    const el = scrollRef.current;
    if (!target || !el) return;
    const cell = el.querySelector<HTMLElement>(`[data-grid-cell="${target.row}:${target.column}"]`);
    if (!cell) return;
    pendingFocus.current = undefined;
    if (document.activeElement === cell) vm.enterCell(target.row, target.column);
    else cell.focus({ preventScroll: true });
  }

  // A focus request (Tab, arrows, un-ignore) may target a row that is scrolled
  // out of the DOM: scroll it into view first, then focus it once it renders.
  const request = vm.focusRequest;
  useEffect(() => {
    if (!request) return;
    pendingFocus.current = { row: request.row, column: request.column };
    const el = scrollRef.current;
    if (el) {
      const header = headerRef.current?.offsetHeight ?? 0;
      const visible = (el.clientHeight || UNMEASURED_VIEWPORT_PX) - header;
      const top = request.row * rowHeight;
      let next = el.scrollTop;
      if (top < next) next = top;
      else if (top + rowHeight > next + visible) next = top + rowHeight - visible;
      if (next !== el.scrollTop) {
        el.scrollTop = next;
        setScrollTop(next);
      }
    }
    focusPending();
  }, [request, rowHeight]);
  useLayoutEffect(() => focusPending());

  const viewport = viewportPx || UNMEASURED_VIEWPORT_PX;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const last = Math.min(
    segmentCount - 1,
    Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN_ROWS,
  );
  const rows: number[] = [];
  for (let i = first; i <= last; i++) rows.push(i);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "F2") {
      e.preventDefault();
      vm.togglePlayback();
      return;
    }
    const cell = cellOf(e.target);
    if (!cell) return;
    if (e.key === "Tab") {
      if (vm.tab(cell.row, cell.column, e.shiftKey)) e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      vm.moveVertical(cell.row, cell.column, e.key === "ArrowDown" ? 1 : -1);
    }
  }

  return (
    <div
      ref={scrollRef}
      data-testid="transcription-grid"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) vm.leaveGrid();
      }}
      css={css`
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        border: 1px solid #b7d59b;
        font-family: ${LAMETA_UI_FONT};
        font-size: 13px;
        color: #37474f;
      `}
    >
      <div
        ref={headerRef}
        css={css`
          position: sticky;
          top: 0;
          z-index: 1;
          display: grid;
          grid-template-columns: ${COLUMNS};
          background: #f4f7f0;
          color: #33691e;
          font-weight: 600;
          box-shadow: inset 0 -1px 0 #b7d59b;
        `}
      >
        <div css={headerCellCss} />
        <TranscriptionHeader vm={vm} />
        <TranslationHeader vm={vm} />
      </div>

      {segmentCount === 0 ? (
        <div
          css={css`
            padding: 10px;
            color: #78909c;
          `}
        >
          {t("grid.empty", "No segments yet. Use “Edit Segments” to add boundaries.")}
        </div>
      ) : (
        <div
          css={css`
            position: relative;
          `}
          style={{ height: segmentCount * rowHeight }}
        >
          {rows.map((i) => (
            <GridRow
              key={i}
              store={store}
              vm={vm}
              index={i}
              rev={rev}
              rowHeight={rowHeight}
              onContextMenu={(x, y) => {
                vm.selectRow(i);
                setMenu({ row: i, x, y });
              }}
            />
          ))}
        </div>
      )}

      <Menu
        open={menu !== undefined}
        onClose={() => setMenu(undefined)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <MenuItem
          dense
          role="menuitemcheckbox"
          aria-checked={menu !== undefined && vm.isIgnored(menu.row)}
          onClick={() => {
            if (menu) vm.setIgnored(menu.row, !vm.isIgnored(menu.row));
            setMenu(undefined);
          }}
        >
          <CheckMark checked={menu !== undefined && vm.isIgnored(menu.row)} />
          {t("grid.ignoredMenu", "Ignored")}
        </MenuItem>
      </Menu>
    </div>
  );
});

/** Row and column of the grid text cell that `target` is, if it is one. */
function cellOf(target: EventTarget): { row: number; column: GridColumn } | undefined {
  const id = (target as HTMLElement).dataset?.gridCell;
  if (!id) return undefined;
  const [row, column] = id.split(":");
  return { row: Number(row), column: column as GridColumn };
}

const GridRow = observer(function GridRow(props: {
  store: ProjectStore;
  vm: GridViewModel;
  index: number;
  rev: number;
  rowHeight: number;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { store, vm, index: i, rev, rowHeight } = props;
  const seg = store.document?.segments[i];
  if (!seg) return null;
  const ignored = vm.isIgnored(i);
  const current = i === vm.currentRow;
  // SayMore greys ignored rows except the current one.
  const greyed = ignored && !current;
  return (
    <div
      data-testid={`grid-row-${i}`}
      data-ignored={ignored || undefined}
      data-current={current || undefined}
      onClick={() => vm.selectRow(i)}
      onContextMenu={(e) => {
        if (!cellOf(e.target)) return;
        e.preventDefault();
        props.onContextMenu(e.clientX, e.clientY);
      }}
      style={{ top: i * rowHeight, height: rowHeight }}
      css={css`
        position: absolute;
        left: 0;
        right: 0;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: ${COLUMNS};
        align-items: stretch;
        border-bottom: 1px solid #eceff1;
        background: ${current ? "#cfe4ff" : greyed ? "#e4e7e9" : "#fff"};
        color: ${greyed ? "#9aa5ab" : "inherit"};
      `}
    >
      <SegmentCell store={store} vm={vm} row={i} range={seg.range} current={current} />
      {ignored ? (
        <>
          <IgnoredCell vm={vm} row={i} column="transcription" />
          <IgnoredCell vm={vm} row={i} column="freeTranslation" />
        </>
      ) : (
        <>
          <EditableCell
            key={`tr-${i}-${rev}`}
            row={i}
            column="transcription"
            vm={vm}
            initial={seg.transcription}
            placeholder={t("grid.transcriptionPlaceholder", "transcription…")}
            onCommit={(text) => void saveCell(store, i, "transcription", text)}
          />
          <EditableCell
            key={`ft-${i}-${rev}`}
            row={i}
            column="freeTranslation"
            vm={vm}
            initial={seg.freeTranslation}
            placeholder={t("grid.freeTranslationPlaceholder", "free translation…")}
            onCommit={(text) => void saveCell(store, i, "freeTranslation", text)}
          />
        </>
      )}
    </div>
  );
});

/**
 * A row's first cell, SayMore's `AudioWaveFormCell`: the row number, and on the
 * current row only a play/stop button at the right and, while the row plays, a
 * translucent fill from the left as wide as the playback position is into the
 * segment. Its tooltip is the segment's time range.
 */
const SegmentCell = observer(function SegmentCell(props: {
  store: ProjectStore;
  vm: GridViewModel;
  row: number;
  range: TimeRange;
  current: boolean;
}) {
  const { store, vm, row, range, current } = props;
  const inProgress = current && (vm.isPlaying || vm.isPaused);
  return (
    <div
      data-testid={`segment-cell-${row}`}
      title={segmentTooltip(range, current)}
      // Entering a row through this cell plays it, as entering a text cell does (SayMore's
      // OnCellEnter schedules playback for column 0 too). Focus keeps F2 inside the grid.
      tabIndex={-1}
      onClick={() => vm.enterCell(row, vm.currentColumn)}
      css={[
        dataCellCss,
        css`
          position: relative;
          justify-content: space-between;
          padding-right: 3px;
        `,
      ]}
    >
      {current && <PlaybackFill vm={vm} range={range} />}
      <span
        css={css`
          position: relative;
        `}
      >
        {row + 1}
      </span>
      {current && (
        <IconButton
          title={t("grid.play", "Play this segment")}
          onClick={(e) => {
            e.stopPropagation();
            vm.togglePlayRow(row);
          }}
          disabled={!store.segmenter}
          sx={{
            width: 22,
            height: 22,
            p: 0,
            fontSize: 12,
            lineHeight: 1,
            border: "2px solid #2e7d32",
            color: "#2e7d32",
            background: "#fff",
            "&:hover": { background: "#eef6ee" },
            "&.Mui-disabled": { opacity: 0.5 },
          }}
        >
          {inProgress ? "■" : "▶"}
        </IconButton>
      )}
    </div>
  );
});

/**
 * The playback fill of the current row's first cell. It is its own observer so
 * that the playback position, which changes every frame, re-renders only this.
 */
const PlaybackFill = observer(function PlaybackFill(props: {
  vm: GridViewModel;
  range: TimeRange;
}) {
  const { vm, range } = props;
  const playback = vm.playback;
  const fraction = playback
    ? playbackFillFraction(
        {
          positionSec: playback.positionSec,
          clipUrl: playback.clipUrl,
          inProgress: vm.isPlaying || vm.isPaused,
        },
        range,
      )
    : 0;
  if (fraction <= 0) return null;
  return (
    <div
      data-testid="playback-progress"
      style={{ width: `${fraction * 100}%` }}
      css={css`
        position: absolute;
        left: 0;
        top: 3px;
        bottom: 3px;
        background: rgba(255, 255, 255, 0.43);
        pointer-events: none;
      `}
    />
  );
});

/** Persist a transcription / free-translation edit straight to the eaf, the way
 * SayMore saves on cell change. Goes through the DOM-preserving document store. */
async function saveCell(
  store: ProjectStore,
  index: number,
  field: "transcription" | "freeTranslation",
  text: string,
): Promise<void> {
  const doc = store.document;
  const adapter = store.adapter;
  if (!doc || !adapter) return;
  if (field === "transcription") doc.tiers.setTranscription(index, text);
  else doc.tiers.setFreeTranslation(index, text);
  doc.bumpVersion();
  await doc.save(adapter);
}

const dataCellCss = css`
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-right: 1px solid #eceff1;
  overflow: hidden;
  white-space: nowrap;
`;

const headerCellCss = css`
  padding: 6px 8px;
  border-right: 1px solid #dce7d0;
  min-width: 0;
`;

const TranscriptionHeader = observer(function TranscriptionHeader(props: { vm: GridViewModel }) {
  const { vm } = props;
  return (
    <ColumnHeader
      label={t("grid.transcription", "Transcription")}
      menuTestId="transcription-options"
      column="transcription"
      onOpen={() => vm.stop()}
      selected={vm.prefs.transcriptionPlayback}
      onSelect={(value) => vm.setTranscriptionPlayback(value)}
      options={[
        { value: "source", label: t("grid.playback.source", "Playback Source Recording") },
        {
          value: "careful",
          label: t("grid.playback.careful", "Playback Careful Speech Recording"),
        },
        { value: "both", label: t("grid.playback.both", "Playback Both Recordings") },
      ]}
    />
  );
});

const TranslationHeader = observer(function TranslationHeader(props: { vm: GridViewModel }) {
  const { vm } = props;
  return (
    <ColumnHeader
      label={t("grid.freeTranslation", "Free Translation")}
      menuTestId="translation-options"
      column="freeTranslation"
      onOpen={() => vm.stop()}
      selected={vm.prefs.translationPlayback}
      onSelect={(value) => vm.setTranslationPlayback(value)}
      options={[
        { value: "source", label: t("grid.playback.source", "Playback Source Recording") },
        {
          value: "translation",
          label: t("grid.playback.translation", "Playback Oral Translation Recording"),
        },
        { value: "both", label: t("grid.playback.both", "Playback Both Recordings") },
      ]}
    />
  );
});

/** A column header with SayMore's "Options ▾" menu: playback choices, then "Fonts...". */
function ColumnHeader<V extends string>(props: {
  label: string;
  menuTestId: string;
  options: { value: V; label: string }[];
  selected: V;
  onSelect: (value: V) => void;
  onOpen: () => void;
  column: GridColumn;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [fontDialogOpen, setFontDialogOpen] = useState(false);
  return (
    <div
      css={[
        headerCellCss,
        css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        `,
      ]}
    >
      <span>{props.label}</span>
      <Button
        variant="outlined"
        aria-haspopup="menu"
        data-testid={props.menuTestId}
        onClick={(e) => {
          props.onOpen();
          setAnchor(e.currentTarget);
        }}
        sx={{
          textTransform: "none",
          fontFamily: "inherit",
          fontSize: 13,
          py: "1px",
          px: "8px",
          minWidth: 0,
          color: "#37474f",
          background: "#fff",
          borderColor: "#90a4ae",
          "&:hover": { borderColor: "#607d8b", background: "#fff" },
        }}
      >
        {t("grid.options", "Options")} ▾
      </Button>
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {props.options.map((o) => (
          <MenuItem
            key={o.value}
            dense
            role="menuitemradio"
            aria-checked={o.value === props.selected}
            onClick={() => {
              setAnchor(null);
              props.onSelect(o.value);
            }}
          >
            <CheckMark checked={o.value === props.selected} />
            {o.label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          dense
          onClick={() => {
            setAnchor(null);
            setFontDialogOpen(true);
          }}
        >
          <CheckMark checked={false} />
          {t("grid.fontsMenu", "Fonts...")}
        </MenuItem>
      </Menu>
      <ColumnFontDialog
        open={fontDialogOpen}
        column={props.column}
        columnLabel={props.label}
        onClose={() => setFontDialogOpen(false)}
      />
    </div>
  );
}

/** The Fonts dialog for `column`, reading and storing that column's font in {@link gridFonts}. */
const ColumnFontDialog = observer(function ColumnFontDialog(props: {
  open: boolean;
  column: GridColumn;
  columnLabel: string;
  onClose: () => void;
}) {
  return (
    <FontDialog
      open={props.open}
      columnLabel={props.columnLabel}
      font={gridFonts.font(props.column)}
      onCancel={props.onClose}
      onChoose={(font) => {
        props.onClose();
        void gridFonts.setFont(props.column, font);
      }}
    />
  );
});

function CheckMark(props: { checked: boolean }) {
  return (
    <span
      aria-hidden
      css={css`
        display: inline-block;
        width: 20px;
      `}
    >
      {props.checked ? "✓" : ""}
    </span>
  );
}

/** Props both kinds of text cell share: focusing a cell makes it the grid's current cell. */
function cellFocusProps(vm: GridViewModel, row: number, column: GridColumn) {
  return {
    "data-grid-cell": `${row}:${column}`,
    onFocus: () => vm.enterCell(row, column),
    onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
  };
}

/** The text cell of an ignored row: "Ignored", centred, not editable, and still
 * focusable so Tab and the context menu reach it as they do in SayMore. */
const IgnoredCell = observer(function IgnoredCell(props: {
  vm: GridViewModel;
  row: number;
  column: GridColumn;
}) {
  return (
    <div
      style={gridFontStyle(gridFonts.font(props.column))}
      tabIndex={0}
      role="textbox"
      aria-readonly
      {...cellFocusProps(props.vm, props.row, props.column)}
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        border-right: 1px solid #eceff1;
        outline: none;
        &:focus {
          background: #f5f5f5;
        }
      `}
    >
      {t("grid.ignoredIndicator", "Ignored")}
    </div>
  );
});

/**
 * A grid text cell that edits locally and commits on blur / Enter (so we don't
 * rewrite the eaf on every keystroke). Escape reverts. A cell that leaves the
 * DOM (scrolled away, row ignored) while holding an uncommitted edit commits it.
 */
const EditableCell = observer(function EditableCell(props: {
  vm: GridViewModel;
  row: number;
  column: GridColumn;
  initial: string;
  placeholder: string;
  onCommit: (text: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  // The value on disk (or on its way there); read by blur and unmount, which can
  // run before React re-renders with the newest `value`.
  const committed = useRef(props.initial);
  const latest = useRef({ value, onCommit: props.onCommit });
  latest.current = { value, onCommit: props.onCommit };

  function commit(text: string): void {
    if (text === committed.current) return;
    committed.current = text;
    latest.current.onCommit(text);
  }

  useEffect(() => () => commit(latest.current.value), []);

  return (
    <div
      css={css`
        border-right: 1px solid #eceff1;
        min-width: 0;
      `}
    >
      <input
        value={value}
        style={gridFontStyle(gridFonts.font(props.column))}
        placeholder={props.placeholder}
        {...cellFocusProps(props.vm, props.row, props.column)}
        onChange={(e) => {
          setValue(e.target.value);
          latest.current.value = e.target.value;
        }}
        onBlur={() => commit(latest.current.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setValue(committed.current);
            latest.current.value = committed.current;
            (e.target as HTMLInputElement).blur();
          }
        }}
        css={css`
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          border: none;
          background: transparent;
          padding: 0 8px;
          font: inherit;
          color: #263238;
          outline: none;
          &:focus {
            background: #fffde7;
          }
        `}
      />
    </div>
  );
});
