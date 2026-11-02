// e2e/validation/html-properties.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../demo/editor/src/htmlProperties';

const snapshot = (page: Page) => page.evaluate(() => window.htmlPropertiesFixture!.snapshot());
const layer = (page: Page, id: string) => page.locator(`.jt-layer-row[data-row-id="${id}"] .jt-layer-row__name`);
const undo = (page: Page) => page.getByRole('button', { name: 'Annuler', exact: true }).click();
const redo = (page: Page) => page.getByRole('button', { name: 'Rétablir', exact: true }).click();
async function seek(page: Page, frame: number): Promise<void> {
  await page.getByLabel('Image', { exact: true }).fill(String(frame));
  await page.getByRole('button', { name: 'Afficher l’image', exact: true }).click();
  await expect(page.locator('#frame-output')).toHaveAttribute('data-frame', String(frame));
}
async function selectPropertyFrame(page: Page, id: string, property: string, frame: number, additive = false): Promise<void> {
  if (!additive) await layer(page, id).click();
  await page.locator(`.jt-grid__row[data-layer-id="${id}"][data-property="${property}"]`).scrollIntoViewIfNeeded();
  const point = await page.evaluate(({ id, property, frame }) => window.htmlPropertiesFixture!.point(id, property, frame), { id, property, frame });
  if (additive) await page.keyboard.down('Control');
  await page.mouse.click(point.x, point.y);
  if (additive) await page.keyboard.up('Control');
}
function track(document: Awaited<ReturnType<typeof snapshot>>['timeline'], id: string, property: string) {
  const found = document.layers.find((entry) => entry.id === id);
  if (found?.type !== 'layer') throw new Error(`Missing demo layer: ${id}`);
  return found.propertyTimelines?.[property];
}
async function expectGroup(page: Page): Promise<void> {
  await expect(page.locator('#button-1')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('#button-2')).toHaveCSS('opacity', '0.8');
  await expect(page.locator('#button-3')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('#button-4')).toHaveCSS('opacity', '0.5');
}

