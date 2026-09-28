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

const videoCatalog = catalog('src/constants/videoModels.ts');
const videos = videoCatalog.videoModelsWithDescription
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

// User-guide snippets for /images/models. The picker's own strings are the
// source: `users` is the credits line on each model card, and the Free-plan
// locks mirror PREMIUM_IMAGE_MODELS / isPremiumEditModel. Edit prices are not
// published here because editModels[].credits is not what the server charges
// for every model; the Generate button shows the price.
const mdxCell = value => String(value)
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\|/g, '\\|')
  .replace(/[{}]/g, match => `\\${match}`)
  .replace(/</g, '&lt;');
const generatedNote = '{/* Generated by scripts/sync-models.cjs from the app\'s image catalog. Do not edit by hand. */}\n\n';
const premiumImages = new Set(images.PREMIUM_IMAGE_MODELS);
const pickerModels = images.modelsWithDescription.filter(model => !model.isCustom);
let imageModelsSnippet = `${generatedNote}| Model | Good for | Credits per image | Free plan |\n| --- | --- | --- | --- |\n`;
for (const model of pickerModels) {
  imageModelsSnippet += `| ${mdxCell(images.getModelDisplayName(model.title))} | ${mdxCell(model.description)} | ${mdxCell(model.users)} | ${premiumImages.has(model.title) ? 'No' : 'Yes'} |\n`;
}
const editNames = list => list.map(model => mdxCell(images.getModelDisplayName(model.label))).join(', ');
const editForAll = images.editModels.filter(model => !images.isPremiumEditModel(model.value));
const editPaidOnly = images.editModels.filter(model => images.isPremiumEditModel(model.value));
const editModelsSnippet = `${generatedNote}- **Every plan:** ${editNames(editForAll)}\n- **Paid plans only:** ${editNames(editPaidOnly)}\n`;

// Marky's model picker (src/components/Chat/ChatModelList.tsx): same
// provider order, same "{n}x" / "Unlimited" labels. The `multiplier` shown
// there is display data; the page explains the plan rules that change it.
const chat = catalog('src/constants/chatModels.ts');
const providerOrder = ['OpenAI', 'Anthropic', 'Google', 'xAI', 'Meta', 'Deepseek',
  'Perplexity', 'Mistral AI', 'Moonshot', 'Qwen'];
const visibleChatModels = chat.chatModels.filter(model => !model.hidden);
const chatProviders = [...new Set(visibleChatModels.map(model => model.provider || 'Other'))]
  .sort((a, b) => {
    const rank = name => (providerOrder.includes(name) ? providerOrder.indexOf(name) : providerOrder.length);
    return rank(a) - rank(b);
  });
const wordRate = model => (model.multiplier === 0 ? 'Unlimited' : `${model.multiplier ?? 1}x`);
const has = (model, feature) => (model.features || []).includes(feature) ? 'Yes' : '—';
let chatModelsSnippet = generatedNote.replace('image catalog', 'chat model catalog');
for (const provider of chatProviders) {
  chatModelsSnippet += `### ${mdxCell(provider)}\n\n| Model | Word rate | Free plan | Web search | Reads files |\n| --- | --- | --- | --- | --- |\n`;
  for (const model of visibleChatModels.filter(m => (m.provider || 'Other') === provider)) {
    const name = model.slug === chat.DEFAULT_CHAT_MODEL_SLUG ? `${mdxCell(model.title)} (default)` : mdxCell(model.title);
    chatModelsSnippet += `| ${name} | ${wordRate(model)} | ${model.availableForFree ? 'Yes' : 'No'} | ${has(model, 'internet')} | ${has(model, 'python')} |\n`;
  }
  chatModelsSnippet += '\n';
}
chatModelsSnippet = chatModelsSnippet.trimEnd() + '\n';

// Agents model picker (src/components/bots/BotModelModal.tsx): every model
// without `hidden`, grouped by provider. `countWords: false` models don't use
// words on the bots server (isProModel); everything else bills words.
const bot = catalog('src/constants/botModels.ts');
const visibleBotModels = bot.chatModels.filter(model => !model.hidden);
const botProviderOrder = ['OpenAI', 'Anthropic', 'Google', 'xAI', 'Meta', 'Deepseek',
  'Z.ai', 'MiniMax', 'Moonshot'];
