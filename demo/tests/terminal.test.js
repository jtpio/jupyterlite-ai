import { test, expect } from '@playwright/test';

const TERMINAL_SETTINGS = '@jupyterlab/terminal-extension:plugin';

/**
 * Store a JupyterLite user setting so it applies on the next page load.
 */
async function saveSetting(page, id, value) {
  await page.evaluate(
    async ([id, raw]) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('JupyterLite Storage - /');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put(raw, id);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    [id, JSON.stringify(value)]
  );
}

/**
 * Text of the terminal screen. The canvas renderer holds no DOM text, so the
 * xterm screen reader mode is enabled to expose the rows as text.
 */
async function terminalText(page) {
  return page.locator('.xterm-accessibility-tree').innerText();
}

test('jupyternaut runs in the JupyterLite terminal', async ({ page }) => {
  await page.goto('/lab/index.html');
  await expect(page.locator('.jp-LabShell')).toBeVisible({ timeout: 60_000 });
  await saveSetting(page, TERMINAL_SETTINGS, { screenReaderMode: true });
  await page.reload();
  await expect(page.locator('.jp-LabShell')).toBeVisible({ timeout: 60_000 });

  await page
    .locator('.jp-LauncherCard[title="Start a new terminal session"]')
    .click();
  const input = page.locator('textarea.xterm-helper-textarea');
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => terminalText(page), { timeout: 60_000 })
    .toContain('js-shell');

  await input.pressSequentially('jupyternaut');
  await input.press('Enter');
  await expect
    .poll(() => terminalText(page), { timeout: 30_000 })
    .toContain('Welcome to Jupyternaut!');

  await input.pressSequentially('/help');
  await input.press('Enter');
  await expect
    .poll(() => terminalText(page), { timeout: 10_000 })
    .toContain('/model');

  await input.pressSequentially('/exit');
  await input.press('Enter');
  await expect
    .poll(() => terminalText(page), { timeout: 10_000 })
    .not.toContain('Ask anything');
});
