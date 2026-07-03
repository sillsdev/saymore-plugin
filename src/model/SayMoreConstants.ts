/**
 * All SayMore-derived magic numbers in one place (plan Risk #7: "keep all
 * SayMore constants named in one module"). Values confirmed against
 * `D:\saymore\src\SayMore\Properties\Settings.settings`.
 */

/** Minimum segment length. Insert/move/nudge are all clamped to this. */
export const MIN_SEGMENT_LENGTH_MS = 460;

/** ← / → nudge the selected boundary by this many ms per keystroke. */
export const NUDGE_MS = 5;

/** After a nudge/drag, replay this many ms up to the boundary. */
export const REPLAY_WINDOW_MS = 1000;

/** Debounce before the post-adjust replay fires (reset by each new nudge). */
export const REPLAY_DELAY_MS = 600;

/** Waveform pixels-per-second at 100% zoom (SayMore `SegmentingWaveViewPixelsPerSecond`). */
export const PIXELS_PER_SECOND_AT_100 = 80;

/** Zoom is clamped to this minimum percentage; Ctrl+1/Ctrl+3 step by ±10. */
export const MIN_ZOOM_PERCENT = 100;
export const ZOOM_STEP_PERCENT = 10;

/** Discrete presets offered by the zoom dropdown (keyboard is not limited to these). */
export const ZOOM_PRESETS = [100, 125, 150, 175, 200, 250, 300, 500, 750, 1000];

/**
 * "Close to the end" window used by the end-of-file rule on save: if the last
 * segment ends within this many seconds of the media end, the tail is handled
 * (extend or trailing-ignored); a larger gap is left unsegmented.
 */
export const CLOSE_TO_END_SEC = 5;

/** How long the too-short warning text stays red before auto-clearing. */
export const TOO_SHORT_WARNING_MS = 4000;

/** Pixel hit-tolerance for clicking a boundary, and the drag dead-zone. */
export const BOUNDARY_HIT_HALF_WIDTH_PX = 4;
export const DRAG_DEAD_ZONE_PX = 2;

/** Oral-annotation sibling folder + per-segment WAV suffixes. */
export const ANNOTATIONS_FOLDER_SUFFIX = "_Annotations";
export const CAREFUL_SUFFIX = "_Careful.wav";
export const TRANSLATION_SUFFIX = "_Translation.wav";

/** The `.annotations.eaf` companion suffix (media extension is retained before it). */
export const ANNOTATIONS_EAF_SUFFIX = ".annotations.eaf";

/** Prefer this media file within a session folder when present. */
export const STANDARD_AUDIO_SUFFIX = "_StandardAudio.wav";
