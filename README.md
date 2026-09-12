# Easy-Peasy.AI documentation

Source for [docs.easy-peasy.ai](https://docs.easy-peasy.ai), published with Mintlify. API schemas live in `api-reference/openapi.json`; endpoint guides are MDX files. Navigation is defined in `docs.json`.

## Update model catalogs

Use a current Easy-Peasy.AI app checkout with its Yarn dependencies installed:

```bash
node scripts/sync-models.cjs /path/to/kopi
node scripts/sync-models.cjs /path/to/kopi --check
```

If the app is in `../kopi`, omit its path. The script loads only the video and image constants using the app's esbuild dependency. It does not load API routes, credentials, or provider clients, and makes no generation requests.

It updates the video model guide, video model/resolution/aspect-ratio enums, and image generation/edit model enums. Motion-control models are excluded because the public video endpoint does not implement their payload. The script retains explicitly listed legacy image routes; review those when changing image routing.

When a model changes, also inspect the API handler: UI defaults can differ from REST defaults, and catalog options do not guarantee provider support. Update request examples, descriptions, and polling behavior when the contract changes. Chat model IDs and aliases must be checked against `src/pages/api/chat/completions.ts` and its provider maps.

## Validate and preview

```bash
node scripts/validate-docs.cjs /path/to/kopi
mint broken-links
mint dev
```

The validation script checks schema references, request/response examples, video settings, MDX compilation, local navigation links, and polling success/error/timeout cases without spending account credits. It uses the app checkout's existing dependencies.

## Publish

Open a pull request to `main`. Mintlify publishes changes merged into the default branch. Check the Mintlify Deployment result and the published page before considering an update complete.
