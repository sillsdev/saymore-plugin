import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { AnnotationSegment } from "../AnnotationSegment";
import { makeTimeRange } from "../TimeRange";

/**
 * DOM-preserving parse/serialize of a `<media>.annotations.eaf` file, mirroring
 * SayMore's `AnnotationFileHelper.cs`.
 *
 * The linchpin requirement: foreign tiers and any unknown ELAN elements
 * (LINGUISTIC_TYPE / LOCALE / CONSTRAINT, "User Defined Tier", "Notes", …) MUST
 * survive a load → save round-trip. We achieve that by parsing the XML into a
 * DOM once and only ever mutating the two tiers SayMore owns
 * ("Transcription" and "Phrase Free Translation") plus TIME_ORDER / HEADER; the
 * rest of the tree is re-serialized untouched.
 *
 * Compatibility rules honored (see SPEC-eaf.md):
 *  - HEADER `MEDIA_DESCRIPTOR` MEDIA_URL = filename only; optional second
 *    descriptor with EXTRACTED_FROM for video-derived audio; `PROPERTY
 *    lastUsedAnnotationId`.
 *  - TIME_ORDER: TIME_SLOT ts{n}, TIME_VALUE = integer ms; missing TIME_VALUE is
 *    interpolated on read (ELAN "regular annotations").
 *  - Tier "Transcription" (ALIGNABLE_ANNOTATION a{n}); tier "Phrase Free
 *    Translation" (PARENT_REF, REF_ANNOTATION + ANNOTATION_REF). TIER_ID match
 *    is case-insensitive.
 *  - Never renumber existing annotation ids; the id counter only ever grows,
 *    continuing from lastUsedAnnotationId.
 *  - Coincident boundary times get DISTINCT time slots (not coalesced).
 */

export interface EafMediaDescriptor {
  /** Filename only (no path), e.g. "X.wav". */
  mediaUrl: string;
  mimeType?: string;
  /** Present for audio extracted from a video source. */
  extractedFrom?: string;
}

/**
 * A parsed EAF: a read-view (media, id counter, positional segments) over a
 * preserved DOM, plus a mutation surface (`writeSegments`) that rewrites only
 * the two owned tiers back onto that DOM.
 */
export interface EafDocument {
  readonly media: EafMediaDescriptor | undefined;
  readonly lastUsedAnnotationId: number;
  /** Positional segments across the Transcription + Free Translation tiers. */
  readonly segments: readonly AnnotationSegment[];
  /** The preserved DOM (foreign tiers included); exposed for callers/tests. */
  readonly dom: Document;
  /**
   * Rewrite the Transcription + Phrase Free Translation tiers (and TIME_ORDER)
   * from `segments`, preserving every foreign tier and unknown element. New
   * time-slot and annotation ids are allocated per the SayMore rules; existing
   * ids are never reused (the counter only grows).
   */
  writeSegments(segments: readonly AnnotationSegment[]): void;
}

const TRANSCRIPTION_TIER = "transcription";
const FREE_TRANSLATION_TIER = "phrase free translation";
const LAST_USED_ID_PROPERTY = "lastUsedAnnotationId";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

// ── small DOM helpers ────────────────────────────────────────────────────────

function childElements(parent: Element | Document, tagName: string): Element[] {
  const out: Element[] = [];
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const node = kids.item(i);
    if (node && node.nodeType === 1 && (node as Element).tagName === tagName) {
      out.push(node as Element);
    }
  }
  return out;
}

function firstChildElement(parent: Element | Document, tagName: string): Element | undefined {
  return childElements(parent, tagName)[0];
}

function elementText(el: Element): string {
  let text = "";
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const node = kids.item(i);
    if (node && (node.nodeType === 3 || node.nodeType === 4)) {
      text += node.nodeValue ?? "";
    }
  }
  return text;
}

function removeAllChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function createElementWithAttrs(
  doc: Document,
  name: string,
  attrs: Array<[string, string]>,
): Element {
  const el = doc.createElement(name);
  for (const [k, v] of attrs) el.setAttribute(k, v);
  return el;
}

// ── MIME detection ───────────────────────────────────────────────────────────

function mimeTypeForExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  switch (ext) {
    case ".wav":
      return "audio/x-wav";
    case ".mpg":
    case ".mpeg":
      return "video/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".aif":
    case ".aiff":
      return "audio/x-aiff";
    default:
      return "application/octet-stream";
  }
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

// ── the implementation ───────────────────────────────────────────────────────

