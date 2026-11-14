import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

/**
 * "Copy an existing ELAN file" (SayMore `AnnotationFileHelper.CreateFileFromFile`,
 * ELAN branch). SayMore copies the chosen `.eaf` to `<media>.annotations.eaf`, then
 * loads it and:
 *  - sets `PROPERTY lastUsedAnnotationId` to the highest numeric annotation id found on
 *    any tier (foreign tiers included), creating HEADER if the file has none;
 *  - replaces every `MEDIA_DESCRIPTOR` with one for the session media;
 *  - leaves tiers, time slots and every other element exactly as they were. Tiers that are
 *    not named "Transcription" / "Phrase Free Translation" (case-insensitive) are kept but
 *    contribute no segments.
 *
 * The plugin differs from SayMore in two ways, both so the result opens in the
 * annotation tools here: the two SayMore tiers are added when the file lacks them
 * (SayMore adds them lazily on first edit), and new elements go where the ELAN schema
 * wants them rather than at the end of their parent.
 */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const TRANSCRIPTION_TIER_ID = "Transcription";
const FREE_TRANSLATION_TIER_ID = "Phrase Free Translation";

type Dom = Document;

function parseQuietly(xml: string): Dom | undefined {
  try {
    const dom = new DOMParser({
      onError: (level) => {
        if (level !== "warning") throw new Error("malformed XML");
      },
    }).parseFromString(xml, "text/xml") as unknown as Dom;
    return dom.documentElement ? dom : undefined;
  } catch {
    return undefined;
  }
}

/** SayMore `GetIsElanFile`: well-formed XML whose root element is ANNOTATION_DOCUMENT. */
export function isElanXml(xml: string): boolean {
  return parseQuietly(xml)?.documentElement?.localName === "ANNOTATION_DOCUMENT";
}

function childElements(parent: Element, tagName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes.item(i);
    if (node.nodeType === 1 && (node as Element).tagName === tagName) out.push(node as Element);
  }
  return out;
}

function mimeTypeFor(mediaFileName: string): string {
  const ext = mediaFileName.slice(mediaFileName.lastIndexOf(".")).toLowerCase();
  if (ext === ".wav") return "audio/x-wav";
  if (ext === ".mpg" || ext === ".mpeg") return "video/mpeg";
  const audio = [".mp3", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".wma", ".aif", ".aiff"];
  return (audio.includes(ext) ? "audio" : "video") + "/*";
}

/** Insert `node` before `ref` (or append when `ref` is undefined), with a line break before it. */
function insertWithBreak(parent: Element, node: Node, ref: Node | null, indent: string): void {
  const doc = parent.ownerDocument;
  parent.insertBefore(doc.createTextNode(indent), ref);
  parent.insertBefore(node, ref);
}

/** The highest number in any ANNOTATION_ID on any tier (SayMore strips every "a" then parses). */
function highestAnnotationId(root: Element): number {
  let max = 0;
  for (const tier of childElements(root, "TIER")) {
    for (const annotation of childElements(tier, "ANNOTATION")) {
      for (let i = 0; i < annotation.childNodes.length; i++) {
        const node = annotation.childNodes.item(i);
        if (node.nodeType !== 1) continue;
        const id = (node as Element).getAttribute("ANNOTATION_ID");
        if (id == null) continue;
        const stripped = id.replace(/a/g, "");
        if (/^\s*[+-]?\d+\s*$/.test(stripped)) max = Math.max(max, parseInt(stripped, 10));
      }
    }
  }
  return max;
}

function ensureHeaderWithMedia(root: Element, mediaFileName: string): Element {
  const doc = root.ownerDocument;
  let header = childElements(root, "HEADER")[0];
  const descriptor = doc.createElement("MEDIA_DESCRIPTOR");
  descriptor.setAttribute("MEDIA_URL", mediaFileName);
  descriptor.setAttribute("MIME_TYPE", mimeTypeFor(mediaFileName));

  if (!header) {
    header = doc.createElement("HEADER");
    header.setAttribute("MEDIA_FILE", "");
    header.setAttribute("TIME_UNITS", "milliseconds");
    header.appendChild(descriptor);
    root.insertBefore(header, root.firstChild);
    return header;
  }

  // Replace the old descriptors in place; with none, they belong ahead of the
  // LINKED_FILE_DESCRIPTORs and PROPERTYs.
  const old = childElements(header, "MEDIA_DESCRIPTOR");
  if (old.length > 0) {
    header.replaceChild(descriptor, old[0]);
    for (const extra of old.slice(1)) header.removeChild(extra);
  } else {
    const firstOther =
      childElements(header, "LINKED_FILE_DESCRIPTOR")[0] ?? childElements(header, "PROPERTY")[0];
    header.insertBefore(descriptor, firstOther ?? null);
  }
  return header;
}