const botProviders = [...new Set(visibleBotModels.map(model => model.modelProvider || 'Other'))]
  .sort((a, b) => {
    const rank = name => (botProviderOrder.includes(name) ? botProviderOrder.indexOf(name) : botProviderOrder.length);
    return rank(a) - rank(b);
  });
const defaultBotSlug = bot.DEFAULT_BOT_MODEL.model.replace(/-dbase$/, '');
let agentModelsSnippet = generatedNote.replace('image catalog', 'agent model catalog');
for (const provider of botProviders) {
  agentModelsSnippet += `### ${mdxCell(provider)}\n\n| Model | Free plan | Uses words |\n| --- | --- | --- |\n`;
  for (const model of visibleBotModels.filter(m => (m.modelProvider || 'Other') === provider)) {
    const name = model.slug === defaultBotSlug ? `${mdxCell(model.title)} (default)` : mdxCell(model.title);
    agentModelsSnippet += `| ${name} | ${model.availableForFree ? 'Yes' : 'No'} | ${model.countWords === false ? 'No' : 'Yes'} |\n`;
  }
  agentModelsSnippet += '\n';
}
agentModelsSnippet = agentModelsSnippet.trimEnd() + '\n';

// Agent limits per plan (BOTS_IN_PLAN, ACTIONS_IN_PLAN, CHARACTERS_IN_PLAN),
// for the plans on sale today (products_for_free_plan) plus Free.
const common = catalog('src/constants/common.ts');
const agentPlans = ['Free', 'Starter', 'Unlimited 50', 'Unlimited', 'Unlimited 200', 'Unlimited 350',
  'Unlimited 500', 'Unlimited 1000', 'Unlimited 2000', 'Unlimited 5000', 'Teams'];
const millions = n => (n >= 1000000 ? `${n / 1000000}M` : n.toLocaleString('en-US'));
let agentLimitsSnippet = generatedNote.replace('image catalog', 'plan limits')
  + '| Plan | Agents | Actions per agent | Knowledge characters per agent |\n| --- | --- | --- | --- |\n';
for (const plan of agentPlans) {
  agentLimitsSnippet += `| ${plan} | ${common.BOTS_IN_PLAN[plan]} | ${common.ACTIONS_IN_PLAN[plan]} | ${millions(common.CHARACTERS_IN_PLAN[plan])} |\n`;
}

// Audio allowances per plan: text-to-speech characters (SPEECHES_WORDS_IN_PLAN),
// transcriptions (AUDIOS_IN_PLAN), and custom voices (utils/voices.ts).
const voiceLimits = catalog('src/utils/voices.ts');
let audioLimitsSnippet = generatedNote.replace('image catalog', 'plan limits')
  + '| Plan | Text-to-speech characters | Transcriptions | Custom voices | Professional clones |\n| --- | --- | --- | --- | --- |\n';
for (const plan of agentPlans) {
  audioLimitsSnippet += `| ${plan} | ${common.SPEECHES_WORDS_IN_PLAN[plan].toLocaleString('en-US')} | ${common.AUDIOS_IN_PLAN[plan].toLocaleString('en-US')} | ${voiceLimits.getMaxClonedVoices(plan)} | ${voiceLimits.canUseProfessionalVoiceClone(plan) ? 'Yes' : 'No'} |\n`;
}

// Video Generator picker (src/components/videos/VideoModelSelection.tsx): one
// row per model family (its text, image and reference variants together), in
// the picker's pin order. Rates are the catalog's creditsPerSecond and
// resolution multipliers, the inputs getVideoModelCredits prices from.
const FAMILY_ALIASES = { 'Wan-2.2': 'Wan v2.2', 'Seedance 1.0 Pro Fast': 'Seedance v1 Pro Fast' };
const familyName = model => {
  const base = model.title.replace(/ (Image|Reference|First-Last Frame|Text)$/, '');
  return FAMILY_ALIASES[base] || base;
};
const PIN_PREFIXES = ['minimax/h3/', 'bytedance/seedance-2.0/fast/', 'bytedance/seedance-2.0-mini/',
  'bytedance/seedance-2.5/', 'black-forest-labs/flux-3/', 'alibaba/wan-3.0/'];
