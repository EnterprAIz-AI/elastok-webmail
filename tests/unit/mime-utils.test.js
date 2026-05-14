import { describe, it, expect } from 'vitest';
import { decodeMimeHeader } from '../../src/utils/mime-utils.js';

describe('decodeMimeHeader', () => {
  it('returns the original value for non-string input', () => {
    expect(decodeMimeHeader(null)).toBe('');
    expect(decodeMimeHeader(undefined)).toBe('');
    expect(decodeMimeHeader('')).toBe('');
  });

  it('passes through plain ASCII unchanged', () => {
    expect(decodeMimeHeader('Hello world')).toBe('Hello world');
  });

  it('decodes Q-encoded UTF-8 tokens', () => {
    expect(decodeMimeHeader('=?UTF-8?Q?Foobar_H=C3=A4gerstr=C3=B6m?=')).toBe('Foobar Hägerström');
  });

  it('decodes B-encoded UTF-8 tokens', () => {
    // "Hello" → base64 "SGVsbG8="
    expect(decodeMimeHeader('=?UTF-8?B?SGVsbG8=?=')).toBe('Hello');
  });

  it('preserves an empty-payload encoded-word rather than dropping it', () => {
    // Previously `=?utf-8?B??=` collapsed silently to '' and erased the
    // entire header. Should now surface the raw token so the field stays
    // visible and we have telemetry instead of silent data loss.
    expect(decodeMimeHeader('=?utf-8?B??=')).toBe('=?utf-8?B??=');
    expect(decodeMimeHeader('=?UTF-8?Q??=')).toBe('=?UTF-8?Q??=');
  });

  it('does not erase surrounding plain text when an encoded-word is empty', () => {
    expect(decodeMimeHeader('Hi =?utf-8?B??= friend')).toBe('Hi =?utf-8?B??= friend');
  });
});
