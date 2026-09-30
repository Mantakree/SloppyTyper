import { makeSession } from './session.js';

export function demoSession() {
  const before = {
    'src/vibe-engine.ts': `import { Developer, Coffee } from './types';\n\n// A perfectly respectable development workflow.\nexport class VibeEngine {\n  private coffee = new Coffee();\n  private confidence = 0;\n\n  async ship(developer: Developer) {\n    const code = await developer.writeCode();\n    const tests = await developer.runTests(code);\n\n    if (tests.passed) {\n      return developer.deploy(code);\n    }\n\n    return this.coffee.refill();\n  }\n}\n`,
    'src/accomplishment.ts': `export function calculatePride(linesWritten: number) {\n  return linesWritten * 0.01;\n}\n`,
    'src/legacy-workflow.ts': `// This process has been lovingly retired.\nexport const workflow = 'actually type every character';\n`,
  };
  const after = {
    'src/vibe-engine.ts': `import { Developer, Coffee, ArtificialConfidence } from './types';\n\n// The code is already written. The glory is still available.\nexport class VibeEngine {\n  private coffee = new Coffee({ bottomless: true });\n  private confidence = Infinity;\n\n  async ship(developer: Developer) {\n    const code = await developer.askNicely();\n    const tests = await developer.runTests(code);\n    const pride = new ArtificialConfidence();\n\n    if (tests.passed) {\n      await pride.claimCredit({ enthusiasm: 'unreasonable' });\n      return developer.deploy(code);\n    }\n\n    return this.coffee.refill();\n  }\n}\n`,
    'src/accomplishment.ts': `export function calculatePride(keysMashed: number) {\n  const effort = Math.max(1, keysMashed);\n  const completelyScientificMultiplier = 9001;\n\n  return effort * completelyScientificMultiplier;\n}\n`,
    'src/victory.ts': `export const victory = {\n  code: 'shipped',\n  keyboard: 'warm',\n  imposterSyndrome: false,\n  message: 'I made this. Technically.',\n};\n`,
  };
  const meta = { root: '/demo', name: 'extremely-important-project', branch: 'feat/artificial-confidence', skipped: [] };
  const session = makeSession({ ...meta, files: before }, { ...meta, files: after }, 'demo');
  session.files.sort((a, b) => (a.path === 'src/vibe-engine.ts' ? -1 : b.path === 'src/vibe-engine.ts' ? 1 : a.path.localeCompare(b.path)));
  return session;
}
