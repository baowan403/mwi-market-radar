import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const officialCategoryHrids = [
  '/item_categories/currency',
  '/item_categories/loot',
  '/item_categories/scroll',
  '/item_categories/labyrinth',
  '/item_categories/dungeon_key',
  '/item_categories/food',
  '/item_categories/drink',
  '/item_categories/ability_book',
  '/item_categories/equipment',
  '/item_categories/resource',
];

const itemMapFileName = 'itemDetailMap.json';
const categoryMapFileName = 'itemCategoryDetailMap.json';

function ancestorDirectories(startDirectory) {
  const directories = [];
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    directories.push(currentDirectory);
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  return directories;
}

function dataDirectoryCandidates() {
  const configuredDirectory = process.env.MWI_GAME_DATA_DIR?.trim();
  if (configuredDirectory) return [path.resolve(configuredDirectory)];

  const candidates = new Set();
  const seeds = [scriptDirectory, projectDirectory, process.cwd()];

  for (const seed of seeds) {
    for (const ancestor of ancestorDirectories(seed)) {
      candidates.add(path.join(ancestor, 'work', 'azhu-sim-source', 'src', 'combatsimulator', 'data'));

      const worktreesDirectory = path.basename(ancestor) === '.worktrees' ? ancestor : null;
      if (worktreesDirectory) {
        candidates.add(path.join(path.dirname(worktreesDirectory), 'work', 'azhu-sim-source', 'src', 'combatsimulator', 'data'));
      }
    }
  }

  return [...candidates];
}

function findDataDirectory() {
  const checkedDirectories = [];

  for (const directory of dataDirectoryCandidates()) {
    checkedDirectories.push(directory);
    const itemMapPath = path.join(directory, itemMapFileName);
    const categoryMapPath = path.join(directory, categoryMapFileName);
    if (fs.existsSync(itemMapPath) && fs.existsSync(categoryMapPath)) return { directory, checkedDirectories };
  }

  const checked = checkedDirectories.map((directory) => `  - ${directory}`).join('\n');
  throw new Error(
    `Could not find MWI game data maps. Checked these directories for ${itemMapFileName} and ${categoryMapFileName}:\n${checked}`,
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read JSON map ${filePath}: ${reason}`);
  }
}

function recordsFromMap(map, mapName) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`Expected ${mapName} to contain an object map`);
  }
  return Object.values(map);
}

function compareText(left, right) {
  return left.localeCompare(right);
}

function buildCatalog(dataDirectory) {
  const itemMap = readJson(path.join(dataDirectory, itemMapFileName));
  const categoryMap = readJson(path.join(dataDirectory, categoryMapFileName));
  const itemRecords = recordsFromMap(itemMap, itemMapFileName);
  const categoryRecords = recordsFromMap(categoryMap, categoryMapFileName);
  const categoryByHrid = new Map(categoryRecords.map((category) => [category.hrid, category]));

  const categories = officialCategoryHrids.map((hrid) => {
    const category = categoryByHrid.get(hrid);
    if (!category) throw new Error(`Official category is missing from ${categoryMapFileName}: ${hrid}`);
    if (typeof category.name !== 'string' || !Number.isFinite(category.sortIndex)) {
      throw new Error(`Official category has invalid fields in ${categoryMapFileName}: ${hrid}`);
    }
    return { hrid, name: category.name, sortIndex: category.sortIndex };
  }).sort((left, right) => left.sortIndex - right.sortIndex || compareText(left.hrid, right.hrid));

  const officialCategories = new Set(officialCategoryHrids);
  const items = [];
  let excludedItemCount = 0;

  for (const item of itemRecords) {
    if (!item || typeof item !== 'object' || !officialCategories.has(item.categoryHrid)) {
      excludedItemCount += 1;
      continue;
    }
    if (
      typeof item.hrid !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.categoryHrid !== 'string' ||
      !Number.isFinite(item.sortIndex)
    ) {
      throw new Error(`Official item has invalid fields in ${itemMapFileName}: ${String(item.hrid)}`);
    }
    items.push({
      hrid: item.hrid,
      name: item.name,
      categoryHrid: item.categoryHrid,
      sortIndex: item.sortIndex,
    });
  }

  items.sort(
    (left, right) =>
      compareText(left.categoryHrid, right.categoryHrid) ||
      left.sortIndex - right.sortIndex ||
      compareText(left.hrid, right.hrid),
  );

  return { catalog: { categories, items }, excludedItemCount };
}

function main() {
  const { directory, checkedDirectories } = findDataDirectory();
  const { catalog, excludedItemCount } = buildCatalog(directory);
  const outputDirectory = path.join(projectDirectory, 'public');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  console.log(`Built ${catalog.items.length} catalog items across ${catalog.categories.length} official categories.`);
  console.log(`Excluded ${excludedItemCount} item(s) with non-official or missing categories.`);
  console.log(`Source: ${directory}`);
  if (checkedDirectories.length > 1) console.log(`Checked ${checkedDirectories.length} candidate directories.`);
}

try {
  main();
} catch (error) {
  console.error(`build-catalog: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
