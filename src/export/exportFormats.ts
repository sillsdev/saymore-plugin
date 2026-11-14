import type { AnnotationSegment } from "../model/AnnotationSegment";
import { t } from "../l10n";
import type { OralAnnotationKind } from "../fs/OralAnnotationFiles";
import { exportAudacityLabels } from "./audacity";
import { exportCsv } from "./csv";
import { exportFlexText, FLEX_TEXT_HAS_BOM, type FlexTextOptions } from "./flexText";
import { exportPlainText } from "./plainText";
import { exportSrt } from "./srt";
import { exportToolbox } from "./toolbox";

/** What a host or browser needs in order to write one export. */
export interface ExportFile {
  /** SayMore's default file name in its Save dialog. */
  fileName: string;
  text: string;
  mimeType: string;
  /** Write a UTF-8 byte order mark first (SayMore's `XElement.Save` does; `File.CreateText` does not). */
  bom: boolean;
  /** The Save dialog's file types and the folder it remembers. */
  save: SaveDialogSetup;
}

/** A file type in the Save dialog; extensions have no dot, and `"*"` means all files. */
export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

/**
 * What lameta's Save dialog needs for one kind of export. `rememberFolderKey` is
 * the SayMore setting that holds that kind's last export folder, so each kind
 * starts where SayMore's would: Audacity, Toolbox, FLEx and each audio kind
 * have their own folder, and plain text, SRT and CSV share the general one.
 */
export interface SaveDialogSetup {
  rememberFolderKey: string;
  filters: SaveDialogFilter[];
}

export const GENERAL_EXPORT_FOLDER_KEY = "LastExportDestinationFolder";
export const AUDACITY_EXPORT_FOLDER_KEY = "LastAudacityExportDestinationFolder";
export const TOOLBOX_EXPORT_FOLDER_KEY = "LastToolboxExportDestinationFolder";
export const FLEX_EXPORT_FOLDER_KEY = "LastFlexInterlinearExportDestinationFolder";
export const CAREFUL_SPEECH_EXPORT_FOLDER_KEY = "LastCarefulSpeechExportDestinationFolder";
export const ORAL_TRANSLATION_EXPORT_FOLDER_KEY = "LastOralTranslationExportDestinationFolder";

/** The Save dialog for SayMore's Careful Speech / Oral Translation audio export, as mp3 or the WAV fallback. */
export function audioExportSave(kind: OralAnnotationKind, extension: string): SaveDialogSetup {
  return kind === "Careful"
    ? saveSetup(
        CAREFUL_SPEECH_EXPORT_FOLDER_KEY,
        t("export.filter.careful", "Careful Speech File"),
        extension,
      )
    : saveSetup(
        ORAL_TRANSLATION_EXPORT_FOLDER_KEY,
        t("export.filter.oralTranslation", "Oral Translation File"),
        extension,
      );
}

/** A Save dialog that remembers its folder under `rememberFolderKey` and offers one file type. */
function saveSetup(
  rememberFolderKey: string,
  filterName: string,
  extension: string,
): SaveDialogSetup {
  return { rememberFolderKey, filters: [{ name: filterName, extensions: [extension] }] };
}

const textFileName = () => t("export.filter.text", "Text File");

/** What the exports need to know about the annotated session. */
export interface ExportContext {
  /** SayMore's `ParentElement.Id`: the session folder name. */
  sessionId: string;
  /** The annotated media file name, e.g. `X.wav`. */
  mediaFileName: string;
  /** Where FLEx should look for the media; the bare name when the folder is unknown. */
  mediaFilePath: string;
}

export type ExportFormatId =
  | "audacityFreeTranslation"
  | "audacityTranscription"
  | "flexInterlinear"
  | "plainText"
  | "srtFreeTranslation"
  | "srtTranscription"
  | "csv"
  | "toolbox";

export interface ExportFormat {
  id: ExportFormatId;
  /** The menu label SayMore shows. */
  label: () => string;
  tooltip?: () => string;
  /** The format needs the Export dialog for writing systems before it can build. */
  needsFlexOptions?: boolean;
}

