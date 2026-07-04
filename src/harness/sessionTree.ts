import { annotationsEafName, findMediaFile } from "../fs/SessionFolder";

/**
 * The simulated SayMore file tree, derived purely from a session's file-name
 * list (see reference screenshot 1). Every row is a real **file**, shown by its
 * filename; the "Audio / Annotations / OralAnnotations" text is the *type*
 * column, not the name. Kept pure so it unit-tests without any adapter:
 *  - the media file is always the "Audio" node;
 *  - its `.annotations.eaf` companion is the nested "Annotations" node;
 *  - a `<media>.oralAnnotations.wav` companion is the deeper "OralAnnotations"
 *    node (we don't create that file yet, so it only shows if one is present —
 *    e.g. in a connected real folder).
 */

/** Combined oral-annotation companion file (harness naming; not yet generated). */
const ORAL_ANNOTATIONS_SUFFIX = ".oralAnnotations.wav";
export type SessionNodeKind = "audio" | "eaf" | "oral";

export interface SessionNode {
  kind: SessionNodeKind;
  /** Relative file name (or folder name, for the oral node). */
  name: string;
  /** SayMore file-type label shown in the right-hand column. */
  typeLabel: string;
  /** Indent depth (audio 0, annotations 1, oral 2). */
  depth: number;
}

export interface SessionTree {
  mediaFileName: string | undefined;
  eafName: string | undefined;
  nodes: SessionNode[];
}

function oralAnnotationsName(mediaFileName: string): string {
  return mediaFileName + ORAL_ANNOTATIONS_SUFFIX;
}

export function deriveSessionTree(files: readonly string[]): SessionTree {
  const mediaFileName = findMediaFile(files);
  if (!mediaFileName) return { mediaFileName: undefined, eafName: undefined, nodes: [] };

  const nodes: SessionNode[] = [
    { kind: "audio", name: mediaFileName, typeLabel: "Audio", depth: 0 },
  ];

  const eafName = annotationsEafName(mediaFileName);
  const hasEaf = files.includes(eafName);
  if (hasEaf) {
    // The "Annotations" row IS the `.eaf` file itself.
    nodes.push({ kind: "eaf", name: eafName, typeLabel: "Annotations", depth: 1 });

    // The `<media>.oralAnnotations.wav` file is a separate, deeper
    // "OralAnnotations" row *under* the eaf — never a sibling of it, and never
    // shown without an eaf (there are no annotations to attach it to).
    const oralName = oralAnnotationsName(mediaFileName);
    if (files.includes(oralName)) {
      nodes.push({ kind: "oral", name: oralName, typeLabel: "OralAnnotations", depth: 2 });
    }
  }

  return { mediaFileName, eafName: hasEaf ? eafName : undefined, nodes };
}
