import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newBrowser, closeBrowser } from '../support/browser.js';
import { resolveAppBinary } from '../support/platform.js';
import { openApp } from '../support/app.js';
import { clearStorage } from '../support/state.js';
import { activateDemo } from '../support/demo.js';

describe('folders and messages', () => {
  let browser: WebdriverIO.Browser;

  beforeAll(async () => {
    browser = await newBrowser({
      hostname: '127.0.0.1',
      port: 4444,
      logLevel: 'warn',
      capabilities: {
        'tauri:options': { application: resolveAppBinary() },
      } as WebdriverIO.Capabilities,
    });
  }, 30_000);

  afterAll(closeBrowser);

  beforeEach(async () => {
    await openApp(browser);
    await clearStorage(browser);
    await openApp(browser);
    await activateDemo(browser);
  });

  async function $$count(selector: string): Promise<number> {
    const els = await browser.$$(selector);
    return els.length;
  }

  it('renders a non-empty folder list from demo data', async () => {
    const list = await browser.$('[data-testid="folder-list"]');
    await list.waitForDisplayed({ timeout: 15_000 });
    expect(await $$count('[data-testid="folder-item"]')).toBeGreaterThan(0);
  });

  it('exposes an INBOX folder', async () => {
    const inbox = await browser.$(
      '[data-testid="folder-item"][data-folder-path="INBOX" i], [data-testid="folder-item"][data-folder-path="Inbox" i]',
    );
    await inbox.waitForExist({ timeout: 15_000 });
    expect(await inbox.isExisting()).toBe(true);
  });

  it('renders message rows for the INBOX folder', async () => {
    await browser.$('[data-testid="folder-list"]').waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(async () => (await $$count('[data-testid="message-row"]')) > 0, {
      timeout: 15_000,
      timeoutMsg: 'no message rows rendered after demo activation',
    });
    expect(await $$count('[data-testid="message-row"]')).toBeGreaterThan(0);
  });

  it('opens a message into the reader when a row is clicked', async () => {
    await browser.waitUntil(async () => (await $$count('[data-testid="message-row"]')) > 0, {
      timeout: 15_000,
    });
    const rows = await browser.$$('[data-testid="message-row"]');
    await rows[0].click();
    // Productivity layout (default) overlays the reader inside the message pane;
    // classic layout uses [data-testid="reader-pane"]. Either path is fine —
    // success is the URL pivoting to a message detail or the reader showing.
    await browser.waitUntil(
      async () => {
        const url = (await browser.execute(() => location.pathname + location.hash)) as string;
        const reader = await browser.$('[data-testid="reader-pane"]');
        return url.includes('/mailbox/') || (await reader.isExisting());
      },
      { timeout: 10_000, timeoutMsg: 'reader did not open after clicking a message row' },
    );
  });
});
