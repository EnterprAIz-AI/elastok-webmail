import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newBrowser, closeBrowser } from '../support/browser.js';
import { resolveAppBinary } from '../support/platform.js';
import { openApp } from '../support/app.js';
import { clearStorage } from '../support/state.js';
import { activateDemo } from '../support/demo.js';

describe('compose modal', () => {
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

  it('is not visible by default', async () => {
    const modal = await browser.$('[data-testid="compose-modal"]');
    expect(await modal.isExisting()).toBe(false);
  });

  it('opens when the Compose button is clicked', async () => {
    const button = await browser.$('[data-testid="compose-button"]');
    await button.waitForClickable({ timeout: 15_000 });
    await button.click();
    const modal = await browser.$('[data-testid="compose-modal"]');
    await modal.waitForDisplayed({ timeout: 10_000 });
    expect(await modal.isDisplayed()).toBe(true);
  });
});
