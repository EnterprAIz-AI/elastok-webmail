// Attachment classification and presentation helpers.
//
// Pure and DOM-free on purpose: the inbox preview leans on these to decide what
// to draw — and whether a thumbnail is worth generating at all — before it
// touches IndexedDB or the network. Anything doing I/O belongs in
// attachment-bytes.ts (fetching) or attachment-thumbs.ts (rendering).

export interface AttachmentLike {
  name?: string;
  filename?: string;
  size?: number;
  contentId?: string;
  cid?: string;
  disposition?: string;
  contentDisposition?: string;
  contentType?: string;
  mimeType?: string;
  type?: string;
  href?: string;
}

/** What the preview can actually render for this file. */
export type AttachmentKind = 'image' | 'pdf' | 'generic';

/** Image types every target browser can decode into a canvas. */
const IMAGE_TYPES = new Set([
  'image/gif',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/apng',
  'image/avif',
]);

const IMAGE_EXTENSIONS = new Set(['gif', 'png', 'jpeg', 'jpg', 'webp', 'bmp', 'apng', 'avif']);

/**
 * Decoding a huge image or rasterizing a huge PDF costs far more than a 160px
 * thumbnail is worth, and the whole file has to sit in memory to do it. Past
 * this size the preview shows a type card instead.
 */
export const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

export function attachmentName(att: AttachmentLike | null | undefined): string {
  return att?.filename || att?.name || 'attachment';
}

export function attachmentContentType(att: AttachmentLike | null | undefined): string {
  return (att?.contentType || att?.mimeType || att?.type || '').toLowerCase();
}

/** Lowercase extension without the dot, or '' when the name carries none. */
export function attachmentExtension(att: AttachmentLike | null | undefined): string {
  const name = attachmentName(att).toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1);
}

export function isPreviewableImage(att: AttachmentLike | null | undefined): boolean {
  if (IMAGE_TYPES.has(attachmentContentType(att))) return true;
  const ext = attachmentExtension(att);
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

export function isPdf(att: AttachmentLike | null | undefined): boolean {
  const type = attachmentContentType(att);
  if (type === 'application/pdf' || type === 'application/x-pdf') return true;
  // Some senders ship PDFs as application/octet-stream; trust the extension.
  return attachmentExtension(att) === 'pdf';
}

export function attachmentKind(att: AttachmentLike | null | undefined): AttachmentKind {
  if (isPreviewableImage(att)) return 'image';
  if (isPdf(att)) return 'pdf';
  return 'generic';
}

/**
 * Whether it's worth trying to render a real thumbnail. A 'generic' kind has
 * nothing to rasterize, and oversized files aren't worth the decode.
 */
export function canThumbnail(att: AttachmentLike | null | undefined): boolean {
  if (attachmentKind(att) === 'generic') return false;
  const size = att?.size || 0;
  return size <= THUMBNAIL_MAX_BYTES;
}

/** Short uppercase badge for the type card: 'PDF', 'XLSX', 'ZIP'. */
export function attachmentTypeLabel(att: AttachmentLike | null | undefined): string {
  const ext = attachmentExtension(att);
  if (ext) return ext.slice(0, 4).toUpperCase();
  const type = attachmentContentType(att);
  const subtype = type.split('/')[1] || '';
  return (subtype.split('+')[0] || 'FILE').slice(0, 4).toUpperCase();
}

export function formatAttachmentSize(bytes: number | undefined | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drop the parts that are body decoration rather than files the user thinks of
 * as attachments — a signature logo the HTML pulls in via cid:.
 *
 * Deliberately narrow: a Content-ID alone proves nothing (Gmail stamps one on
 * every attachment it sends, real PDFs included), so a part is only hidden when
 * it is an image AND carries a cid AND says disposition inline. Missing or
 * 'attachment' disposition always means show it.
 */
export function filterDownloadableAttachments<T extends AttachmentLike>(
  atts: T[] | null | undefined,
): T[] {
  if (!Array.isArray(atts)) return [];
  return atts.filter((att) => {
    if (!att?.contentId) return true;
    if (!attachmentContentType(att).startsWith('image/')) return true;
    const disposition = (att.disposition || att.contentDisposition || '').toLowerCase();
    return disposition !== 'inline';
  });
}

interface RowLike {
  attachments?: AttachmentLike[];
  has_attachment?: boolean;
  has_attachments?: boolean;
  attachment_count?: number;
  latestHasAttachments?: boolean;
  messages?: RowLike[];
}

/**
 * Whether a mailbox row (a message or a whole conversation) should advertise
 * attachments.
 *
 * `has_attachment`, singular, is the field the sync worker actually writes on
 * every message record. The plural spelling and the two count fields below are
 * other shapes the API and older caches have used; keeping them costs nothing,
 * but leaving the singular one out — as this check did for a long time — makes
 * the paperclip disappear from every row in the inbox.
 */
export function rowHasAttachments(item: RowLike | null | undefined): boolean {
  if (!item) return false;
  // When the real list is loaded, trust it: it knows to ignore signature logos.
  if (Array.isArray(item.attachments) && item.attachments.length) {
    return filterDownloadableAttachments(item.attachments).length > 0;
  }
  if (item.has_attachment) return true;
  if (item.has_attachments) return true;
  if ((item.attachment_count || 0) > 0) return true;
  if (item.latestHasAttachments) return true;
  if (Array.isArray(item.messages)) {
    return item.messages.some((message) => rowHasAttachments(message));
  }
  return false;
}

/** Summary line for the preview header: '3 files · 445 KB'. */
export function describeAttachments(atts: AttachmentLike[] | null | undefined): string {
  const list = Array.isArray(atts) ? atts : [];
  if (!list.length) return '';
  const totalBytes = list.reduce((sum, att) => sum + (att?.size || 0), 0);
  const count = `${list.length} file${list.length === 1 ? '' : 's'}`;
  const size = formatAttachmentSize(totalBytes);
  return size ? `${count} · ${size}` : count;
}
