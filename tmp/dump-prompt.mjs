// 临时脚本：把生成的 system prompt 打印出来看排版，用完可删
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const addonScripts = path.resolve(here, '..', 'addon', 'chrome', 'content', 'scripts', 'translate');

function makeSandbox(prefs) {
  const sandbox = {
    console,
    Zotero: {
      debug: () => {},
      logError: (e) => console.error('logError', e),
      Prefs: { get: (k) => prefs[k], set: () => {} },
      Utilities: { randomString: (n) => 'x'.repeat(n), Internal: {} },
      ItemTypes: { getLocalizedName: () => '' },
    },
    Promise, Map, Set, Date, JSON, Math, RegExp, Error,
    parseInt, parseFloat, isNaN, String, Number, Array, Object,
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'context.js', 'prompts.js']) {
    vm.runInContext(fs.readFileSync(path.join(addonScripts, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.DeepSeekTranslate;
}

const mode = process.argv[2] || 'default';
const prefs = mode === 'off'
  ? {
    'extensions.englishAssistant.translate.showEtymology': false,
    'extensions.englishAssistant.translate.exampleCount': 0,
  }
  : mode === 'simple'
    ? {
      'extensions.englishAssistant.translate.targetLang': '简体中文',
      'extensions.englishAssistant.translate.explainMode': 'en-simple',
    }
    : { 'extensions.englishAssistant.translate.targetLang': '简体中文' };

const D = makeSandbox(prefs);
console.log(`===== system prompt（${mode}）=====\n`);
console.log(D.prompts.systemPrompt());
console.log('\n===== user prompt =====\n');
console.log(D.prompts.userPrompt({
  text: 'sliders',
  pageLabel: '第 3 页',
  metadata: { title: 'Modular Synthesis', creators: 'A. Author', year: '2024' },
  context: {
    available: true,
    matched: true,
    before: 'The panel is covered with ',
    selected: 'sliders',
    after: ', switches, and buttons.',
    pageLabel: '第 3 页',
  },
}));
