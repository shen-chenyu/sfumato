import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPortrait } from '@shen-chenyu/sfumato';

const input = process.argv[2];
if (!input)
  throw Error(
    'Usage: node portrait.mjs photo.jpg [output-directory] [en|zh-CN]',
  );
const output = resolve(process.argv[3] || 'output');
const language = process.argv[4] || 'en';
if (!['en', 'zh-CN'].includes(language))
  throw Error('Language must be en or zh-CN. / 语言请选择 en 或 zh-CN。');
await mkdir(output, { recursive: true });
const { data, info } = await sharp(input)
  .rotate()
  .toColourspace('srgb')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const result = createPortrait(
  { data, width: info.width, height: info.height },
  { language },
);
await sharp(result.image.data, {
  raw: { width: 160, height: 160, channels: 4 },
})
  .png()
  .toFile(resolve(output, 'portrait.png'));
await writeFile(resolve(output, 'curves.svg'), result.svg);
await writeFile(
  resolve(output, 'recipe.json'),
  JSON.stringify(result.recipe, null, 2),
);
await writeFile(resolve(output, 'explanation.txt'), result.explanation + '\n');
await writeFile(
  resolve(output, 'math.json'),
  JSON.stringify(result.math, null, 2),
);
await writeFile(resolve(output, 'math-portrait.svg'), result.card);
await sharp(Buffer.from(result.card))
  .png()
  .toFile(resolve(output, 'math-portrait.png'));
console.log(result.explanation);
console.log(
  `Saved portrait.png, curves.svg, recipe.json, explanation.txt, math.json and the SVG/PNG math portrait card in ${output}`,
);