class EafDocumentImpl implements EafDocument {
  readonly dom: Document;
  private _media: EafMediaDescriptor | undefined;
  private _lastUsedAnnotationId = 0;
  private _segments: AnnotationSegment[] = [];

  constructor(dom: Document) {
    this.dom = dom;
    this.refresh();
  }

  get media(): EafMediaDescriptor | undefined {
    return this._media;
  }
  get lastUsedAnnotationId(): number {
    return this._lastUsedAnnotationId;
  }
  get segments(): readonly AnnotationSegment[] {
    return this._segments;
  }

  private get root(): Element {
    const root = this.dom.documentElement;
    if (!root) throw new Error("EAF has no document element");
    return root;
  }

  /** Find one of SayMore's two owned tiers by case-insensitive TIER_ID. */
  private findTier(tierIdLower: string): Element | undefined {
    return childElements(this.root, "TIER").find(
      (t) => (t.getAttribute("TIER_ID") ?? "").toLowerCase() === tierIdLower,
    );
  }

  /** Recompute the read-view (media, id counter, segments) from the DOM. */
  private refresh(): void {
    this._media = this.readMedia();
    this._lastUsedAnnotationId = this.computeLastUsedAnnotationId();
    this._segments = this.buildSegments();
  }

  private readMedia(): EafMediaDescriptor | undefined {
    const header = firstChildElement(this.root, "HEADER");
    if (!header) return undefined;
    const descriptors = childElements(header, "MEDIA_DESCRIPTOR");
    if (descriptors.length === 0) return undefined;
    // Primary descriptor = the one without EXTRACTED_FROM (fall back to first).
    const primary = descriptors.find((d) => !d.getAttribute("EXTRACTED_FROM")) ?? descriptors[0];
    const extracted = descriptors.find((d) => d.getAttribute("EXTRACTED_FROM"));
    const media: EafMediaDescriptor = {
      mediaUrl: primary.getAttribute("MEDIA_URL") ?? "",
    };
    const mime = primary.getAttribute("MIME_TYPE");
    if (mime) media.mimeType = mime;
    if (extracted) {
      const from = extracted.getAttribute("EXTRACTED_FROM");
      if (from) media.extractedFrom = from;
    }
    return media;
  }

