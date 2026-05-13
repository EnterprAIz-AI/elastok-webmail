import { currentPath } from './state.js';

export async function activateDemo(browser: WebdriverIO.Browser): Promise<void> {
  const tryDemo = await browser.$('[data-testid="try-demo-btn"]');
  await tryDemo.waitForClickable({ timeout: 10_000 });
  await tryDemo.click();
  await browser.waitUntil(async () => (await currentPath(browser)).startsWith('/mailbox'), {
    timeout: 15_000,
    timeoutMsg: 'expected navigation to /mailbox after Try Demo',
  });
  const shell = await browser.$('[data-testid="mailbox-shell"]');
  await shell.waitForDisplayed({ timeout: 15_000 });
}
