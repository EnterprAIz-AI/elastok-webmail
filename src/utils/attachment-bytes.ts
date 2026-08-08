// Resolving an attachment's bytes for preview.
//
// The forwardemail API has no per-attachment endpoint: files come embedded in
// the message detail, so "fetch one attachment" really means "re-download the
// whole message". That would be a terrible thing to hang off a hover, and it's
// usually unnecessary — the sync worker already parses the raw message and
// persists every part as a data URL in `messageBodies.attachments[].href`.
//
// So this resolves local-first and only reaches for the network when a caller
// explicitly allows it (i.e. the user clicked to open the file, not just
// pointed at the row).

import { db } from './db';
import { Local } from './storage';
import { Remote } from './remote.js';
import { getCachedAttachmentBlob, cacheAttachmentBlob } from './attachment-cache.js';
import { getMessageApiId } from './sync-helpers';
import { attachmentName, attachmentContentType, type AttachmentLike } from './attachment-kind';
import { warn } from './logger';

interface MessageLike {
  id?: string | number;
  folder?: string;
  folder_path?: string;
  [key: string]: unknown;
}

interface CachedBodyRecord {
  attachments?: AttachmentLike[];
}

export interface ResolveOptions {
  /**
   * Allow re-downloading the whole message when the bytes aren't on the device.
   * Off by default so the inbox popover can never trigger a multi-megabyte
   * fetch just because the pointer crossed a row.
   */
  allowNetwork?: boolean;
}

/** Decode a `data:` URL into a Blob without going through a giant base64 copy. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(5, comma);
  const isBase64 = header.includes(';base64');
  const contentType = header.split(';')[0] || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  try {
    if (!isBase64) {
      return new Blob([decodeURIComponent(payload)], { type: contentType });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  } catch (err) {
    warn('[attachment-bytes] Failed to decode data URL', err);
    return null;
  }
}

/**
 * Turn whatever the API/cache calls "content" into bytes. Mirrors
 * mail-service-helpers' contentToBytes, kept local so this module stays in the
 * utils layer.
 */
