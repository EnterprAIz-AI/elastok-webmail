import { describe, it, expect, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../../src/utils/remote.js', () => ({ Remote: { request: vi.fn() } }));
vi.mock('../../src/utils/storage.js', () => ({ Local: { get: vi.fn(() => null) } }));
vi.mock('../../src/utils/db', () => ({ db: { folders: { where: vi.fn() } } }));
vi.mock('../../src/stores/folderStore.ts', () => ({ folders: writable([]) }));
vi.mock('../../src/utils/logger.ts', () => ({ warn: vi.fn() }));
vi.mock('../../src/utils/sent-folder.js', () => ({
  resolveSentFolder: vi.fn(() => 'RESOLVED_FALLBACK'),
}));

import { buildSentCopyPayload } from '../../src/utils/sent-copy.js';
import { resolveSentFolder } from '../../src/utils/sent-folder.js';

describe('buildSentCopyPayload', () => {
  const baseEmail = {
    from: 'me@example.com',
    to: ['you@example.com'],
    subject: 'Hi',
    html: '<p>Body</p>',
    text: 'Body',
  };

  it('uses sentFolderOverride and skips folder resolution when provided', () => {
    const payload = buildSentCopyPayload(baseEmail, 'me@example.com', null, 'Custom/Sent');
    expect(payload.folder).toBe('Custom/Sent');
    expect(resolveSentFolder).not.toHaveBeenCalled();
  });

  it('falls back to resolveSentFolder when no override is given', () => {
    const payload = buildSentCopyPayload(baseEmail, 'me@example.com', null, null);
    expect(payload.folder).toBe('RESOLVED_FALLBACK');
    expect(resolveSentFolder).toHaveBeenCalled();
  });

  it('carries attachments through to the sent copy', () => {
    const attachments = [
      {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
        content: 'base64data',
        encoding: 'base64',
      },
    ];
    const payload = buildSentCopyPayload(
      { ...baseEmail, attachments, has_attachment: true },
      'me@example.com',
      null,
      'Sent',
    );
    expect(payload.attachments).toEqual(attachments);
    expect(payload.has_attachment).toBe(true);
  });

  it('defaults attachments to an empty array and has_attachment to false', () => {
    const payload = buildSentCopyPayload(baseEmail, 'me@example.com', null, 'Sent');
    expect(payload.attachments).toEqual([]);
    expect(payload.has_attachment).toBe(false);
  });
});
