/** @jsxImportSource @emotion/react */
import { observer } from "mobx-react-lite";
import { useState } from "react";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { t } from "../../l10n";
import {
  deliverExportBytes,
  deliverExportFile,
  type ExportDelivery,
} from "../../export/deliverExportFile";
import { exportOralAudio, type RunFfmpeg } from "../../export/audioExport";
import type { OralAnnotationKind } from "../../fs/OralAnnotationFiles";
import {
  audioExportSave,
  buildExport,
  EXPORT_FORMATS,
  type ExportContext,
  type ExportFile,
  type ExportFormat,
} from "../../export/exportFormats";
import type { ProjectStore } from "../../state/ProjectStore";
import { FlexExportDialog } from "./FlexExportDialog";

/** The session id SayMore puts in export file names: the session folder's name. */
function exportContext(store: ProjectStore): ExportContext {
  const dir = store.sessionDirectory;
  const media = store.mediaFileName;
  const folderName = dir.split(/[\\/]/).filter(Boolean).pop();
  const separator = dir.includes("\\") ? "\\" : "/";
  return {
    sessionId: folderName ?? media.replace(/\.[^.]*$/, ""),
    mediaFileName: media,
    mediaFilePath: dir ? `${dir.replace(/[\\/]+$/, "")}${separator}${media}` : media,
  };
}

/** The status line after an export: the saved file's name, or nothing for a cancel or a download. */
export function deliveryNotice(delivery: ExportDelivery): string | undefined {
  return delivery.kind === "saved"
    ? t("export.saved", "Saved {fileName}.", { fileName: delivery.fileName })
    : undefined;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** SayMore's "Export" drop-down; enabled only while the grid has rows. */
export const ExportMenu = observer(function ExportMenu(props: {
  store: ProjectStore;
  /** The host's ffmpeg, present only inside lameta; without it the audio exports deliver WAV. */
  runFfmpeg?: RunFfmpeg;
}) {
  const { store, runFfmpeg } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [recorded, setRecorded] = useState<Record<OralAnnotationKind, boolean>>({
    Careful: false,
    Translation: false,
  });
  const [notice, setNotice] = useState<string | undefined>(undefined);

  /** SayMore enables each audio item only when recordings of that kind exist. */
  const openMenu = async (button: HTMLElement) => {
    setAnchor(button);
    const index = store.oralIndex;
    if (!index) return;
    await index.refresh();
    setRecorded({
      Careful: index.namesOfKind("Careful").length > 0,
      Translation: index.namesOfKind("Translation").length > 0,
    });
  };

  const runAudio = async (kind: OralAnnotationKind) => {
    setAnchor(null);
    const index = store.oralIndex;
    const adapter = store.adapter;
    if (!index || !adapter) return;
    setNotice(undefined);
    try {
      const result = await exportOralAudio({
        adapter,
        index,
        kind,
        ...exportContext(store),
        runFfmpeg,
      });
      const extension = result.fileName.slice(result.fileName.lastIndexOf(".") + 1);
      const delivery = await deliverExportBytes(
        result.fileName,
        result.bytes,
        result.mimeType,
        audioExportSave(kind, extension),
      );
      if (delivery.kind === "cancelled") return;
      const fallback = result.fellBackToWav
        ? t(
            "export.audioWavFallback",
            "This environment cannot make an MP3, so the audio was exported as a WAV file.",
          )
        : undefined;
      const parts = [deliveryNotice(delivery), fallback].filter(Boolean);
      setNotice(parts.length ? parts.join(" ") : undefined);
    } catch (e) {
      setNotice(errorText(e));
    }
  };

  const deliver = (build: () => ExportFile) => {
    setNotice(undefined);
    void (async () => {
      try {
        setNotice(deliveryNotice(await deliverExportFile(build())));
      } catch (e) {
        setNotice(errorText(e));
      }
    })();
  };
  const [flexOpen, setFlexOpen] = useState(false);
  const segments = store.document?.tiers.segments ?? [];

  const run = (format: ExportFormat) => {
    setAnchor(null);
    if (format.needsFlexOptions) {
      setFlexOpen(true);
      return;
    }
    deliver(() => buildExport(format.id, segments, exportContext(store)));
  };

  return (
    <>
      <Button
        variant="outlined"
        disabled={segments.length === 0}
        onClick={(e) => void openMenu(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        sx={{
          textTransform: "none",
          fontFamily: "inherit",
          fontSize: 13,
          py: "3px",
          px: "8px",
          minWidth: 0,
          gap: "4px",
          color: "#37474f",
          background: "#fff",
          borderColor: "#90a4ae",
          "&:hover": { borderColor: "#607d8b", background: "#fff" },
          "&.Mui-disabled": { opacity: 0.65 },
        }}
      >
        {t("annotations.export", "Export")} ▾
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {EXPORT_FORMATS.map((f) => (
          <MenuItem key={f.id} title={f.tooltip?.()} onClick={() => run(f)} sx={{ fontSize: 13 }}>
            {f.label()}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          disabled={!recorded.Careful}
          onClick={() => void runAudio("Careful")}
          sx={{ fontSize: 13 }}
        >
          {t("export.carefulSpeechAudio", "Careful Speech Audio...")}
        </MenuItem>
        <MenuItem
          disabled={!recorded.Translation}
          onClick={() => void runAudio("Translation")}
          sx={{ fontSize: 13 }}
        >
          {t("export.oralTranslationAudio", "Oral Translation Audio...")}
        </MenuItem>
      </Menu>
      {notice && (
        <span role="status" style={{ fontSize: 12, color: "#37474f" }}>
          {notice}
        </span>
      )}
      <FlexExportDialog
        open={flexOpen}
        tierLanguages={store.document?.tierLanguages()}
        onCancel={() => setFlexOpen(false)}
        onExport={(flex) => {
          setFlexOpen(false);
          deliver(() => buildExport("flexInterlinear", segments, exportContext(store), flex));
        }}
      />
    </>
  );
});
