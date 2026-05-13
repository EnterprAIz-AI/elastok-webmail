export async function clearStorage(browser: WebdriverIO.Browser): Promise<void> {
  await browser.execute(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Origin may not be ready yet; navigation will retry.
    }
  });
}

export async function currentPath(browser: WebdriverIO.Browser): Promise<string> {
  return browser.execute(() => location.pathname) as Promise<string>;
}
