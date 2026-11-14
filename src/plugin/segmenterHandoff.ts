const KEY = "saymore.openSegmenterFor";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * "Manually segment" in lameta: `selectFile` recreates this iframe on the new eaf's grid
 * tab, so the request to open the segmenter there survives in `sessionStorage`, which the
 * recreated iframe (same origin, same window) can read.
 */
export function requestSegmenterOn(eafRelPath: string, store: Storage | undefined = storage()) {
  try {
    store?.setItem(KEY, eafRelPath);
  } catch {
    /* storage unavailable: the grid opens instead */
  }
}

/** Drop an unconsumed request (the host did not select the eaf). */
export function cancelSegmenterRequest(store: Storage | undefined = storage()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    /* nothing to drop */
  }
}

/** True once, when a request for exactly this eaf is pending; the request is then spent. */
export function takeSegmenterRequest(
  eafRelPath: string,
  store: Storage | undefined = storage(),
): boolean {
  try {
    const wanted = store?.getItem(KEY) === eafRelPath;
    if (store?.getItem(KEY) !== null && store?.getItem(KEY) !== undefined) store.removeItem(KEY);
    return wanted;
  } catch {
    return false;
  }
}
