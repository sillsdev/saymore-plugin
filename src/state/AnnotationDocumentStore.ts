import { makeAutoObservable, runInAction } from "mobx";
import type { AnnotationSegment } from "../model/AnnotationSegment";
import { TierCollection } from "../model/TierCollection";
import {
  createEafFromTemplate,
  loadEaf,
  serializeEaf,
  type EafDocument,
} from "../model/eaf/EafDocument";
import { eafTemplateXml } from "../model/eaf/eafTemplate";
import type { FileSystemAdapter } from "../fs/FileSystemAdapter";
import { annotationsEafName } from "../fs/SessionFolder";

/**
 * The source of truth for one session's annotations: the positional segments
 * (via TierCollection), the preserved EAF DOM for compatible save, dirty
 * tracking (version vs savedVersion), and the DOM-preserving write to disk.
 */
export class AnnotationDocumentStore {
  readonly tiers = new TierCollection();

  mediaFileName = "";
  durationSec = 0;

  /** Bumped on every in-memory edit. */
  version = 0;
  /** The version last written to disk; dirty when `version !== savedVersion`. */
  savedVersion = 0;

  /** The preserved EAF document (DOM + read-view), edited only on save. */
  private eaf: EafDocument | undefined;

  constructor() {
    makeAutoObservable<AnnotationDocumentStore, "eaf">(this, { tiers: false, eaf: false });
  }

  get segments(): AnnotationSegment[] {
    return this.tiers.segments;
  }

  get isDirty(): boolean {
    return this.version !== this.savedVersion;
  }

  /**
   * Initialise from an existing EAF (or seed a fresh one from the template) and
   * load its segments into the tier model.
   */
  init(mediaFileName: string, durationSec: number, eafXml: string | undefined): void {
    this.mediaFileName = mediaFileName;
    this.durationSec = durationSec;
    this.eaf = eafXml ? loadEaf(eafXml) : createEafFromTemplate(eafTemplateXml, mediaFileName);
    this.tiers.replaceAll(this.eaf.segments);
    this.version = 0;
    this.savedVersion = 0;
  }

  bumpVersion(): void {
    this.version++;
  }

  /** Serialize the current segments back onto the preserved DOM. */
  serialize(): string {
    if (!this.eaf) throw new Error("AnnotationDocumentStore: not initialised");
    this.eaf.writeSegments(this.tiers.segments);
    return serializeEaf(this.eaf);
  }

  /** Write the EAF beside the media through the adapter and mark clean. */
  async save(adapter: FileSystemAdapter): Promise<void> {
    const xml = this.serialize();
    await adapter.writeText(annotationsEafName(this.mediaFileName), xml);
    runInAction(() => {
      this.savedVersion = this.version;
    });
  }
}
