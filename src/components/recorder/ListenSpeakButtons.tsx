/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import { t } from "../../l10n";
import { LAMETA_UI_FONT } from "../../lametaTheme";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";
import listenIconUrl from "./icons/ListenToOriginalRecording.png";
import listenIconDownUrl from "./icons/ListenToOriginalRecordingDown.png";
import speakIconUrl from "./icons/RecordOralAnnotation.png";
import speakIconRecordingUrl from "./icons/RecordingOralAnnotationInProgress.gif";

/**
 * SayMore's push-to-talk pair, using the real SayMore art (John's request):
 * the ear button over the source row, the face/mic button over the
 * annotation row (disabled until the annotator has heard the current
 * segment; animates via the recording GIF while held). Both use pointer
 * capture so the button keeps receiving events even if the pointer drifts
 * off it while held; losing that capture any other way (drag off-window,
 * alt-tab, element removed) is treated as an ABORT, never a successful stop
 * — a truncated take must never be kept.
 */
export const ListenButton = observer(function ListenButton(props: { vm: RecorderViewModel }) {
  const { vm } = props;
  return (
    <PressHoldButton
      label={t("recorder.listen", "Listen")}
      icon={vm.isListening ? listenIconDownUrl : listenIconUrl}
      pressed={vm.isListening}
      disabled={vm.mode === "Done" || vm.mode === "Error"}
      onDown={() => vm.listenDown()}
      onUp={() => vm.listenUp()}
      onAbort={() => vm.abortRecording()}
    />
  );
});

export const SpeakButton = observer(function SpeakButton(props: { vm: RecorderViewModel }) {
  const { vm } = props;
  const canRecord = vm.mode === "Record" && vm.hasListenedToCurrent;
  return (
    <PressHoldButton
      label={t("recorder.speak", "Speak")}
      icon={vm.isRecording ? speakIconRecordingUrl : speakIconUrl}
      pressed={vm.isRecording}
      disabled={!canRecord}
      onDown={() => vm.speakDown()}
      onUp={() => void vm.speakUp()}
      onAbort={() => vm.abortRecording()}
    />
  );
});

function PressHoldButton(props: {
  label: string;
  icon: string;
  pressed: boolean;
  disabled: boolean;
  onDown: () => void;
  onUp: () => void;
  onAbort: () => void;
}) {
  const { label, icon, pressed, disabled, onDown, onUp, onAbort } = props;
  // Guards against handling the same release twice: an explicit
  // releasePointerCapture() and a real pointerup both end up notifying
  // "lostpointercapture" — only the first should fire an action.
  const heldRef = useRef(false);

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    if (disabled || e.button !== 0) return;
    // Optional: jsdom/happy-dom (specs) don't implement the Pointer Capture API.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    heldRef.current = true;
    onDown();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>): void {
    if (!heldRef.current) return;
    heldRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onUp();
  }

  function handleCaptureLost(): void {
    if (!heldRef.current) return;
    heldRef.current = false;
    onAbort();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleCaptureLost}
      onLostPointerCapture={handleCaptureLost}
      css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        width: 64px;
        height: 64px;
        border: none;
        border-radius: 8px;
        background: transparent;
        font-family: ${LAMETA_UI_FONT};
        font-size: 11px;
        font-weight: 600;
        color: #263238;
        cursor: ${disabled ? "not-allowed" : "pointer"};
        opacity: ${disabled ? 0.45 : 1};
        touch-action: none;
        user-select: none;
        &:hover {
          background: ${disabled ? "transparent" : "rgba(0, 0, 0, 0.05)"};
        }
        &:focus-visible {
          outline: 2px solid #263238;
          outline-offset: 2px;
        }
      `}
    >
      <img src={icon} alt="" width={40} height={40} draggable={false} />
      <span>{label}</span>
    </button>
  );
}
