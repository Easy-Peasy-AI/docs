# Easy-Peasy.AI docs: instructions for writers and agents

Mintlify site served at `https://easy-peasy.ai/docs` (Mintlify "Host at" + the
rewrites in the app's `next.config.mjs`). Pages are MDX with YAML frontmatter;
navigation lives in `docs.json`. Preview with `npx mint dev --no-open` (Node 22+;
without `--no-open` it opens a tab in the active Chrome window, which pushes the
screenshot tab to the background). Check with `npx mint broken-links`.
`npx mint validate` always reports one warning, that `docs.json` isn't an
OpenAPI file; it's a CLI quirk and appears on `main` too.

## Structure

| Tab | Folder | Audience |
| --- | --- | --- |
| Guides | `index.mdx`, `get-started/`, `ai-images/`, `account/`, then one folder per product area as it's written (`marky/`, `ai-employees/`, `videos/`, `audio/`, `tools/`, `agents/`, `workflows/`) | People using the dashboard |
| Developers | `developers/`, `mcp/` | People building on the API, MCP server, or embeds |
| API Reference | `api-reference/` | Endpoint reference generated from `api-reference/openapi*.json` |

Keep URLs stable. If a page moves, add a `redirects` entry to `docs.json`.

## Terminology

Use these names exactly. The docs repeat them hundreds of times, so consistency matters more than style.

| Use | Meaning | Don't use |
| --- | --- | --- |
| **Easy-Peasy.AI** | The product and company | Easy Peasy, EasyPeasy |
| **Marky Agent**, then **Marky** | The AI agent in the sidebar that chats, researches, builds slides and websites | Marky Chat, the chatbot |
| **Agents** | AI agents people build, train on their data, and deploy to a website or channels (formerly Bots) | bots, chatbots (except "formerly Bots", once per page at most) |
| **AI Employees**, then **employees** | The product, then the AI teammates people hire in it. Each has a role, instructions, memory, a computer, and apps | AI workers, bots, agents |
| **direct message** | An employee's one-to-one chat with its owner | DM (in prose), conversation (for the whole list) |
| **group chat** | A conversation with several employees, and sometimes invited people (`rooms` in the code) | room, channel |
| **routines** | Work an employee does on its own, on a schedule or when a webhook or email starts it. Marky's equivalent is **automations** | scheduled tasks |
| **tools** | The single-purpose AI generators under **All Tools** (Blog Post Generator, SOAP Note Generator, and so on) | templates, presets |
| **custom tools** | Tools people build themselves with **Create Tool** | custom generators, dynamic templates |
| **templates** | Ready-made starting points inside a creator: image and video templates, workflow templates, slide templates | tools |
| **presets** | Only in the API docs, where `preset` is the request field. Say "tools (called presets in the API)" once | anywhere in Guides |
| **words** | The text allowance used by Marky and text tools | tokens (except in API docs) |
| **image & video credits** (short: **credits**) | The allowance used by images, videos and other visual features, as labelled in **Settings** > **Subscription** | coins, points |
| **text-to-speech characters** | The audio allowance (text to speech, voice changer, dubbing, sound effects, music), shown as **Text to Speech Usage** | speech credits |
| **bonus credits**, **bonus words** | Extra allowance bought separately or earned through referrals; used after the plan allowance and carried over | add-on credits |
| **dashboard** | The signed-in app at easy-peasy.ai | platform, portal |


## Writing style

- Second person, active voice, present tense. One idea per sentence.
- Sentence case for titles and headings.
- UI labels in bold, spelled exactly as on screen: click **Buy more credits**. Menu paths: **Settings** > **Subscription**.
- Lead with what the reader can do. No marketing adjectives ("powerful", "seamless", "cutting-edge").
- Don't put prices, model lists, or credit costs in prose if they change often. Link to https://easy-peasy.ai/pricing for prices. Take credit costs and limits from the app code (`kopi/src/constants/*`), never from memory or marketing pages.
- `description` in frontmatter is one sentence; it's what search results and AI assistants show.

## Page template

1. One-paragraph intro: what this is and when you'd use it.
2. Requirements, if any (plan, connected account) in a `<Note>`.
3. The task as `<Steps>`, one screenshot per step where it helps.
4. Options or settings as a table.
5. Credits: what it costs and where to check usage.
6. Troubleshooting or FAQ as `<AccordionGroup>`.
7. Related pages as `<Columns>` of `<Card>`s.

## Screenshots

- Take them only from the docs demo account (`docs@easy-peasy.ai`), never a personal or customer account. No real names, emails, customer conversations, or API keys in any image.
- Capture with `scripts/capture_chrome.py` from a Chrome tab at a 1440×900 viewport, light theme, browser zoom 100%. The tab must be the active tab of a window of its own (drag it out of your main window once), or the script captures nothing.
- Mark the tab before capturing so no other tab can be captured. Many pages reset their title while you work, so keep the marker on with an observer:
  ```js
  const apply = () => { if (!document.title.startsWith('[cap] ')) document.title = '[cap] ' + document.title; };
  new MutationObserver(apply).observe(document.head, { childList: true, subtree: true, characterData: true });
  apply();
  ```
- If you drive the tab with the Claude in Chrome extension, hide its overlays before capturing: `#claude-agent-glow-border,#claude-phantom-cursor{display:none!important}`.
- Don't screenshot the dashboard's **Examples** tab or other public galleries: they show other people's images.
- Full-page shots: `--max-width 1600`. Detail shots: pass `--clip x,y,w,h` (CSS pixels) around the relevant part of the UI. Photo-heavy shots (galleries, style pickers) compress poorly: resave them at 1200 px wide and WebP quality 85.
- To point at a control, give it an indigo ring before capturing:
  `el.style.outline = '3px solid #6366F1'; el.style.outlineOffset = '3px'`. Remove it afterwards.
- Hide account-specific banners (a pending cancellation, trial countdowns) that most readers won't see, but never fake UI text or numbers.
- Save as WebP in `images/<folder>/<page>-<what>.webp`, and show with alt text:
  ```mdx
  <Frame caption="Optional caption">
    <img src="/images/account/subscription-plan-card.webp" alt="What the screenshot shows" />
  </Frame>
  ```

## Publishing

Open a pull request to `main`. Mintlify publishes what's merged. Check the published page after deploying.

## Generated content

`snippets/image-models.mdx` and `snippets/image-edit-models.mdx` (from the app's image catalog), `snippets/chat-models.mdx` (from Marky's model catalog, grouped like the model picker), and `snippets/video-models.mdx` and `snippets/video-reference-limits.mdx` (from the video catalog, one row per model family in the picker's order), `snippets/agent-models.mdx` (the agent model picker from `botModels.ts`, with each model's Free-plan access and whether it uses words) `snippets/agent-plan-limits.mdx` (agents, actions and knowledge characters per plan from `common.ts`) and `snippets/audio-plan-limits.mdx` (text-to-speech characters, transcriptions and custom voices per plan from `common.ts` and `utils/voices.ts`) are generated by `scripts/sync-models.cjs`, the same script that refreshes the API reference. Don't edit them by hand; re-run the script when models or prices change. Pages import them, for example `import ImageModels from '/snippets/image-models.mdx';`.

The chat table shows the picker's display rate (`multiplier`). The real billing rules live in `kopi/src/data/edge.ts` (the Free plan's flat 0.2x, "Unlimited" models at 0.1x outside Unlimited and Teams plans, input-token charges on some large models); `marky/models.mdx` explains them in prose, so update that page when those rules change.