/** SayMore's Export menu, in its order (the ELAN File item and the mp3 audio exports are not here). */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: "audacityFreeTranslation",
    label: () => t("export.audacityFreeTranslation", "Audacity Label File (Free Translation)..."),
  },
  {
    id: "audacityTranscription",
    label: () => t("export.audacityTranscription", "Audacity Label File (Transcription)..."),
  },
  {
    id: "flexInterlinear",
    label: () => t("export.flexInterlinear", "FLEx Interlinear Text..."),
    needsFlexOptions: true,
  },
  { id: "plainText", label: () => t("export.plainText", "Plain Text...") },
  {
    id: "srtFreeTranslation",
    label: () => t("export.srtFreeTranslation", "Subtitles File (Free Translation)..."),
    tooltip: () =>
      t("export.srtTooltip", "The SRT format can be used to create subtitle (captioned) video"),
  },
  {
    id: "srtTranscription",
    label: () => t("export.srtTranscription", "Subtitles File (Transcription)..."),
    tooltip: () =>
      t("export.srtTooltip", "The SRT format can be used to create subtitle (captioned) video"),
  },
  {
    id: "csv",
    label: () => t("export.csv", "Spreadsheet (CSV) File..."),
    tooltip: () =>
      t("export.csvTooltip", "Use this for getting data into a spreadsheet application."),
  },
  { id: "toolbox", label: () => t("export.toolbox", "Toolbox File...") },
];

const fileName = (ctx: ExportContext, suffix: string, ext: string) =>
  `${ctx.sessionId}_${suffix}${ext}`;

const TEXT_MIME = "text/plain;charset=utf-8";

/** Build one export's file, with SayMore's default file name. `flex` is required for `flexInterlinear`. */
export function buildExport(
  id: ExportFormatId,
  segments: readonly AnnotationSegment[],
  ctx: ExportContext,
  flex?: Pick<FlexTextOptions, "transcriptionWs" | "freeTranslationWs">,
): ExportFile {
  const plain = (
    name: string,
    text: string,
    save: SaveDialogSetup,
    mimeType = TEXT_MIME,
  ): ExportFile => ({
    fileName: name,
    text,
    mimeType,
    bom: false,
    save,
  });
  const audacity = saveSetup(AUDACITY_EXPORT_FOLDER_KEY, textFileName(), "txt");
  const srt = saveSetup(
    GENERAL_EXPORT_FOLDER_KEY,
    t("export.filter.srt", "SRT Subtitle File"),
    "srt",
  );
  switch (id) {
    case "audacityFreeTranslation":
      return plain(
        fileName(ctx, "audacity_freeTranslation", ".txt"),
        exportAudacityLabels(segments, "freeTranslation"),
        audacity,
      );
    case "audacityTranscription":
      return plain(
        fileName(ctx, "audacity_transcription", ".txt"),
        exportAudacityLabels(segments, "transcription"),
        audacity,
      );
    case "plainText":
      return plain(
        fileName(ctx, "transcription", ".txt"),
        exportPlainText(segments),
        saveSetup(GENERAL_EXPORT_FOLDER_KEY, textFileName(), "txt"),
      );
    case "srtFreeTranslation":
      return plain(
        fileName(ctx, "freeTranslation_subtitle", ".srt"),
        exportSrt(segments, "freeTranslation"),
        srt,
        "application/x-subrip;charset=utf-8",
      );
    case "srtTranscription":
      return plain(
        fileName(ctx, "transcription_subtitle", ".srt"),
        exportSrt(segments, "transcription"),
        srt,
        "application/x-subrip;charset=utf-8",
      );
    case "csv":
      return plain(
        fileName(ctx, "transcription", ".csv"),
        exportCsv(segments),
        saveSetup(
          GENERAL_EXPORT_FOLDER_KEY,
          t("export.filter.csv", "Comma Separated Values File"),
          "csv",
        ),
        "text/csv;charset=utf-8",
      );
    case "toolbox":
      return plain(
        fileName(ctx, "interlinear", ".txt"),
        exportToolbox(segments, ctx.sessionId, ctx.mediaFileName),
        saveSetup(
          TOOLBOX_EXPORT_FOLDER_KEY,
          t("export.filter.toolbox", "Toolbox Standard Format File"),
          "txt",
        ),
      );
    case "flexInterlinear": {
      if (!flex) throw new Error("FLEx export needs writing systems.");
      return {
        fileName: `${ctx.mediaFileName}.flextext`,
        text: exportFlexText(segments, {
          title: ctx.mediaFileName,
          mediaFilePath: ctx.mediaFilePath,
          ...flex,
        }),
        mimeType: "application/xml;charset=utf-8",
        bom: FLEX_TEXT_HAS_BOM,
        save: {
          rememberFolderKey: FLEX_EXPORT_FOLDER_KEY,
          filters: [
            { name: t("export.filter.flex", "FLEx Interlinear"), extensions: ["flextext"] },
            { name: t("export.filter.all", "All Files"), extensions: ["*"] },
          ],
        },
      };
    }
  }
}
