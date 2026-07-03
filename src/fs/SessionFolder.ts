import type { FileSystemAdapter } from "./FileSystemAdapter";
import {
  ANNOTATIONS_EAF_SUFFIX,
  ANNOTATIONS_FOLDER_SUFFIX,
  STANDARD_AUDIO_SUFFIX,
} from "../model/SayMoreConstants";

/**
 * Session-folder discovery over a FileSystemAdapter: find the media file (prefer
 * `*_StandardAudio.wav`), the companion `.annotations.eaf`, and the oral
 * annotations folder. All names are relative to the session folder.
 */

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".wma"];
const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".mkv",
  ".webm",
  ".3gp",
  ".m4v",
];

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function isAudio(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extOf(name));
}

function isMedia(name: string): boolean {
  const ext = extOf(name);
  return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

export function annotationsEafName(mediaFileName: string): string {
  return mediaFileName + ANNOTATIONS_EAF_SUFFIX;
}

/**
 * Choose the session's media file from a list of names: only top-level media
 * files (not inside `_Annotations/`, not `.eaf`/pref files), preferring a
 * `*_StandardAudio.wav`, then audio over video, then the first candidate.
 */
export function findMediaFile(names: readonly string[]): string | undefined {
  const candidates = names.filter((n) => {
    if (n.includes("/")) return false; // nested (e.g. inside _Annotations/)
    const lower = n.toLowerCase();
    if (lower.endsWith(ANNOTATIONS_EAF_SUFFIX)) return false;
    if (lower.endsWith(".eaf") || lower.endsWith(".etf")) return false;
    if (lower.endsWith(".pfsx") || lower.endsWith(".psfx")) return false; // ELAN prefs
    return isMedia(n);
  });
  const standard = candidates.find((n) => n.endsWith(STANDARD_AUDIO_SUFFIX));
  if (standard) return standard;
  return candidates.find(isAudio) ?? candidates[0];
}

export class SessionFolder {
  readonly mediaFileName: string;

  constructor(mediaFileName: string) {
    this.mediaFileName = mediaFileName;
  }

  static async open(adapter: FileSystemAdapter): Promise<SessionFolder | undefined> {
    const media = findMediaFile(await adapter.list());
    return media ? new SessionFolder(media) : undefined;
  }

  get eafName(): string {
    return annotationsEafName(this.mediaFileName);
  }

  get oralAnnotationsFolder(): string {
    return this.mediaFileName + ANNOTATIONS_FOLDER_SUFFIX;
  }

  hasEaf(adapter: FileSystemAdapter): Promise<boolean> {
    return adapter.exists(this.eafName);
  }

  async loadEafText(adapter: FileSystemAdapter): Promise<string | undefined> {
    return (await adapter.exists(this.eafName)) ? adapter.readText(this.eafName) : undefined;
  }
}
