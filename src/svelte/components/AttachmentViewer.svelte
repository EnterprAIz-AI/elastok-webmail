<script lang="ts">
  // Full-screen attachment viewer, mounted once by Mailbox and driven by the
  // attachmentPreview store so both the inbox popover and the open-message
  // attachment strip land here.
  //
  // Unlike the popover this is an explicit user action, so it is allowed to
  // re-download the message when the bytes aren't cached locally.
  import X from '@lucide/svelte/icons/x';
  import Download from '@lucide/svelte/icons/download';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import FileQuestion from '@lucide/svelte/icons/file-question';
  import {
    attachmentViewer,
    closeAttachmentViewer,
    stepAttachmentViewer,
  } from '../../stores/attachmentPreview';
  import { resolveAttachmentBlob } from '../../utils/attachment-bytes';
  import {
    attachmentKind,
    attachmentName,
    attachmentTypeLabel,
    formatAttachmentSize,
  } from '../../utils/attachment-kind';
  import { mailService } from '../../stores/mailService';
  import type { Attachment, Message } from '../../types';

  const viewer = $derived($attachmentViewer);
  const entry = $derived(viewer.entries[viewer.index]);
  const attachment = $derived(entry?.attachment);
  const message = $derived(entry?.message);
  const name = $derived(attachment ? attachmentName(attachment) : '');
  const kind = $derived(attachment ? attachmentKind(attachment) : 'generic');
  const sizeLabel = $derived(formatAttachmentSize(attachment?.size));

  // Safari on iOS refuses to render a PDF inside an iframe (it shows a blank
  // box or just the first page with no controls), so those get a link out.
  const isIos =
    typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  let objectUrl: string | null = $state(null);
  let loading = $state(false);
  let failed = $state(false);
  let zoomed = $state(false);

  $effect(() => {
    const currentAttachment = attachment;
    const currentMessage = message;

    zoomed = false;
    failed = false;

    if (!currentAttachment || !currentMessage) {
      objectUrl = null;
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    loading = true;

    resolveAttachmentBlob(currentAttachment, currentMessage, { allowNetwork: true })
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          failed = true;
          return;
        }
        created = URL.createObjectURL(blob);
        objectUrl = created;
      })
      .catch(() => {
        if (!cancelled) failed = true;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      objectUrl = null;
    };
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (!viewer.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAttachmentViewer();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepAttachmentViewer(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepAttachmentViewer(-1);
    }
  };

  const download = () => {
    if (!attachment || !message) return;
    // The preview types stay loose on purpose (they accept raw API shapes);
    // mailService wants the app's narrowed Attachment/Message.
    mailService.downloadAttachment(attachment as Attachment, message as unknown as Message);
  };

  const openInNewTab = () => {
    if (objectUrl) window.open(objectUrl, '_blank', 'noopener,noreferrer');
  };
</script>

<svelte:window on:keydown={handleKeydown} />

{#if viewer.open && attachment}
  <div
    class="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Attachment preview: {name}"
    data-testid="attachment-viewer"
  >
    <header class="flex items-center gap-3 px-4 py-3 text-white">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">{name}</div>
        <div class="text-xs text-white/70">
          {sizeLabel}
          {#if viewer.entries.length > 1}
            <span class="ml-2 tabular-nums">{viewer.index + 1} / {viewer.entries.length}</span>
          {/if}
        </div>
      </div>
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10"
        onclick={download}
        title="Download"
      >
        <Download class="h-4 w-4" />
        <span class="hidden sm:inline">Download</span>
      </button>
      <button
        type="button"
        class="inline-flex cursor-pointer items-center rounded p-1.5 text-white/90 transition-colors hover:bg-white/10"
        onclick={closeAttachmentViewer}
        title="Close"
        aria-label="Close"
      >
        <X class="h-5 w-5" />
      </button>
    </header>

    <div class="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
      {#if viewer.entries.length > 1}
        <button
          type="button"
          class="absolute left-2 z-10 cursor-pointer rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/70"
          onclick={() => stepAttachmentViewer(-1)}
          aria-label="Previous attachment"
        >
          <ChevronLeft class="h-6 w-6" />
        </button>
        <button
          type="button"
          class="absolute right-2 z-10 cursor-pointer rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/70"
          onclick={() => stepAttachmentViewer(1)}
          aria-label="Next attachment"
        >
          <ChevronRight class="h-6 w-6" />
        </button>
      {/if}

      {#if loading}
        <div class="text-sm text-white/80">Loading…</div>
      {:else if failed || !objectUrl}
        <div class="flex max-w-sm flex-col items-center gap-3 text-center text-white/80">
          <FileQuestion class="h-10 w-10" />
          <p class="text-sm">This file couldn't be loaded for preview.</p>
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1.5 rounded bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
            onclick={download}
          >
            <Download class="h-4 w-4" />
            Download instead
          </button>
        </div>
      {:else if kind === 'image'}
        <button
          type="button"
          class="flex h-full w-full cursor-zoom-in items-center justify-center overflow-auto {zoomed
            ? 'cursor-zoom-out'
            : ''}"
          onclick={() => (zoomed = !zoomed)}
          aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
        >
          <img
            src={objectUrl}
            alt={name}
            class={zoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
          />
        </button>
      {:else if kind === 'pdf' && !isIos}
        <iframe src={objectUrl} title={name} class="h-full w-full rounded bg-white"></iframe>
      {:else}
        <div class="flex max-w-sm flex-col items-center gap-3 text-center text-white/80">
          <span class="rounded border border-white/30 px-3 py-1.5 text-sm font-semibold">
            {attachmentTypeLabel(attachment)}
          </span>
          <p class="text-sm">
            {kind === 'pdf'
              ? 'PDFs open in a separate tab on this device.'
              : "This file type can't be shown here."}
          </p>
          <div class="flex gap-2">
            {#if kind === 'pdf'}
              <button
                type="button"
                class="inline-flex cursor-pointer items-center gap-1.5 rounded bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
                onclick={openInNewTab}
              >
                <ExternalLink class="h-4 w-4" />
                Open
              </button>
            {/if}
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
              onclick={download}
            >
              <Download class="h-4 w-4" />
              Download
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
