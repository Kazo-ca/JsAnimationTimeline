// e2e/validation/spatial-projection.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ISpatialSceneSnapshot } from '../../demo/editor/src/spatialProjectionScene';
import type {} from '../../demo/editor/src/spatialProjection';

const snapshot = (page: Page) => page.evaluate(() => window.spatialProjectionFixture!.snapshot());
async function seek(page: Page, frame: number) {
  await page.getByLabel('Image', { exact: true }).fill(String(frame));
  await page.getByRole('button', { name: 'Afficher cette image', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).frame).toBe(frame);
  return snapshot(page);
}
async function scenario(page: Page, name: string) {
  await page.getByLabel('Scénario', { exact: true }).selectOption(name);
  await page.getByRole('button', { name: 'Charger et comparer', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Comparaison prête. Les clés sources sont conservées.');
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true);
}
function sameGeometry(actual: ISpatialSceneSnapshot | undefined, expected: ISpatialSceneSnapshot | undefined): void {
  expect(actual).toBeDefined(); expect(expected).toBeDefined();
  if (actual === undefined || expected === undefined) throw new Error('Missing spatial comparison scene.');
  for (let index = 0; index < expected.matrix.length; index++) expect(actual.matrix[index]).toBeCloseTo(expected.matrix[index], 3);
  for (let index = 0; index < expected.origin.length; index++) expect(actual.origin[index]).toBeCloseTo(expected.origin[index], 3);
  for (let corner = 0; corner < expected.corners.length; corner++) {
    for (let axis = 0; axis < 3; axis++) expect(actual.corners[corner][axis]).toBeCloseTo(expected.corners[corner][axis], 2);
  }
}
test.describe('Shared spatial projection through the real browser and exported players', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto('/spatial-projection.html');
    await expect(page.locator('#status')).toHaveText('Comparaison prête. Les clés sources sont conservées.');
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('spatial-projection.png'), fullPage: true });
    await info.attach('spatial-projection-state', { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });

  test('rotates the retained source translation continuously instead of interpolating endpoint matrices', async ({ page }) => {
    const initial = await snapshot(page);
    expect(initial.cssRefused).toBe(false);
    for (const frame of [1, 25.5, 51, 77.25, 101]) {
      const state = await seek(page, frame);
      const angle = (frame - 1) / 100 * Math.PI / 2;
      expect(state.preview?.matrix[4]).toBeCloseTo(Math.cos(angle) * 100, 3);
      expect(state.preview?.matrix[5]).toBeCloseTo(Math.sin(angle) * 100, 3);
      sameGeometry(state.cssScene, state.preview);
      if (Number.isInteger(frame)) { sameGeometry(state.json, state.preview); sameGeometry(state.javascript, state.preview); }
      else {
        const sampledAngle = (Math.floor(frame) - 1) / 100 * Math.PI / 2;
        expect(state.json?.matrix[4]).toBeCloseTo(Math.cos(sampledAngle) * 100, 3);
        sameGeometry(state.javascript, state.json);
      }
      expect(state.editable).toEqual(initial.editable);
    }
  });

  test('combines independent pivots and preserves the third source coordinate', async ({ page }) => {
    await scenario(page, 'pivots');
    for (const frame of [1, 44.25, 60, 101]) {
      const state = await seek(page, frame); const t = (frame - 1) / 100;
      expect(state.preview?.origin[0]).toBeCloseTo((10 + 60 * t) * 2, 3);
      expect(state.preview?.origin[1]).toBeCloseTo((20 + 60 * t) * .8, 3);
      expect(state.preview?.origin[2]).toBe(7);
      sameGeometry(state.cssScene, state.preview);
      if (Number.isInteger(frame)) { sameGeometry(state.json, state.preview); sameGeometry(state.javascript, state.preview); }
    }
  });

  test('retains relative source, font and viewport units after dimensions change', async ({ page }) => {
    await scenario(page, 'relative');
    for (const resized of [false, true]) {
      if (resized) {
        await page.getByRole('button', { name: 'Agrandir les dimensions et la police', exact: true }).click();
        await page.setViewportSize({ width: 1200, height: 1050 });
      }
      const state = await seek(page, 51); const preview = state.preview;
      expect(preview).toBeDefined(); if (preview === undefined) throw new Error('Missing preview.');
      expect(preview.declaration).toContain('2em'); expect(preview.declaration).toContain('2vw');
      expect(preview.declaration).toContain('translateX(10%)');
      expect(preview.matrix[4]).toBeCloseTo(2 * preview.font + .1 * preview.width / Math.sqrt(2), 3);
      expect(preview.matrix[5]).toBeCloseTo(.02 * preview.viewport + .1 * preview.width / Math.sqrt(2), 3);
      sameGeometry(state.cssScene, preview); sameGeometry(state.json, preview); sameGeometry(state.javascript, preview);
    }
  });

  test('preserves zero and negative scale without clamping', async ({ page }) => {
    await scenario(page, 'negative');
    for (const frame of [26.25, 51, 76, 101]) {
      const state = await seek(page, frame); const scale = 1 - 2 * (frame - 1) / 100;
      expect(state.cssRefused).toBe(false); expect(state.preview?.matrix[0]).toBeCloseTo(scale, 5);
      expect(state.preview?.matrix[4]).toBeCloseTo(100 * scale, 3);
      sameGeometry(state.cssScene, state.preview);
      if (Number.isInteger(frame)) { sameGeometry(state.json, state.preview); sameGeometry(state.javascript, state.preview); }
    }
  });

  test('dates a held source change and refuses to disguise it as continuously interpolated CSS', async ({ page }) => {
    await scenario(page, 'source');
    const initial = await snapshot(page);
    expect(initial.cssRefused).toBe(true); expect(initial.css).toBe('');
    await expect(page.locator('#css-status')).toContainText('Utilisez le JSON ou le JavaScript');
    for (const frame of [1, 50, 51, 70]) {
      const state = await seek(page, frame); const source = frame < 51 ? 100 : 200;
      expect(state.preview?.matrix[4]).toBeCloseTo(source * Math.cos((frame - 1) / 100 * Math.PI / 2), 3);
      sameGeometry(state.json, state.preview); sameGeometry(state.javascript, state.preview);
      expect(state.editable).toEqual(initial.editable);
    }
  });

  test('keeps independent curves in JSON and JavaScript when one CSS declaration cannot represent them', async ({ page }) => {
    await scenario(page, 'incompatible');
    expect((await snapshot(page)).cssRefused).toBe(true);
    expect((await snapshot(page)).css).toBe('');
    for (const frame of [20, 51, 80]) {
      const state = await seek(page, frame); sameGeometry(state.json, state.preview); sameGeometry(state.javascript, state.preview);
    }
  });

  test('restores source transforms and keeps the comparison usable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await seek(page, 51);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'Restaurer les styles sources', exact: true }).click();
    const state = await snapshot(page); expect(state.restored).toBe(true);
    for (const scene of [state.preview, state.cssScene, state.json, state.javascript]) {
      expect(scene?.matrix).toEqual([1, 0, 0, 1, 100, 0]); expect(scene?.origin).toEqual([20, 16, 7]);
    }
  });

  for (const source of ['inline', 'stylesheet']) {
    test(`refuses ${source} group sources which coincide only before resizing`, async ({ page }) => {
      await page.getByLabel('Origine des déclarations', { exact: true }).selectOption(source);
      await page.getByRole('button', { name: 'Vérifier le groupe et redimensionner', exact: true }).click();
      const result = (await snapshot(page)).group;
      expect(result?.initial).toEqual(['matrix(1, 0, 0, 1, 100, 0)', 'matrix(1, 0, 0, 1, 100, 0)']);
      expect(result?.editable).toBe(false); expect(result?.diagnostics.length).toBeGreaterThan(0);
      expect(result?.rendered).toEqual(result?.initial);
      expect(result?.resized).toEqual(['matrix(1, 0, 0, 1, 150, 0)', 'matrix(1, 0, 0, 1, 100, 0)']);
      await expect(page.locator('#group-status')).toContainText('Groupe refusé');
    });
  }
});
