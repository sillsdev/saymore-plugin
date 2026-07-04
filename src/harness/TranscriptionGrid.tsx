/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { t } from "../l10n";
import type { HarnessStore } from "./HarnessStore";
import { StubButton } from "./stub";

/**
 * First real slice of the SayMore transcription grid (reference screenshot 2):
 * one row per REAL segment read from the `.eaf`, with editable Transcription and
 * Free Translation cells that save straight back to the eaf (through the
 * DOM-preserving document store), and a real per-segment play button. The
 * per-column "Options ▾" menus are stubbed; full grid UX (autoplay, ignore
 * styling, fonts, keyboard nav) is out of scope for this first slice.
 */
export const TranscriptionGrid = observer(function TranscriptionGrid(props: {
  harness: HarnessStore;
}) {
  const { harness } = props;
  const doc = harness.projectStore.document;
  const segmenter = harness.projectStore.segmenter;
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
        border: 1px solid #b7d59b;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      `}
    >
      <div
        css={css`
          display: grid;
          grid-template-columns: 40px 44px 1fr 1fr;
          background: #f4f7f0;
          border-bottom: 1px solid #b7d59b;
          font-weight: 600;
          color: #33691e;
        `}
      >
        <HeaderCell />
        <HeaderCell />
        <HeaderCell label={t("grid.transcription", "Transcription")} withOptions />
        <HeaderCell label={t("grid.freeTranslation", "Free Translation")} withOptions />
      </div>

      {segments.length === 0 && (
        <div
          css={css`
            padding: 10px;
            color: #78909c;
          `}
        >
          {t("grid.empty", "No segments yet. Use “Segment…” to add boundaries.")}
        </div>
      )}

      {segments.map((seg, i) => {
        const selected = i === selectedRow;
        return (
          <div
            key={i}
            onClick={() => setSelectedRow(i)}
            css={css`
              display: grid;
              grid-template-columns: 40px 44px 1fr 1fr;
              min-height: 34px;
              background: ${selected ? "#cfe4ff" : "#fff"};
              border-bottom: 1px solid #eceff1;
            `}
          >
            <div css={cellCss}>{i + 1}</div>
            <div
              css={[
                cellCss,
                css`
                  justify-content: center;
                `,
              ]}
            >
              <button
                type="button"
                title={t("grid.play", "Play this segment")}
                onClick={(e) => {
                  e.stopPropagation();
                  segmenter?.playSegment(i);
                }}
                disabled={!segmenter}
                css={css`
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  border: 2px solid #2e7d32;
                  color: #2e7d32;
                  background: #fff;
                  cursor: pointer;
                  line-height: 1;
                  &:disabled {
                    opacity: 0.5;
                    cursor: default;
                  }
                `}
              >
                ▶
              </button>
            </div>
            <EditableCell
              key={`tr-${i}-${rev}`}
              initial={seg.transcription}
              placeholder={t("grid.transcriptionPlaceholder", "transcription…")}
              onCommit={(text) => void harness.saveCell(i, "transcription", text)}
            />
            <EditableCell
              key={`ft-${i}-${rev}`}
              initial={seg.freeTranslation}
              placeholder={t("grid.freeTranslationPlaceholder", "free translation…")}
              onCommit={(text) => void harness.saveCell(i, "freeTranslation", text)}
            />
          </div>
        );
      })}
    </div>
  );
});

const cellCss = css`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  color: #37474f;
`;

function HeaderCell(props: { label?: string; withOptions?: boolean }) {
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        border-right: 1px solid #dce7d0;
      `}
    >
      <span>{props.label ?? ""}</span>
      {props.withOptions && (
        <StubButton feature={props.label}>{t("grid.options", "Options")} ▾</StubButton>
      )}
    </div>
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
        width: 100%;
        border: none;
        background: transparent;
        padding: 4px 8px;
        font: inherit;
        color: #263238;
        outline: none;
        border-right: 1px solid #eceff1;
        &:focus {
          background: #fffde7;
        }
      `}
    />
  );
}
