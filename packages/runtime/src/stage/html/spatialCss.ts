// packages/runtime/src/stage/html/spatialCss.ts
/** Portable CSS syntax checks; the browser additionally validates declarations in its own realm. */
type Dimension = 'number' | 'length' | 'angle' | 'unknown';
const LENGTHS = new Set(['px', '%', 'em', 'rem', 'vw', 'vh', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'ex', 'ch', 'lh', 'rlh',
  'cap', 'ic', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh']);
const ANGLES = new Set(['deg', 'rad', 'grad', 'turn']);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;

export function safeSpatialCss(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 16384
    && !/[;{}\\]/.test(value) && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
    && !/(?:\/\*|\*\/|expression\s*\(|javascript\s*:|@import|url\s*\()/i.test(value);
}

function splitArguments(text: string): string[] | undefined {
  const result: string[] = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth < 0) return undefined;
    else if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (depth !== 0) return undefined;
  result.push(text.slice(start).trim());
  return result.every((entry) => entry !== '') ? result : undefined;
}

/** Small typed arithmetic parser: preserve expressions rather than resolving their units. */
function expression(text: string, percentage: boolean, depth: number): Dimension | undefined {
  if (depth > 24) return undefined;
  let index = 0; let groupDepth = 0;
  const skip = (): void => { while (/\s/.test(text[index] ?? '') && index < text.length) index++; };
  function atom(): Dimension | undefined {
    skip();
    const numeric = NUMBER.exec(text.slice(index));
    if (numeric !== null) {
      index += numeric[0].length;
      const suffix = /^[a-z%]+/i.exec(text.slice(index))?.[0] ?? '';
      index += suffix.length;
      if (!Number.isFinite(Number(numeric[0]))) return undefined;
      if (suffix === '') return 'number';
      if (suffix === '%' && !percentage) return undefined;
      return LENGTHS.has(suffix.toLowerCase()) ? 'length' : ANGLES.has(suffix.toLowerCase()) ? 'angle' : undefined;
    }
    const name = /^(calc|min|max|clamp|var)\(/i.exec(text.slice(index));
    if (name === null) {
      if (text[index] !== '(') return undefined;
      if (++groupDepth + depth > 24) return undefined;
      index++; const value = sum(); skip();
      if (text[index++] !== ')') return undefined;
      groupDepth--;
      return value;
    }
    index += name[0].length;
    const start = index; let nesting = 1;
    while (index < text.length && nesting > 0) {
      if (text[index] === '(') nesting++;
      else if (text[index] === ')') nesting--;
      index++;
    }
    if (nesting !== 0) return undefined;
    const args = splitArguments(text.slice(start, index - 1));
    if (args === undefined) return undefined;
    const fn = name[1].toLowerCase();
    if (fn === 'var') {
      if (!/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(args[0]) || args.length > 2) return undefined;
      if (args.length === 2 && expression(args[1], percentage, depth + 1) === undefined) return undefined;
      return 'unknown';
    }
    if (fn === 'calc' && args.length !== 1 || fn === 'clamp' && args.length !== 3) return undefined;
    const values = args.map((arg) => expression(arg, percentage, depth + 1));
    if (values.some((value) => value === undefined)) return undefined;
    const known = new Set(values.filter((value) => value !== 'unknown'));
    return known.size > 1 ? undefined : values.includes('unknown') ? 'unknown' : values[0];
  }
  function product(): Dimension | undefined {
    let left = atom(); skip();
    while (text[index] === '*' || text[index] === '/') {
      const operator = text[index++]; const right = atom();
      if (left === undefined || right === undefined) return undefined;
      if (left === 'unknown' || right === 'unknown') left = 'unknown';
      else if (operator === '/') left = right === 'number' ? left : left === right ? 'number' : undefined;
      else left = left === 'number' ? right : right === 'number' ? left : undefined;
      skip();
    }
    return left;
  }
  function sum(): Dimension | undefined {
    let left = product(); skip();
    while (text[index] === '+' || text[index] === '-') {
      index++; const right = product();
      if (left === undefined || right === undefined) return undefined;
      left = left === 'unknown' || right === 'unknown' ? 'unknown' : left === right ? left : undefined;
      skip();
    }
    return left;
  }
  const result = sum(); skip();
  return index === text.length ? result : undefined;
}

export function spatialCssValue(value: string, expected: 'number' | 'length' | 'angle', percentage = true): boolean {
  if (!safeSpatialCss(value)) return false;
  const text = value.trim();
  // Arithmetic outside CSS math functions is not a single CSS value.
  if (!/^(?:calc|min|max|clamp|var)\(/i.test(text)
    && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)?$/i.test(text)) return false;
  const type = expression(text, percentage, 0);
  return type === expected || type === 'unknown' || type === 'number' && Number(text) === 0;
}

export function isHtmlSpatialSourceTransform(input: unknown): input is string {
  if (!safeSpatialCss(input)) return false;
  const text = input.trim();
  if (text.toLowerCase() === 'none') return true;
  let offset = 0; let count = 0;
  while (offset < text.length) {
    const head = /^\s*([a-z][a-z0-9]*)\(/i.exec(text.slice(offset));
    if (head === null) return false;
    offset += head[0].length; const start = offset; let depth = 1;
    while (offset < text.length && depth > 0) {
      if (text[offset] === '(') depth++;
      else if (text[offset] === ')') depth--;
      offset++;
    }
    if (depth !== 0) return false;
    const args = splitArguments(text.slice(start, offset - 1));
    if (args === undefined || !validTransformFunction(head[1].toLowerCase(), args)) return false;
    count++;
    while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++;
  }
  return count > 0;
}

function validTransformFunction(name: string, args: readonly string[]): boolean {
  const values = (expected: 'number' | 'length' | 'angle', min: number, max = min): boolean =>
    args.length >= min && args.length <= max && args.every((value) => spatialCssValue(value, expected));
  if (name === 'matrix') return values('number', 6);
  if (name === 'matrix3d') return values('number', 16);
  if (name === 'translate') return values('length', 1, 2);
  if (name === 'translatex' || name === 'translatey') return values('length', 1);
  if (name === 'translatez' || name === 'perspective') return args.length === 1 && spatialCssValue(args[0], 'length', false);
  if (name === 'translate3d') return args.length === 3 && values('length', 3) && spatialCssValue(args[2], 'length', false);
  if (name === 'scale') return values('number', 1, 2);
  if (['scalex', 'scaley', 'scalez'].includes(name)) return values('number', 1);
  if (name === 'scale3d') return values('number', 3);
  if (['rotate', 'rotatex', 'rotatey', 'rotatez', 'skewx', 'skewy'].includes(name)) return values('angle', 1);
  if (name === 'skew') return values('angle', 1, 2);
  return name === 'rotate3d' && args.length === 4 && args.slice(0, 3).every((arg) => spatialCssValue(arg, 'number'))
    && spatialCssValue(args[3], 'angle');
}
