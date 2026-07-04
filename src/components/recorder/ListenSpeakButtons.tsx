/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import { t } from "../../l10n";
import {
  LAMETA_BLUE,
  LAMETA_DARK_BLUE,
  LAMETA_GREEN,
  LAMETA_DARK_GREEN,
  LAMETA_UI_FONT,
} from "../../lametaTheme";
import type { RecorderViewModel } from "../../state/recorder/RecorderViewModel";

/**
 * SayMore's left-gutter push-to-talk pair: a big press-and-hold Listen (ear,
 * blue panel) over Speak (face/mic, green panel; disabled until the annotator
 * has heard the current segment). Both use pointer capture so the button keeps
 * receiving events even if the pointer drifts off it while held; losing that
 * capture any other way (drag off-window, alt-tab, element removed) is treated
 * as an ABORT, never a successful stop — a truncated take must never be kept.
 */
export const ListenSpeakButtons = observer(function ListenSpeakButtons(props: {
  vm: RecorderViewModel;
}) {
  const { vm } = props;
  const canRecord = vm.mode === "Record" && vm.hasListenedToCurrent;

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        font-family: ${LAMETA_UI_FONT};
      `}
    >
      <PressHoldButton
        label={t("recorder.listen", "Listen")}
        icon="👂"
        color={LAMETA_BLUE}
        pressedColor={LAMETA_DARK_BLUE}
        pressed={vm.isListening}
        disabled={vm.mode === "Done" || vm.mode === "Error"}
        onDown={() => vm.listenDown()}
        onUp={() => vm.listenUp()}
        onAbort={() => vm.abortRecording()}
      />
      <PressHoldButton
        label={t("recorder.speak", "Speak")}
        icon="🗣"
        color={LAMETA_GREEN}
        pressedColor={LAMETA_DARK_GREEN}
        pressed={vm.isRecording}
        disabled={!canRecord}
        onDown={() => vm.speakDown()}
        onUp={() => void vm.speakUp()}
        onAbort={() => vm.abortRecording()}
      />
    </div>
  );
});

function PressHoldButton(props: {
  label: string;
  icon: string;
  color: string;
  pressedColor: string;
  pressed: boolean;
  disabled: boolean;
  onDown: () => void;
  onUp: () => void;
  onAbort: () => void;
}) {
  const { label, icon, color, pressedColor, pressed, disabled, onDown, onUp, onAbort } = props;
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
        width: 76px;
        height: 76px;
        border: none;
        border-radius: 10px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        color: #263238;
        background: ${pressed ? pressedColor : color};
        cursor: ${disabled ? "not-allowed" : "pointer"};
        opacity: ${disabled ? 0.45 : 1};
        touch-action: none;
        user-select: none;
        &:focus-visible {
          outline: 2px solid #263238;
          outline-offset: 2px;
        }
      `}
    >
      <span aria-hidden css={css({ fontSize: 28, lineHeight: 1 })}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
