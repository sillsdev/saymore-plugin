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

/**
 * Ask lameta to select `eafRelPath` with a request to open the segmenter there. Resolves to
 * what `selectFile` resolved; when that is false, or `selectFile` rejects, the request is
 * dropped so that a later visit to the eaf opens its grid.
 */
export async function selectEafForSegmenter(
  eafRelPath: string,
  selectFile: (relPath: string) => Promise<boolean>,
  store: Storage | undefined = storage(),
): Promise<boolean> {
  requestSegmenterOn(eafRelPath, store);
  let selected = false;
  try {
    selected = await selectFile(eafRelPath);
  } finally {
    if (!selected) cancelSegmenterRequest(store);
  }
  return selected;
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
