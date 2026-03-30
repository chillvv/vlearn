import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

type CliArgs = {
  mode: 'baseline' | 'diff';
  threshold: number;
};

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname);
const fixtureDir = path.join(root, 'fixtures');
const baselinePath = path.join(fixtureDir, 'baseline.png');
const candidatePath = path.join(fixtureDir, 'candidate.png');
const diffPath = path.join(fixtureDir, 'diff.png');

if (!fs.existsSync(fixtureDir)) {
  fs.mkdirSync(fixtureDir, { recursive: true });
}

if (args.mode === 'baseline') {
  ensurePng(candidatePath, '#2563EB');
  fs.copyFileSync(candidatePath, baselinePath);
  console.log('baseline updated');
  process.exit(0);
}

ensurePng(baselinePath, '#2563EB');
ensurePng(candidatePath, '#2563EB');

const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
const candidate = PNG.sync.read(fs.readFileSync(candidatePath));
const diff = new PNG({ width: baseline.width, height: baseline.height });

const mismatchPixels = pixelmatch(baseline.data, candidate.data, diff.data, baseline.width, baseline.height, {
  threshold: 0.1,
});

const totalPixels = baseline.width * baseline.height;
const mismatchRatio = mismatchPixels / totalPixels;
fs.writeFileSync(diffPath, PNG.sync.write(diff));

console.log(
  JSON.stringify(
    {
      mismatchPixels,
      mismatchRatio,
      threshold: args.threshold,
      pass: mismatchRatio <= args.threshold,
      appiumTarget: {
        platformName: 'android',
        automationName: 'UiAutomator2',
        appPackage: 'com.aiweb.mobile',
      },
    },
    null,
    2,
  ),
);

if (mismatchRatio > args.threshold) {
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const mode = argv.includes('--mode') ? (argv[argv.indexOf('--mode') + 1] as 'baseline' | 'diff') : 'diff';
  const threshold = argv.includes('--threshold') ? Number(argv[argv.indexOf('--threshold') + 1]) : 0.002;
  return { mode, threshold };
}

function ensurePng(targetPath: string, fillColor: string) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  const png = new PNG({ width: 80, height: 160 });
  const [r, g, b] = hexToRgb(fillColor);
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = r;
    png.data[index + 1] = g;
    png.data[index + 2] = b;
    png.data[index + 3] = 255;
  }
  fs.writeFileSync(targetPath, PNG.sync.write(png));
}

function hexToRgb(value: string) {
  const normalized = value.replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}