const pinRank = model => {
  const rank = PIN_PREFIXES.findIndex(prefix => model.model.startsWith(prefix));
  return rank === -1 ? PIN_PREFIXES.length : rank;
};
const quality = value => value.replace(/k$/, 'K');
const RESOLUTION_ORDER = ['360p', '480p', '720p', '768p', '1080p', '2k', '4k'];
const byResolution = (a, b) => RESOLUTION_ORDER.indexOf(a) - RESOLUTION_ORDER.indexOf(b);
const number = value => String(Math.round(value * 100) / 100);
const secondsOf = model => (model.options.duration || []).map(value => Number(String(value).replace(/s$/, '')));
function secondsLabel(list) {
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  if (!sorted.length) return 'Set by the model';
  if (sorted.length > 3 && sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)) {
    return `${sorted[0]}–${sorted.at(-1)} s`;
  }
  return `${sorted.join(', ')} s`;
}
const ratePerSecond = (model, resolution) =>
  model.options.creditsPerSecond * ((resolution && model.options.resolutionCreditsMultiplier?.[resolution]) || 1);
function priceLabel(model) {
  const o = model.options;
  if (o.creditsPerSecond !== undefined) {
    const resolutions = [...(o.resolution || [])].sort(byResolution);
    if (!resolutions.length) return `${number(o.creditsPerSecond)} per second`;
    return resolutions
      .map((resolution, i) => `${number(ratePerSecond(model, resolution))}${i === 0 ? ' per second' : ''} at ${quality(resolution)}`)
      .join(', ');
  }
  const durations = secondsOf(model).sort((a, b) => a - b);
  if (!durations.length) return `${model.credits} per video`;
  return durations
    .map(seconds => `${videoCatalog.getVideoModelCredits(model.title, String(seconds))} for ${seconds} s`)
    .join(', ');
}
const families = new Map();
videos.forEach((model, index) => {
  const name = familyName(model);
  if (!families.has(name)) families.set(name, { name, index, rank: pinRank(model), models: [] });
  const family = families.get(name);
  family.rank = Math.min(family.rank, pinRank(model));
  family.models.push(model);
});
let videoModelsSnippet = generatedNote.replace('image catalog', 'video catalog')
  + '| Model | Starts from | Length | Quality | Credits | Free plan |\n| --- | --- | --- | --- | --- | --- |\n';