Agent pages carry a few hand-written rules from the app code: the Free plan's 100 agent messages per 30 days (`notify-about-messages-limit-for-free-bots.ts`), the voice-call plan list, trial minutes and 2x word rate (`kopi/src/constants/botVoice.ts`, bots server `voice/pipeline.ts`), 200 words per attached image (`kopi/src/constants/botImageInput.ts`), and the Free channels (`FREE_PLAN_CHANNELS` in `components/bots/Integration/catalog.ts`). Check `agents/limits-and-usage.mdx`, `agents/voice.mdx` and `agents/appearance.mdx` when those change.

Audio pages carry hand-written rules too: text-to-speech rates (Turbo half, **Saver** voices one per 10) and per-generation caps (`kopi/src/pages/tts.tsx` and `/api/generate-audio`), and how transcriptions are counted (`getTotalAudios` in `kopi/src/data/audios.ts`). Check `audio/text-to-speech.mdx` and `audio/speech-to-text.mdx` when those change. The other audio tools draw on the same character allowance at hand-written rates: voice changer and dubbing about 2,000 per minute (`VOICE_CHANGER_SECONDS_AS_WORDS_MULTIPLIER`, `DUBBING_SECONDS_AS_WORDS_MULTIPLIER` in `common.ts`), sound effects and the audio generator 1,000 per generation (`soundEffects.ts`, `audioGenerator.ts`), and music 600 per generation, because Suno returns two tracks at 300 each (`generate-song.ts` + `webhooks/song-callback.ts`). `audio/limits.mdx` has the table; check it, the tool's own page, `marky/media.mdx`, `videos/video-editor.mdx`, `videos/video-agent.mdx` and `workflows/build.mdx` when those change.

