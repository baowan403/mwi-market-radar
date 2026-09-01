import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(projectDirectory, 'scripts', 'vendor', 'milkonomy', 'strategy-data.json');
const outputDirectory = path.join(projectDirectory, 'public');
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, path.join(outputDirectory, 'strategy-data.json'));
process.stdout.write('Staged strategy-data.json\n');
