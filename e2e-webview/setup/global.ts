import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const READY_TIMEOUT_MS = 30_000;
// The intermediary prints this marker to stdout once its listener is bound.
// We can't HTTP-probe /status because the intermediary forwards /status to
// the in-app server on :4445, which isn't spawned until a per-spec
// `webdriverio.remote()` call delivers the binary-path capability — so any
// pre-session HTTP probe fails by design.
const READY_MARKER = /tauri-webdriver running on port/i;

const REPORTS_DIR = path.resolve('./reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

export default async function globalSetup() {
  const stdoutPath = path.join(REPORTS_DIR, 'tauri-webdriver.stdout.log');
  const stderrPath = path.join(REPORTS_DIR, 'tauri-webdriver.stderr.log');
  const stdoutLog = fs.createWriteStream(stdoutPath);
  const stderrLog = fs.createWriteStream(stderrPath);

  const driver: ChildProcess = spawn('tauri-webdriver', [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `tauri-webdriver did not print readiness marker within ${READY_TIMEOUT_MS}ms. ` +
            `See ${path.relative(process.cwd(), stderrPath)} for driver output.`,
        ),
      );
    }, READY_TIMEOUT_MS);

    let stdoutBuf = '';
    driver.stdout?.on('data', (chunk: Buffer) => {
      stdoutLog.write(chunk);
      process.stdout.write(chunk);
      stdoutBuf += chunk.toString('utf8');
      if (READY_MARKER.test(stdoutBuf)) {
        clearTimeout(timer);
        resolve();
      }
    });
    driver.stderr?.on('data', (chunk: Buffer) => {
      stderrLog.write(chunk);
      process.stderr.write(chunk);
    });

    driver.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`tauri-webdriver failed to spawn: ${(err as Error).message}`));
    });
    driver.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `tauri-webdriver exited during startup (code=${code}, signal=${signal}). ` +
            `See ${path.relative(process.cwd(), stderrPath)} for driver output.`,
        ),
      );
    });
  });

  try {
    await ready;
  } catch (err) {
    if (driver.exitCode === null && !driver.killed) driver.kill('SIGTERM');
    stdoutLog.end();
    stderrLog.end();
    throw err;
  }

  return async () => {
    if (driver.exitCode === null && !driver.killed) driver.kill('SIGTERM');
    stdoutLog.end();
    stderrLog.end();
  };
}
