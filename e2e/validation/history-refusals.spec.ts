// e2e/validation/history-refusals.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../demo/editor/src/historyRefusals';

const snapshot = (page: Page) => page.evaluate(() => window.historyRefusalsFixture!.snapshot());
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
function stableState(state: Snapshot) {
  return { timeline: state.timeline, style: state.style, opacity: state.opacity, sourceStyle: state.sourceStyle,
    canUndo: state.canUndo, canRedo: state.canRedo, journal: state.journal, fault: state.fault, successEvents: state.successEvents };
}

test.describe('History refusal feedback with prepared host rendering', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/history-refusals.html');
    await page.waitForFunction(() => window.historyRefusalsFixture?.ready);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('history-refusals.png'), fullPage: true });
    if (await page.evaluate(() => Boolean(window.historyRefusalsFixture))) {
      await info.attach('history-refusal-state', { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });

  test('reports the exact undo reason once and preserves the preview and history until retry', async ({ page }) => {
    await click(page, 'Appliquer une opacité de 75 %');
    await expect(page.locator('#opacity-output')).toHaveText('75 %');
    await page.getByLabel('Refuser l’annulation').check();
    const before = await snapshot(page);
    await click(page, 'Annuler');
    const refused = await snapshot(page);
    await expect(page.locator('#status')).toHaveText('Permission undo refusée');
    expect(refused.accepted).toBe(false);
    expect(refused.refusals).toEqual([{ reason: 'Permission undo refusée', commandLabel: 'Modifier l’opacité', state: {
      timeline: before.timeline, style: before.style, opacity: before.opacity, canUndo: true, canRedo: false
    } }]);
    expect(stableState(refused)).toEqual(stableState(before));
    await page.getByLabel('Refuser l’annulation').uncheck();
    await click(page, 'Annuler');
    await expect(page.locator('#opacity-output')).toHaveText('25 %');
    const reverted = await snapshot(page);
    expect(reverted.accepted).toBe(true);
    expect(reverted.canUndo).toBe(false); expect(reverted.canRedo).toBe(true);
    expect(reverted.refusals).toEqual(refused.refusals);
    await click(page, 'Rétablir');
    await expect(page.locator('#opacity-output')).toHaveText('75 %');
    expect((await snapshot(page)).timeline).toEqual(before.timeline);
  });

  test('reports the exact redo reason once without consuming the redo entry', async ({ page }) => {
    await click(page, 'Appliquer une opacité de 75 %');
    const changed = await snapshot(page);
    await click(page, 'Annuler');
    await page.getByLabel('Refuser le rétablissement').check();
    const before = await snapshot(page);
    await click(page, 'Rétablir');
    const refused = await snapshot(page);
    await expect(page.locator('#status')).toHaveText('Permission redo refusée');
    expect(refused.accepted).toBe(false);
    expect(refused.refusals).toHaveLength(1);
    expect(refused.refusals[0]).toMatchObject({ reason: 'Permission redo refusée', commandLabel: 'Modifier l’opacité',
      state: { style: before.style, opacity: '0.25', canUndo: false, canRedo: true } });
    expect(stableState(refused)).toEqual(stableState(before));
    await page.getByLabel('Refuser le rétablissement').uncheck();
    await click(page, 'Rétablir');
    await expect(page.locator('#opacity-output')).toHaveText('75 %');
    const retried = await snapshot(page);
    expect(retried.accepted).toBe(true); expect(retried.timeline).toEqual(changed.timeline);
    expect(retried.canUndo).toBe(true); expect(retried.canRedo).toBe(false);
    expect(retried.refusals).toEqual(refused.refusals);
    await click(page, 'Annuler');
    await expect(page.locator('#opacity-output')).toHaveText('25 %');
  });

  test('keeps the refusal reason and retry controls usable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await click(page, 'Appliquer une opacité de 75 %');
    await page.getByLabel('Refuser l’annulation').check();
    await click(page, 'Annuler');
    await expect(page.locator('#status')).toHaveText('Permission undo refusée');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByLabel('Refuser l’annulation').uncheck();
    await click(page, 'Annuler');
    await expect(page.locator('#opacity-output')).toHaveText('25 %');
    expect((await snapshot(page)).canRedo).toBe(true);
  });
});