  /**
   * Self-heal: the id counter is the max numeric id across ALL tiers'
   * ALIGNABLE_ANNOTATION and REF_ANNOTATION elements, regardless of the stored
   * PROPERTY value (which may be missing or stale).
   */
  private computeLastUsedAnnotationId(): number {
    let max = 0;
    const consider = (el: Element) => {
      const id = el.getAttribute("ANNOTATION_ID");
      if (!id) return;
      const n = parseInt(id.replace(/^a/i, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    };
    for (const tag of ["ALIGNABLE_ANNOTATION", "REF_ANNOTATION"]) {
      const list = this.root.getElementsByTagName(tag);
      for (let i = 0; i < list.length; i++) consider(list.item(i) as Element);
    }
    // Also honor an explicit stored value if it happens to be larger.
    const stored = this.readStoredLastUsedId();
    return Math.max(max, stored);
  }

  private readStoredLastUsedId(): number {
    const header = firstChildElement(this.root, "HEADER");
    if (!header) return 0;
    for (const prop of childElements(header, "PROPERTY")) {
      if (prop.getAttribute("NAME") === LAST_USED_ID_PROPERTY) {
        const n = parseInt(elementText(prop).trim(), 10);
        if (Number.isFinite(n)) return n;
      }
    }
    return 0;
  }

  /**
   * Time-slot id → seconds, filling any missing TIME_VALUE by linear
   * interpolation evenly between the nearest anchored slots in document order.
   */
  private buildTimeSlotSeconds(): Map<string, number> {
    const timeOrder = firstChildElement(this.root, "TIME_ORDER");
    const slots = timeOrder ? childElements(timeOrder, "TIME_SLOT") : [];
    const ids: string[] = [];
    const rawMs: (number | undefined)[] = [];
    for (const slot of slots) {
      ids.push(slot.getAttribute("TIME_SLOT_ID") ?? "");
      const v = slot.getAttribute("TIME_VALUE");
      rawMs.push(v == null || v === "" ? undefined : parseInt(v, 10));
    }
    const filled = interpolateMissing(rawMs);
    const map = new Map<string, number>();
    for (let i = 0; i < ids.length; i++) map.set(ids[i], filled[i] / 1000);
    return map;
  }

  private buildSegments(): AnnotationSegment[] {
    const slotSeconds = this.buildTimeSlotSeconds();
    const transcriptionTier = this.findTier(TRANSCRIPTION_TIER);
    const ftTier = this.findTier(FREE_TRANSLATION_TIER);

    // Free-translation text keyed by parent transcription annotation id.
    const ftByParent = new Map<string, string>();
    if (ftTier) {
      for (const annotation of childElements(ftTier, "ANNOTATION")) {
        const ref = firstChildElement(annotation, "REF_ANNOTATION");
        if (!ref) continue;
        const parent = ref.getAttribute("ANNOTATION_REF");
        if (!parent) continue;
        const valueEl = firstChildElement(ref, "ANNOTATION_VALUE");
        ftByParent.set(parent, valueEl ? elementText(valueEl) : "");
      }
    }

    const segments: AnnotationSegment[] = [];
    if (!transcriptionTier) return segments;
    for (const annotation of childElements(transcriptionTier, "ANNOTATION")) {
      const alignable = firstChildElement(annotation, "ALIGNABLE_ANNOTATION");
      if (!alignable) continue;
      const id = alignable.getAttribute("ANNOTATION_ID") ?? "";
      const ref1 = alignable.getAttribute("TIME_SLOT_REF1") ?? "";
      const ref2 = alignable.getAttribute("TIME_SLOT_REF2") ?? "";
      const start = slotSeconds.get(ref1) ?? 0;
      const end = slotSeconds.get(ref2) ?? start;
      const valueEl = firstChildElement(alignable, "ANNOTATION_VALUE");
      segments.push({
        range: makeTimeRange(start, end),
        transcription: valueEl ? elementText(valueEl) : "",
        freeTranslation: ftByParent.get(id) ?? "",
      });
    }
    return segments;
  }

  writeSegments(inputSegments: readonly AnnotationSegment[]): void {
    const segments = [...inputSegments];
    const doc = this.dom;

    const header = this.ensureHeader();
    this.ensureLastUsedIdProperty(header);

    const transcriptionTier = this.findTier(TRANSCRIPTION_TIER);
    const ftTier = this.findTier(FREE_TRANSLATION_TIER);
    if (!transcriptionTier || !ftTier) {
      throw new Error(
        "writeSegments requires both the Transcription and Phrase Free Translation tiers",
      );
    }

    const timeOrder = this.ensureTimeOrder();

    // TIME_ORDER may only be cleared when no foreign tier depends on the slots
    // via ALIGNABLE (time-subdivision) children. Otherwise keep and extend it.
    const clearTimeOrder = !this.hasForeignAlignableTier();
    let nextSlotNumber: number;
    if (clearTimeOrder) {
      removeAllChildren(timeOrder);
      nextSlotNumber = 1;
    } else {
      nextSlotNumber = this.maxTimeSlotNumber(timeOrder) + 1;
    }

    // Rewrite only the owned tiers' annotation children.
    removeAllChildren(transcriptionTier);
    removeAllChildren(ftTier);

    let nextAnnotationId = this._lastUsedAnnotationId;

    const indentUnit = "  ";
    const tierIndent = "\n" + indentUnit; // TIER is one level under root
    const annotationIndent = "\n" + indentUnit.repeat(2);
    const innerIndent = "\n" + indentUnit.repeat(3);
    const valueIndent = "\n" + indentUnit.repeat(4);
    const slotIndent = "\n" + indentUnit.repeat(2);

    const appendSlot = (value: number): string => {
      const id = "ts" + nextSlotNumber++;
      const slot = createElementWithAttrs(doc, "TIME_SLOT", [
        ["TIME_SLOT_ID", id],
        ["TIME_VALUE", String(Math.round(value * 1000))],
      ]);
      timeOrder.appendChild(doc.createTextNode(slotIndent));
      timeOrder.appendChild(slot);
      return id;
    };

    for (const seg of segments) {
      // allocation order per segment: start slot, end slot, annotation id.
      const startSlot = appendSlot(seg.range.start);
      const endSlot = appendSlot(seg.range.end);
      const transcriptionId = "a" + ++nextAnnotationId;

      const alignable = createElementWithAttrs(doc, "ALIGNABLE_ANNOTATION", [
        ["ANNOTATION_ID", transcriptionId],
        ["TIME_SLOT_REF1", startSlot],
        ["TIME_SLOT_REF2", endSlot],
      ]);
      const alignableValue = doc.createElement("ANNOTATION_VALUE");
      alignableValue.appendChild(doc.createTextNode(seg.transcription ?? ""));
      alignable.appendChild(doc.createTextNode(valueIndent));
      alignable.appendChild(alignableValue);
      alignable.appendChild(doc.createTextNode(innerIndent));

      const transAnnotation = doc.createElement("ANNOTATION");
      transAnnotation.appendChild(doc.createTextNode(innerIndent));
      transAnnotation.appendChild(alignable);
      transAnnotation.appendChild(doc.createTextNode(annotationIndent));

      transcriptionTier.appendChild(doc.createTextNode(annotationIndent));
      transcriptionTier.appendChild(transAnnotation);

      const freeTranslation = seg.freeTranslation ?? "";
      if (freeTranslation.length > 0) {
        const ftId = "a" + ++nextAnnotationId;
        const ref = createElementWithAttrs(doc, "REF_ANNOTATION", [
          ["ANNOTATION_ID", ftId],
          ["ANNOTATION_REF", transcriptionId],
        ]);
        const refValue = doc.createElement("ANNOTATION_VALUE");
        refValue.appendChild(doc.createTextNode(freeTranslation));
        ref.appendChild(doc.createTextNode(valueIndent));
        ref.appendChild(refValue);
        ref.appendChild(doc.createTextNode(innerIndent));

        const ftAnnotation = doc.createElement("ANNOTATION");
        ftAnnotation.appendChild(doc.createTextNode(innerIndent));
        ftAnnotation.appendChild(ref);
        ftAnnotation.appendChild(doc.createTextNode(annotationIndent));

        ftTier.appendChild(doc.createTextNode(annotationIndent));
        ftTier.appendChild(ftAnnotation);
      }
    }

    // Close tiers / time-order at the parent indent level for readability.
    if (segments.length > 0) {
      transcriptionTier.appendChild(doc.createTextNode(tierIndent));
      // free-translation tier only has content if some segment had a translation
      if (ftTier.firstChild) ftTier.appendChild(doc.createTextNode(tierIndent));
      if (clearTimeOrder) timeOrder.appendChild(doc.createTextNode(tierIndent));
    }

    // Persist the grown id counter and refresh the read-view.
    this.setLastUsedIdProperty(header, nextAnnotationId);
    this.refresh();
  }

  // ── writeSegments support ──────────────────────────────────────────────────

  private ensureHeader(): Element {
    let header = firstChildElement(this.root, "HEADER");
    if (!header) {
      header = createElementWithAttrs(this.dom, "HEADER", [
        ["MEDIA_FILE", ""],
        ["TIME_UNITS", "milliseconds"],
      ]);
      this.root.insertBefore(header, this.root.firstChild);
    }
    return header;
  }

  private ensureTimeOrder(): Element {
    let timeOrder = firstChildElement(this.root, "TIME_ORDER");
    if (!timeOrder) {
      timeOrder = this.dom.createElement("TIME_ORDER");
      const header = firstChildElement(this.root, "HEADER");
      if (header && header.nextSibling) {
        this.root.insertBefore(timeOrder, header.nextSibling);
      } else {
        this.root.appendChild(timeOrder);
      }
    }
    return timeOrder;
  }

  private ensureLastUsedIdProperty(header: Element): void {
    const existing = childElements(header, "PROPERTY").find(
      (p) => p.getAttribute("NAME") === LAST_USED_ID_PROPERTY,
    );
    if (!existing) {
      const prop = createElementWithAttrs(this.dom, "PROPERTY", [["NAME", LAST_USED_ID_PROPERTY]]);
      prop.appendChild(this.dom.createTextNode(String(this._lastUsedAnnotationId)));
      header.appendChild(prop);
    }
  }

  private setLastUsedIdProperty(header: Element, value: number): void {
    const prop = childElements(header, "PROPERTY").find(
      (p) => p.getAttribute("NAME") === LAST_USED_ID_PROPERTY,
    );
    if (prop) {
      removeAllChildren(prop);
      prop.appendChild(this.dom.createTextNode(String(value)));
    }
  }

  private maxTimeSlotNumber(timeOrder: Element): number {
    let max = 0;
    for (const slot of childElements(timeOrder, "TIME_SLOT")) {
      const id = slot.getAttribute("TIME_SLOT_ID") ?? "";
      const n = parseInt(id.replace(/^ts/i, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  /** A foreign tier that carries ALIGNABLE_ANNOTATION children depends on the
   * time slots, so TIME_ORDER must not be cleared. */
  private hasForeignAlignableTier(): boolean {
    for (const tier of childElements(this.root, "TIER")) {
      const idLower = (tier.getAttribute("TIER_ID") ?? "").toLowerCase();
      if (idLower === TRANSCRIPTION_TIER || idLower === FREE_TRANSLATION_TIER) {
        continue;
      }
      if (tier.getElementsByTagName("ALIGNABLE_ANNOTATION").length > 0) {
        return true;
      }
    }
    return false;
  }

  serialize(): string {
    // `this.dom` is typed as the lib.dom `Document` (parse() casts the xmldom
    // node across that boundary); cast back to xmldom's node type here.
    const body = new XMLSerializer().serializeToString(
      this.dom as unknown as Parameters<XMLSerializer["serializeToString"]>[0],
    );
    // xmldom does not emit the XML declaration; prepend it to match SayMore.
    if (body.startsWith("<?xml")) return body;
    return XML_DECLARATION + "\n" + body;
  }
}

// ── public API ───────────────────────────────────────────────────────────────

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
}

/** Parse an existing `.annotations.eaf` string, preserving foreign nodes. */
export function loadEaf(xml: string): EafDocument {
  return new EafDocumentImpl(parse(xml));
}

/** Seed a new document from `annotationTemplate.etf`, setting the media filename. */
export function createEafFromTemplate(templateXml: string, mediaFileName: string): EafDocument {
  const doc = new EafDocumentImpl(parse(templateXml));
  const root = doc.dom.documentElement;
  if (!root) throw new Error("template has no document element");

  // Ensure HEADER exists and carries the media descriptor + id property.
  let header = firstChildElement(root, "HEADER");
  if (!header) {
    header = createElementWithAttrs(doc.dom, "HEADER", [
      ["MEDIA_FILE", ""],
      ["TIME_UNITS", "milliseconds"],
    ]);
    root.insertBefore(header, root.firstChild);
  }

  const name = basename(mediaFileName);
  // MEDIA_DESCRIPTOR: attr order MEDIA_URL, MIME_TYPE.
  let descriptor = firstChildElement(header, "MEDIA_DESCRIPTOR");
  if (!descriptor) {
    descriptor = createElementWithAttrs(doc.dom, "MEDIA_DESCRIPTOR", [
      ["MEDIA_URL", name],
      ["MIME_TYPE", mimeTypeForExtension(name)],
    ]);
    header.appendChild(descriptor);
  } else {
    descriptor.setAttribute("MEDIA_URL", name);
    descriptor.setAttribute("MIME_TYPE", mimeTypeForExtension(name));
  }

  // PROPERTY lastUsedAnnotationId after the descriptors.
  let prop = childElements(header, "PROPERTY").find(
    (p) => p.getAttribute("NAME") === LAST_USED_ID_PROPERTY,
  );
  if (!prop) {
    prop = createElementWithAttrs(doc.dom, "PROPERTY", [["NAME", LAST_USED_ID_PROPERTY]]);
    prop.appendChild(doc.dom.createTextNode("0"));
    header.appendChild(prop);
  }

  doc.writeSegments([]); // normalize state / recompute read-view
  return doc;
}

/** Serialize back to EAF XML, preserving the original DOM for foreign tiers. */
export function serializeEaf(doc: EafDocument): string {
  return (doc as EafDocumentImpl).serialize();
}

// ── free functions ───────────────────────────────────────────────────────────

/**
 * Fill `undefined` gaps in a list of millisecond values by linear interpolation
 * evenly between the nearest anchored (defined) values in order. Leading gaps
 * copy the first anchor; trailing gaps copy the last. Results are rounded to
 * integer ms to match SayMore's integer TIME_VALUEs.
 */
function interpolateMissing(values: (number | undefined)[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (values[i] !== undefined) anchors.push(i);

  if (anchors.length === 0) return out; // nothing to anchor to → all zero

  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined) {
      out[i] = v;
      continue;
    }
    // find surrounding anchors
    let prev: number | undefined;
    let next: number | undefined;
    for (const a of anchors) {
      if (a < i) prev = a;
      if (a > i) {
        next = a;
        break;
      }
    }
    if (prev === undefined && next !== undefined) {
      out[i] = values[next]!;
    } else if (prev !== undefined && next === undefined) {
      out[i] = values[prev]!;
    } else if (prev !== undefined && next !== undefined) {
      const pv = values[prev]!;
      const nv = values[next]!;
      const frac = (i - prev) / (next - prev);
      out[i] = Math.round(pv + (nv - pv) * frac);
    }
  }
  return out;
}