Tools, workflows and the image extras carry hand-written rates as well: the tools model table in `tools/models.mdx` (the multiplier lists and `getClaudePresetInputRates` in `kopi/src/data/completions.ts`, options in `constants/aiModels.ts`), the public-link limits in `tools/custom-tools.mdx` (`api/shared-template/generate.ts`), Interior Designer prices (`api/room-gpt.ts`, `constants/nanoBananaCredits.ts`), the Photo Studio rendering models (`PHOTO_STUDIO_ENGINES` in `pages/ai-images/index.tsx`) and pack price (`run-photo-packs.ts`), headshot packages (`components/headshots/PricingSection.tsx`), and referral bonuses (`constants/referrals.ts`).

AI Employees pages (`ai-employees/`) are hand-written from the app code too. Check them when these change: employees per plan (`EMPLOYEES_IN_PLAN` and `employeesLimitForPlan` in `kopi/src/constants/employees.ts`), the Standard and Best quality models (`DEFAULT_EMPLOYEE_MODEL`, `EMPLOYEE_BEST_QUALITY_MODEL`, same file), voice calls (`VOICE_CALL_PLANS` and the `VOICE_TRIAL_*` constants in `constants/botVoice.ts`; `EMPLOYEE_CALL_MAX_MINUTES`, `EMPLOYEE_CALL_MAX_TASKS`, `EMPLOYEE_CALL_END_AFTER_SILENCE` and `EMPLOYEE_VOICE_MODELS` in `constants/employeeVoice.ts`), approvals (`DEFAULT_APPROVAL_POLICY` and the gated tools in `lib/employee-approvals/rules.ts`, `LIVE_APPROVAL_WAIT_MS` in `gate.ts`, the email interval in `notify.ts`, the 7-day expiry in `docs/ai-employees-approvals.sql`), routines (`ROUTINE_EVENT_LIMITS` in `lib/routine-triggers/constants.ts`, the 10-routine cap and 5-minute minimum in `pages/api/employees/[uuid]/routines.ts`, `SCHEDULE_PRESETS` in `components/employees/workspace/routines/routineFormat.tsx`), group chats (`MAX_ROOMS_PER_USER` and `MAX_ROOM_MEMBERS` in `lib/employee-team/api.ts`, hand-off limits in `routing.ts`, task reminders in `tasks.ts`), invited people (`ROOM_PEOPLE_LIMITS`, invite and per-person limits in `lib/employee-team/people.ts`, file limits in `attachments.ts`, email rules in `notifications.ts`), Slack (`DEFAULT_SLACK_SETTINGS` in `lib/employee-slack/config.ts`), and the company profile fields (`lib/companyProfile.ts`). Screenshots for these pages come from the test account `ai-employees@easy-peasy.ai`, with the fictional brand Aurela (a small perfume brand) in examples. Never show an Aurela web address: aurela.com and aurela.co are real sites.

The other video tools price outside the catalog, so their pages carry hand-written rates: `videos/extend.mdx` (`kopi/src/constants/videoExtend.ts`), `videos/edit.mdx` (the edit tiers in `videoModels.ts`), `videos/upscale.mdx` (`VIDEO_UPSCALE_CREDITS_PER_SECOND` and `MINIMAX_VIDEO_UPGRADE_CREDITS` in `common.ts`), `videos/motion-control.mdx` and `videos/talking-videos.mdx` (their API routes). Check them when those change.

## Keeping the API reference current

See `README.md`: `scripts/sync-models.cjs` refreshes model enums from the app, and `scripts/validate-docs.cjs` checks schemas and examples.