// Reference limits for /videos/references, one row per family that takes
// references. The app attaches at most one video and one audio file per job,
// which the page says in prose.
const referenceRows = [];
function referenceRow(name, models) {
  const imageConfigs = models.map(m => m.options.referenceImageConfig).filter(Boolean);
  const videoConfig = models.map(m => m.options.referenceVideoConfig).find(Boolean);
  const audioConfigs = models.map(m => m.options.referenceAudioConfig).filter(Boolean);
  if (!imageConfigs.length && !videoConfig) return null;
  let images = '—';
  if (imageConfigs.length) {
    const types = new Set(imageConfigs.flatMap(c => c.supportedTypes || []));
    images = `Up to ${Math.max(...imageConfigs.map(c => c.maxImages || 1))}${types.has('style') ? '' : ' (people and objects)'}`;
  }
  let video = '—';
  if (videoConfig?.isEditSource) {
    video = `1 clip to edit, ${videoConfig.minClipSeconds}–${videoConfig.maxClipSeconds} s`;
  } else if (videoConfig) {
    video = `Up to ${videoConfig.maxVideos} clips, ${videoConfig.minClipSeconds}–${videoConfig.maxClipSeconds} s each`
      + (videoConfig.maxTotalSeconds ? `, ${videoConfig.maxTotalSeconds} s in total` : '');
  }
  // The reference variant carries the most detail (clip lengths, formats).
  const audioConfig = audioConfigs.find(c => c.acceptedFormats) || audioConfigs[0];
  let audio = '—';
  if (audioConfig) {
    audio = `Up to ${audioConfig.maxAudios} clips`
      + (audioConfig.maxTotalSeconds ? `, ${audioConfig.maxTotalSeconds} s in total` : '')
      + (audioConfig.acceptedFormats?.length ? `, ${audioConfig.acceptedFormats.map(f => f.toUpperCase()).join(' or ')}` : '');
  }
  return `| ${mdxCell(name)} | ${images} | ${video} | ${audio} |\n`;
}
for (const family of [...families.values()].sort((a, b) => a.rank - b.rank || a.index - b.index)) {
  const { models } = family;
  const plain = models.find(m => m.options.inputType.includes('text') && !m.options.requiresReferenceImages)
    || models.find(m => m.options.inputType.includes('image')) || models[0];
  const inputs = [];
  if (models.some(m => m.options.inputType.includes('text') && !m.options.requiresReferenceImages)) inputs.push('Text');
  if (models.some(m => m.options.inputType.includes('image'))) inputs.push('Image');
  if (models.some(m => m.options.supportsTailImage)) inputs.push('Start and end images');
  if (models.some(m => m.options.supportsReferenceImages)) {
    inputs.push(models.some(m => m.options.supportsReferenceVideo) ? 'Reference images and video' : 'Reference images');
  }
  // Veo's image variants render 8 s only, while text allows 4, 6 or 8.
  const textSeconds = new Set(models.filter(m => m.options.inputType.includes('text')).flatMap(secondsOf));
  const imageSeconds = new Set(models.filter(m => m.options.inputType.includes('image')).flatMap(secondsOf));
  let length = secondsLabel(models.flatMap(secondsOf));
  if (imageSeconds.size && imageSeconds.size < textSeconds.size && [...imageSeconds].every(s => textSeconds.has(s))) {
    length += ` (${secondsLabel([...imageSeconds])} from an image)`;
  }
  const resolutions = [...new Set(models.flatMap(m => m.options.resolution || []))].sort(byResolution);
  let price = priceLabel(plain);
  // A variant that prices a shared quality differently (MiniMax H3 Max
  // Reference has no 480p discount) gets its own note.
  for (const model of models.filter(m => m !== plain && m.options.creditsPerSecond !== undefined)) {
    const differs = (model.options.resolution || []).some(resolution =>
      !plain.options.resolution?.includes(resolution) || ratePerSecond(model, resolution) !== ratePerSecond(plain, resolution));
    if (differs) price += `; ${model.title}: ${priceLabel(model)}`;
  }
  const audioOff = plain.options.audioDisabledCreditsMultiplier;
  if (audioOff !== undefined && audioOff < 1) price += ` (${Math.round((1 - audioOff) * 100)}% less without sound)`;
  const free = models.find(m => m.freeUserAccess);
  const freeLabel = free
    ? [...(free.freePlanPolicy?.resolutions || []).map(quality),
      ...(free.freePlanPolicy?.maxDurationSeconds ? [`up to ${free.freePlanPolicy.maxDurationSeconds} s`] : [])].join(', ') || 'Yes'
    : '—';
  // A family made only of reference models (Kling O3 Reference) keeps its full title.
  const name = models.every(m => m.options.requiresReferenceImages) ? models[0].title : family.name;
  const startsFrom = inputs.map((label, i) => (i === 0 ? label : label.toLowerCase())).join(', ');
  referenceRows.push(referenceRow(name, models));
  videoModelsSnippet += `| ${mdxCell(name)} | ${startsFrom} | ${length} | ${resolutions.map(quality).join(', ') || '—'} | ${mdxCell(price)} | ${freeLabel} |\n`;
}

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
fs.mkdirSync(path.join(docsRoot, 'snippets'), { recursive: true });
output('snippets/image-models.mdx', imageModelsSnippet);
output('snippets/image-edit-models.mdx', editModelsSnippet);
output('snippets/chat-models.mdx', chatModelsSnippet);
output('snippets/agent-models.mdx', agentModelsSnippet);
output('snippets/agent-plan-limits.mdx', agentLimitsSnippet);
output('snippets/audio-plan-limits.mdx', audioLimitsSnippet);
output('snippets/video-models.mdx', videoModelsSnippet);
output('snippets/video-reference-limits.mdx', generatedNote.replace('image catalog', 'video catalog')
  + '| Model | Reference images | Reference video | Reference audio |\n| --- | --- | --- | --- |\n'
  + referenceRows.filter(Boolean).join(''));
console.log(`Checked ${videos.length} public video variants (${families.size} families), ${imageProperties.model.enum.length} image models, ${images.EDIT_MODEL_VALUES.length} edit models, ${visibleChatModels.length} chat models, and ${visibleBotModels.length} agent models.`);
