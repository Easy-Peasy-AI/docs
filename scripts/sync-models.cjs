#!/usr/bin/env node
// Read catalogs only: never import API routes or initialize provider clients.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const docsRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const appRoot = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(docsRoot, '../kopi'));
const check = args.includes('--check');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const esbuild = appRequire('esbuild');

function catalog(file) {
  const result = esbuild.buildSync({
    absWorkingDir: appRoot,
    entryPoints: [file],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    loader: { '.svg': 'empty' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, appRequire);
  return module.exports;
}

const videos = catalog('src/constants/videoModels.ts').videoModelsWithDescription
  // These use a separate session-authenticated web route, not the public API.
  .filter(model => !model.options.isMotionControl);
const images = catalog('src/constants/imageModels.ts');
const schemaPath = path.join(docsRoot, 'api-reference/openapi.json');
const spec = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const videoProperties = spec.components.schemas.GenerateVideoRequest.properties;
videoProperties.model.enum = videos.map(model => model.title);
videoProperties.resolution.enum = [...new Set(videos.flatMap(model => model.options.resolution || []))]
  .sort((a, b) => parseInt(a) * (a.endsWith('k') ? 1000 : 1) - parseInt(b) * (b.endsWith('k') ? 1000 : 1));
videoProperties.aspectRatio.enum = [...new Set(videos.flatMap(model => model.options.aspectRatio || []))];
const imageProperties = spec.components.schemas.ImageGenerationRequest.properties;
// Older titles still have explicit branches in generate-image.ts. Keep this
// list separate from the current catalog so a removed model is reviewed.
const legacyImageModels = ['OpenAI GPT Image 1', 'OpenAI GPT Image 1.5',
  'Midjourney V6', 'Midjourney V7', 'FLUX 1.1 Pro', 'Flux.1 Krea', 'Stable Diffusion 3.0',
];
imageProperties.model.enum = [...new Set([...images.models, ...legacyImageModels])];
imageProperties.editModel.enum = images.EDIT_MODEL_VALUES;

const code = value => '`' + value + '`';
const values = list => list.map(code).join(', ');
function seconds(list) {
  if (!list?.length) return 'Provider-specific';
  const numbers = [...new Set(list.map(value => Number(value.replace(/s$/, ''))))].sort((a, b) => a - b);
  if (numbers.length > 3 && numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)) {
    return `${numbers[0]}–${numbers.at(-1)} (whole seconds)`;
  }
  return numbers.join(', ');
}
function input(model) {
  const o = model.options;
  if (o.requiresReferenceImages) return o.supportsReferenceVideo ? 'Reference images or video' : 'Reference images';
  if (o.inputType.includes('image')) return o.supportsTailImage ? 'First image + optional last image' : 'First image';
  return 'Text';
}
function family(model) {
  if (/^Wan/i.test(model.title)) return 'WAN';
  if (model.title.startsWith('Gemini')) return 'Gemini Omni';
  if (model.title.startsWith('Happy')) return 'Happy Horse';
  return model.title.split(' ')[0];
}
function mediaLimit(config, countKey) {
  if (!config) return '—';
  const parts = [`${config[countKey] || 1} max`];
  if (config.minClipSeconds !== undefined || config.maxClipSeconds !== undefined) {
    parts.push(`${config.minClipSeconds || 0}–${config.maxClipSeconds || '?'}s each`);
  }
  if (config.maxTotalSeconds) parts.push(`${config.maxTotalSeconds}s total`);
  if (config.maxBytesPerClip) parts.push(`${config.maxBytesPerClip / (1024 * 1024)} MiB each`);
  if (config.acceptedFormats?.length) parts.push(config.acceptedFormats.join('/'));
  return parts.join('; ');
}

let page = `---
title: 'Video models'
description: 'Exact API model names, input modes, durations, resolutions, and reference limits'
---

Choose an exact model name for [Generate Video](/api-reference/endpoint/generate-video). Every request requires a non-empty \`prompt\` and a \`model\`.

The tables below are generated from the app's video catalog. They describe the settings accepted by the API's model validation; provider availability and plan limits also apply.

## Choose settings

- Send \`duration\` as a **string**, such as \`"5"\` or \`"8s"\`. A range means every whole second in that range. A comma-separated list means only those durations.
- Send an explicitly listed \`resolution\` and \`aspectRatio\` when the model offers them. \`2k\` and \`4k\` use a lowercase \`k\`. **Omit** a setting marked “Provider-specific” or “From input”.
- If you omit \`duration\`, the API selects five seconds when listed, otherwise the first configured duration, or five seconds when no duration list is configured. Provider-specific models may use their own output length. Explicit settings make requests more predictable.
- “First image” requires \`image\`. A model that accepts a last image also accepts \`tailImage\` alongside \`image\`. Supply both when you want first-to-last-frame interpolation.
- Reference models take \`referenceImages\`, or \`referenceVideos\` where listed. The reference tables below list optional audio inputs and limits.

<Note>
Model suffixes are not a reliable way to select the input mode. \`Grok Imagine 1.5\`, \`Kling 2.5 Turbo Standard\`, and \`Seedance 1.0 Pro Fast\` require an image. \`Grok Imagine 1.5 Text\` and \`Seedance v1 Pro Fast\` take text.
</Note>

## Model catalog

`;
const groups = new Map();
for (const v of videos) {
  const name = family(v);
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push(v);
}
for (const [name, models] of groups) {
  page += `### ${name}\n\n| Model | Input | Duration (seconds) | Resolution | Aspect ratio |\n| --- | --- | --- | --- | --- |\n`;
  for (const v of models) {
    const o = v.options;
    page += `| ${code(v.title)} | ${input(v)} | ${seconds(o.duration)} | ${o.resolution?.length ? values(o.resolution) : 'Provider-specific'} | ${o.aspectRatio?.length ? values(o.aspectRatio) : 'From input'} |\n`;
  }
  page += '\n';
}
page += `## Reference limits

All media URLs must be downloadable without browser cookies and remain valid through any queue delay. Limits are **per request**, not per account. Additional reference media can increase the credit cost.

Do not combine \`referenceVideos\` with \`image\` or \`tailImage\`. Audio references require a companion reference image or a supported reference video; they cannot be used with a first-frame \`image\`.

| Model | Reference images (max) | Reference video | Reference audio |
| --- | --- | --- | --- |
`;
for (const v of videos.filter(v => v.options.supportsReferenceImages || v.options.supportsReferenceVideo)) {
  const o = v.options;
  page += `| ${code(v.title)} | ${o.referenceImageConfig?.maxImages || '—'} | ${mediaLimit(o.referenceVideoConfig, 'maxVideos')} | ${mediaLimit(o.referenceAudioConfig, 'maxAudios')} |\n`;
}
page += `
Veo reference images are optional on the variants listed above. For \`Gemini Omni Flash Reference\` video editing, the output follows the input clip's duration. Input requirements still apply when a model offers reference images alongside a first-frame mode.

## Free plan settings

Free accounts can use the variants below with sufficient remaining credits. Send the listed resolution explicitly. All other models require a paid plan.

| Model | Resolution | Maximum duration |
| --- | --- | --- |
`;
for (const v of videos.filter(v => v.freeUserAccess)) {
  const policy = v.freePlanPolicy || {};
  page += `| ${code(v.title)} | ${values(policy.resolutions || v.options.resolution || []) || 'Model settings'} | ${policy.maxDurationSeconds ? `${policy.maxDurationSeconds} seconds` : 'Model settings'} |\n`;
}
page += `
## Retired and separate features

\`Sora 2\`, \`Sora 2 Pro\`, and their Image variants are no longer accepted by this endpoint. Choose a current model and update its duration, resolution, and inputs together.

Kling Motion Control uses a separate web-app workflow. Its motion-video payload is not supported by this public API endpoint.
`;

function output(relativePath, content) {
  const file = path.join(docsRoot, relativePath);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  if (check) {
    console.error(`Out of date: ${relativePath}`);
    process.exitCode = 1;
  } else {
    fs.writeFileSync(file, content);
    console.log(`Updated ${relativePath}`);
  }
}
output('api-reference/openapi.json', JSON.stringify(spec, null, 2) + '\n');
output('api-reference/video-models.mdx', page);
console.log(`Checked ${videos.length} public video variants, ${imageProperties.model.enum.length} image models, and ${images.EDIT_MODEL_VALUES.length} edit models.`);
