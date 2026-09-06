import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { createPortrait, toMathCard, describeMath } from '../../packages/sfumato/dist/index.mjs';

// Documentation image only. Sharp belongs to this optional example, not the core.
const { data, info } = await sharp('public/portrait.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const result = createPortrait({ data, width: info.width, height: info.height });
await writeFile('docs/math-portrait.svg', result.card);
await sharp(Buffer.from(result.card)).png().toFile('docs/math-portrait.png');
const chinese = { ...result.recipe, language: 'zh-CN' };
await sharp(Buffer.from(toMathCard(chinese))).png().toFile('docs/math-portrait.zh-CN.png');
await writeFile('docs/math-portrait.json', JSON.stringify(describeMath(chinese), null, 2) + '\n');
const source = await sharp('public/portrait.png').resize(320, 320).png().toBuffer();
const curves = await sharp(Buffer.from(result.svg)).resize(320, 320).png().toBuffer();
const tone = await sharp(result.image.data, { raw: { width: 160, height: 160, channels: 4 } })
  .resize(320, 320).png().toBuffer();
const headings = Buffer.from('<svg width="1040" height="64"><rect width="1040" height="64" fill="#f3f3f1"/><g font-family="Arial,sans-serif" font-size="16" fill="#34383b"><text x="24" y="39">PHOTOGRAPH</text><text x="360" y="39">CURVES</text><text x="696" y="39">SFUMATO</text></g></svg>');
await sharp({ create: { width: 1040, height: 408, channels: 3, background: '#f3f3f1' } })
  .composite([{ input: headings, left: 0, top: 0 }, ...[source, curves, tone].map((input, i) => ({ input, left: 24 + i * 336, top: 64 }))])
  .png().toFile('docs/package-example.png');
await writeFile('docs/package-example.json', JSON.stringify({
  source: 'public/portrait.png (NASA, public domain)', packageVersion: '0.1.0',
  stats: result.stats, explanation: result.explanation,
}, null, 2) + '\n');
