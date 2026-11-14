import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface PressAndHoldHandlers {
  /** Starts the gesture. */
  onDown: () => void;
  /** The pointer was released: the gesture succeeded. */
  onUp: () => void;
  /** The gesture ended without a release (cancel, lost capture, blur, unmount): discard the take. */
  onAbort: () => void;
}

/**
 * Push-to-talk gesture handlers for a button. A press ends exactly once, as
 * `onUp` (pointer released) or `onAbort` (anything else). Besides the button's
 * own pointer events, the gesture listens on `window` from pointerdown until it
 * ends, so a release or focus loss still ends it when the button no longer
 * receives events (pointer drifted off, element re-rendered, window lost focus).
 * Unmounting the button mid-press aborts.
 */
export function usePressAndHold(handlers: PressAndHoldHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const heldRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);

  function finish(kind: "up" | "abort"): void {
    if (!heldRef.current) return;
    heldRef.current = false;
    detachRef.current?.();
    detachRef.current = null;
    if (kind === "up") handlersRef.current.onUp();
    else handlersRef.current.onAbort();
  }

  useEffect(
    () => () => {
      finish("abort");
    },
    [],
  );

  function onPointerDown(e: ReactPointerEvent<HTMLElement>): void {
    if (e.button !== 0 || heldRef.current) return;
    // Optional: jsdom/happy-dom (specs) don't implement the Pointer Capture API.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    heldRef.current = true;
    const up = () => finish("up");
    const abort = () => finish("abort");
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    detachRef.current = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
    };
    handlersRef.current.onDown();
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>): void {
    if (!heldRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    finish("up");
  }

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel: () => finish("abort"),
    onLostPointerCapture: () => finish("abort"),
  };
}
