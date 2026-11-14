/* core.js — the one place that understands a Venice /models record.
 *
 * Loaded by the browser (window.VCore) and required by server.js, so the page,
 * the JSON API, the Markdown tables and the MCP tools all describe a model the
 * same way. No DOM, no network: data in, plain objects and strings out.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// =====================================================================
// CONTENT POLICY
//
// Three axes decide which video or image model fits a job, and the Venice
// /models response answers only part of them. Likeness and NSFW are provider
// policy, not API metadata, so they live in the curated tables below. Every
// rating carries its provenance: `verified` was checked against the provider's
// published policy (or reported by the API), `inferred` was derived from the
// privacy tier and should be confirmed before it is relied on. An unmatched
// model degrades to an inferred or unrated row; it is never guessed silently.
// "Open" means not blocked. It is never a promise that a prompt will render.
// =====================================================================
const POLICY_STATES = {
  open:    { label: 'Open',    icon: 'check_circle',  cls: 'pol-open'    },
  limited: { label: 'Limited', icon: 'error_outline', cls: 'pol-limited' },
  blocked: { label: 'Blocked', icon: 'block',         cls: 'pol-blocked' },
  unrated: { label: 'Unrated', icon: 'help_outline',  cls: 'pol-unrated' },
};

// Video and image models are judged on three axes each. Likeness and NSFW
// ask the same question of both; the third differs because the media do.
// For video it is whether the model scores its own audio; for images it is
// where the filter lives, which for a still is the thing that decides
// whether a prompt is refused at all.
const POLICY_AXES = {
  video: [
    { key: 'likeness', label: 'Likeness / IP', short: 'Likeness', icon: 'record_voice_over',
      desc: 'Whether real people (actors, public figures) and copyrighted characters survive the provider filter.' },
    { key: 'voice',    label: 'Native voice',  short: 'Voice',    icon: 'graphic_eq',
      desc: 'Whether the model scores its own dialogue and sound effects, or returns a silent clip you must dub.' },
    { key: 'nsfw',     label: 'Adult / NSFW',  short: 'NSFW',     icon: 'explicit',
      desc: 'Whether explicit adult content is permitted and actually renders usably.' },
  ],
  image: [
    { key: 'likeness', label: 'Likeness / IP', short: 'Likeness', icon: 'face',
      desc: 'Whether real people (actors, public figures) and copyrighted characters survive the filter, where one exists.' },
    { key: 'filter',   label: 'Filter',        short: 'Filter',   icon: 'shield',
      desc: 'Where the refusal lives. Open weights on Venice hardware carry no classifier wrapper; a proxied model brings the provider\'s own.' },
    { key: 'nsfw',     label: 'Adult / NSFW',  short: 'NSFW',     icon: 'explicit',
      desc: 'Whether explicit adult content is permitted and the weights were actually trained to render it.' },
  ],
};

// The profile a row carries lives on row.policy; its .kind picks the axes.
function axesFor(row) {
  return (row && row.policy && POLICY_AXES[row.policy.kind]) || null;
}

// Matched against the lowercased model ID, first hit wins — so Ovi (built
// on a Wan backbone, but its own policy story) is listed before Wan.
const VIDEO_POLICY = [
  {
    test: /ovi/, family: 'Ovi',
    likeness: { state: 'open', note: 'Apache-licensed open weights served on Venice hardware — no upstream likeness or IP filter stands between your prompt and the model.' },
    voice:    { state: 'open', note: 'Purpose-built for this: twin audio/video backbones cross-attend per block, giving synced speech, multi-speaker dialogue, SFX and music without a separate dub pass.' },
    nsfw:     { state: 'limited', note: 'Prompts are accepted rather than refused, but the training data was not built for explicit output — expect inconsistent, frequently tame results. Venice also gates unfiltered generation behind a paid plan.' },
    source: 'Ovi model card (arXiv 2510.01284) + Venice private-tier hosting',
  },
  {
    test: /\bwan\b|wan-?\d/, family: 'Wan',
    likeness: { state: 'open', note: 'Open weights running on Venice GPUs. None of the celebrity/public-figure interception that the hosted providers apply is in the path.' },
    voice:    { state: 'unrated', note: 'Varies by Wan revision — the API constraint is authoritative and overrides this row when present.' },
    nsfw:     { state: 'limited', note: 'No hard prompt filter, but output quality for explicit content is unreliable. Unfiltered generation requires a paid Venice plan.' },
    source: 'Wan open-weights distribution + Venice private-tier hosting',
  },
  {
    test: /sora/, family: 'Sora',
    likeness: { state: 'blocked', note: 'A real face renders only if that person has uploaded a verified Cameo and granted permission — a prompt or a reference photo alone will not do it. Copyrighted characters moved to opt-in, so rightsholders must have granted use.' },
    voice:    { state: 'open', note: 'Generates synchronized dialogue and sound effects in the same pass.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is refused outright under OpenAI usage policy.' },
    source: 'OpenAI Sora 2 cameo-consent and copyright opt-in policy',
  },
  {
    test: /veo/, family: 'Veo',
    likeness: { state: 'blocked', note: 'Public-figure depictions are filtered, and the safety check fires even on a merely celebrity-adjacent hallucination — generations get blocked before you see them.' },
    voice:    { state: 'open', note: 'Native synchronized audio: dialogue and ambience are rendered with the frames, not layered afterwards.' },
    nsfw:     { state: 'blocked', note: 'Zero-tolerance policy on sexually explicit material, gratuitous violence and hate speech.' },
    source: 'Google Veo content policy',
  },
  {
    test: /kling/, family: 'Kling',
    likeness: { state: 'blocked', note: 'Among the strictest moderation of any hosted model — prompt, upload and output are each screened, and likenesses of celebrities and political figures are intercepted at every stage.' },
    voice:    { state: 'unrated', note: 'Version-dependent: v3 generates video and audio in a single pass, earlier turbo revisions return silent clips. The API constraint decides.' },
    nsfw:     { state: 'blocked', note: 'NSFW is not permitted, and uploads are screened as well as prompts.' },
    source: 'Kuaishou Kling moderation policy',
  },
  {
    test: /seedance|seedream/, family: 'Seedance',
    likeness: { state: 'blocked', note: 'Face generation is restricted by the provider.' },
    voice:    { state: 'open', note: 'Generates its own audio track, with dual-channel stereo support.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted.' },
    source: 'ByteDance Seedance content policy',
  },
  {
    test: /gemini-omni|omni-flash/, family: 'Gemini Omni',
    likeness: { state: 'blocked', note: 'Google screens public figures and copyrighted characters on the Omni video family the same way it does on Veo.' },
    voice:    { state: 'open', note: 'Native audio is part of the Omni video path — dialogue and ambience land in the same pass when the API reports audio support.' },
    nsfw:     { state: 'blocked', note: 'Sexually explicit material is refused under Google generative-media policy.' },
    source: 'Google Gemini / Veo generative media policy',
  },
  {
    test: /grok-imagine/, family: 'Grok Imagine',
    likeness: { state: 'limited', note: 'xAI allows stylised depictions more readily than OpenAI or Google, but photoreal public-figure likenesses are still restricted on the hosted Imagine path.' },
    voice:    { state: 'unrated', note: 'Audio support varies by Imagine revision — the API constraint is authoritative when present.' },
    nsfw:     { state: 'limited', note: 'xAI is less strict than OpenAI on adult content, but the hosted Imagine endpoint still refuses some explicit prompts.' },
    source: 'xAI Grok Imagine usage policy',
  },
  {
    test: /minimax|hailuo/, family: 'MiniMax',
    likeness: { state: 'blocked', note: 'MiniMax screens celebrity and political likenesses on the hosted video models.' },
    voice:    { state: 'unrated', note: 'Native audio depends on the Hailuo / MiniMax revision — trust the API audio flag.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted on the hosted MiniMax video API.' },
    source: 'MiniMax / Hailuo content policy',
  },
  {
    test: /pixverse/, family: 'PixVerse',
    likeness: { state: 'blocked', note: 'PixVerse applies a likeness and IP filter on hosted generations.' },
    voice:    { state: 'unrated', note: 'Audio support is revision-dependent; the API constraint decides.' },
    nsfw:     { state: 'blocked', note: 'Adult content is refused by the provider.' },
    source: 'PixVerse content policy',
  },
  {
    test: /runway/, family: 'Runway',
    likeness: { state: 'blocked', note: 'Runway blocks photoreal likenesses of real people and copyrighted characters.' },
    voice:    { state: 'unrated', note: 'Gen-4 audio support is version-dependent — use the API audio flag.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted under Runway acceptable use.' },
    source: 'Runway acceptable use policy',
  },
  {
    test: /\bltx\b|lightricks/, family: 'LTX',
    likeness: { state: 'open', note: 'Open-weights LTX models served on Venice hardware have no upstream celebrity/IP interceptor in the path.' },
    voice:    { state: 'unrated', note: 'Varies by LTX revision — the API audio constraint overrides this row when present.' },
    nsfw:     { state: 'limited', note: 'No hard prompt filter, but the training mix is not an adult-specialist set. Unfiltered generation still needs a paid Venice plan.' },
    source: 'Lightricks LTX open weights + Venice private-tier hosting',
  },
  {
    test: /vidu/, family: 'Vidu',
    likeness: { state: 'blocked', note: 'Vidu screens public-figure and copyrighted-character depictions.' },
    voice:    { state: 'unrated', note: 'Audio support is revision-dependent; the API constraint decides.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted.' },
    source: 'Shengshu / Vidu content policy',
  },
];

// No table entry: say so, and derive a provisional read from the privacy
// tier, which the API does report. A "private" model runs on Venice's own
// hardware with no third-party filter in the path; an "anonymized" one is
// proxied to a provider that brings its own moderation. Useful as a prior,
// not as a guarantee — hence inferred: true, which renders dashed.
function inferFromPrivacy(privacy, axis) {
  if (privacy === 'private') {
    return axis === 'nsfw'
      ? { state: 'limited', note: 'No table entry for this model. It is Venice-hosted (private tier), so no third-party filter sits in the path — but that is an inference from the privacy tier, not a checked policy.', inferred: true }
      : { state: 'limited', note: 'No table entry for this model. Venice-hosted (private tier) models historically apply no upstream likeness filter, but this has not been confirmed for this model.', inferred: true };
  }
  if (privacy === 'anonymized') {
    return { state: 'blocked', note: 'No table entry for this model. It is proxied to a third-party provider (anonymized tier), and those providers filter likeness and explicit content — assumed blocked until confirmed.', inferred: true };
  }
  return { state: 'unrated', note: 'No policy information available for this model, and its privacy tier was not reported.', inferred: true };
}

// Builds the full policy + generation profile for one video model.
// API-derived facts always beat the curated table.
function videoProfile(raw, spec) {
  const id = String(raw.id || '').toLowerCase();
  const c = spec.constraints || {};
  const entry = VIDEO_POLICY.find(e => e.test.test(id)) || null;
  const privacy = spec.privacy || 'unknown';

  // constraints.audio is the API telling us outright whether this model
  // carries its own soundtrack. When present it settles the voice axis.
  const apiAudio = typeof c.audio === 'boolean' ? c.audio : null;
  const configurable = !!c.audio_configurable;

  const axis = key => {
    if (key === 'voice' && apiAudio !== null) {
      return apiAudio
        ? { state: 'open', verified: true,
            note: 'Reported by the Venice API (constraints.audio) — this model generates its own audio track.' +
                  (configurable ? ' The audio parameter is configurable, so you can request a silent render.' : ''),
            source: 'Venice API' }
        : { state: 'blocked', verified: true,
            note: 'Reported by the Venice API (constraints.audio) — this model returns silent video. Pair it with a TTS or music model for sound.',
            source: 'Venice API' };
    }
    const fromTable = entry && entry[key];
    if (fromTable && fromTable.state !== 'unrated') {
      return { state: fromTable.state, note: fromTable.note, source: entry.source, verified: true };
    }
    const inf = inferFromPrivacy(privacy, key);
    return { state: inf.state, note: inf.note, inferred: true, source: 'Inferred from privacy tier' };
  };

  const modeRaw = c.model_type || '';
  const mode = modeRaw === 'image-to-video' ? 'image → video'
             : modeRaw === 'video'          ? 'video → video'
             : modeRaw === 'text-to-video'  ? 'text → video'
             // The API did not report model_type — fall back to the ID.
             : id.includes('image-to')      ? 'image → video'
             : id.includes('reference')     ? 'reference → video'
             : 'text → video';

  return {
    kind: 'video',
    family: entry ? entry.family : 'Unlisted',
    mode,
    modeSource: modeRaw ? 'api' : 'id',
    durations: c.durations || [],
    resolutions: c.resolutions || [],
    aspectRatios: c.aspect_ratios || [],
    promptLimit: c.prompt_character_limit || 0,
    audioConfigurable: configurable,
    likeness: axis('likeness'),
    voice: axis('voice'),
    nsfw: axis('nsfw'),
  };
}

// =====================================================================
// IMAGE CONTENT POLICY
//
// Images work differently from video, and the difference is the whole
// story: a filter is not part of a model's weights, it is a classifier
// the host wraps around them. Venice's product layer adds none of its
// own, so an open-weight model served on Venice hardware has nothing
// between the prompt and the sampler, while a model proxied to OpenAI,
// Google or ByteDance carries that provider's prompt and output screens
// and can refuse a request Venice would have allowed.
//
// That makes the filter axis API-derived: model_spec.privacy already
// reports "private" (Venice-hosted) vs "anonymized" (proxied), which is
// exactly the distinction. Likeness and NSFW stay curated, as for video.
//
// NSFW here splits two ways that matter when picking a model. A model
// can be unfiltered yet untrained for explicit work — nothing refuses
// the prompt, the result is simply tame. Those rate "limited", not
// "open"; "open" is reserved for weights actually trained for it.
// =====================================================================
const IMAGE_POLICY = [
  // Purpose-built adult models first: several carry an SDXL/Flux
  // lineage whose generic patterns appear further down this list.
  {
    test: /lustify/, family: 'Lustify',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper. An SDXL-lineage model, so a well-known face may render from the base training alone.' },
    nsfw:     { state: 'open', note: 'Purpose-built for photoreal adult imagery — this is what the weights were fine-tuned for, so results are usable rather than merely un-refused.' },
    source: 'Venice uncensored image roster + Lustify model lineage',
  },
  {
    test: /pony/, family: 'Pony',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper. Stylised output, so likeness fidelity is lower than a photoreal model.' },
    nsfw:     { state: 'open', note: 'The Pony lineage is explicitly trained for adult content and responds to its own scoring tags.' },
    source: 'Venice uncensored image roster + Pony Diffusion lineage',
  },
  {
    test: /wai|illustrious/, family: 'WAI / Illustrious',
    likeness: { state: 'open', note: 'No classifier wrapper. Anime-domain weights: real-person likeness is out of distribution, so expect a stylised approximation rather than a match.' },
    nsfw:     { state: 'open', note: 'Anime-domain adult content is well within this model\'s training.' },
    source: 'Venice uncensored image roster (listed as "Anime (WAI)")',
  },
  {
    test: /uncensored/, family: 'Uncensored fine-tune',
    likeness: { state: 'open', note: 'A de-restricted fine-tune served on Venice hardware with no classifier wrapper.' },
    nsfw:     { state: 'open', note: 'Fine-tuned specifically to remove the base model\'s reluctance around explicit content.' },
    source: 'Venice uncensored image roster',
  },
  {
    test: /chroma/, family: 'Chroma',
    likeness: { state: 'open', note: 'Flux-lineage open weights on Venice hardware, no classifier wrapper.' },
    nsfw:     { state: 'open', note: 'A Flux derivative retrained without the base model\'s content restrictions.' },
    source: 'Venice uncensored image roster + Chroma model lineage',
  },
  {
    test: /z-image/, family: 'Z-Image',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper.' },
    nsfw:     { state: 'open', note: 'Listed among Venice\'s uncensored image models; the fast turbo sampling makes it cheap to iterate on.' },
    source: 'Venice uncensored image roster',
  },

  // Third-party proxied models: the provider's filter, not Venice's.
  {
    test: /gpt-image|dall-?e/, family: 'OpenAI GPT Image',
    likeness: { state: 'limited', note: 'Stylised depictions of public figures are permitted, but photorealistic likenesses of a specific person stay blocked, and any public figure can opt out of being generated at all.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is refused under OpenAI usage policy.' },
    source: 'OpenAI image content policy',
  },
  {
    test: /nano-banana|gemini|imagen/, family: 'Google (Nano Banana / Imagen)',
    likeness: { state: 'blocked', note: 'Google applies IP and likeness restrictions that reach beyond public figures — protected characters and reference-image rights are screened too, and the model clears none of them for you.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is refused.' },
    source: 'Google Gemini image generation policy',
  },
  {
    test: /seedream|seedance/, family: 'ByteDance Seedream',
    likeness: { state: 'blocked', note: 'Face and likeness generation is restricted by the provider.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted.' },
    source: 'ByteDance Seedream content policy',
  },
  {
    test: /grok-imagine/, family: 'Grok Imagine',
    likeness: { state: 'limited', note: 'xAI is looser than OpenAI on stylised public figures, but photoreal likenesses of a specific person are still restricted on the hosted Imagine path.' },
    nsfw:     { state: 'limited', note: 'Some adult prompts are accepted that OpenAI would refuse, but the hosted Imagine endpoint is not an uncensored stack.' },
    source: 'xAI Grok Imagine usage policy',
  },
  {
    test: /krea/, family: 'Krea',
    likeness: { state: 'blocked', note: 'Krea applies a likeness and IP screen on hosted generations.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is refused by the provider.' },
    source: 'Krea content policy',
  },
  {
    test: /luma|uni-1/, family: 'Luma',
    likeness: { state: 'blocked', note: 'Luma screens real-person likenesses and copyrighted characters on Uni-1 / Dream Machine-class models.' },
    nsfw:     { state: 'blocked', note: 'Adult content is not permitted.' },
    source: 'Luma Dream Machine acceptable use',
  },
  {
    test: /ideogram/, family: 'Ideogram',
    likeness: { state: 'blocked', note: 'Ideogram filters public-figure and trademarked-character depictions.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is refused.' },
    source: 'Ideogram content policy',
  },
  {
    test: /recraft/, family: 'Recraft',
    likeness: { state: 'blocked', note: 'Recraft applies a likeness and brand-IP filter on hosted generations.' },
    nsfw:     { state: 'blocked', note: 'Explicit content is not permitted.' },
    source: 'Recraft acceptable use',
  },
  {
    test: /imagineart/, family: 'ImagineArt',
    likeness: { state: 'blocked', note: 'ImagineArt screens celebrity likenesses on the hosted API.' },
    nsfw:     { state: 'blocked', note: 'Adult content is refused by the provider.' },
    source: 'ImagineArt content policy',
  },

  // Unfiltered but not trained for adult work — the "limited" case.
  {
    test: /flux/, family: 'Flux',
    likeness: { state: 'open', note: 'Open weights on Venice hardware. The Flux licence carries an acceptable-use policy, but that is a policy document, not a filter compiled into the weights — nothing intercepts the prompt.' },
    nsfw:     { state: 'limited', note: 'Nothing refuses the prompt, but the base Flux training is deliberately tame around explicit anatomy. Use the uncensored fine-tune or Chroma if that is the job.' },
    source: 'Black Forest Labs Flux model card + Venice private-tier hosting',
  },
  {
    test: /hidream/, family: 'HiDream',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper.' },
    nsfw:     { state: 'limited', note: 'Unfiltered but not trained for explicit output — prompts are accepted, results are tame.' },
    source: 'HiDream open weights + Venice private-tier hosting',
  },
  {
    test: /qwen/, family: 'Qwen Image',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper. Strong at legible in-image text.' },
    nsfw:     { state: 'limited', note: 'Unfiltered but tame: the training set was not built for explicit content.' },
    source: 'Qwen Image open weights + Venice private-tier hosting',
  },
  {
    test: /\bwan\b|wan-?\d/, family: 'Wan Image',
    likeness: { state: 'open', note: 'Open weights running on Venice GPUs. No upstream celebrity interceptor sits between the prompt and the sampler.' },
    nsfw:     { state: 'limited', note: 'No hard prompt filter, but explicit quality is unreliable. Unfiltered generation requires a paid Venice plan.' },
    source: 'Wan open-weights distribution + Venice private-tier hosting',
  },
  {
    test: /hunyuan/, family: 'Hunyuan Image',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper.' },
    nsfw:     { state: 'limited', note: 'Unfiltered but not trained as an adult specialist — prompts are accepted, results are often tame.' },
    source: 'Tencent Hunyuan Image open weights + Venice private-tier hosting',
  },
  {
    test: /sd-?3|sd35|sdxl|stable-?diffusion/, family: 'Stable Diffusion',
    likeness: { state: 'open', note: 'Open weights on Venice hardware, no classifier wrapper.' },
    nsfw:     { state: 'limited', note: 'SD 3.x in particular was filtered at training time around human anatomy, so explicit prompts are accepted but render poorly.' },
    source: 'Stability AI model cards + Venice private-tier hosting',
  },
];

// Where the refusal lives. This one is not curated: model_spec.privacy
// already draws exactly the line that matters, so it is read from the API.
function filterAxisFromPrivacy(privacy) {
  if (privacy === 'private') {
    return { state: 'open', source: 'Venice API',
      note: 'Venice-hosted (private tier): the weights run on Venice\'s own infrastructure with no third-party classifier wrapped around them, and Venice adds no product filter of its own. Only the model\'s own training limits apply.' };
  }
  if (privacy === 'anonymized') {
    return { state: 'blocked', source: 'Venice API',
      note: 'Proxied to a third-party provider (anonymized tier). That provider screens prompts and outputs with its own classifiers and can refuse a request Venice itself would have allowed.' };
  }
  return { state: 'unrated', source: 'Venice API', inferred: true,
    note: 'The API did not report a privacy tier for this model, so where its filter lives is unknown.' };
}

function imageProfile(raw, spec) {
  const id = String(raw.id || '').toLowerCase();
  const c = spec.constraints || {};
  const entry = IMAGE_POLICY.find(e => e.test.test(id)) || null;
  const privacy = spec.privacy || 'unknown';

  const axis = key => {
    const fromTable = entry && entry[key];
    if (fromTable && fromTable.state !== 'unrated') {
      return { state: fromTable.state, note: fromTable.note, source: entry.source, verified: true };
    }
    const inf = inferFromPrivacy(privacy, key);
    return { state: inf.state, note: inf.note, inferred: true, source: 'Inferred from privacy tier' };
  };

  // Each image model commits to one sizing idiom; sending the wrong one
  // is a 400. The API says which, and the old card never surfaced it.
  const ratios = c.aspectRatios || c.aspect_ratios || [];
  const resolutions = c.resolutions || [];
  const sizing = (ratios.length || resolutions.length) ? 'aspect + resolution' : 'width × height';

  return {
    kind: 'image',
    family: entry ? entry.family : 'Unlisted',
    sizing,
    aspectRatios: ratios,
    defaultAspectRatio: c.defaultAspectRatio || '',
    resolutions,
    defaultResolution: c.defaultResolution || '',
    widthHeightDivisor: c.widthHeightDivisor || 0,
    stepsDefault: c.steps?.default || 0,
    stepsMax: c.steps?.max || 0,
    promptLimit: c.promptCharacterLimit || 0,
    likeness: axis('likeness'),
    filter: filterAxisFromPrivacy(privacy),
    nsfw: axis('nsfw'),
  };
}


// =====================================================================
// TYPES
// =====================================================================
const TYPE_META = {
  text:      { label: 'Language',       short: 'Text',    endpoint: 'POST /chat/completions', doc: 'api-reference/endpoint/chat/completions' },
  image:     { label: 'Image',          short: 'Image',   endpoint: 'POST /image/generate', doc: 'api-reference/endpoint/image/generate' },
  video:     { label: 'Video',          short: 'Video',   endpoint: 'POST /video/queue', doc: 'api-reference/endpoint/video/queue' },
  tts:       { label: 'Voice / TTS',    short: 'Voice',   endpoint: 'POST /audio/speech', doc: 'api-reference/endpoint/audio/speech' },
  music:     { label: 'Music & audio',  short: 'Music',   endpoint: 'POST /audio/queue', doc: 'api-reference/endpoint/audio/queue' },
  asr:       { label: 'Speech to text', short: 'STT',     endpoint: 'POST /audio/transcriptions', doc: 'api-reference/endpoint/audio/transcriptions' },
  inpaint:   { label: 'Image edit',     short: 'Edit',    endpoint: 'POST /image/edit', doc: 'api-reference/endpoint/image/edit' },
  upscale:   { label: 'Upscale',        short: 'Upscale', endpoint: 'POST /image/upscale', doc: 'api-reference/endpoint/image/upscale' },
  embedding: { label: 'Embedding',      short: 'Embed',   endpoint: 'POST /embeddings', doc: 'api-reference/endpoint/embeddings/generate' },
  decision:  { label: 'Decisions',      short: 'Decide',  endpoint: 'POST /decisions', doc: 'api-reference/endpoint/decisions/create' },
};
const TYPE_ORDER = ['text', 'image', 'video', 'tts', 'music', 'asr', 'inpaint', 'upscale', 'embedding', 'decision'];

function typeLabel(t) { return (TYPE_META[t] && TYPE_META[t].label) || t; }

// =====================================================================
// VENDORS — who built the model, read off the ID prefix.
// =====================================================================
const PROVIDER_RULES = [
  [/^(tts-|text-embedding-)qwen/i, 'Alibaba'],
  [/^text-embedding-(3-|ada)/i, 'OpenAI'],
  [/^text-embedding-nemotron/i, 'NVIDIA'],
  [/^(qwen|wan-|e2ee-qwen|happyhorse)/i, 'Alibaba'],
  [/^(openai|gpt|o[0-9]|chatgpt|e2ee-gpt|sora)/i, 'OpenAI'],
  [/^(claude|anthropic)/i, 'Anthropic'],
  [/^(gemini|gemma|google-|veo|nano-banana|lyria|tts-gemini|imagen)/i, 'Google'],
  [/^(zai|z-ai|z-image|glm|e2ee-glm|olafangensan-glm)/i, 'Z.ai'],
  [/^(deepseek|e2ee-deepseek)/i, 'DeepSeek'],
  [/^(grok|xai|tts-xai|stt-xai)/i, 'xAI'],
  [/^(kimi|moonshot|e2ee-kimi)/i, 'Moonshot'],
  [/^(elevenlabs|tts-elevenlabs)/i, 'ElevenLabs'],
  [/^(minimax|tts-minimax|hailuo)/i, 'MiniMax'],
  [/^(nvidia|nemotron)/i, 'NVIDIA'],
  [/^(hermes|nous)/i, 'Nous Research'],
  [/^(llama|meta-)/i, 'Meta'],
  [/^(mistral|magistral|devstral|pixtral)/i, 'Mistral'],
  [/^(seed|seedance)/i, 'ByteDance'],
  [/^xiaomi/i, 'Xiaomi'],
  [/^kling/i, 'Kling'],
  [/^runway/i, 'Runway'],
  [/^luma/i, 'Luma'],
  [/^ideogram/i, 'Ideogram'],
  [/^recraft/i, 'Recraft'],
  [/^bria/i, 'Bria'],
  [/^topaz/i, 'Topaz'],
  [/^ltx/i, 'Lightricks'],
  [/^pixverse/i, 'PixVerse'],
  [/^vidu/i, 'Vidu'],
  [/^stable-/i, 'Stability AI'],
  [/^tts-inworld/i, 'Inworld'],
  [/^flux/i, 'Black Forest'],
  [/^hunyuan/i, 'Tencent'],
  [/^krea/i, 'Krea'],
  [/^fal-ai\//i, 'fal.ai'],
  [/^(venice|jev-)/i, 'Venice'],
  [/^aion/i, 'Aion Labs'],
  [/^mercury/i, 'Inception'],
];
const PROVIDER_SLUGS = { 'Alibaba': 'alibaba', 'Google': 'google', 'OpenAI': 'openai', 'ByteDance': 'bytedance', 'Kling': 'kling', 'xAI': 'xai', 'MiniMax': 'minimax', 'Anthropic': 'anthropic', 'Z.ai': 'z.ai', 'ElevenLabs': 'elevenlabs', 'Black Forest': 'flux', 'DeepSeek': 'deepseek', 'Lightricks': 'lightricks', 'Moonshot': 'moonshot', 'PixVerse': 'pixverse', 'Luma': 'luma', 'NVIDIA': 'nvidia', 'Ideogram': 'ideogram', 'Krea': 'krea', 'Runway': 'runway', 'Meta': 'meta', 'Recraft': 'recraft', 'Vidu': 'vidu', 'Xiaomi': 'xiaomi', 'fal.ai': 'fal', 'Mistral': 'mistral', 'Nous Research': 'nous', 'Stability AI': 'stability', 'Tencent': 'tencent', 'Topaz': 'topazlabs' };

function providerOf(id) {
  const s = String(id || '');
  for (const pair of PROVIDER_RULES) if (pair[0].test(s)) return pair[1];
  return '';
}

// =====================================================================
// CAPABILITIES — the flags a text model reports, in the order they matter.
// =====================================================================
const CAPS = [
  { key: 'vision',    api: 'supportsVision',          label: 'Vision',      long: 'Accepts images' },
  { key: 'reasoning', api: 'supportsReasoning',       label: 'Reasoning',   long: 'Thinks before answering' },
  { key: 'tools',     api: 'supportsFunctionCalling', label: 'Tools',       long: 'Function calling' },
  { key: 'web',       api: 'supportsWebSearch',       label: 'Web',         long: 'Venice web search' },
  { key: 'code',      api: 'optimizedForCode',        label: 'Code',        long: 'Optimised for code' },
  { key: 'schema',    api: 'supportsResponseSchema',  label: 'JSON schema', long: 'Structured output' },
  { key: 'audio',     api: 'supportsAudioInput',      label: 'Audio in',    long: 'Accepts audio' },
  { key: 'video',     api: 'supportsVideoInput',      label: 'Video in',    long: 'Accepts video' },
  { key: 'xsearch',   api: 'supportsXSearch',         label: 'X search',    long: 'Searches X' },
  { key: 'tee',       api: 'supportsTeeAttestation',  label: 'TEE',         long: 'Runs in a hardware enclave' },
  { key: 'e2ee',      api: 'supportsE2EE',            label: 'E2EE',        long: 'End-to-end encrypted' },
  { key: 'logprobs',  api: 'supportsLogProbs',        label: 'Logprobs',    long: 'Returns token log-probabilities' },
];
const CAP_BY_KEY = {};
CAPS.forEach(c => { CAP_BY_KEY[c.key] = c; });

// =====================================================================
// FORMATTING
// =====================================================================
// A price is shown exactly as Venice reports it: two decimals from a dollar
// up, and below that as many as the number really has. Nothing is rounded
// into a nicer figure.
function fmtUsd(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (v === 0) return '$0';
  if (v >= 1) return '$' + v.toFixed(2);
  let s = String(Number(v.toPrecision(4)));
  if (s.indexOf('e') !== -1) s = v.toFixed(8).replace(/0+$/, '');
  const dot = s.indexOf('.');
  if (dot === -1) s += '.00';
  else if (s.length - dot - 1 < 2) s += '0';
  return '$' + s;
}
function fmtRange(a, b) {
  return (b === undefined || b === null || a === b) ? fmtUsd(a) : fmtUsd(a) + '–' + fmtUsd(b);
}
function fmtTokens(t) {
  if (!t) return '—';
  if (t >= 1e6) return (t / 1e6).toFixed(t % 1e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (t >= 1e3) return Math.round(t / 1e3) + 'K';
  return String(t);
}
function fmtCount(n) {
  if (!isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'K';
  return Math.floor(n).toLocaleString('en-US');
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}
const usd = o => (o && typeof o.usd === 'number') ? o.usd : null;

// =====================================================================
// PRICING — turn model_spec.pricing into one shape for every model type.
//
//   cells  what the card prints, at most four: [{ k: label, v, v2? }]
//   unit   what one of those numbers buys ("per 1M tokens")
//   sort   the number the "cheapest first" sort uses (Infinity = unknown)
//   text   one line a person or an agent can read without the labels
//   tables everything else, for the detail sheet and the Markdown export
//   buys   how to turn a budget into units: [{ label, per, scale }]
// =====================================================================
function priceOf(type, spec, videoPrice) {
  const p = spec.pricing || {};
  const out = { cells: [], unit: '', sort: Infinity, text: '', tables: [], buys: [], note: '' };
  const cell = (k, v, v2) => { if (v !== null && v !== undefined) out.cells.push(v2 !== undefined && v2 !== v ? { k, v, v2 } : { k, v }); };
  const table = (title, rows, unit) => { if (rows.length) out.tables.push({ title, unit: unit || '', rows }); };
  const gridRows = obj => Object.keys(obj || {}).map(k => [k, usd(obj[k])]).filter(r => r[1] !== null);

  if (type === 'text' || type === 'decision' || type === 'embedding') {
    const i = usd(p.input), o = usd(p.output), cr = usd(p.cache_input), cw = usd(p.cache_write);
    out.unit = 'per 1M tokens';
    cell('In', i);
    if (type !== 'embedding') cell('Out', o);
    cell('Cache read', cr);
    cell('Cache write', cw);
    out.sort = i === null ? Infinity : i;
    out.text = type === 'embedding'
      ? fmtUsd(i) + ' per 1M input tokens'
      : fmtUsd(i) + ' in / ' + fmtUsd(o) + ' out per 1M tokens';
    if (i > 0) out.buys.push({ label: 'input tokens', per: i, scale: 1e6 });
    if (o > 0 && type !== 'embedding') out.buys.push({ label: 'output tokens', per: o, scale: 1e6 });
    const ext = p.extended;
    if (ext) {
      const rows = [];
      if (usd(ext.input) !== null) rows.push(['In', usd(ext.input)]);
      if (usd(ext.output) !== null) rows.push(['Out', usd(ext.output)]);
      if (usd(ext.cache_input) !== null) rows.push(['Cache read', usd(ext.cache_input)]);
      if (usd(ext.cache_write) !== null) rows.push(['Cache write', usd(ext.cache_write)]);
      table('Long-context rate, prompts over ' + fmtTokens(ext.context_token_threshold) + ' tokens', rows, 'per 1M tokens');
      out.note = 'Past ' + fmtTokens(ext.context_token_threshold) + ' input tokens the higher long-context rate applies to the whole request.';
    }
  }

  else if (type === 'image' || type === 'inpaint') {
    const noun = type === 'image' ? 'image' : 'edit';
    out.unit = 'per ' + noun;
    const base = type === 'image' ? usd(p.generation) : usd(p.inpaint);
    const res = gridRows(p.resolutions);
    if (res.length) {
      res.forEach(r => cell(r[0], r[1]));
      out.cells = out.cells.slice(0, 4);
      const vals = res.map(r => r[1]);
      out.sort = Math.min.apply(null, vals);
      out.text = res.map(r => r[0] + ' ' + fmtUsd(r[1])).join(', ') + ' per ' + noun;
    } else if (base !== null) {
      cell(type === 'image' ? 'Per image' : 'Per edit', base);
      out.unit = '';
      out.sort = base;
      out.text = fmtUsd(base) + ' per ' + noun;
    }
    if (isFinite(out.sort) && out.sort > 0) out.buys.push({ label: noun + 's', per: out.sort, scale: 1 });
    if (p.quality) {
      const rows = [];
      Object.keys(p.quality).forEach(r => Object.keys(p.quality[r]).forEach(q => {
        const v = usd(p.quality[r][q]); if (v !== null) rows.push([r + ' · ' + q, v]);
      }));
      table('By resolution and quality', rows, 'per ' + noun);
    }
    if (p.inputImages && usd(p.inputImages.additional) !== null) {
      out.note = p.inputImages.included + ' input image' + (p.inputImages.included === 1 ? '' : 's') +
        ' included, then ' + fmtUsd(usd(p.inputImages.additional)) + ' for each extra one.';
    }
    if (type === 'image' && p.upscale) {
      table('Upscale (shared Venice price, not this model\'s own)', gridRows(p.upscale).map(r => [r[0].replace('x', '×'), r[1]]), 'per image');
    }
  }

  else if (type === 'upscale') {
    out.unit = 'per image';
    const x2 = usd(p.upscale && p.upscale['2x']), x4 = usd(p.upscale && p.upscale['4x']);
    cell('2×', x2); cell('4×', x4);
    out.sort = x2 === null ? Infinity : x2;
    out.text = '2× ' + fmtUsd(x2) + ', 4× ' + fmtUsd(x4) + ' per image';
    if (x2 > 0) out.buys.push({ label: '2× upscales', per: x2, scale: 1 });
  }

  else if (type === 'tts') {
    const i = usd(p.input);
    cell('Per 1M characters', i);
    out.sort = i === null ? Infinity : i;
    out.text = fmtUsd(i) + ' per 1M characters';
    if (i > 0) out.buys.push({ label: 'characters', per: i, scale: 1e6 });
  }

  else if (type === 'music') {
    if (p.durations) {
      const keys = Object.keys(p.durations).map(Number).sort((a, b) => a - b);
      const vals = keys.map(k => usd(p.durations[k])).filter(v => v !== null);
      const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      out.unit = 'by length';
      cell('Per track', lo, hi);
      out.sort = lo;
      out.text = fmtRange(lo, hi) + ' per track (' + keys[0] + ' to ' + keys[keys.length - 1] + ' seconds)';
      table('By track length', keys.map(k => ['up to ' + k + ' s', usd(p.durations[k])]), 'per track');
      if (lo > 0) out.buys.push({ label: 'shortest tracks', per: lo, scale: 1 });
    } else if (usd(p.generation) !== null) {
      const g = usd(p.generation);
      cell('Per generation', g);
      out.sort = g;
      out.text = fmtUsd(g) + ' per generation';
      if (g > 0) out.buys.push({ label: 'generations', per: g, scale: 1 });
    } else if (usd(p.per_second) !== null) {
      const s = usd(p.per_second);
      out.unit = 'of audio';
      cell('Per second', s);
      out.sort = s;
      out.text = fmtUsd(s) + ' per second of audio';
      if (s > 0) out.buys.push({ label: 'seconds', per: s, scale: 1 });
    } else if (usd(p.per_thousand_characters) !== null) {
      const c = usd(p.per_thousand_characters);
      cell('Per 1K characters', c);
      out.sort = c;
      out.text = fmtUsd(c) + ' per 1,000 characters';
      if (c > 0) out.buys.push({ label: 'characters', per: c, scale: 1e3 });
    }
  }

  else if (type === 'asr') {
    const s = usd(p.per_audio_second);
    out.unit = 'of audio';
    if (s !== null) {
      cell('Per second', s);
      cell('Per hour', Number((s * 3600).toPrecision(6)));
      out.sort = s;
      out.text = fmtUsd(s) + ' per second of audio (' + fmtUsd(Number((s * 3600).toPrecision(6))) + ' per hour)';
      if (s > 0) out.buys.push({ label: 'hours of audio', per: s * 3600, scale: 1 });
    }
  }

  else if (type === 'video') {
    if (videoPrice && videoPrice.min !== undefined) {
      cell('Per second of video', videoPrice.min, videoPrice.max);
      out.sort = videoPrice.min;
      out.text = fmtRange(videoPrice.min, videoPrice.max) + ' per second of video';
      out.note = videoPrice.max !== videoPrice.min
        ? 'The rate runs from the cheapest setting to the dearest: resolution and audio move it. From Venice\'s pricing page; POST /video/quote gives the exact price of a job.'
        : 'From Venice\'s pricing page; POST /video/quote gives the exact price of a job.';
      if (videoPrice.min > 0) out.buys.push({ label: 'seconds at the lowest rate', per: videoPrice.min, scale: 1 });
    } else if (videoPrice && videoPrice.bySource) {
      out.cells.push({ k: 'Price', s: 'By source' });
      out.text = 'Priced by the video you send; quote it with POST /video/quote';
      out.note = 'This model charges by the source video. POST /video/quote with your input returns the price.';
    } else {
      out.cells.push({ k: 'Price', s: 'Quote' });
      out.text = 'Not listed; quote it with POST /video/quote';
      out.note = 'Venice does not list a rate for this model. POST /video/quote returns the price of a job.';
    }
  }

  return out;
}

// What a rating reads as on a card. Two axes are facts, not permissions, so they
// get their own words instead of "Open" and "Blocked".
const AXIS_WORDS = {
  voice:  { open: 'Native audio', blocked: 'Silent', unrated: 'Audio unknown', limited: 'Some audio' },
  filter: { open: 'No provider filter', blocked: 'Provider filter', unrated: 'Filter unknown', limited: 'Some filtering' },
};
function axisText(key, state, short) {
  if (AXIS_WORDS[key]) return AXIS_WORDS[key][state];
  return (short ? short + ': ' : '') + POLICY_STATES[state].label;
}

// One short string per price cell: "$2.50", "$0.04–$0.35", "By source".
function cellText(c) { return c.s ? c.s : fmtRange(c.v, c.v2); }

// =====================================================================
// NORMALIZE — one raw /models record in, one catalogue row out.
// =====================================================================
function normalize(raw, videoPrices) {
  const spec = raw.model_spec || {};
  const type = raw.type || 'unknown';
  const caps = spec.capabilities || {};
  const sets = spec.model_sets || [];
  const provider = providerOf(raw.id);
  const dep = spec.deprecation && typeof spec.deprecation === 'object' ? spec.deprecation : null;

  const row = {
    id: raw.id,
    name: spec.name || raw.id,
    type,
    created: raw.created || 0,
    privacy: spec.privacy || 'unknown',
    desc: spec.description || '',
    provider,
    mark: PROVIDER_SLUGS[provider] || '',
    beta: !!spec.betaModel,
    offline: !!spec.offline,
    uncensored: !!spec.uncensored || sets.indexOf('uncensored') !== -1,
    recommended: sets.indexOf('venice_recommendations') !== -1,
    traits: spec.traits || [],
    source: spec.modelSource || '',
    retires: dep ? String(dep.removesAt || dep.date || '').slice(0, 10) : '',
    replacement: dep ? (dep.replacementModelId || '') : '',
    ctx: 0,
    maxOut: 0,
    caps: [],
    policy: null,
    mode: '',
    facts: [],          // [label, value] pairs for the detail sheet
    price: priceOf(type, spec, videoPrices ? videoPrices[raw.id] : null),
    raw,
  };
  const fact = (k, v) => { if (v !== undefined && v !== null && v !== '' && v !== 0) row.facts.push([k, String(v)]); };

  if (type === 'text') {
    row.ctx = spec.availableContextTokens || raw.context_length || 0;
    row.maxOut = spec.maxCompletionTokens || 0;
    row.caps = CAPS.filter(c => caps[c.api] === true).map(c => c.key);
    fact('Context window', row.ctx ? row.ctx.toLocaleString('en-US') + ' tokens' : '');
    fact('Max output', row.maxOut ? row.maxOut.toLocaleString('en-US') + ' tokens' : '');
    if (caps.quantization && caps.quantization !== 'not-available') fact('Quantization', caps.quantization);
    if (caps.supportsReasoningEffort) fact('Reasoning effort', 'Configurable');
    const cs = spec.constraints || {};
    if (cs.temperature && cs.temperature.default !== undefined) fact('Default temperature', cs.temperature.default);
    if (cs.top_p && cs.top_p.default !== undefined) fact('Default top_p', cs.top_p.default);
  } else if (type === 'embedding') {
    row.ctx = spec.maxInputTokens || 0;
    fact('Dimensions', spec.embeddingDimensions);
    fact('Max input', row.ctx ? row.ctx.toLocaleString('en-US') + ' tokens' : '');
    if (spec.supportsCustomDimensions) fact('Custom dimensions', 'Yes');
  } else if (type === 'decision') {
    row.ctx = spec.maxStateTokens || 0;
    fact('State cap', spec.maxStateTokens ? spec.maxStateTokens.toLocaleString('en-US') + ' tokens' : '');
    fact('Total cap', spec.maxTotalTokens ? spec.maxTotalTokens.toLocaleString('en-US') + ' tokens' : '');
    fact('Question types', 'yes/no, choice, score');
  } else if (type === 'image') {
    const ip = imageProfile(raw, spec);
    row.policy = ip;
    fact('Sizing', ip.sizing);
    fact('Resolutions', ip.resolutions.join(', '));
    fact('Default resolution', ip.defaultResolution);
    fact('Aspect ratios', ip.aspectRatios.join(', '));
    fact('Steps', ip.stepsDefault ? ip.stepsDefault + ' default, ' + ip.stepsMax + ' max' : '');
    fact('Prompt limit', ip.promptLimit ? ip.promptLimit.toLocaleString('en-US') + ' characters' : '');
    if (spec.supportsWebSearch) fact('Web search', 'Yes');
    if (spec.supportsStyleReferences) fact('Style references', 'Yes');
    const cs = spec.constraints || {};
    if (cs.qualities) fact('Quality settings', cs.qualities.join(', '));
  } else if (type === 'inpaint') {
    const cs = spec.constraints || {};
    fact('Aspect ratios', (cs.aspectRatios || []).join(', '));
    fact('Resolutions', (cs.resolutions || []).join(', '));
    fact('Prompt limit', cs.promptCharacterLimit ? cs.promptCharacterLimit.toLocaleString('en-US') + ' characters' : '');
    fact('Max input images', cs.maxInputImages);
    if (cs.combineImages) fact('Combines images', 'Yes');
  } else if (type === 'video') {
    const vp = videoProfile(raw, spec);
    row.policy = vp;
    row.mode = vp.mode;
    fact('Mode', vp.mode);
    fact('Durations', vp.durations.join(', '));
    fact('Resolutions', vp.resolutions.join(', '));
    fact('Aspect ratios', vp.aspectRatios.join(', '));
    fact('Audio', vp.voice.state === 'open' ? (vp.audioConfigurable ? 'Native, can be switched off' : 'Native') : vp.voice.state === 'blocked' ? 'Silent' : '');
    fact('Prompt limit', vp.promptLimit ? vp.promptLimit.toLocaleString('en-US') + ' characters' : '');
    const feat = sets.filter(s => s !== 'venice_recommendations' && s !== 'featured' && s !== 'audio').map(s => s.replace(/_/g, ' '));
    fact('Tagged', feat.join(', '));
  } else if (type === 'tts') {
    row.voices = (spec.voices || []).slice();
    fact('Voices', row.voices.length);
    fact('Formats', (spec.supported_formats || []).join(', '));
    fact('Default format', spec.default_format);
    if (spec.supports_custom_voice_id) fact('Custom voice ID', 'Yes');
    if (spec.voice_cloning) fact('Voice cloning', spec.voice_cloning.mode.replace(/_/g, ' ') + ', ' + spec.voice_cloning.min_sample_seconds + ' s sample minimum');
  } else if (type === 'music') {
    row.voices = (spec.voices || []).slice();
    fact('Length', spec.min_duration ? spec.min_duration + ' to ' + spec.max_duration + ' seconds' : '');
    fact('Formats', (spec.supported_formats || []).join(', '));
    fact('Prompt limit', spec.prompt_character_limit ? spec.prompt_character_limit.toLocaleString('en-US') + ' characters' : '');
    fact('Lyrics', spec.supports_lyrics ? (spec.lyrics_required ? 'Required' : 'Optional') : '');
    fact('Voices', row.voices.length);
    if (spec.supports_force_instrumental) fact('Instrumental mode', 'Yes');
    if (spec.voice_changer) fact('Voice changer', 'Yes');
  }

  if (row.retires) fact('Retires', row.retires + (row.replacement ? ', replaced by ' + row.replacement : ''));
  fact('Added', fmtDate(row.created));
  if (row.traits.length) fact('Venice traits', row.traits.join(', '));

  // Lower-cased haystack for the search box.
  row.hay = (row.id + ' ' + row.name + ' ' + provider + ' ' + typeLabel(type) + ' ' + row.mode + ' ' +
    row.caps.join(' ') + ' ' + row.privacy + (row.uncensored ? ' uncensored' : '')).toLowerCase();
  return row;
}

function build(rawList, videoPrices) {
  return (rawList || []).map(r => normalize(r, videoPrices));
}

// =====================================================================
// VIDEO PRICES — Venice lists them on its pricing page, not on /models.
// Parses the "## Video" table of docs.venice.ai/pricing.md.
// =====================================================================
function parseVideoPrices(md) {
  const out = {};
  const start = md.indexOf('\n## Video');
  if (start === -1) return out;
  const rest = md.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  const section = next === -1 ? rest : rest.slice(0, next);
  section.split('\n').forEach(line => {
    if (line.charAt(0) !== '|') return;
    const cols = line.split('|').map(s => s.trim());
    const idm = /`([^`]+)`/.exec(cols[2] || '');
    if (!idm) return;
    const price = (cols[4] || '').replace(/\\/g, '');
    const nums = (price.match(/\$\s*([0-9.]+)/g) || []).map(s => parseFloat(s.replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
    if (nums.length) out[idm[1]] = { min: Math.min.apply(null, nums), max: Math.max.apply(null, nums) };
    else if (/source/i.test(price)) out[idm[1]] = { bySource: true };
  });
  return out;
}

// =====================================================================
// FOR AGENTS — the same rows as plain records and as Markdown.
// =====================================================================
function agentRecord(row) {
  const rec = {
    id: row.id,
    name: row.name,
    type: row.type,
    provider: row.provider || null,
    endpoint: (TYPE_META[row.type] && TYPE_META[row.type].endpoint) || null,
    price: row.price.text || null,
    price_unit: row.price.unit && /^per /.test(row.price.unit) ? row.price.unit : (row.price.cells[0] && !row.price.cells[0].s ? (row.price.cells[0].k.charAt(0).toLowerCase() + row.price.cells[0].k.slice(1) + ' ' + row.price.unit).trim() : null),
    pricing: (row.raw.model_spec && row.raw.model_spec.pricing) || null,
    privacy: row.privacy,
    description: row.desc,
  };
  if (row.type === 'video') {
    const c = row.price.cells[0];
    rec.pricing = c && c.v !== undefined ? { per_second: { usd_min: c.v, usd_max: c.v2 === undefined ? c.v : c.v2 }, source: 'https://docs.venice.ai/pricing.md' } : null;
    rec.mode = row.mode;
  }
  if (row.ctx) rec.context_tokens = row.ctx;
  if (row.maxOut) rec.max_output_tokens = row.maxOut;
  if (row.caps.length) rec.capabilities = row.caps;
  if (row.beta) rec.beta = true;
  if (row.offline) rec.offline = true;
  if (row.uncensored) rec.uncensored = true;
  if (row.retires) { rec.retires = row.retires; if (row.replacement) rec.replacement = row.replacement; }
  if (row.traits.length) rec.traits = row.traits;
  if (row.policy) {
    rec.content_policy = {};
    (POLICY_AXES[row.policy.kind] || []).forEach(a => {
      const v = row.policy[a.key];
      rec.content_policy[a.key] = { rating: v.state, basis: v.inferred ? 'inferred' : 'checked' };
    });
  }
  rec.created = fmtDate(row.created);
  return rec;
}

const mdCell = s => String(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function modelsMarkdown(rows, opts) {
  opts = opts || {};
  const groups = {};
  rows.forEach(r => { (groups[r.type] = groups[r.type] || []).push(r); });
  const types = TYPE_ORDER.filter(t => groups[t]).concat(Object.keys(groups).filter(t => TYPE_ORDER.indexOf(t) === -1));
  const lines = [];
  types.forEach(t => {
    const list = groups[t].slice().sort((a, b) => a.name.localeCompare(b.name));
    const meta = TYPE_META[t] || {};
    lines.push('## ' + typeLabel(t) + ' (' + list.length + ')', '');
    if (meta.endpoint) lines.push('Endpoint: `' + meta.endpoint + '`', '');
    if (t === 'text') {
      lines.push('| Model ID | Name | Input /1M | Output /1M | Cache read /1M | Context | Max output | Capabilities | Privacy |', '| - | - | - | - | - | - | - | - | - |');
      list.forEach(r => {
        const pr = (r.raw.model_spec && r.raw.model_spec.pricing) || {};
        lines.push('| `' + r.id + '` | ' + mdCell(r.name) + ' | ' + fmtUsd(usd(pr.input)) + ' | ' + fmtUsd(usd(pr.output)) + ' | ' +
          (usd(pr.cache_input) === null ? '—' : fmtUsd(usd(pr.cache_input))) + ' | ' + fmtTokens(r.ctx) + ' | ' + fmtTokens(r.maxOut) + ' | ' +
          (r.caps.join(', ') || '—') + ' | ' + r.privacy + ' |');
      });
    } else if (t === 'video') {
      lines.push('| Model ID | Name | Mode | Price per second | Audio | Durations | Resolutions | Privacy |', '| - | - | - | - | - | - | - | - |');
      list.forEach(r => {
        const p = r.policy || {};
        lines.push('| `' + r.id + '` | ' + mdCell(r.name) + ' | ' + r.mode.replace(/→/g, 'to') + ' | ' + r.price.cells.map(cellText).join(' ') + ' | ' +
          (p.voice && p.voice.state === 'open' ? 'native' : p.voice && p.voice.state === 'blocked' ? 'silent' : '—') + ' | ' +
          ((p.durations || []).join(', ') || '—') + ' | ' + ((p.resolutions || []).join(', ') || '—') + ' | ' + r.privacy + ' |');
      });
    } else {
      lines.push('| Model ID | Name | Price | Privacy |', '| - | - | - | - |');
      list.forEach(r => lines.push('| `' + r.id + '` | ' + mdCell(r.name) + ' | ' + mdCell(r.price.text || '—') + ' | ' + r.privacy + ' |'));
    }
    lines.push('');
  });
  return lines.join('\n');
}

function modelMarkdown(row) {
  const L = [];
  L.push('# ' + row.name, '');
  L.push('- Model ID: `' + row.id + '`');
  L.push('- Type: ' + typeLabel(row.type) + (row.mode ? ' (' + row.mode.replace(/→/g, 'to') + ')' : ''));
  if (TYPE_META[row.type]) L.push('- Endpoint: `' + TYPE_META[row.type].endpoint + '`');
  if (row.provider) L.push('- Built by: ' + row.provider);
  L.push('- Price: ' + (row.price.text || 'not listed'));
  L.push('- Privacy tier: ' + row.privacy);
  if (row.caps.length) L.push('- Capabilities: ' + row.caps.map(k => CAP_BY_KEY[k].long.toLowerCase()).join('; '));
  if (row.beta) L.push('- Beta: can change or be removed without notice');
  if (row.offline) L.push('- Status: offline');
  if (row.retires) L.push('- Retires: ' + row.retires + (row.replacement ? ' (replacement: `' + row.replacement + '`)' : ''));
  L.push('');
  if (row.desc) L.push(row.desc, '');
  if (row.price.cells.length || row.price.tables.length) {
    L.push('## Pricing', '');
    if (row.price.cells.length) {
      L.push('| Rate | USD | Unit |', '| - | - | - |');
      row.price.cells.forEach(c => L.push('| ' + c.k + ' | ' + cellText(c) + ' | ' + (row.price.unit || '') + ' |'));
      L.push('');
    }
    row.price.tables.forEach(t => {
      L.push('### ' + t.title, '', '| Setting | USD' + (t.unit ? ' ' + t.unit : '') + ' |', '| - | - |');
      t.rows.forEach(r => L.push('| ' + r[0] + ' | ' + fmtUsd(r[1]) + ' |'));
      L.push('');
    });
    if (row.price.note) L.push(row.price.note, '');
  }
  if (row.facts.length) {
    L.push('## Specifications', '');
    row.facts.forEach(f => L.push('- ' + f[0] + ': ' + f[1]));
    L.push('');
  }
  if (row.voices && row.voices.length) L.push('## Voices', '', row.voices.join(', '), '');
  if (row.policy) {
    L.push('## Content policy ratings', '', 'Hand-curated ratings, not a guarantee from the provider. "open" means not blocked.', '');
    (POLICY_AXES[row.policy.kind] || []).forEach(a => {
      const v = row.policy[a.key];
      L.push('- ' + a.label + ': ' + v.state + (v.inferred ? ' (inferred)' : '') + '. ' + v.note);
    });
    L.push('');
  }
  return L.join('\n');
}

// A filter that the page, the JSON API and the MCP tool all share.
//   q: free text · type · cap: comma list · privacy · provider
//   max_price: ceiling on the sort price · uncensored: true · sort
function query(rows, f) {
  f = f || {};
  let out = rows;
  if (f.type && f.type !== 'all') out = out.filter(r => r.type === f.type);
  if (f.q) {
    const terms = String(f.q).toLowerCase().split(/\s+/).filter(Boolean);
    out = out.filter(r => terms.every(t => r.hay.indexOf(t) !== -1));
  }
  if (f.cap) {
    const want = String(f.cap).split(',').map(s => s.trim()).filter(Boolean);
    out = out.filter(r => want.every(c => r.caps.indexOf(c) !== -1));
  }
  if (f.privacy) out = out.filter(r => r.privacy === f.privacy);
  if (f.provider) { const p = String(f.provider).toLowerCase(); out = out.filter(r => r.provider.toLowerCase() === p); }
  if (f.uncensored) out = out.filter(r => r.uncensored);
  if (f.online) out = out.filter(r => !r.offline);
  if (f.max_price !== undefined && f.max_price !== '' && !isNaN(f.max_price)) out = out.filter(r => r.price.sort <= Number(f.max_price));
  return sortRows(out.slice(), f.sort);
}

function sortRows(list, key) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  switch (key) {
    case 'price':      return list.sort((a, b) => (a.price.sort - b.price.sort) || byName(a, b));
    case 'price-desc': return list.sort((a, b) => ((isFinite(b.price.sort) ? b.price.sort : -1) - (isFinite(a.price.sort) ? a.price.sort : -1)) || byName(a, b));
    case 'name':       return list.sort(byName);
    case 'context':    return list.sort((a, b) => (b.ctx - a.ctx) || byName(a, b));
    default:           return list.sort((a, b) => (b.created - a.created) || byName(a, b));
  }
}

return {
  TYPE_META, TYPE_ORDER, CAPS, CAP_BY_KEY, POLICY_STATES, POLICY_AXES, PROVIDER_SLUGS,
  typeLabel, providerOf, axisText, fmtUsd, fmtRange, fmtTokens, fmtCount, fmtDate, cellText,
  priceOf, normalize, build, parseVideoPrices, agentRecord, modelsMarkdown, modelMarkdown, query, sortRows,
};
});
