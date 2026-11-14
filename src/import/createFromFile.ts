import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { annotationsEafName } from "../fs/SessionFolder";
import { createEafFromTemplate, serializeEaf } from "../model/eaf/EafDocument";
import { eafTemplateXml } from "../model/eaf/eafTemplate";
import { segmentsFromAudacityLabels, type LabelTextTier } from "./audacityLabels";
import { importElanFile, isElanXml } from "./elanImport";

/**
 * SayMore `AnnotationFileHelper.CreateFileFromFile`: decide by content, not by which
 * button was pressed. A well-formed ELAN document is copied (see {@link importElanFile});
 * anything else is read as an Audacity label file, with the label text going into `tier`.
 * `getMediaDurationSec` is only called for a label file, which needs the media length.
 */
export async function buildEafFromChosenFile(opts: {
  fileText: string;
  mediaFileName: string;
  tier: LabelTextTier;
  getMediaDurationSec: () => Promise<number>;
}): Promise<{ xml: string; kind: "elan" | "audacity" }> {
  const { fileText, mediaFileName, tier } = opts;
  if (isElanXml(fileText)) {
    return { xml: importElanFile(fileText, mediaFileName), kind: "elan" };
  }
  const durationSec = await opts.getMediaDurationSec();
  const doc = createEafFromTemplate(eafTemplateXml, mediaFileName);
  doc.writeSegments(segmentsFromAudacityLabels(fileText, durationSec, tier));
  return { xml: serializeEaf(doc), kind: "audacity" };
}

/**
 * Write `<media>.annotations.eaf` from a user-chosen ELAN or Audacity label file and
 * return its relative name. An `.eaf` that appeared since the Start Annotating screen
 * loaded is never overwritten.
 */
export async function createEafFromChosenFile(opts: {
  adapter: FileSystemAdapter;
  mediaFileName: string;
  fileText: string;
  tier: LabelTextTier;
  getMediaDurationSec: () => Promise<number>;
}): Promise<string> {
  const eafRel = annotationsEafName(opts.mediaFileName);
  if (await opts.adapter.exists(eafRel)) return eafRel;
  const { xml } = await buildEafFromChosenFile(opts);
  await opts.adapter.writeText(eafRel, xml);
  return eafRel;
}
