#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.argv[2] || path.join(root, '../kopi'));
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const spec = JSON.parse(read('api-reference/openapi.json'));
const Ajv = appRequire('ajv');
const ajv = new Ajv({ allErrors: true, nullable: true, schemaId: 'auto', unknownFormats: 'ignore' });
ajv.addSchema(spec, 'easy-peasy');
let examples = 0;

function validate(schema, data, label) {
  // Keep local OpenAPI component references resolvable from standalone schemas.
  const external = JSON.parse(JSON.stringify(schema).replace(/"#\/components\//g, '"easy-peasy#/components/'));
  const valid = ajv.validate(external, data);
  assert(valid, `${label}: ${ajv.errorsText(ajv.errors)}`);
  examples++;
}
function visit(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  Object.values(value).forEach(item => visit(item, fn));
}
visit(spec, item => {
  if (item.$ref?.startsWith('#/')) {
    const result = item.$ref.slice(2).split('/').reduce((parent, key) => parent?.[key], spec);
    assert(result, `Unresolved schema: ${item.$ref}`);
  }
});
for (const [url, ops] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(ops)) {
    const contents = [operation.requestBody?.content, ...Object.values(operation.responses || {}).map(response => response.content)];
    for (const content of contents) {
      for (const media of Object.values(content || {})) {
        if (!media.schema) continue;
        if (media.example !== undefined) validate(media.schema, media.example, `${method} ${url}`);
        for (const example of Object.values(media.examples || {})) {
          if (example.value !== undefined) validate(media.schema, example.value, `${method} ${url}: ${example.summary}`);
        }
      }
    }
  }
}

// Read the catalog without importing any routes or provider clients.
const bundled = appRequire('esbuild').buildSync({
  absWorkingDir: appRoot, entryPoints: ['src/constants/videoModels.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', loader: { '.svg': 'empty' },
}).outputFiles[0].text;
const catalogModule = { exports: {} };
new Function('module', 'exports', 'require', bundled)(catalogModule, catalogModule.exports, appRequire);
const models = catalogModule.exports.videoModelsWithDescription;
function videoSettings(body) {
  const model = models.find(model => model.title === body.model);
  assert(model && !model.options.isMotionControl, `Unsupported video model: ${body.model}`);
  const o = model.options;
  if (body.duration && o.duration) {
    assert(o.duration.some(d => d.replace(/s$/, '') === body.duration.replace(/s$/, '')), `Invalid duration for ${body.model}`);
  }
  if (body.resolution) assert(o.resolution?.includes(body.resolution), `Invalid resolution for ${body.model}`);
  if (body.aspectRatio && o.aspectRatio?.length) assert(o.aspectRatio.includes(body.aspectRatio), `Invalid aspect ratio for ${body.model}`);
  if (o.inputType.includes('image')) assert(body.image, `Missing image for ${body.model}`);
  if (body.image) assert(o.inputType.includes('image'), `Unexpected image for ${body.model}`);
  if (body.tailImage) assert(o.supportsTailImage && body.image, `Unsupported tail image for ${body.model}`);
  if (o.requiresReferenceImages) assert(body.referenceImages?.length || body.referenceVideos?.length || body.referenceVideo, `Missing reference input for ${body.model}`);
  if (body.referenceImages) assert(o.supportsReferenceImages && body.referenceImages.length <= o.referenceImageConfig.maxImages, `Invalid image references for ${body.model}`);
  if (body.referenceVideos) assert(o.supportsReferenceVideo && body.referenceVideos.length <= o.referenceVideoConfig.maxVideos, `Invalid video references for ${body.model}`);
  if (body.referenceAudios) assert(o.supportsReferenceAudio && body.referenceAudios.length <= o.referenceAudioConfig.maxAudios, `Invalid audio references for ${body.model}`);
}
for (const example of Object.values(spec.paths['/api/generate-video'].post.requestBody.content['application/json'].examples)) videoSettings(example.value);

function files(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.mdx') ? [file] : [];
  });
}
const pages = [...files('api-reference'), ...files('mcp')];
function localLink(link, from) {
  const clean = link.split('#')[0].split('?')[0];
  if (!clean || !clean.startsWith('/')) return;
  const destination = path.join(root, clean);
  assert(['', '.mdx', '.md'].some(ext => fs.existsSync(destination + ext)), `Broken local link ${link} in ${from}`);
}
const nav = JSON.parse(read('docs.json'));
visit(nav.navigation, item => {
  for (const page of item.pages || []) if (typeof page === 'string') localLink('/' + page, 'docs.json');
});

