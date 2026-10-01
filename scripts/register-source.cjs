'use strict';
// Opt-in source runner for focused tests/benchmarks only. No files or declarations emitted.
// This is not a build, a type check, or a substitute for release validation.
const fs = require('node:fs');
let ts;
try { ts = require('typescript'); }
catch { throw new Error('Source checks require the development dependency typescript. Install dev dependencies first.'); }
require.extensions['.ts'] = function compileSource(module, file) {
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, sourceMap: false },
  });
  module._compile(outputText, file);
};
