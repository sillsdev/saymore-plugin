import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { annotationsEafName } from "../fs/SessionFolder";
import type { AnnotationSegment } from "../model/AnnotationSegment";
import { makeTimeRange } from "../model/TimeRange";
import { createEafFromTemplate, serializeEaf } from "../model/eaf/EafDocument";
import { eafTemplateXml } from "../model/eaf/eafTemplate";
import { DEFAULT_AUTO_SEGMENTER_SETTINGS, type AutoSegmenterSettings } from "./autoSegmenter";
import { computeEnvelope } from "./envelope";
import { runSilenceSegmenter } from "./autoSegmenterClient";
import type { Envelope } from "./EnvelopeCache";

/**
 * Turn the auto-segmenter's boundary list (ascending seconds, excluding 0,
 * including the media end — see {@link getNaturalBreaks}) into contiguous
 * positional segments, matching SayMore's `AutoSegmenter.Run` →
 * `TimeTier.AppendSegment` (each break is the END of a segment that starts at
 * the previous break; the first starts at 0). Text tiers are left empty.
 *
 * Degenerate boundaries (not strictly greater than the running start) are
 * skipped defensively; the ported algorithm never emits them, but a bespoke
 * one might.
 */
export function segmentsFromBoundaries(boundaries: readonly number[]): AnnotationSegment[] {
  const segments: AnnotationSegment[] = [];
  let start = 0;
  for (const end of boundaries) {
    if (end <= start) continue;
    segments.push({ range: makeTimeRange(start, end), transcription: "", freeTranslation: "" });
    start = end;
  }
  return segments;
}

/**
 * Build the SayMore-parity `<media>.annotations.eaf` XML for a set of
 * auto-segmenter boundaries: seed the annotation template, write the segments
 * onto the owned tiers (integer-ms TIME_SLOTs, empty-text ALIGNABLE_ANNOTATIONs
 * on the Transcription tier), and serialize. Pure — no I/O, no worker — so it
 * unit-tests directly.
 */
export function buildAutoSegmentedEafXml(
  mediaFileName: string,
  boundaries: readonly number[],
): string {
  const doc = createEafFromTemplate(eafTemplateXml, mediaFileName);
  doc.writeSegments(segmentsFromBoundaries(boundaries));
  return serializeEaf(doc);
}

export interface AutoSegmentToEafOptions {
  adapter: FileSystemAdapter;
  mediaFileName: string;
  /** Reuse an already-computed envelope; otherwise the media is read + decoded. */
  envelope?: Envelope;
  settings?: AutoSegmenterSettings;
  onProgress?: (fraction: number) => void;
  /** Seam for tests: defaults to the silence/VAD {@link runSilenceSegmenter}. */
  runSegmenter?: (
    envelope: Envelope,
    settings: AutoSegmenterSettings,
    onProgress?: (fraction: number) => void,
  ) => Promise<number[]>;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

/**
 * End-to-end auto-segment for one media file, everything up to (but not
 * including) revealing the segmenter: compute the envelope if needed, run the
 * auto-segmenter (worker), and write the resulting SayMore-parity `.eaf` beside
 * the media through the adapter seam. Never clobbers an existing `.eaf`.
 *
 * The eaf is fully written here so the caller can safely `selectFile` it (in the
 * embedded flow, `selectFile` recreates the iframe and nothing after it runs).
 * Returns the eaf's relative name and the boundaries found.
 */
export async function autoSegmentToEaf(
  opts: AutoSegmentToEafOptions,
): Promise<{ eafRel: string; boundaries: number[] }> {
  const { adapter, mediaFileName } = opts;
  const settings = opts.settings ?? DEFAULT_AUTO_SEGMENTER_SETTINGS;
  const runSegmenter = opts.runSegmenter ?? runSilenceSegmenter;
  const eafRel = annotationsEafName(mediaFileName);

  // Guard a race where an `.eaf` appeared since load — don't overwrite it.
  if (await adapter.exists(eafRel)) {
    return { eafRel, boundaries: [] };
  }

  const envelope =
    opts.envelope ??
    (await computeEnvelope(await adapter.readBytes(mediaFileName), extOf(mediaFileName)));

  const boundaries = await runSegmenter(envelope, settings, opts.onProgress);
  const xml = buildAutoSegmentedEafXml(mediaFileName, boundaries);
  await adapter.writeText(eafRel, xml);
  return { eafRel, boundaries };
}