function pollingCode(file, name) {
  const blocks = [...read(file).matchAll(/```javascript\n([\s\S]*?)```/g)];
  const block = blocks.find(match => match[1].includes(`async function ${name}`));
  assert(block, `Missing polling example: ${name}`);
  return block[1];
}
let pollingCases = 0;
async function runPoll(kind, responses, expected, errorPattern) {
  const name = kind === 'video' ? 'waitForVideo' : 'waitForTranscription';
  const file = kind === 'video' ? 'generate-video' : 'create-transcription';
  let now = 0;
  let calls = 0;
  const context = {
    Date: { now: () => now },
    AbortSignal: { timeout: ms => { assert(ms > 0 && ms <= 30000); return {}; } },
    encodeURIComponent,
    setTimeout: (fn, ms) => { now += ms; fn(); },
    fetch: async (url, init) => {
      assert(init.headers['x-api-key'] === 'test-key');
      if (kind === 'video') assert(url.endsWith('video_id=123'));
      else assert(JSON.parse(init.body).audio_id === '123');
      const result = responses[Math.min(calls++, responses.length - 1)];
      assert(calls <= 41, 'Polling did not stop at the deadline');
      if (result.networkError) throw new Error('Network error');
      return { ok: (result.status || 200) < 400, status: result.status || 200,
        json: async () => { if (result.invalidJSON) throw new Error('Invalid JSON'); return result.body; } };
    },
  };
  vm.createContext(context);
  vm.runInContext(pollingCode(`api-reference/endpoint/${file}.mdx`, name) + `\nresult = ${name}('123', 'test-key');`, context);
  if (errorPattern) await assert.rejects(context.result, errorPattern);
  else assert.equal(JSON.stringify(await context.result), JSON.stringify(expected));
  if (responses[0].networkError || (responses[0].status || 200) >= 400) assert.equal(calls, 1);
  pollingCases++;
}

async function main() {
  const { compile } = await import(pathToFileURL(appRequire.resolve('@mdx-js/mdx')).href);
  for (const file of pages) {
    const source = read(file);
    await compile(source.replace(/^---\n[\s\S]*?\n---\n/, ''));
    for (const match of source.matchAll(/(?:href=["']([^"']+)["']|\]\((\/[^)]+)\))/g)) localLink(match[1] || match[2], file);
    for (const match of source.matchAll(/```bash[^\n]*\n([\s\S]*?)```/g)) {
      const endpoint = match[1].match(/https:\/\/easy-peasy\.ai(\/api\/[a-z/-]+)/)?.[1];
      const data = match[1].match(/-d\s+'([\s\S]*?)'/)?.[1];
      if (!endpoint || !data) continue;
      const body = JSON.parse(data);
      const schema = spec.paths[endpoint]?.post?.requestBody?.content?.['application/json']?.schema;
      assert(schema, `Undocumented cURL endpoint: ${endpoint}`);
      validate(schema, body, `${file} cURL`);
      if (endpoint === '/api/generate-video') videoSettings(body);
    }
  }
  const pending = { video: { status: 'processing', url: '' } };
  const completed = { video: { status: 'completed', url: 'https://example.com/video.mp4' } };
  await runPoll('video', [{ body: pending }, { body: completed }], completed.video.url);
  await runPoll('video', [{ body: pending }], null, /Timed out/);
  await runPoll('video', [{ body: { video: { status: 'completed', url: '' } } }], null, /Unexpected/);
  await runPoll('video', [{ invalidJSON: true }], null, /Unexpected/);
  const transcript = { uuid: '123', transcription_status: 'done', content: 'Hello' };
  await runPoll('audio', [{ body: { uuid: '123', transcription_status: 'processing' } }, { body: transcript }], transcript);
  const silent = { ...transcript, content: '' };
  await runPoll('audio', [{ body: silent }], silent);
  const legacy = { uuid: '123', content: 'Hello' };
  await runPoll('audio', [{ body: legacy }], legacy);
  await runPoll('audio', [{ body: { uuid: '123', transcription_status: 'failed' } }], null, /failed/);
  await runPoll('audio', [{ body: { uuid: '123', transcription_status: 'unknown' } }], null, /Unknown/);
  await runPoll('audio', [{ body: { uuid: '123', transcription_status: 'processing' } }], null, /Timed out/);
  await runPoll('audio', [{ invalidJSON: true }], null, /Unexpected/);
  for (const kind of ['video', 'audio']) {
    for (const status of [401, 404, 500]) await runPoll(kind, [{ status, body: { error: 'Unavailable' } }], null, new RegExp(`HTTP ${status}`));
    await runPoll(kind, [{ networkError: true }], null, /Network error/);
  }
  execFileSync(process.execPath, [path.join(root, 'scripts/sync-models.cjs'), appRoot, '--check'], { stdio: 'inherit' });
  console.log(`Validated ${pages.length} MDX pages, ${examples} schema/cURL examples, video settings, local links, and ${pollingCases} polling cases.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
