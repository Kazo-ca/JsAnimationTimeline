// packages/export-css/src/continuous/htmlTargets.ts
import type { IHtmlCssTarget } from './htmlScene';
import { HtmlCssSceneError } from './htmlErrors';

function safeSelector(selector: string): string {
  if (selector.trim() === '' || selector.length > 10_000 || /[<>;{}]/.test(selector) ||
    [...selector].some((char) => char.codePointAt(0)! < 32) || /:(?:scope|host)(?:\b|\()/i.test(selector)) {
    throw new HtmlCssSceneError('unsafe-selector', 'Le sélecteur ne peut pas être écrit dans une feuille CSS autonome.');
  }
  return selector;
}
function idSelector(element: Element): string | undefined {
  const escaped = [...element.id].map((char) => /["\\<>;{}]/.test(char) || char.codePointAt(0)! < 32 ? `\\${char.codePointAt(0)!.toString(16)} ` : char).join('');
  return element.id === '' ? undefined : `[id="${escaped}"]`;
}
export function htmlExportScope(root: ParentNode, requested?: string): { readonly document: Document; readonly selector: string } {
  if (root.nodeType === 9) {
    if (requested !== undefined) throw new HtmlCssSceneError('invalid-root-selector', 'rootSelector est réservé à un conteneur élément.');
    return { document: root as Document, selector: '' };
  }
  if (root.nodeType !== 1) throw new HtmlCssSceneError('unsupported-root', 'L’export CSS exige un document ou un conteneur HTML connecté.');
  const element = root as Element;
  const document = element.ownerDocument;
  if (!element.isConnected || element.getRootNode() !== document) throw new HtmlCssSceneError('unsupported-root', 'Les fragments détachés et racines Shadow DOM ne sont pas exportables en CSS autonome.');
  const selector = requested ?? idSelector(element);
  if (selector === undefined) throw new HtmlCssSceneError('missing-root-selector', 'Attribuez un ID unique au conteneur ou fournissez rootSelector.');
  safeSelector(selector);
  const matches = document.querySelectorAll(selector);
  if (matches.length !== 1 || matches[0] !== element) throw new HtmlCssSceneError('ambiguous-root-selector', 'Le sélecteur du conteneur doit identifier uniquement ce conteneur dans le document.');
  return { document, selector: `:is(${selector}) ` };
}
function signature(target: IHtmlCssTarget): string {
  return JSON.stringify({ trajectories: target.trajectories, transform: target.transformBase, gradients: target.gradients,
    spatial: target.spatial, spatialSources: target.spatialSources });
}

/** Membership plus complete trajectory identity, never equal integer snapshots, defines a group. */
export function groupCssTargets(root: ParentNode, scope: string, selectors: readonly string[], targets: readonly IHtmlCssTarget[],
  supplied?: (element: Element) => string | undefined): readonly IHtmlCssTarget[] {
  if (selectors.length * targets.length > 1_000_000) throw new HtmlCssSceneError('resource-limit', 'Le nombre de sélecteurs et de cibles dépasse le budget CSS.');
  selectors.forEach(safeSelector);
  const matches = selectors.map((selector) => new Set(root.querySelectorAll(selector)));
  const groups = new Map<string, IHtmlCssTarget[]>();
  for (const target of targets) {
    const membership = JSON.stringify(matches.map((elements) => elements.has(target.element)));
    groups.set(membership, [...(groups.get(membership) ?? []), target]);
  }
  const result: IHtmlCssTarget[] = [];
  for (const [key, group] of groups) {
    const membership = JSON.parse(key) as boolean[];
    const selectorsForGroup = selectors.map((selector, index) => membership[index] ? `:is(${selector})` : `:not(:is(${selector}))`).join('');
    const first = signature(group[0]);
    const identical = group.every((target) => signature(target) === first);
    const emit = (target: IHtmlCssTarget, unique = ''): void => {
      const selector = `${scope}${selectorsForGroup}${unique}`;
      const expected = identical ? group.map((item) => item.element) : [target.element];
      const actual = Array.from(target.element.ownerDocument.querySelectorAll(selector));
      if (actual.length !== expected.length || expected.some((element) => !actual.includes(element))) throw new HtmlCssSceneError('selector-mismatch', 'Le ciblage CSS ne reproduit pas les correspondances de la scène.');
      result.push({ ...target, selector });
    };
    if (identical) emit(group[0]);
    else for (const target of group) {
      const unique = [supplied?.(target.element), idSelector(target.element)].find((selector) => {
        if (selector === undefined) return false;
        safeSelector(selector);
        const elements = root.querySelectorAll(selector);
        return elements.length === 1 && elements[0] === target.element;
      });
      if (unique === undefined) throw new HtmlCssSceneError('ambiguous-target', 'Ces éléments ont des trajectoires ou bases distinctes. Attribuez des ID uniques ou fournissez des sélecteurs uniques.');
      emit(target, `:is(${unique})`);
    }
  }
  return result;
}
