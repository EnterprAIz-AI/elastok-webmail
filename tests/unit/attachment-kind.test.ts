import { describe, it, expect } from 'vitest';
import {
  attachmentExtension,
  attachmentKind,
  attachmentTypeLabel,
  canThumbnail,
  describeAttachments,
  filterDownloadableAttachments,
  formatAttachmentSize,
  isPdf,
  isPreviewableImage,
  THUMBNAIL_MAX_BYTES,
} from '../../src/utils/attachment-kind';

// The shapes below are the real ones observed on api.forwardemail.net, not
// invented fixtures — in particular the Gmail attachments that carry BOTH
// contentDisposition: 'attachment' and a Content-ID.
const gmailPdf = {
  filename: '13- NF ELASTOK- JULHO 2026.pdf',
  name: '13- NF ELASTOK- JULHO 2026.pdf',
  contentType: 'application/pdf',
  disposition: 'attachment',
  contentId: '<f_msgfxtbq0>',
  size: 256490,
};

const signatureLogo = {
  filename: 'logo.png',
  name: 'logo.png',
  contentType: 'image/png',
  disposition: 'inline',
  contentId: '<logo@elastok>',
  size: 4120,
};

describe('attachment classification', () => {
  it('treats a Gmail PDF as a previewable PDF despite its Content-ID', () => {
    expect(attachmentKind(gmailPdf)).toBe('pdf');
    expect(isPdf(gmailPdf)).toBe(true);
    expect(canThumbnail(gmailPdf)).toBe(true);
  });

  it('detects a PDF sent as application/octet-stream by its extension', () => {
    const att = { filename: 'boleto.pdf', contentType: 'application/octet-stream', size: 68111 };
    expect(isPdf(att)).toBe(true);
    expect(attachmentKind(att)).toBe('pdf');
  });

  it('detects images by content type and by extension', () => {
    expect(isPreviewableImage({ contentType: 'image/jpeg' })).toBe(true);
    expect(isPreviewableImage({ filename: 'foto.WEBP' })).toBe(true);
    expect(isPreviewableImage({ filename: 'planilha.xlsx' })).toBe(false);
  });

  it('falls back to generic for types nothing can rasterize', () => {
    expect(attachmentKind({ filename: 'contrato.docx' })).toBe('generic');
    expect(canThumbnail({ filename: 'contrato.docx', size: 10 })).toBe(false);
  });

  it('refuses to thumbnail a file too big to decode cheaply', () => {
    expect(canThumbnail({ ...gmailPdf, size: THUMBNAIL_MAX_BYTES + 1 })).toBe(false);
    expect(canThumbnail({ ...gmailPdf, size: THUMBNAIL_MAX_BYTES })).toBe(true);
  });

  it('survives missing names and null input', () => {
    expect(attachmentExtension(null)).toBe('');
    expect(attachmentExtension({ filename: 'noextension' })).toBe('');
    expect(attachmentExtension({ filename: 'trailing.' })).toBe('');
    expect(attachmentKind(undefined)).toBe('generic');
    expect(canThumbnail(null)).toBe(false);
  });
});

describe('attachmentTypeLabel', () => {
  it('uses the extension when there is one', () => {
    expect(attachmentTypeLabel(gmailPdf)).toBe('PDF');
    expect(attachmentTypeLabel({ filename: 'dados.xlsx' })).toBe('XLSX');
  });

  it('falls back to the mime subtype when the name has no extension', () => {
    expect(attachmentTypeLabel({ filename: 'part1', contentType: 'image/png' })).toBe('PNG');
    expect(attachmentTypeLabel({ filename: 'part1' })).toBe('FILE');
  });
});

describe('filterDownloadableAttachments', () => {
  it('hides an inline signature logo', () => {
    expect(filterDownloadableAttachments([signatureLogo])).toEqual([]);
  });

  it('keeps a Gmail attachment that merely carries a Content-ID', () => {
    // The regression that broke Forward: a cid alone must never mean "inline".
    expect(filterDownloadableAttachments([gmailPdf])).toEqual([gmailPdf]);
  });

  it('keeps a cid image whose disposition is missing or explicit', () => {
    const noDisposition = { filename: 'a.png', contentType: 'image/png', contentId: '<x>' };
    const explicit = { ...noDisposition, disposition: 'attachment' };
    expect(filterDownloadableAttachments([noDisposition, explicit])).toEqual([
      noDisposition,
      explicit,
    ]);
  });

  it('keeps non-image parts even when inline', () => {
    const inlinePdf = { ...gmailPdf, disposition: 'inline' };
    expect(filterDownloadableAttachments([inlinePdf])).toEqual([inlinePdf]);
  });

  it('tolerates a missing list', () => {
    expect(filterDownloadableAttachments(null)).toEqual([]);
    expect(filterDownloadableAttachments(undefined)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats sizes the way the message strip already did', () => {
    expect(formatAttachmentSize(0)).toBe('');
    expect(formatAttachmentSize(undefined)).toBe('');
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(68111)).toBe('67 KB');
    expect(formatAttachmentSize(256490)).toBe('250 KB');
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('summarizes a set of files', () => {
    expect(describeAttachments([gmailPdf])).toBe('1 file · 250 KB');
    expect(describeAttachments([gmailPdf, signatureLogo])).toBe('2 files · 255 KB');
    expect(describeAttachments([])).toBe('');
    expect(describeAttachments(null)).toBe('');
  });

  it('omits the size when nothing reports one', () => {
    expect(describeAttachments([{ filename: 'a.txt' }])).toBe('1 file');
  });
});
