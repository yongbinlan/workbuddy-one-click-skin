import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULTS = ['default-01-coast.jpg', 'default-02-mountains.jpg', 'default-03-night.jpg', 'default-04-dunes.jpg'];

// Copy only bundled JPEGs. Never replace user pictures or change an existing selection.
export function seedDefaultWallpapers(root = ROOT) {
  const source = path.join(ROOT, 'default-wallpapers');
  for (const name of DEFAULTS) {
    const bytes = fs.readFileSync(path.join(source, name));
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid bundled JPEG: ' + name);
  }
  const lib = path.join(root, 'wallpapers');
  fs.mkdirSync(lib, {recursive:true});
  const hadPictures = fs.readdirSync(lib).some(name => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name));
  const added = [];
  for (const name of DEFAULTS) {
    try {
      fs.copyFileSync(path.join(source, name), path.join(lib, name), fs.constants.COPYFILE_EXCL);
      added.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  let selected = false;
  if (!hadPictures) {
    try {
      fs.writeFileSync(path.join(lib, 'current.json'), JSON.stringify({path:path.join(lib, DEFAULTS[0]), preset:'medium', position:'center center'}, null, 2), {flag:'wx'});
      selected = true;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return {added, selected};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(seedDefaultWallpapers()));
}