function setLastUsedAnnotationId(header: Element, value: number): void {
  const doc = header.ownerDocument;
  let prop = childElements(header, "PROPERTY").find(
    (p) => p.getAttribute("NAME") === "lastUsedAnnotationId",
  );
  if (!prop) {
    prop = doc.createElement("PROPERTY");
    prop.setAttribute("NAME", "lastUsedAnnotationId");
    header.appendChild(prop);
  }
  while (prop.firstChild) prop.removeChild(prop.firstChild);
  prop.appendChild(doc.createTextNode(String(value)));
}

function hasTier(root: Element, tierId: string): boolean {
  return childElements(root, "TIER").some(
    (t) => (t.getAttribute("TIER_ID") ?? "").toLowerCase() === tierId.toLowerCase(),
  );
}

/** Add SayMore's two tiers when the file has no tier of that (case-insensitive) name. */
function ensureSayMoreTiers(root: Element): void {
  const doc = root.ownerDocument;
  const tiers = childElements(root, "TIER");
  const anchor = tiers[tiers.length - 1] ?? childElements(root, "TIME_ORDER")[0];
  const before = anchor ? anchor.nextSibling : null;

  const toAdd: Element[] = [];
  if (!hasTier(root, TRANSCRIPTION_TIER_ID)) {
    const tier = doc.createElement("TIER");
    tier.setAttribute("DEFAULT_LOCALE", "ipa-ext");
    tier.setAttribute("LINGUISTIC_TYPE_REF", "Transcription");
    tier.setAttribute("TIER_ID", TRANSCRIPTION_TIER_ID);
    toAdd.push(tier);
  }
  if (!hasTier(root, FREE_TRANSLATION_TIER_ID)) {
    const tier = doc.createElement("TIER");
    tier.setAttribute("LINGUISTIC_TYPE_REF", "Transcription");
    tier.setAttribute("PARENT_REF", TRANSCRIPTION_TIER_ID);
    tier.setAttribute("TIER_ID", FREE_TRANSLATION_TIER_ID);
    toAdd.push(tier);
  }
  if (toAdd.length === 0) return;

  for (const tier of toAdd) insertWithBreak(root, tier, before, "\n\t");

  // The new tiers name the "Transcription" linguistic type; ELAN refuses a tier whose type is undefined.
  const typeDefined = childElements(root, "LINGUISTIC_TYPE").some(
    (l) => l.getAttribute("LINGUISTIC_TYPE_ID") === "Transcription",
  );
  if (!typeDefined) {
    const type = doc.createElement("LINGUISTIC_TYPE");
    type.setAttribute("GRAPHIC_REFERENCES", "false");
    type.setAttribute("LINGUISTIC_TYPE_ID", "Transcription");
    type.setAttribute("TIME_ALIGNABLE", "true");
    const lastTier = childElements(root, "TIER").pop();
    insertWithBreak(root, type, lastTier ? lastTier.nextSibling : null, "\n\t");
  }
}

/**
 * Turn the text of a user-chosen `.eaf` into the text of `<media>.annotations.eaf`.
 * Throws when `xml` is not an ELAN file; callers decide that with {@link isElanXml}.
 */
export function importElanFile(xml: string, mediaFileName: string): string {
  const dom = parseQuietly(xml);
  const root = dom?.documentElement;
  if (!dom || !root || root.localName !== "ANNOTATION_DOCUMENT") {
    throw new Error("Not an ELAN annotation file.");
  }

  const lastId = highestAnnotationId(root);
  const header = ensureHeaderWithMedia(root, mediaFileName);
  setLastUsedAnnotationId(header, lastId);
  ensureSayMoreTiers(root);

  const body = new XMLSerializer().serializeToString(
    dom as unknown as Parameters<XMLSerializer["serializeToString"]>[0],
  );
  // The output is always UTF-8, whatever encoding the source declared.
  return XML_DECLARATION + "\n" + body.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
}
