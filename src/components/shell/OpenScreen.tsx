/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import Button from "@mui/material/Button";
import { t } from "../../l10n";
import { BrowserDirectoryAdapter } from "../../fs/BrowserDirectoryAdapter";
import type { ProjectStore } from "../../state/ProjectStore";
import { LAMETA_UI_FONT } from "../../lametaTheme";

/**
 * Landing screen: open a real SayMore session folder (File System Access API,
 * Chromium) or drop/pick a single audio file (in-memory, save = download).
 */
export const OpenScreen = observer(function OpenScreen(props: { store: ProjectStore }) {
  const { store } = props;
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function openFolder(): Promise<void> {
    try {
      const adapter = await BrowserDirectoryAdapter.pick();
      await store.openSession(adapter);
    } catch (e) {
      // User cancelled the picker, or the API is unavailable.
      if (e instanceof Error && e.name !== "AbortError") {
        console.error(e);
      }
    }
  }

  async function openFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await store.openSingleFile(file.name, bytes);
  }

  const supportsDirectory = typeof window !== "undefined" && "showDirectoryPicker" in window;

  return (
    <div
      css={css`
        max-width: 40rem;
        margin: 4rem auto;
        padding: 0 1rem;
        font-family: ${LAMETA_UI_FONT};
        line-height: 1.5;
      `}
    >
      <h1
        css={css`
          font-size: 1.5rem;
        `}
      >
        {t("app.title", "lameta Audio Annotation — Manual Segmenter")}
      </h1>

      {store.loading && <p>{t("open.loading", "Loading…")}</p>}
      {store.error && (
        <p
          css={css`
            color: #c62828;
          `}
        >
          {store.error}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void openFile(file);
        }}
        css={css`
          margin-top: 1.5rem;
          padding: 2rem;
          border: 2px dashed ${dragOver ? "#1565c0" : "#b0bec5"};
          border-radius: 8px;
          text-align: center;
          background: ${dragOver ? "#e3f2fd" : "#fafafa"};
        `}
      >
        <p>{t("open.dropHint", "Drop one audio file here to segment it")}</p>
        <Button
          variant="outlined"
          onClick={() => fileInputRef.current?.click()}
          sx={{
            mt: "0.5rem",
            textTransform: "none",
            fontFamily: "inherit",
            color: "#37474f",
            borderColor: "#90a4ae",
            "&:hover": { borderColor: "#607d8b" },
          }}
        >
          {t("open.pickFile", "Choose an audio file…")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav"
          css={css`
            display: none;
          `}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
          }}
        />
      </div>

      <div
        css={css`
          margin-top: 1.5rem;
        `}
      >
        <Button
          variant="outlined"
          disabled={!supportsDirectory}
          onClick={() => void openFolder()}
          sx={{
            textTransform: "none",
            fontFamily: "inherit",
            color: "#37474f",
            borderColor: "#90a4ae",
            "&:hover": { borderColor: "#607d8b" },
          }}
        >
          {t("open.openFolder", "Open a SayMore session folder…")}
        </Button>
        {!supportsDirectory && (
          <p
            css={css`
              font-size: 12px;
              color: #78909c;
            `}
          >
            {t(
              "open.noDirectory",
              "Folder mode needs a Chromium browser (File System Access API). Single-file mode works anywhere.",
            )}
          </p>
        )}
      </div>
    </div>
  );
});
