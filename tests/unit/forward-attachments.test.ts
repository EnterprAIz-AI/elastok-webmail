import { describe, expect, it } from 'vitest';
import { isInlineAttachmentPart } from '../../src/stores/mailbox-actions-helpers';

// Shapes below mirror what api.forwardemail.net actually returns under
// `nodemailer.attachments` for real messages — captured from a live mailbox.
describe('isInlineAttachmentPart', () => {
  it('keeps a Gmail-sent PDF even though Gmail stamps a Content-ID on it', () => {
    // The regression that made "Forward" arrive with no attachments: every
    // Gmail attachment carries a cid, so cid-means-inline dropped all of them.
    expect(
      isInlineAttachmentPart({
        filename: 'Boleto-TEXTIPAN INDUSTRIA E COMERCIO LTDA-16.pdf',
        contentType: 'application/pdf',
        contentDisposition: 'attachment',
        contentId: '<f_msgfxtbq0>',
        cid: 'f_msgfxtbq0',
      } as never),
    ).toBe(false);
  });

  it('skips a logo the HTML body references (no disposition, related: true)', () => {
    expect(
      isInlineAttachmentPart({
        contentType: 'image/png',
        contentId: '<1>',
        cid: '1',
        related: true,
      } as never),
    ).toBe(true);
  });

  it('skips an explicitly inline part', () => {
    expect(isInlineAttachmentPart({ contentDisposition: 'inline', cid: 'x' } as never)).toBe(true);
  });

  it('keeps a plain attachment with no cid at all', () => {
    expect(
      isInlineAttachmentPart({ filename: 'nota.pdf', contentDisposition: 'attachment' } as never),
    ).toBe(false);
  });

  it('falls back to the bare cid when no disposition is present', () => {
    expect(isInlineAttachmentPart({ cid: 'abc' } as never)).toBe(true);
    expect(isInlineAttachmentPart({ filename: 'x.pdf' } as never)).toBe(false);
  });

  it('tolerates null/undefined parts', () => {
    expect(isInlineAttachmentPart(null)).toBe(false);
    expect(isInlineAttachmentPart(undefined)).toBe(false);
  });
});
