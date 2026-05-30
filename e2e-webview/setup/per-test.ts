import { afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { currentBrowser } from '../support/browser.js';

const SCREENSHOT_DIR = path.resolve('./screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

afterEach(async (ctx) => {
  if (ctx.task.result?.state !== 'fail') return;
  const browser = currentBrowser();
  if (!browser) return;
  const safe = ctx.task.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
  try {
    await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${safe}-${Date.now()}.png`));
  } catch {
    // Session may already be closed; don't mask the original failure.
  }
  // TEMPORARY: on ANY test failure (not just the readiness-gate timeout that
  // dumpDemoProbes covers), print the db-engine mode + UA + breadcrumbs so the
  // Linux db-worker fallback can be diagnosed (e.g. did shouldUseMainThreadDb()
  // engage? is the main-thread db.messages write persisting?).
  try {
    const diag = await browser.execute(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        dbMode: w.__feDbMode ?? 'unset',
        ua: navigator.userAgent,
        hasTauri:
          typeof (w as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined',
        unreadRows: document.querySelectorAll('[data-testid="message-row"][data-unread="true"]')
          .length,
        messageRows: document.querySelectorAll('[data-testid="message-row"]').length,
        trace: ((w.__feTrace as string[]) || []).slice(-40),
        console: ((w.__e2eConsole as string[]) || []).slice(-40),
      };
    });
    console.error(
      `\n[afterEach] FAILURE diagnostics for "${ctx.task.name}":\n${JSON.stringify(diag, null, 2)}\n`,
    );
  } catch {
    // best-effort
  }
});
