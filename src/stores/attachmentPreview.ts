// State for the attachment preview: which files a mailbox row carries, and
// which one the full-screen viewer is showing.
//
// The viewer is mounted once by Mailbox.svelte and driven from here, so both
// the inbox popover and the open-message attachment strip can open the same
// surface without passing props through the tree.

import { writable, get } from 'svelte/store';
import { getCachedMessageAttachments } from '../utils/attachment-bytes';
import { filterDownloadableAttachments, type AttachmentLike } from '../utils/attachment-kind';

export interface PreviewMessage {
  id?: string | number;
  folder?: string;
  folder_path?: string;
  from?: string;
  attachments?: AttachmentLike[];
  [key: string]: unknown;
}

/** One message's files, kept grouped so a thread can label who sent what. */
export interface AttachmentGroup {
  message: PreviewMessage;
  attachments: AttachmentLike[];
}

export interface ViewerEntry {
  attachment: AttachmentLike;
  message: PreviewMessage;
}

interface ViewerState {
  open: boolean;
  entries: ViewerEntry[];
  index: number;
}

const CLOSED: ViewerState = { open: false, entries: [], index: 0 };

export const attachmentViewer = writable<ViewerState>(CLOSED);

export function openAttachmentViewer(entries: ViewerEntry[], index = 0): void {
  const list = (entries || []).filter((entry) => entry?.attachment);
  if (!list.length) return;
  attachmentViewer.set({
    open: true,
    entries: list,
    index: Math.min(Math.max(index, 0), list.length - 1),
  });
}

export function closeAttachmentViewer(): void {
  attachmentViewer.set(CLOSED);
}

/** Move through the open message's files; wraps around at both ends. */
export function stepAttachmentViewer(delta: number): void {
  const state = get(attachmentViewer);
  if (!state.open || state.entries.length < 2) return;
  const count = state.entries.length;
  const next = (((state.index + delta) % count) + count) % count;
  attachmentViewer.set({ ...state, index: next });
}

/** Flatten groups into the list the viewer navigates. */
export function groupsToEntries(groups: AttachmentGroup[]): ViewerEntry[] {
  return (groups || []).flatMap((group) =>
    (group.attachments || []).map((attachment) => ({ attachment, message: group.message })),
  );
}

// Rows mount and unmount constantly while scrolling a virtualized list, so
// resolved lists are memoized. Only non-empty results are kept: an empty answer
// usually means the body hasn't synced yet, and re-reading lets the row fill in
// by itself once it has.
const memo = new Map<string, AttachmentLike[]>();
const MEMO_LIMIT = 500;

function remember(id: string, attachments: AttachmentLike[]): void {
  if (!attachments.length) return;
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(id, attachments);
}

async function attachmentsForMessage(message: PreviewMessage): Promise<AttachmentLike[]> {
  const id = message?.id;
  if (!id) return [];
  const key = String(id);

  const inline = Array.isArray(message.attachments) ? message.attachments : [];
  if (inline.length) {
    const filtered = filterDownloadableAttachments(inline);
    remember(key, filtered);
    return filtered;
  }

  const cached = memo.get(key);
  if (cached) return cached;

  const filtered = filterDownloadableAttachments(await getCachedMessageAttachments(id));
  remember(key, filtered);
  return filtered;
}

/**
 * Everything a mailbox row should offer to preview. A row is a conversation in
 * some layouts and a bare message in others, so the shape decides — a thread
 * walks all its messages, which is what makes the count match what the
 * conversation actually holds.
 */
export async function loadRowAttachments(
  item: PreviewMessage | { messages?: PreviewMessage[] },
): Promise<AttachmentGroup[]> {
  if (!item) return [];

  const threadMessages = (item as { messages?: PreviewMessage[] }).messages;
  const messages: PreviewMessage[] =
    Array.isArray(threadMessages) && threadMessages.length
      ? threadMessages
      : [item as PreviewMessage];

  const groups: AttachmentGroup[] = [];
  for (const message of messages) {
    const attachments = await attachmentsForMessage(message);
    if (attachments.length) groups.push({ message, attachments });
  }
  return groups;
}

/** Drop memoized lists — used when the account changes. */
export function resetAttachmentPreviewCache(): void {
  memo.clear();
}
