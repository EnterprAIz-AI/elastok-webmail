// Thumbnail rendering + cache for attachment previews.
//
// A thumbnail is generated once and then lives in IndexedDB as a ~4 KB data
// URL, so the expensive part (decoding a photo, rasterizing a PDF page) happens
// at most once per attachment no matter how often the row is hovered.
//
// The cache is deliberately separate from utils/attachment-cache.js: that one
// holds whole attachments under a 50 MB budget, and a few multi-megabyte files
// would evict every thumbnail if they shared a pool.

import { db } from './db';
import { Local } from './storage';
import { resolveAttachmentBlob, type ResolveOptions } from './attachment-bytes';
import {
  attachmentKind,
  attachmentName,
  canThumbnail,
  type AttachmentLike,
} from './attachment-kind';
import { warn } from './logger';

const THUMB_KEY_PREFIX = 'att_thumb_';
const MANIFEST_KEY = 'att_thumb_manifest';
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

/** Longest edge of the stored thumbnail, in device-independent pixels. */
export const THUMB_MAX_PX = 160;

interface ManifestEntry {
  key: string;
  size: number;
  cachedAt: number;
}

interface Manifest {
  totalBytes: number;
  entries: ManifestEntry[];
}

interface MessageLike {
  id?: string | number;
  folder?: string;
  folder_path?: string;
  [key: string]: unknown;
}

function account(): string {
  return Local.get('email') || 'default';
}

function thumbKey(messageId: string | number, filename: string): string {
  return `${THUMB_KEY_PREFIX}${account()}_${messageId}_${filename}`;
}

// Attachments we already tried and could not render (bytes not on the device,
// corrupt file, unsupported codec). Memory-only: a reload gets a fresh shot.
const failed = new Set<string>();

// Manifest updates are read-modify-write, so they run one at a time to avoid
// two concurrent thumbnails clobbering each other's bookkeeping.
let manifestQueue: Promise<unknown> = Promise.resolve();

async function readManifest(): Promise<Manifest> {
  try {
    const record = await db.meta.get(MANIFEST_KEY);
    return (record?.value as Manifest) || { totalBytes: 0, entries: [] };
  } catch {
    return { totalBytes: 0, entries: [] };
  }
}

async function storeThumbnail(key: string, dataUrl: string): Promise<void> {
  const size = dataUrl.length;
  manifestQueue = manifestQueue
    .then(async () => {
      const manifest = await readManifest();
      if (manifest.entries.some((entry) => entry.key === key)) return;

      while (manifest.totalBytes + size > MAX_CACHE_BYTES && manifest.entries.length) {
        const oldest = manifest.entries.shift();
        if (!oldest) break;
        manifest.totalBytes -= oldest.size;
        try {
          await db.meta.delete(oldest.key);
        } catch {
          // Best effort.
        }
      }

      await db.meta.put({ key, value: dataUrl, updatedAt: Date.now() });
      manifest.entries.push({ key, size, cachedAt: Date.now() });
      manifest.totalBytes += size;
      await db.meta.put({ key: MANIFEST_KEY, value: manifest, updatedAt: Date.now() });
    })
    .catch((err) => {
      warn('[attachment-thumbs] Failed to cache thumbnail', err);
    });
  return manifestQueue as Promise<void>;
}

async function readThumbnail(key: string): Promise<string | null> {
  try {
    const record = await db.meta.get(key);
    return typeof record?.value === 'string' ? record.value : null;
  } catch {
    return null;
  }
}

/** Export the canvas as the smallest format the browser will actually encode. */
function canvasToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    const webp = canvas.toDataURL('image/webp', 0.72);
    // Safari historically ignores the webp request and hands back a PNG; the
    // prefix is the only reliable tell.
    if (webp.startsWith('data:image/webp')) return webp;
    return canvas.toDataURL('image/png');
  } catch (err) {
    warn('[attachment-thumbs] Canvas export failed', err);
    return null;
  }
}

function fitInside(width: number, height: number, max: number): { w: number; h: number } {
  if (!width || !height) return { w: max, h: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to the <img> path (some codecs only work there).
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function renderImageThumbnail(blob: Blob): Promise<string | null> {
  const source = await decodeImage(blob);
  if (!source) return null;
  try {
    const width = (source as ImageBitmap).width || (source as HTMLImageElement).naturalWidth;
    const height = (source as ImageBitmap).height || (source as HTMLImageElement).naturalHeight;
    const { w, h } = fitInside(width, height, THUMB_MAX_PX);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return canvasToDataUrl(canvas);
  } finally {
    (source as ImageBitmap).close?.();
  }
}

// pdf.js is ~1 MB, so it is imported on demand and only ever loaded for users
// who actually hover a PDF. Vite splits it into its own chunk.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, workerSrc] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then(
          (mod: { default: string }) => mod.default,
        ),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function renderPdfThumbnail(blob: Blob): Promise<string | null> {
  const { getDocument } = await loadPdfjs();
  const buffer = await blob.arrayBuffer();
  const task = getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, THUMB_MAX_PX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvas, viewport }).promise;
    // PDF pages are transparent, so paint the paper white *behind* what was
    // just drawn — filling first would risk pdf.js clearing it.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    return canvasToDataUrl(canvas);
  } finally {
    // Tears down the document and its worker; without this every hovered PDF
    // would leak a worker for the life of the tab.
    void task.destroy();
  }
}

/**
 * A cached-or-generated thumbnail for one attachment, or null when there is
 * nothing to show (unsupported type, oversized, bytes not reachable).
 *
 * By default this never hits the network: pass `allowNetwork` only from a path
 * the user explicitly asked for.
 */
export async function getAttachmentThumbnail(
  attachment: AttachmentLike | null | undefined,
  message: MessageLike | null | undefined,
  options: ResolveOptions = {},
): Promise<string | null> {
  if (!attachment || !message?.id) return null;
  if (!canThumbnail(attachment)) return null;

  const filename = attachmentName(attachment);
  const key = thumbKey(message.id, filename);
  if (failed.has(key)) return null;

  const cached = await readThumbnail(key);
  if (cached) return cached;

  const blob = await resolveAttachmentBlob(attachment, message, options);
  if (!blob) {
    // No bytes locally — remember, so hovering the row again is free.
    if (!options.allowNetwork) failed.add(key);
    return null;
  }

  let dataUrl: string | null = null;
  try {
    dataUrl =
      attachmentKind(attachment) === 'pdf'
        ? await renderPdfThumbnail(blob)
        : await renderImageThumbnail(blob);
  } catch (err) {
    warn('[attachment-thumbs] Render failed', err);
    dataUrl = null;
  }

  if (!dataUrl) {
    failed.add(key);
    return null;
  }

  void storeThumbnail(key, dataUrl);
  return dataUrl;
}

/** Drop every cached thumbnail for the current account. */
export async function clearThumbnailCache(): Promise<void> {
  try {
    const manifest = await readManifest();
    for (const entry of manifest.entries) {
      await db.meta.delete(entry.key).catch(() => {});
    }
    await db.meta.put({
      key: MANIFEST_KEY,
      value: { totalBytes: 0, entries: [] },
      updatedAt: Date.now(),
    });
    failed.clear();
  } catch {
    // Best effort.
  }
}
