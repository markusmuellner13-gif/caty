// Assemble the static site into dist/. Copies the game sources and vendors
// three.js from node_modules (or the checked-in vendor/ copy as fallback).
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'vendor'), { recursive: true });

for (const f of ['index.html', 'style.css']) cpSync(join(root, f), join(dist, f));
cpSync(join(root, 'src'), join(dist, 'src'), { recursive: true });

const npmThree = join(root, 'node_modules/three/build/three.module.min.js');
const vendored = join(root, 'vendor/three.module.js');
cpSync(existsSync(npmThree) ? npmThree : vendored, join(dist, 'vendor/three.module.js'));
if (existsSync(join(root, 'vendor/THREE-LICENSE'))) {
  cpSync(join(root, 'vendor/THREE-LICENSE'), join(dist, 'vendor/THREE-LICENSE'));
}
console.log('Built dist/');
