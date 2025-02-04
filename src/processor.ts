import type { SourceAndMapResult } from 'webpack-sources';
import type { SideEffectFree } from './types';

const webpackModuleHeader = '(function(module, __webpack_exports__, __webpack_require__) {';
const importPattern =
  /var (\w+_WEBPACK_[A-Z]+_MODULE_\w+) = ([/*#\w]*)(__webpack_require__[^;,]+);/g;

function checkSideEffectFree(sideEffectFree: SideEffectFree, requireExpression: string) {
  // check if module has sideEffects false
  const [, importedModule] = requireExpression.match(/["']([^"']+)["']/) || [];
  return sideEffectFree.get(importedModule) || false;
}

function collectRequires(src: string, sideEffectFree: SideEffectFree) {
  // Collect require variables
  const requireVariables = new Map();

  const matches = src.matchAll(importPattern);
  for (const match of matches) {
    const variableName = match[1];
    let requireExpression = match[3];

    // if referencing another require var, inline it
    requireExpression = requireExpression.replace(
      /\w+_WEBPACK_[A-Z]+_MODULE_\w+/,
      (s) => (requireVariables.get(s) && requireVariables.get(s).requireExpression) || s
    );

    requireVariables.set(variableName, {
      variableName,
      requireExpression,
      isSideEffectFree: checkSideEffectFree(sideEffectFree, requireExpression),
    });
  }
  return requireVariables;
}

export function processSource(
  file: string,
  original: SourceAndMapResult,
  sideEffectFree: SideEffectFree
): string {
  let startIdx = 0;
  let src = '';
  do {
    const endIdx = original.source.indexOf(webpackModuleHeader, startIdx);
    let srcSlice = original.source.slice(
      startIdx,
      endIdx > 0 ? endIdx + webpackModuleHeader.length : undefined
    );

    // Collect require variables
    const requireVariables = collectRequires(srcSlice, sideEffectFree);

    // Replace variable names.
    for (const [
      variableName,
      { requireExpression, isSideEffectFree },
    ] of requireVariables.entries()) {
      // eslint-disable-next-line no-continue
      if (!isSideEffectFree) continue;

      // strip top level var declarations
      const declarationlessOutput = srcSlice.replace(
        new RegExp(`var ${variableName}[^\\w]([^;]+);`),
        (m, p0) => `// (inlined) ${(p0.match(/"([^"]+)/) || [])[1]}`
      );

      // replace inline variable references with require expression
      const reflessOutput = declarationlessOutput.replace(
        new RegExp(`([^\\w])${variableName}([^\\w])`, 'g'),
        `$1(${requireExpression})$2`
      );

      if (reflessOutput !== declarationlessOutput) {
        // import var is being used somewhere, confirm replacements
        srcSlice = reflessOutput;
      }
    }

    src += srcSlice;
    startIdx = endIdx > 0 ? endIdx + webpackModuleHeader.length : -1;
  } while (startIdx !== -1);

  return src;
}
