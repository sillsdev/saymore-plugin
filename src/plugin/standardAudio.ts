import { standardAudioName } from "../fs/SessionFolder";
import { STANDARD_AUDIO_FFMPEG_ARGS } from "../model/SayMoreConstants";
import type { PluginHostApiV1 } from "./PluginApiTypes";
import { START_TAB_ID } from "./tabProvider";

/**
 * Select `<base>_StandardAudio.wav` in lameta on its "Start Annotating" tab. lameta
 * would otherwise open the WAV on its own Audio tab, because Start Annotating does
 * not claim the default. Resolves false when lameta cannot select the file or has
 * no `selectFile`.
 */
export async function selectStandardAudio(
  api: Pick<PluginHostApiV1, "selectFile">,
  wavName: string,
): Promise<boolean> {
  try {
    return await api.selectFile(wavName, { tabId: START_TAB_ID });
  } catch {
    return false;
  }
}

/**
 * The file-conversion screen's "Convert": the host's ffmpeg writes
 * `<base>_StandardAudio.wav` beside the selected non-WAV media (progress 0 to 1
 * drives the bar), then lameta selects that WAV on its Start Annotating tab, which
 * recreates this iframe there. Throws when lameta cannot select the WAV, so the
 * conversion view shows the error.
 */
export async function convertToStandardAudio(
  api: Pick<PluginHostApiV1, "selectFile" | "ffmpeg">,
  selectedFileName: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const wavName = standardAudioName(selectedFileName);
  await api.ffmpeg.run({ outputRelPath: wavName, args: STANDARD_AUDIO_FFMPEG_ARGS, onProgress });
  if (!(await selectStandardAudio(api, wavName))) {
    throw new Error(`lameta could not select ${wavName}.`);
  }
  return wavName;
}
