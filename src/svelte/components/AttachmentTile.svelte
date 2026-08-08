<script lang="ts">
  // One attachment as a small clickable tile: a real thumbnail when we can
  // render one, a type card when we can't. Used by the inbox popover and the
  // viewer's filmstrip.
  import { getAttachmentThumbnail } from '../../utils/attachment-thumbs';
  import {
    attachmentName,
    attachmentTypeLabel,
    canThumbnail,
    formatAttachmentSize,
    type AttachmentLike,
  } from '../../utils/attachment-kind';
  import type { PreviewMessage } from '../../stores/attachmentPreview';

  interface Props {
    attachment: AttachmentLike;
    message: PreviewMessage;
    active?: boolean;
    onclick?: () => void;
  }

  let { attachment, message, active = false, onclick = () => {} }: Props = $props();

  const name = $derived(attachmentName(attachment));
  const typeLabel = $derived(attachmentTypeLabel(attachment));
  const sizeLabel = $derived(formatAttachmentSize(attachment?.size));

  let thumbnail: string | null = $state(null);
  let loading = $state(false);

  // Generating a thumbnail is local-only here (never `allowNetwork`), so a tile
  // for a message whose bytes aren't cached simply keeps its type card.
  $effect(() => {
    const currentAttachment = attachment;
    const currentMessage = message;
    thumbnail = null;
    if (!canThumbnail(currentAttachment)) return;

    let cancelled = false;
    loading = true;
    getAttachmentThumbnail(currentAttachment, currentMessage)
      .then((result) => {
        if (!cancelled) thumbnail = result;
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<button
  type="button"
  class="group flex w-[92px] shrink-0 cursor-pointer flex-col gap-1 text-left"
  {onclick}
  title={sizeLabel ? `${name} · ${sizeLabel}` : name}
  data-testid="attachment-tile"
>
  <div
    class="flex h-[68px] w-full items-center justify-center overflow-hidden rounded border bg-muted/40 transition-colors {active
      ? 'border-primary ring-1 ring-primary'
      : 'border-border group-hover:border-primary/60'}"
  >
    {#if thumbnail}
      <img src={thumbnail} alt={name} class="h-full w-full object-cover" />
    {:else if loading}
      <div class="h-full w-full animate-pulse bg-muted"></div>
    {:else}
      <span class="text-xs font-semibold tracking-wide text-muted-foreground">{typeLabel}</span>
    {/if}
  </div>
  <span class="truncate text-[11px] leading-tight text-foreground">{name}</span>
  {#if sizeLabel}
    <span class="text-[10px] leading-none text-muted-foreground">{sizeLabel}</span>
  {/if}
</button>
