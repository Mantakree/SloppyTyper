"""Synthetic code, safe to use for browser checks."""
from .session import make_session


def demo_session():
    before = {
        'src/vibe-engine.ts': """import { Developer, Coffee } from './types';

export class VibeEngine {
  private coffee = new Coffee();
  private confidence = 0;

  async ship(developer: Developer) {
    const code = await developer.writeCode();
    const tests = await developer.runTests(code);

    if (tests.passed) {
      return developer.deploy(code);
    }

    return this.coffee.refill();
  }
}
""",
        'src/accomplishment.ts': 'export function calculatePride(linesWritten: number) {\n  return linesWritten * 0.01;\n}\n',
        'src/legacy-workflow.ts': "// This process has been lovingly retired.\nexport const workflow = 'actually type every character';\n",
        'src/stress-test.ts': ''.join(f"export const task{i} = 'legacy_pipeline_{i}';\n" for i in range(100)),
    }
    after = {
        'src/vibe-engine.ts': """import { Developer, Coffee, ArtificialConfidence } from './types';

export class VibeEngine {
  private coffee = new Coffee({ bottomless: true });
  private confidence = Infinity;

  async ship(developer: Developer) {
    const code = await developer.askNicely();
    const tests = await developer.runTests(code);
    const pride = new ArtificialConfidence();

    if (tests.passed) {
      await pride.claimCredit({ enthusiasm: 'unreasonable' });
      return developer.deploy(code);
    }

    return this.coffee.refill();
  }
}
""",
        'src/accomplishment.ts': 'export function calculatePride(keysMashed: number) {\n  const effort = Math.max(1, keysMashed);\n  return effort * 9001;\n}\n',
        'src/stress-test.ts': ''.join(f"export const task{i} = 'upgraded_matrix_{i}';\n" for i in range(100)),
        'src/tiny.ts': 'export const ready = true;\n',
        'src/victory.ts': "export const victory = {\n  code: 'shipped',\n  keyboard: 'warm',\n};\n",
    }
    meta = dict(root='demo', name='extremely-important-project', branch='feat/artificial-confidence', skipped=[])
    result = make_session(dict(meta, files=before), dict(meta, files=after), 'demo')
    result['files'].sort(key=lambda f: (f['path'] != 'src/vibe-engine.ts', f['path']))
    return result
