/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { t } from "../../l10n";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import type { Viewport } from "../waveform/WaveformSurface";
import { layoutCells, sameTimeRange } from "./cellLayout";
import playIconUrl from "./icons/PlaySegment.png";
import undoIconUrl from "./icons/undo.png";

/**
 * Per-segment controls drawn over the SOURCE waveform (top row): an
 * always-visible play button at the bottom-left of every segment
 * (`vm.playSourceOf`), and — only while hovering that segment — an "Ignored"
 * checkbox (`vm.toggleIgnore`) and, when this is the segment the next
 * undo/redo would touch, an Undo button at the top (C# ref:
 * SegmenterDlgBase.HandleIgnoreButtonClick / ~line 893 for the undo tooltip).
 */
export const SourceSegmentControls = observer(function SourceSegmentControls(props: {
  vm: RecorderViewModel;
  viewport: Viewport;
}) {
  const { vm, viewport } = props;
  const rects = layoutCells(vm.cells, viewport);
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <>
      {rects.map((rect) => {
        const cell = vm.cells[rect.index];
        const showUndo = sameTimeRange(cell.range, vm.timeRangeForUndo);
        return (
          <div
            key={rect.index}
            onMouseEnter={() => setHovered(rect.index)}
            onMouseLeave={() => setHovered((h) => (h === rect.index ? null : h))}
            css={css`
              position: absolute;
              top: 0;
              height: ${viewport.height}px;
              pointer-events: auto;
            `}
            style={{ left: rect.left, width: rect.width }}
          >
            {hovered === rect.index && (
              <div
                css={css`
                  position: absolute;
                  top: 2px;
                  left: 2px;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                `}
              >
                <label
                  data-testid={`segment-ignore-${rect.index}`}
                  css={css`
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    padding: 1px 4px;
                    font-size: 10px;
                    background: rgba(255, 255, 255, 0.9);
                    border: 1px solid #90a4ae;
                    border-radius: 3px;
                    cursor: pointer;
                  `}
                >
                  <input
                    type="checkbox"
                    checked={cell.ignored}
                    onChange={() => vm.toggleIgnore(rect.index)}
                    css={css`
                      width: 10px;
                      height: 10px;
                      margin: 0;
                    `}
                  />
                  {t("recorder.ignored", "Ignored")}
                </label>

                {showUndo && (
                  <button
                    type="button"
                    data-testid="segment-undo"
                    title={t("recorder.undoTooltip", "Undo: {description} (Ctrl-Z or Z)", {
                      description: vm.undoDescription ?? "",
                    })}
                    onClick={() => vm.undo()}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: 3px;
                      padding: 1px 4px;
                      font-size: 10px;
                      background: rgba(255, 255, 255, 0.9);
                      border: 1px solid #90a4ae;
                      border-radius: 3px;
                      cursor: pointer;
                      &:hover {
                        background: #fff;
                      }
                    `}
                  >
                    <img src={undoIconUrl} alt="" width={12} height={12} />
                    {t("recorder.undo", "Undo")}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              data-testid={`segment-play-${rect.index}`}
              title={t("recorder.playSource", "Play the source")}
              onClick={() => vm.playSourceOf(rect.index)}
              css={css`
                position: absolute;
                bottom: 2px;
                left: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                padding: 0;
                border: 1px solid #2e7d32;
                border-radius: 3px;
                background: #fff;
                cursor: pointer;
                &:hover {
                  background: #eef6ee;
                }
              `}
            >
              <img src={playIconUrl} alt="" width={14} height={14} />
            </button>
          </div>
        );
      })}
    </>
  );
});
