import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_COMMIT = 'febe90f14f7ea1e51937cc888f6f6e1907c58fff';
const REPOSITORY = 'https://github.com/Polokikiki/Milkonomy.git';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const milkonomyDirectory = process.env.MWI_MILKONOMY_DIR?.trim();

if (!milkonomyDirectory) {
  throw new Error('MWI_MILKONOMY_DIR is required');
}

const absoluteMilkonomyDirectory = path.resolve(milkonomyDirectory);
const safeDirectoryArgs = ['-c', `safe.directory=${absoluteMilkonomyDirectory}`];
const head = execFileSync('git', [...safeDirectoryArgs, 'rev-parse', 'HEAD'], {
  cwd: absoluteMilkonomyDirectory,
  encoding: 'utf8',
}).trim();
const status = execFileSync('git', [...safeDirectoryArgs, 'status', '--porcelain'], {
  cwd: absoluteMilkonomyDirectory,
  encoding: 'utf8',
}).trim();

if (head !== EXPECTED_COMMIT) {
  throw new Error(`Unexpected Milkonomy commit: ${head}`);
}
if (status !== '') {
  throw new Error('Milkonomy reference clone must be clean');
}

const gameDataPath = path.join(absoluteMilkonomyDirectory, 'public', 'data', 'data.json');
const translationPath = path.join(absoluteMilkonomyDirectory, 'src', 'locales', 'lang', 'zh-tw.ts');
const gameDataRaw = await readFile(gameDataPath, 'utf8');
const gameData = JSON.parse(gameDataRaw) as Record<string, unknown>;
const translationModule = await import(pathToFileURL(translationPath).href);
const translations = translationModule.default as Record<string, string>;

const strategyData = {
  gameVersion: gameData.gameVersion,
  versionTimestamp: gameData.versionTimestamp,
  enhancementLevelTotalBonusMultiplierTable: gameData.enhancementLevelTotalBonusMultiplierTable,
  itemDetailMap: gameData.itemDetailMap,
  actionDetailMap: gameData.actionDetailMap,
  communityBuffTypeDetailMap: gameData.communityBuffTypeDetailMap,
  achievementTierDetailMap: gameData.achievementTierDetailMap,
  personalBuffTypeDetailMap: gameData.personalBuffTypeDetailMap,
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function json(value: unknown): string {
  return `${JSON.stringify(stable(value))}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const outputDirectory = path.join(projectDirectory, 'scripts', 'vendor', 'milkonomy');
await mkdir(outputDirectory, { recursive: true });
const translationsJson = json(translations);
const strategyDataJson = json(strategyData);

await writeFile(path.join(outputDirectory, 'zh-tw.json'), translationsJson, 'utf8');
await writeFile(path.join(outputDirectory, 'strategy-data.json'), strategyDataJson, 'utf8');
await writeFile(path.join(outputDirectory, 'source.json'), json({
  repository: REPOSITORY,
  commit: EXPECTED_COMMIT,
  license: 'MIT',
  gameVersion: gameData.gameVersion,
  versionTimestamp: gameData.versionTimestamp,
  files: {
    gameDataSha256: sha256(gameDataRaw),
    translationsSha256: sha256(translationsJson),
    strategyDataSha256: sha256(strategyDataJson),
  },
}), 'utf8');

process.stdout.write(`Imported Milkonomy ${head} (${String(gameData.gameVersion)})\n`);
