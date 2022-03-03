"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.processSource = processSource;
const importPattern = /var (\w+_WEBPACK_[A-Z]+_MODULE_\w+) = ([/*#\w]*)(__webpack_require__[^;,]+);/g;

function checkSideEffectFree(sideEffectFree, requireExpression) {
  // check if module has sideEffects false
  const [, importedModule] = requireExpression.match(/["']([^"']+)["']/) || [];
  return sideEffectFree.get(importedModule) || false;
}

function collectRequires(src, sideEffectFree) {
  // Collect require variables
  const requireVariables = new Map();
  const matches = src.matchAll(importPattern);

  for (const match of matches) {
    const variableName = match[1];
    let requireExpression = match[3]; // if referencing another require var, inline it

    requireExpression = requireExpression.replace(/\w+_WEBPACK_[A-Z]+_MODULE_\w+/, s => requireVariables.get(s) || s);

    if (!checkSideEffectFree(sideEffectFree, requireExpression)) {
      continue;
    }

    requireVariables.set(variableName, requireExpression);
  }

  return requireVariables;
}

function processSource(originalSource, sideEffectFree) {
  let newSource = originalSource;
  const requireVariables = collectRequires(originalSource, sideEffectFree);

  if (requireVariables.size === 0) {
    return null;
  } // Replace variable names.


  for (const [variableName, requireExpression] of requireVariables.entries()) {
    // strip top level var declarations
    const declarationlessOutput = newSource.replace(new RegExp(`var ${variableName}[^\\w]([^;]+);`), (m, p0) => `// (inlined) ${(p0.match(/"([^"]+)/) || [])[1]}`); // replace inline variable references with require expression

    const reflessOutput = declarationlessOutput.replace(new RegExp(`([^\\w])${variableName}([^\\w])`, 'g'), `$1(${requireExpression})$2`);

    if (reflessOutput !== declarationlessOutput) {
      // import var is being used somewhere, confirm replacements
      newSource = reflessOutput;
    }
  } // nothing has changed


  if (newSource === originalSource) {
    return null;
  }

  return newSource;
}