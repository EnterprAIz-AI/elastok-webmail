<script lang="ts">
  // The paperclip in a mailbox row, upgraded into a preview.
  //
  // Everything here is local-first: the file list comes from what the sync
  // worker already cached, and thumbnails are only rendered from bytes already
  // on the device. Pointing at a row must never cost a download.
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Download from '@lucide/svelte/icons/download';
  import * as Popover from '$lib/components/ui/popover';
  import AttachmentTile from './AttachmentTile.svelte';
  import { mailService } from '../../stores/mailService';
  import { extractDisplayName } from '../../utils/address';
  import { describeAttachments } from '../../utils/attachment-kind';
  import type { Attachment, Message } from '../../types';
  import {
    loadRowAttachments,
    groupsToEntries,
    openAttachmentViewer,
    type AttachmentGroup,
    type PreviewMessage,
  } from '../../stores/attachmentPreview';

  interface Props {
    /** A conversation or a bare message — loadRowAttachments handles both. */
    item: PreviewMessage | { messages?: PreviewMessage[] };
  }

  let { item }: Props = $props();

  let groups: AttachmentGroup[] = $state([]);
  let open = $state(false);

  const entries = $derived(groupsToEntries(groups));
  const count = $derived(entries.length);
  const summary = $derived(describeAttachments(entries.map((entry) => entry.attachment)));

  // Rows mount and unmount constantly in the virtualized list, so the lookup is
  // deferred to idle time — scrolling stays smooth and offscreen rows that are
  // torn down before their turn never touch IndexedDB at all.
  $effect(() => {
    const currentItem = item;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      loadRowAttachments(currentItem)
        .then((result) => {
          if (!cancelled) groups = result;
        })
        .catch(() => {});
    };

    const schedule =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 1000 })
        : setTimeout(run, 50);

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === 'function' && typeof schedule === 'number') {
        cancelIdleCallback(schedule);
      }
      clearTimeout(schedule as ReturnType<typeof setTimeout>);
    };
  });

  const stopRowActivation = (event: Event) => {
    event.stopPropagation();
  };

  // The row itself opens the message on Enter/Space; the trigger must not.
  const stopRowKeys = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  };

  const openViewer = (index: number) => {
    open = false;
    openAttachmentViewer(entries, index);
  };

  let downloading = $state(false);

  // Sequential on purpose: browsers throttle (or silently drop) a burst of
  // simultaneous downloads from one gesture.
  const downloadAll = async () => {
    if (downloading) return;
    downloading = true;
    try {
      for (const entry of entries) {
        await mailService.downloadAttachment(
          entry.attachment as Attachment,
          entry.message as unknown as Message,
        );
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } finally {
      downloading = false;
    }
  };
</script>

{#if count > 0}
  <Popover.Root bind:open>
    <Popover.Trigger
      openOnHover
      openDelay={220}
      closeDelay={180}
      class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onclick={stopRowActivation}
      onkeydown={stopRowKeys}
      aria-label="{count} attachment{count === 1 ? '' : 's'}"
      data-testid="attachment-preview-trigger"
    >
      <Paperclip class="h-3.5 w-3.5 opacity-70" />
      {#if count > 1}
        <span class="text-[10px] font-medium leading-none tabular-nums">{count}</span>
      {/if}
    </Popover.Trigger>

    <Popover.Content
      align="start"
      class="w-[min(340px,92vw)] p-3"
      trapFocus={false}
      preventScroll={false}
      onclick={stopRowActivation}
      onOpenAutoFocus={(event: Event) => event.preventDefault()}
      data-testid="attachment-preview-content"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-xs font-medium text-muted-foreground">{summary}</span>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          onclick={downloadAll}
          disabled={downloading}
          title="Download all"
        >
          <Download class="h-3.5 w-3.5" />
          <span>All</span>
        </button>
      </div>

      {#each groups as group (group.message.id)}
        {#if groups.length > 1}
          <div class="mb-1 mt-2 truncate text-[11px] text-muted-foreground first:mt-0">
            {extractDisplayName(group.message.from) || group.message.from || '(no sender)'}
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#each group.attachments as attachment (attachment.filename || attachment.name)}
            <AttachmentTile
              {attachment}
              message={group.message}
              onclick={() =>
                openViewer(
                  entries.findIndex(
                    (entry) => entry.attachment === attachment && entry.message === group.message,
                  ),
                )}
            />
          {/each}
        </div>
      {/each}

      <p class="mt-2 text-[10px] leading-tight text-muted-foreground">
        Click a file to open it full screen.
      </p>
    </Popover.Content>
  </Popover.Root>
{:else}
  <!-- The message is flagged as having attachments but its body hasn't synced
       yet, so there is nothing truthful to preview — keep the plain clip. -->
  <Paperclip class="h-3.5 w-3.5 shrink-0 opacity-70" />
{/if}
