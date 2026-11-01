// packages/runtime/src/stage/html/spatialSource.ts
import type { HtmlReadResult } from './cssTypes';
import { compareHtmlSpecificity, htmlSelectorSpecificity } from './specificity';
import type { HtmlSpecificity } from './specificity';

const PROPERTIES = ['transform', 'transform-origin'] as const;
type SourceProperty = typeof PROPERTIES[number];
interface IWinner { readonly value: string; readonly important: boolean; readonly inline: boolean; readonly specificity: HtmlSpecificity }
const UNPROVEN = 'La source CSS du groupe ne peut pas être prouvée identique. Utilisez des objets individuels ou une source explicite commune.';

function choose(previous: IWinner | undefined, next: IWinner): IWinner {
  if (previous === undefined) return next;
  if (previous.important !== next.important) return next.important ? next : previous;
  if (previous.inline !== next.inline) return next.inline ? next : previous;
  return compareHtmlSpecificity(next.specificity, previous.specificity) >= 0 ? next : previous;
}

/** Group compatibility requires authored units as well as current computed equality. */
export function captureHtmlSpatialGroupSource(element: Element): HtmlReadResult<string> {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (view === null || element.getRootNode() !== document) return { status: 'unsupported', reason: UNPROVEN };
  const winners = new Map<SourceProperty, IWinner>();
  let inspected = 0;
  function apply(style: CSSStyleDeclaration, specificity: HtmlSpecificity, inline: boolean): void {
    if (style.getPropertyValue('all') !== '' || ['transform-origin-x', 'transform-origin-y', 'transform-origin-z'].some((name) => style.getPropertyValue(name) !== '')) throw new Error(UNPROVEN);
    for (const property of PROPERTIES) {
      const value = style.getPropertyValue(property).trim();
      if (value !== '') winners.set(property, choose(winners.get(property), { value, important: style.getPropertyPriority(property) === 'important', inline, specificity }));
    }
  }
  function applicable(media: string): boolean {
    if (media.trim() === '' || media.trim() === 'all') return true;
    if (typeof view!.matchMedia !== 'function') throw new Error(UNPROVEN);
    return view!.matchMedia(media).matches;
  }
  function rules(items: CSSRuleList, depth: number): void {
    if (depth > 24) throw new Error(UNPROVEN);
    for (const rule of Array.from(items)) {
      if (++inspected > 50000) throw new Error(UNPROVEN);
      if (rule.type === 1) {
        const styleRule = rule as CSSStyleRule;
        if ('cssRules' in styleRule && (styleRule as CSSStyleRule & { cssRules: CSSRuleList }).cssRules.length > 0) throw new Error(UNPROVEN);
        const relevant = [...PROPERTIES, 'all', 'transform-origin-x', 'transform-origin-y', 'transform-origin-z'].some((name) => styleRule.style.getPropertyValue(name) !== '');
        if (!relevant || !element.matches(styleRule.selectorText)) continue;
        // The existing specificity grammar deliberately refuses selector lists/pseudo selectors/escapes.
        const specificity = htmlSelectorSpecificity(styleRule.selectorText);
        if (specificity === undefined) throw new Error(UNPROVEN);
        apply(styleRule.style, specificity, false);
      } else if (rule.type === 4) {
        const media = rule as CSSMediaRule;
        if (applicable(media.conditionText)) rules(media.cssRules, depth + 1);
      } else if (rule.type === 2 || rule.type === 5 || rule.type === 7 || rule.type === 8) {
        // Charset/font-face/keyframe declarations do not establish an element's static author value.
      } else {
        // Imports, cascade layers, supports/scope and unknown grouping rules require a complete cascade model.
        throw new Error(UNPROVEN);
      }
    }
  }
  try {
    for (const sheet of [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets ?? [])]) {
      if (!sheet.disabled && applicable(sheet.media?.mediaText ?? '')) rules(sheet.cssRules, 0);
    }
    const inline = (element as HTMLElement | SVGElement).style;
    if (inline !== undefined) apply(inline, [0, 0, 0], true);
    const computed = view.getComputedStyle(element);
    if (computed.animationName.split(',').some((name) => name.trim() !== '' && name.trim() !== 'none')
      || computed.transitionDuration.split(',').some((duration) => Number.parseFloat(duration) > 0)) throw new Error(UNPROVEN);
    const values = PROPERTIES.map((property) => {
      const fallback = property === 'transform' ? 'none' : element.namespaceURI === 'http://www.w3.org/2000/svg' ? '0px 0px 0px' : '50% 50% 0px';
      const authored = winners.get(property)?.value ?? fallback;
      // The same variable text may resolve through different inherited values/units on each member.
      if (/\b(?:var|env|attr)\s*\(|^(?:inherit|revert|revert-layer)$/i.test(authored)) throw new Error(UNPROVEN);
      const source = /^(?:initial|unset)$/i.test(authored) ? fallback : authored;
      return [source, computed.getPropertyValue(property)];
    });
    return { status: 'value', value: JSON.stringify(values) };
  } catch { return { status: 'unsupported', reason: UNPROVEN }; }
}
