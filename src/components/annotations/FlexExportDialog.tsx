/** @jsxImportSource @emotion/react */
import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { t } from "../../l10n";

import { defaultFlexWritingSystems, type FlexWritingSystems } from "../../export/flexDefaults";

export type { FlexWritingSystems };

const STORAGE_KEY = "saymore.flexExport.writingSystems";

/** SayMore remembers the last choice (`TranscriptionWsForFWInterlinearExport`); the browser keeps it in localStorage. */
function loadLast(): Partial<FlexWritingSystems> | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed.transcriptionWs === "string") return parsed;
  } catch {
    /* storage unavailable: use the defaults */
  }
  return undefined;
}

/**
 * SayMore's "Export Annotations For FieldWorks Interlinear" dialog. It offers
 * the writing systems installed with FLEx; the plugin cannot read those, so each
 * is a typed writing system id such as `en`.
 */
export function FlexExportDialog(props: {
  open: boolean;
  /** The languages the eaf's Transcription and Phrase Free Translation tiers declare. */
  tierLanguages?: { transcription?: string; freeTranslation?: string };
  onCancel: () => void;
  onExport: (ws: FlexWritingSystems) => void;
}) {
  const { open, tierLanguages } = props;
  const [ws, setWs] = useState<FlexWritingSystems>(() =>
    defaultFlexWritingSystems(tierLanguages ?? {}, loadLast()),
  );
  useEffect(() => {
    if (open) setWs(defaultFlexWritingSystems(tierLanguages ?? {}, loadLast()));
  }, [open, tierLanguages?.transcription, tierLanguages?.freeTranslation]);
  const valid = ws.transcriptionWs.trim() !== "" && ws.freeTranslationWs.trim() !== "";
  const submit = () => {
    const chosen = {
      transcriptionWs: ws.transcriptionWs.trim(),
      freeTranslationWs: ws.freeTranslationWs.trim(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
    } catch {
      /* storage unavailable: the choice is just not remembered */
    }
    props.onExport(chosen);
  };
  return (
    <Dialog open={props.open} onClose={props.onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16 }}>
        {t("export.flexTitle", "Export Annotations For FieldWorks Interlinear")}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div>
          {t(
            "export.flexOverview",
            "Specify the writing systems for the transcriptions and free translations.",
          )}
        </div>
        <TextField
          size="small"
          label={t("export.flexTranscriptionWs", "{tier}:", {
            tier: t("grid.transcription", "Transcription"),
          })}
          value={ws.transcriptionWs}
          onChange={(e) => setWs({ ...ws, transcriptionWs: e.target.value })}
        />
        <TextField
          size="small"
          label={t("export.flexFreeTranslationWs", "{tier}:", {
            tier: t("grid.freeTranslation", "Free Translation"),
          })}
          value={ws.freeTranslationWs}
          onChange={(e) => setWs({ ...ws, freeTranslationWs: e.target.value })}
        />
        <div>
          {t(
            "export.flexImportInstructions",
            "When importing this file into {program}, be sure to have the project analysis language set to {ws} .",
            { program: "FLEx", ws: ws.freeTranslationWs },
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel} sx={{ textTransform: "none" }}>
          {t("export.flexCancel", "Cancel")}
        </Button>
        <Button
          onClick={submit}
          disabled={!valid}
          variant="contained"
          sx={{ textTransform: "none" }}
        >
          {t("export.flexExport", "Export...")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