// The return is pinned to a plain ArrayBuffer (not ArrayBufferLike) because
// SharedArrayBuffer-backed views aren't valid Blob parts.
function contentToBytes(content: unknown): Uint8Array<ArrayBuffer> | null {
  if (!content) return null;
  if (content instanceof Uint8Array) return new Uint8Array(content);
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  const record = content as { type?: string; data?: number[] };
  if (record?.type === 'Buffer' && Array.isArray(record.data)) {
    return new Uint8Array(record.data);
  }
  if (Array.isArray(content)) return new Uint8Array(content as number[]);
  if (typeof content === 'string') {
    try {
      const binary = atob(content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }
  return null;
}

function sameAttachment(candidate: AttachmentLike, target: AttachmentLike): boolean {
  const a = attachmentName(candidate).toLowerCase();
  const b = attachmentName(target).toLowerCase();
  if (a && a === b) return true;
  const candidateCid = candidate.contentId || candidate.cid;
  const targetCid = target.contentId || target.cid;
  return Boolean(candidateCid && targetCid && candidateCid === targetCid);
}

function account(): string {
  return Local.get('email') || 'default';
}

/** In-flight requests, so N tiles of the same message share one download. */
const pending = new Map<string, Promise<Blob | null>>();

function pendingKey(messageId: string | number, filename: string): string {
  return `${account()}::${messageId}::${filename}`;
}

/**
 * Read the attachment list this app has cached for a message. The sync worker
 * writes these with data-URL hrefs; the mailService path writes metadata only.
 */
export async function getCachedMessageAttachments(
  messageId: string | number,
): Promise<AttachmentLike[]> {
  if (!messageId) return [];
  try {
    const record = (await db.messageBodies
      .where('[account+id]')
      .equals([account(), messageId])
      .first()) as CachedBodyRecord | undefined;
    return Array.isArray(record?.attachments) ? record.attachments : [];
  } catch {
    return [];
  }
}

async function resolveFromLocal(
  attachment: AttachmentLike,
  messageId: string | number,
): Promise<Blob | null> {
  // 1. The attachment object already carries the bytes (sync worker path).
  if (typeof attachment.href === 'string' && attachment.href.startsWith('data:')) {
    const blob = dataUrlToBlob(attachment.href);
    if (blob) return blob;
  }

  const filename = attachmentName(attachment);

  // 2. Previously downloaded and kept for offline access.
  try {
    const cached = await getCachedAttachmentBlob(messageId, filename);
    if (cached) {
      const blob = dataUrlToBlob(cached);
      if (blob) return blob;
    }
  } catch {
    // Cache miss is not an error.
  }

  // 3. The cached message body may hold a data URL even when the caller's copy
  //    of the attachment (e.g. from a list payload) does not.
  const cachedAttachments = await getCachedMessageAttachments(messageId);
  const match = cachedAttachments.find((candidate) => sameAttachment(candidate, attachment));
  if (typeof match?.href === 'string' && match.href.startsWith('data:')) {
    return dataUrlToBlob(match.href);
  }

  return null;
}

async function resolveFromNetwork(
  attachment: AttachmentLike,
  message: MessageLike,
  messageId: string | number,
): Promise<Blob | null> {
  const folder = message.folder_path || message.folder || '';
  try {
    const response = await Remote.request(
      'Message',
      {},
      {
        method: 'GET',
        pathOverride: `/v1/messages/${encodeURIComponent(String(messageId))}?folder=${encodeURIComponent(
          String(folder),
        )}&raw=false`,
      },
    );
    const result = ((response as { Result?: unknown })?.Result || response) as Record<
      string,
      unknown
    >;
    const list = ((result?.nodemailer as Record<string, unknown>)?.attachments ||
      result?.attachments ||
      []) as AttachmentLike[];
    const match = list.find((candidate) => sameAttachment(candidate, attachment));
    if (!match) return null;

    const contentType =
      attachmentContentType(match) ||
      attachmentContentType(attachment) ||
      'application/octet-stream';

    if (typeof match.href === 'string' && match.href.startsWith('data:')) {
      return dataUrlToBlob(match.href);
    }
    const bytes = contentToBytes((match as { content?: unknown }).content);
    if (!bytes?.byteLength) return null;
    return new Blob([bytes], { type: contentType });
  } catch (err) {
    warn('[attachment-bytes] Network resolve failed', err);
    return null;
  }
}

/**
 * Best-effort bytes for one attachment.
 *
 * Returns null rather than throwing when the file isn't reachable — callers
 * render a type card in that case, which is a perfectly good preview.
 */
export async function resolveAttachmentBlob(
  attachment: AttachmentLike | null | undefined,
  message: MessageLike | null | undefined,
  options: ResolveOptions = {},
): Promise<Blob | null> {
  if (!attachment) return null;
  const messageId = getMessageApiId((message || {}) as Parameters<typeof getMessageApiId>[0]);
  if (!messageId) return null;

  const filename = attachmentName(attachment);
  const key = pendingKey(messageId, filename);
  const existing = pending.get(key);
  if (existing) return existing;

  const task = (async () => {
    const local = await resolveFromLocal(attachment, messageId);
    if (local) return local;
    if (!options.allowNetwork) return null;

    const remote = await resolveFromNetwork(attachment, message as MessageLike, messageId);
    if (remote) {
      // Keep it around for offline use. cacheAttachmentBlob skips anything over
      // its own per-item ceiling, so a huge file just isn't stored.
      try {
        const dataUrl = await blobToDataUrl(remote);
        if (dataUrl) {
          void cacheAttachmentBlob(messageId, filename, dataUrl, remote.size).catch(() => {});
        }
      } catch {
        // Caching is best effort.
      }
    }
    return remote;
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, task);
  return task;
}

export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}
