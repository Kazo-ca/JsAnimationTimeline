// e2e/validation/playback-exports.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type {} from '../../demo/editor/src/playbackExports';
import type { IHtmlPlaybackPlayer, IHtmlPlaybackPlayerOptions } from '../../packages/runtime/src/playback/html/types';

const snapshot = (page: Page) => page.evaluate(() => window.playbackExportsFixture!.snapshot());
async function seek(page: Page, frame: number): Promise<void> {
  await page.getByLabel('Image', { exact: true }).fill(String(frame));
  await page.getByRole('button', { name: 'Afficher cette image', exact: true }).click();
  await expect(page.locator('#frame-output')).toHaveAttribute('data-frame', String(Math.floor(frame)));
}

async function compareScenes(page: Page): Promise<void> {
  const current = await snapshot(page);
  expect(current.json).toEqual(current.source);
  expect(current.javascript).toEqual(current.source);
}

test.describe('portable frame-sampled playback exports', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/playback-exports.html');
    await expect(page.getByRole('heading', { name: 'Une animation. Trois lectures.' })).toBeVisible();
    await page.getByRole('button', { name: 'Compiler et charger les exports', exact: true }).click();
    await expect(page.locator('#export-status')).toHaveText(/Exports chargés/);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('playback-exports.png'), fullPage: true });
    expect(errors).toEqual([]);
  });

  test('roundtrips snapshots and standalone JavaScript with direct and backward seeks', async ({ page }) => {
    const before = await snapshot(page);
    for (const frame of [100, 1, 50, 20, 49, 75, 30]) {
      await seek(page, frame);
      await compareScenes(page);
      const current = await snapshot(page);
      expect(current.source.buttons).toEqual(['0.5', '0.8', '0.5', '0.5']);
      expect(current.editable).toBe(before.editable);
      expect(current.genericFrame).toEqual(current.genericSource);
    }
    await page.getByRole('button', { name: 'Relire le JSON HTML', exact: true }).click();
    await expect(page.locator('#export-status')).toContainText('JSON relu');
    await compareScenes(page);
    expect((await snapshot(page)).editable).toBe(before.editable);
  });

  test('preserves crossing gradient stops in JSON and an actually imported standalone module', async ({ page }) => {
    const before = await snapshot(page);
    const gradients = new Map<number, string>();
    for (const frame of [49, 50, 51, 70, 51, 50, 49]) {
      await seek(page, frame);
      await compareScenes(page);
      const current = await snapshot(page);
      const blue = current.source.gradient.indexOf('rgb(0, 0, 255)');
      const green = current.source.gradient.indexOf('rgba(0, 255, 0,');
      expect(blue).toBeGreaterThan(-1);
      expect(green).toBeGreaterThan(-1);
      expect(blue < green).toBe(frame > 50);
      if (gradients.has(frame)) expect(current.source.gradient).toBe(gradients.get(frame));
      gradients.set(frame, current.source.gradient);
      expect(current.editable).toBe(before.editable);
      expect(current.javascriptRequests).toEqual([]);
    }
    await page.getByRole('button', { name: 'Relire le JSON HTML', exact: true }).click();
    await expect(page.locator('#export-status')).toContainText('JSON relu');
    await seek(page, 51);
    await compareScenes(page);
    expect((await snapshot(page)).source.gradient).toBe(gradients.get(51));
  });

  test('downloads actual data and a dependency-free module preserving hostile names as data', async ({ page }) => {
    const downloadJson = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le JSON HTML', exact: true }).click();
    const jsonDownload = await downloadJson;
    expect(jsonDownload.suggestedFilename()).toBe('timeline-html-playback.json');
    const jsonPath = await jsonDownload.path();
    if (jsonPath === null) throw new Error('JSON download unavailable.');
    const jsonData = JSON.parse(await readFile(jsonPath, 'utf8')) as { sampling: string; frames: Record<string, unknown> };
    expect(jsonData.sampling).toBe('frames');
    expect(Object.keys(jsonData.frames)).toHaveLength(100);
    const downloadJs = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le JavaScript', exact: true }).click();
    const jsDownload = await downloadJs;
    expect(jsDownload.suggestedFilename()).toBe('timeline-playback.mjs');
    const jsPath = await jsDownload.path();
    if (jsPath === null) throw new Error('JavaScript download unavailable.');
    const current = await snapshot(page);
    expect(await readFile(jsPath, 'utf8')).toBe(current.moduleSource);
    expect(current.moduleSource).not.toMatch(/\bimport\s*(?:[({*]|["'])/);
    expect(current.moduleSource).not.toContain('</script>');
    expect(current.moduleSource).not.toContain('new Function');
    expect(current.moduleSource).not.toMatch(/\beval\s*\(/);
    expect(current.htmlSourceObjects).toEqual(['buttons', 'specific', 'transform', 'gradient']);
    expect(current.javascriptRequests).toEqual([]);
    expect(current.injected).toBe(false);
    await expect(page.frameLocator('#javascript-frame').locator('script[src]')).toHaveCount(1);
  });

  test('uses explicit frame sampling, plays and pauses, and restores only owned declarations', async ({ page }) => {
    await seek(page, 20.75);
    await compareScenes(page);
    await expect(page.locator('#sampling-note')).toContainText('image entière');
    await page.getByRole('button', { name: 'Lire les exports', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    await expect.poll(async () => (await snapshot(page)).frame).toBeGreaterThan(20);
    await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).playing).toBe(false);
    await seek(page, 100);
    await page.getByRole('button', { name: 'Restaurer les styles', exact: true }).click();
    await expect(page.locator('#export-status')).toContainText('Styles d’origine restaurés');
    const restored = await snapshot(page);
    expect(restored.source.buttons).toEqual(['1', '1', '1', '1']);
    expect(restored.json).toEqual(restored.source);
    expect(restored.javascript).toEqual(restored.source);
    expect(restored.source.outline).toBe('3px');
  });

  test('the built standalone module cancels a scheduled frame when changing speed reaches the end', async ({ page }) => {
    const scheduling = await page.evaluate(async () => {
      const moduleSource = window.playbackExportsFixture!.snapshot().moduleSource;
      const sourceRoot = document.querySelector<HTMLIFrameElement>('#javascript-frame')!.contentDocument!.querySelector('.export-scene')!;
      const root = document.importNode(sourceRoot, true);
      const url = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
      try {
        const module = await import(url) as { createPlayer(options: IHtmlPlaybackPlayerOptions): IHtmlPlaybackPlayer };
        let now = 0; let nextHandle = 0;
        const callbacks = new Map<number, () => void>();
        const clock = { now: () => now,
          requestFrame: (callback: () => void) => { callbacks.set(++nextHandle, callback); return nextHandle; },
          cancelFrame: (handle: number) => { callbacks.delete(handle); }
        };
        const player = module.createPlayer({ root, clock });
        try {
          player.play(); const initial = callbacks.size;
          now = 10_000; player.setSpeed(2);
          const ended = { pending: callbacks.size, playing: player.playing, frame: player.currentFrame };
          player.play(); player.play(); const restarted = { pending: callbacks.size, frame: player.currentFrame };
          player.destroy(); player.destroy();
          return { initial, ended, restarted, destroyed: callbacks.size };
        } finally { player.destroy(); }
      } finally { URL.revokeObjectURL(url); }
    });
    expect(scheduling).toEqual({ initial: 1, ended: { pending: 0, playing: false, frame: 100 },
      restarted: { pending: 1, frame: 1 }, destroyed: 0 });
  });

  test('refuses unresolved overlaps without changing the editable animation or loaded exports', async ({ page }) => {
    await seek(page, 75);
    const before = await snapshot(page);
    await page.getByRole('button', { name: 'Tester un conflit non résolu', exact: true }).click();
    await expect(page.locator('#refusal-status')).toContainText('Export refusé');
    const after = await snapshot(page);
    expect(after.editable).toBe(before.editable);
    expect(after.source).toEqual(before.source);
    expect(after.json).toEqual(before.json);
    expect(after.javascript).toEqual(before.javascript);
  });

  for (const width of [320, 768, 1440]) test(`keeps export controls and scenes usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: 'Télécharger le JavaScript', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await seek(page, 49);
    await compareScenes(page);
  });
});
