/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import { t } from "../../l10n";
import type { ProjectStore } from "../../state/ProjectStore";
import { StubButton } from "../shell/stub";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * First real slice of the SayMore transcription grid (reference screenshot 2):
 * one row per REAL segment read from the `.eaf`, with editable Transcription and
 * Free Translation cells that save straight back to the eaf (through the
 * DOM-preserving document store), and a real per-segment play button. The
 * per-column "Options ▾" menus are stubbed; full grid UX (autoplay, ignore
 * styling, fonts, keyboard nav) is out of scope for this first slice.
 *
 * It's a plain HTML `<table>` with `table-layout: fixed` so header and body
 * columns are guaranteed to line up: two narrow fixed columns (row number, play)
 * and two equal-width text columns (Transcription, Free Translation).
 *
 * The table lives in a vertically-scrolling container that fills the height its
 * parent (the grid pane) gives it, and the header row is `position: sticky` so it
 * stays visible while the rows scroll under it — so the whole grid never overflows
 * the frame lameta hands the iframe.
 */
export const TranscriptionGrid = observer(function TranscriptionGrid(props: {
  store: ProjectStore;
}) {
  const { store } = props;
  const doc = store.document;
  const segmenter = store.segmenter;
  const [selectedRow, setSelectedRow] = useState(0);

  if (!doc)
    return (
      <p
        css={css`
          padding: 12px;
        `}
      >
        {t("harness.loading", "Loading…")}
      </p>
    );

  const segments = doc.segments;
  // `rev` in the cell keys makes external changes (reload/undo) reset the inputs.
  const rev = doc.version;

  return (
    <div
      css={css`
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        border: 1px solid #b7d59b;
      `}
    >
      <table
        css={css`
          table-layout: fixed;
          width: 100%;
          border-collapse: collapse;
          font-family: ${LAMETA_UI_FONT};
          font-size: 13px;
          color: #37474f;
        `}
      >
        <colgroup>
          <col css={{ width: 40 }} />
          <col css={{ width: 44 }} />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr
            css={css`
              background: #f4f7f0;
              border-bottom: 1px solid #b7d59b;
              color: #33691e;
            `}
          >
            <th css={headerCellCss} />
            <th css={headerCellCss} />
            <HeaderCell label={t("grid.transcription", "Transcription")} />
            <HeaderCell label={t("grid.freeTranslation", "Free Translation")} />
          </tr>
        </thead>
        <tbody>
          {segments.length === 0 && (
            <tr>
              <td
                colSpan={4}
                css={css`
                  padding: 10px;
                  color: #78909c;
                `}
              >
                {t("grid.empty", "No segments yet. Use “Edit Segments” to add boundaries.")}
              </td>
            </tr>
          )}

          {segments.map((seg, i) => {
            const selected = i === selectedRow;
            return (
              <tr
                key={i}
                onClick={() => setSelectedRow(i)}
                css={css`
                  min-height: 34px;
                  background: ${selected ? "#cfe4ff" : "#fff"};
                  border-bottom: 1px solid #eceff1;
                `}
              >
                <td css={dataCellCss}>{i + 1}</td>
                <td
                  css={[
                    dataCellCss,
                    css`
                      text-align: center;
                    `,
                  ]}
                >
                  <IconButton
                    title={t("grid.play", "Play this segment")}
                    onClick={(e) => {
                      e.stopPropagation();
                      segmenter?.playSegment(i);
                    }}
                    disabled={!segmenter}
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
                    ▶
                  </IconButton>
                </td>
                <EditableCell
                  key={`tr-${i}-${rev}`}
                  initial={seg.transcription}
                  placeholder={t("grid.transcriptionPlaceholder", "transcription…")}
                  onCommit={(text) => void saveCell(store, i, "transcription", text)}
                />
                <EditableCell
                  key={`ft-${i}-${rev}`}
                  initial={seg.freeTranslation}
                  placeholder={t("grid.freeTranslationPlaceholder", "free translation…")}
                  onCommit={(text) => void saveCell(store, i, "freeTranslation", text)}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  padding: 4px 8px;
  vertical-align: middle;
  border-right: 1px solid #eceff1;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// Sticky so the header stays pinned while the body scrolls. The background and
// bottom box-shadow live on the cells (not the row) because a sticky cell must
// paint its own background, and collapsed row borders don't stick reliably.
const headerCellCss = css`
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f4f7f0;
  padding: 6px 8px;
  text-align: left;
  font-weight: 600;
  border-right: 1px solid #dce7d0;
  box-shadow: inset 0 -1px 0 #b7d59b;
`;

function HeaderCell(props: { label: string }) {
  return (
    <th css={headerCellCss}>
      <div
        css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        `}
      >
        <span>{props.label}</span>
        <StubButton feature={props.label}>{t("grid.options", "Options")} ▾</StubButton>
      </div>
    </th>
  );
}

/**
 * A grid text cell that edits locally and commits on blur / Enter (so we don't
 * rewrite the eaf on every keystroke). Escape reverts.
 */
function EditableCell(props: {
  initial: string;
  placeholder: string;
  onCommit: (text: string) => void;
}) {
  const [value, setValue] = useState(props.initial);

  function commit(): void {
    if (value !== props.initial) props.onCommit(value);
  }

  return (
    <td
      css={css`
        padding: 0;
        vertical-align: middle;
        border-right: 1px solid #eceff1;
      `}
    >
      <input
        value={value}
        placeholder={props.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setValue(props.initial);
            (e.target as HTMLInputElement).blur();
          }
        }}
        css={css`
          box-sizing: border-box;
          width: 100%;
          border: none;
          background: transparent;
          padding: 8px;
          font: inherit;
          color: #263238;
          outline: none;
          &:focus {
            background: #fffde7;
          }
        `}
      />
    </td>
  );
}