test.describe('HTML property integration', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1250 });
    await page.goto('/html-properties.html');
    await page.waitForFunction(() => window.htmlPropertiesFixture?.ready);
    await page.getByRole('combobox', { name: 'Niveau de zoom', exact: true }).selectOption({ label: 'Ajuster à la fenêtre' });
    await expectGroup(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('html-properties.png'), fullPage: true });
    expect(errors).toEqual([]);
  });

  test('resolves all group members and inspects original CSS while previewing the specific override', async ({ page }) => {
    const before = await snapshot(page);
    for (const frame of [20, 49, 50, 100, 1]) {
      await seek(page, frame);
      await expectGroup(page);
    }
    await page.getByRole('button', { name: 'Inspecter le groupe', exact: true }).click();
    await expect(page.locator('#base-inspection')).toContainText('4 éléments · opacité d’origine : 100 %');
    await expect(page.getByRole('button', { name: 'Animer la marge commune', exact: true })).toBeDisabled();
    await expect(page.locator('#margin-info')).toHaveAttribute('title', /valeurs initiales différentes/);
    await expect(page.locator('#margin-reason')).toContainText('Attribuez un ID');
    await expect(page.locator('#button-2')).toHaveCSS('margin-top', '12px');
    await expect(page.locator('#button-1')).toHaveCSS('margin-top', '0px');
    await expectGroup(page);
    const after = await snapshot(page);
    expect(after.timeline).toEqual(before.timeline);
    expect(after.changes).toEqual([]);
    expect(track(after.timeline, 'specific', 'opacity')?.keys.map((key) => key.frame)).toEqual([50]);
  });

  test('F6 captures the resolved value, preserves the early override, and survives undo and reload', async ({ page }) => {
    await selectPropertyFrame(page, 'specific', 'opacity', 20);
    await page.keyboard.press('F6');
    await expect(page.locator('.jt-grid__row[data-layer-id="specific"][data-property="opacity"] [data-frame="20"]')).toBeVisible();
    const captured = await snapshot(page);
    expect(track(captured.timeline, 'specific', 'opacity')?.keys).toEqual([
      { frame: 20, value: { kind: 'number', value: .8 } }, { frame: 50, value: { kind: 'number', value: .8 } }
    ]);
    await seek(page, 1); await expectGroup(page);
    await undo(page);
    expect(track((await snapshot(page)).timeline, 'specific', 'opacity')?.keys.map((key) => key.frame)).toEqual([50]);
    await expectGroup(page); await redo(page); await expectGroup(page);
    await page.getByRole('button', { name: 'Mémoriser le projet', exact: true }).click();
    await undo(page);
    await page.getByRole('button', { name: 'Recharger le projet', exact: true }).click();
    expect(track((await snapshot(page)).timeline, 'specific', 'opacity')?.keys).toEqual(track(captured.timeline, 'specific', 'opacity')?.keys);
    await seek(page, 49); await expectGroup(page);
  });

  test('edits an explicit group value from a mixed inspector and restores the group through undo', async ({ page }) => {
    await selectPropertyFrame(page, 'buttons', 'opacity', 20);
    const before = await snapshot(page);
    const field = page.locator('.jt-properties-panel [data-property="opacity"] input');
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Saisissez une valeur');
    await field.fill('0.4');
    await field.press('Enter');
    await expect(page.locator('#button-1')).toHaveCSS('opacity', '0.4');
    await expect(page.locator('#button-3')).toHaveCSS('opacity', '0.4');
    await expect(page.locator('#button-4')).toHaveCSS('opacity', '0.4');
    const changed = await snapshot(page);
    expect(track(changed.timeline, 'buttons', 'opacity')?.keys).toEqual([
      { frame: 1, value: { kind: 'number', value: .5 } }, { frame: 20, value: { kind: 'number', value: .4 } }
    ]);
    expect(track(changed.timeline, 'specific', 'opacity')).toEqual(track(before.timeline, 'specific', 'opacity'));
    await undo(page);
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
    await expectGroup(page);
    await expect(field).toHaveValue('');
    await redo(page);
    expect((await snapshot(page)).timeline).toEqual(changed.timeline);
    await expect(page.locator('#button-1')).toHaveCSS('opacity', '0.4');
  });

  test('keeps integer CSS keys discrete and refuses MotionTween without changing history', async ({ page }) => {
    const before = await snapshot(page);
    const undoButton = page.getByRole('button', { name: 'Annuler', exact: true });
    await expect(undoButton).toBeDisabled();
    await selectPropertyFrame(page, 'transform', 'zIndex', 1);
    await selectPropertyFrame(page, 'transform', 'zIndex', 100, true);
    const tween = page.getByRole('button', { name: 'Créer une interpolation de mouvement', exact: true });
    await expect(tween).toHaveAttribute('aria-disabled', 'true');
    await expect(tween).toHaveAttribute('aria-description', /entier/);
    await tween.click({ force: true });
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
    expect((await snapshot(page)).changes).toEqual([]);
    await expect(undoButton).toBeDisabled();
    for (const frame of [1, 50, 99]) {
      await seek(page, frame);
      await expect(page.locator('#transform-box')).toHaveCSS('z-index', '1');
    }
    await seek(page, 100);
    await expect(page.locator('#transform-box')).toHaveCSS('z-index', '2');
    expect(track((await snapshot(page)).timeline, 'transform', 'zIndex')?.transitions).toBeUndefined();
  });

  test('edits independent gradient components and restores exact state through undo/redo', async ({ page }) => {
    const sourceGradient = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    await seek(page, 20);
    const before = await snapshot(page);
    const beforeGradient = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(beforeGradient).not.toBe(sourceGradient);
    await page.getByRole('button', { name: 'Afficher le point central', exact: true }).click();
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.5\) 50%/);
    await page.getByRole('button', { name: 'Point central à 25 %', exact: true }).click();
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.25\) 50%/);
    const changed = await snapshot(page);
    expect(track(changed.timeline, 'gradient', 'rightPosition')).toEqual(track(before.timeline, 'gradient', 'rightPosition'));
    expect(track(changed.timeline, 'gradient', 'gradientAngle')).toEqual(track(before.timeline, 'gradient', 'gradientAngle'));
    expect(changed.html.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'middle', 'right']);
    await undo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.5\) 50%/);
    await undo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', beforeGradient);
    await redo(page); await redo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.25\) 50%/);
    await seek(page, 19);
    await expect(page.locator('#gradient-box')).not.toHaveCSS('background-image', /rgba\(0, 255, 0,/);
    await seek(page, 20);
    await page.getByRole('button', { name: 'Point gauche violet', exact: true }).click();
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgb\(128, 0, 255\) 0%/);
    const colored = await snapshot(page);
    expect(track(colored.timeline, 'gradient', 'leftColor')?.keys.find((key) => key.frame === 20)?.value).toEqual({ kind: 'color', r: .5, g: 0, b: 1, a: 1 });
    await undo(page);
    expect(track((await snapshot(page)).timeline, 'gradient', 'leftColor')).toEqual(track(before.timeline, 'gradient', 'leftColor'));
  });

  test('keeps gradient stop identities when positions cross, tie, cancel and undo', async ({ page }) => {
    await seek(page, 20);
    await page.getByRole('button', { name: 'Afficher le point central', exact: true }).click();
    await selectPropertyFrame(page, 'gradient', 'rightPosition', 20);
    const before = await snapshot(page);
    const beforeGradient = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    const position = page.locator('.jt-properties-panel [data-property="rightPosition"] input');
    await expect(position).toHaveValue('100');
    await position.fill('25');
    await position.press('Escape');
    await expect(position).toHaveValue('100');
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', beforeGradient);

    await position.fill('25');
    await position.press('Enter');
    const crossedPattern = /rgb\(0, 0, 255\) 25%, rgba\(0, 255, 0, 0\.5\) 50%\)$/;
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', crossedPattern);
    const crossed = await snapshot(page);
    expect(track(crossed.timeline, 'gradient', 'rightPosition')?.keys).toEqual([
      { frame: 1, value: { kind: 'number', value: 100 } }, { frame: 20, value: { kind: 'number', value: 25 } }
    ]);
    for (const property of ['gradientAngle', 'leftColor', 'leftPresent', 'middlePresent', 'middleOpacity']) {
      expect(track(crossed.timeline, 'gradient', property)).toEqual(track(before.timeline, 'gradient', property));
    }
    expect(crossed.html).toEqual(before.html);
    expect(crossed.html.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'middle', 'right']);
    await undo(page);
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', beforeGradient);
    await redo(page);
    expect((await snapshot(page)).timeline).toEqual(crossed.timeline);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', crossedPattern);

    await position.fill('50');
    await position.press('Enter');
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.5\) 50%, rgb\(0, 0, 255\) 50%\)$/);
    expect((await snapshot(page)).html).toEqual(before.html);
    await undo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', crossedPattern);
  });

  test('renders a gradient MotionTween crossing deterministically when seeking in either direction', async ({ page }) => {
    await page.getByRole('button', { name: 'Afficher le point central', exact: true }).click();
    await selectPropertyFrame(page, 'gradient', 'rightPosition', 100);
    const position = page.locator('.jt-properties-panel [data-property="rightPosition"] input');
    await position.fill('25');
    await position.press('Enter');
    await selectPropertyFrame(page, 'gradient', 'rightPosition', 1);
    await selectPropertyFrame(page, 'gradient', 'rightPosition', 100, true);
    await page.getByRole('button', { name: 'Créer une interpolation de mouvement', exact: true }).click();
    const animated = await snapshot(page);
    expect(track(animated.timeline, 'gradient', 'rightPosition')?.transitions).toHaveLength(1);
    const backgrounds = new Map<number, string>();
    for (const frame of [66, 67, 68, 100, 68, 67, 66]) {
      await seek(page, frame);
      const background = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
      const blue = background.indexOf('rgb(0, 0, 255)');
      const green = background.indexOf('rgba(0, 255, 0, 0.5)');
      expect(blue).toBeGreaterThan(-1);
      expect(green).toBeGreaterThan(-1);
      expect(blue < green).toBe(frame > 67);
      if (backgrounds.has(frame)) expect(background).toBe(backgrounds.get(frame));
      backgrounds.set(frame, background);
    }
    expect((await snapshot(page)).timeline).toEqual(animated.timeline);
    expect((await snapshot(page)).html).toEqual(animated.html);
    await undo(page);
    expect(track((await snapshot(page)).timeline, 'gradient', 'rightPosition')?.transitions).toBeUndefined();
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', /rgba\(0, 255, 0, 0\.5\) 50%, rgb\(0, 0, 255\) 100%\)$/);
    await redo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', backgrounds.get(66)!);
  });

  test('cancels and persists explicit priority decisions independently from selection and temporal keys', async ({ page }) => {
    const initial = await snapshot(page);
    await expect(page.locator('#conflict-target')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Résoudre le conflit de priorité', exact: true }).click();
    await page.getByLabel('Règle à conserver', { exact: true }).selectOption('conflict-b');
    await page.getByRole('button', { name: 'Annuler le choix', exact: true }).click();
    expect((await snapshot(page)).html).toEqual(initial.html);
    expect((await snapshot(page)).timeline).toEqual(initial.timeline);
    await page.getByRole('button', { name: 'Résoudre le conflit de priorité', exact: true }).click();
    await page.getByLabel('Règle à conserver', { exact: true }).selectOption('conflict-b');
    await page.getByRole('button', { name: 'Appliquer cette priorité', exact: true }).click();
    await expect(page.locator('#conflict-target')).toHaveCSS('opacity', '0.7');
    await layer(page, 'conflict-a').click(); await seek(page, 80);
    await expect(page.locator('#conflict-target')).toHaveCSS('opacity', '0.7');
    expect((await snapshot(page)).timeline).toEqual(initial.timeline);
    await page.getByRole('button', { name: 'Annuler la décision de priorité', exact: true }).click();
    await expect(page.locator('#conflict-target')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Rétablir la décision de priorité', exact: true }).click();
    await page.getByRole('button', { name: 'Mémoriser le projet', exact: true }).click();
    await page.getByRole('button', { name: 'Annuler la décision de priorité', exact: true }).click();
    await page.getByRole('button', { name: 'Recharger le projet', exact: true }).click();
    await expect(page.locator('#conflict-target')).toHaveCSS('opacity', '0.7');
    const reloaded = await snapshot(page);
    expect(reloaded.html.resolutions).toHaveLength(1);
    expect(reloaded.diagnostics.filter((entry) => entry.code === 'priority-conflict')).toEqual([]);
    expect(reloaded.timeline).toEqual(initial.timeline);
  });

  test('removes a gradient stop using the other presence tracks at that frame and supports undo/redo', async ({ page }) => {
    await seek(page, 20);
    await page.getByRole('button', { name: 'Afficher le point central', exact: true }).click();
    await seek(page, 30);
    const before = await snapshot(page);
    const threeStops = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(threeStops.match(/rgba?\(/g)).toHaveLength(3);
    await page.getByRole('button', { name: 'Retirer le point gauche', exact: true }).click();
    const twoStops = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(twoStops.match(/rgba?\(/g)).toHaveLength(2);
    expect(twoStops).toContain('rgba(0, 255, 0, 0.5) 50%');
    expect(twoStops).toContain('rgb(0, 0, 255) 100%');
    const changed = await snapshot(page);
    expect(track(changed.timeline, 'gradient', 'leftPresent')?.keys).toEqual([
      { frame: 1, value: { kind: 'boolean', value: true } }, { frame: 30, value: { kind: 'boolean', value: false } }
    ]);
    expect(track(changed.timeline, 'gradient', 'middlePresent')).toEqual(track(before.timeline, 'gradient', 'middlePresent'));
    expect(changed.html.gradients).toEqual(before.html.gradients);
    await undo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', threeStops);
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
    await redo(page);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', twoStops);
    await seek(page, 29);
    const restoredEarlier = await page.locator('#gradient-box').evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(restoredEarlier.match(/rgba?\(/g)).toHaveLength(3);
    await seek(page, 30);
    await expect(page.locator('#gradient-box')).toHaveCSS('background-image', twoStops);
  });

  test('preserves the source rotation while editing X and restores source styles on teardown', async ({ page }) => {
    await seek(page, 30);
    await page.getByLabel('Position X en pixels', { exact: true }).fill('40');
    await page.getByRole('button', { name: 'Appliquer la position X', exact: true }).click();
    const matrix = () => page.locator('#transform-box').evaluate((element) => {
      const value = new DOMMatrix(getComputedStyle(element).transform);
      return { x: value.e, y: value.f, rotation: Math.atan2(value.b, value.a) * 180 / Math.PI };
    });
    await expect.poll(async () => (await matrix()).x).toBe(40);
    expect((await matrix()).y).toBe(15);
    expect((await matrix()).rotation).toBeCloseTo(30, 3);
    await undo(page);
    await expect.poll(async () => (await matrix()).x).toBe(12);
    await redo(page);
    await expect.poll(async () => (await matrix()).x).toBe(40);
    await page.getByRole('button', { name: 'Terminer l’aperçu et restaurer les styles', exact: true }).click();
    await expect(page.locator('#status')).toContainText('styles d’origine sont restaurés');
    for (const id of ['button-1', 'button-2', 'button-3', 'button-4', 'conflict-target']) await expect(page.locator(`#${id}`)).toHaveCSS('opacity', '1');
    expect((await matrix()).x).toBe(12);
    expect((await matrix()).y).toBe(15);
    expect((await matrix()).rotation).toBeCloseTo(30, 3);
    await expect(page.locator('#button-2')).toHaveCSS('margin-top', '12px');
  });
});
