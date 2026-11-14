// Server-only client for calling the LTX-Video text-to-video Gradio Space
// hosted for free on Hugging Face (ZeroGPU). We talk to the Gradio HTTP
// "queue" API directly with fetch() instead of the @gradio/client npm
// package, because that package assumes a Node.js runtime and breaks when
// Next.js bundles it (see gradio-app/gradio#8864).
//
// Docs for this API shape: https://www.gradio.app/guides/querying-gradio-apps-with-curl
// Space: https://huggingface.co/spaces/Lightricks/ltx-video-distilled

const SPACE_BASE_URL = "https://lightricks-ltx-video-distilled.hf.space";
const API_NAME = "text_to_video";

export interface GenerateVideoParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  seed?: number;
  randomizeSeed?: boolean;
  guidanceScale?: number;
}

export interface GenerateVideoResult {
  videoUrl: string;
  seedUsed: number;
}

// Component value ranges as configured on the Space (see /config), used to
// clamp anything a caller sends us before it hits the model.
const LIMITS = {
  width: { min: 256, max: 1280 },
  height: { min: 256, max: 1280 },
  durationSeconds: { min: 0.3, max: 8.5 },
  guidanceScale: { min: 1, max: 10 },
  seed: { min: 0, max: 4294967295 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

class InferenceError extends Error {}

export async function generateVideo(
  params: GenerateVideoParams,
): Promise<GenerateVideoResult> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new InferenceError("Необходимо написать описание сцены.");

  const width = clamp(params.width ?? 704, LIMITS.width.min, LIMITS.width.max);
  const height = clamp(params.height ?? 512, LIMITS.height.min, LIMITS.height.max);
  const durationSeconds = clamp(
    params.durationSeconds ?? 3,
    LIMITS.durationSeconds.min,
    LIMITS.durationSeconds.max,
  );
  const guidanceScale = clamp(
    params.guidanceScale ?? 1,
    LIMITS.guidanceScale.min,
    LIMITS.guidanceScale.max,
  );
  const randomizeSeed = params.randomizeSeed ?? true;
  const seed = clamp(params.seed ?? 42, LIMITS.seed.min, LIMITS.seed.max);

  // Positional args must match the Space's `text_to_video` handler signature
  // exactly: [prompt, negative_prompt, image_name, video_name, height, width,
  // task, duration_seconds, frames_to_use, seed, randomize_seed,
  // guidance_scale, improve_texture]. image_name/video_name/frames_to_use
  // are only relevant to the Space's image-to-video and video-to-video
  // tabs, so we pass inert defaults.
  const data = [
    prompt,
    params.negativePrompt?.trim() || "worst quality, blurry, distorted, watermark",
    "",
    "",
    height,
    width,
    "text-to-video",
    durationSeconds,
    9,
    seed,
    randomizeSeed,
    guidanceScale,
    true,
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.HF_TOKEN) {
    headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;
  }

  const submitRes = await fetch(`${SPACE_BASE_URL}/gradio_api/call/${API_NAME}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });

  if (!submitRes.ok) {
    throw new InferenceError(
      `Не удалось отправить задание (HTTP ${submitRes.status}). Сервер может быть перегружен или временно недоступен. Попробуйте позже.`,
    );
  }

  const { event_id: eventId } = (await submitRes.json()) as { event_id: string };
  if (!eventId) throw new InferenceError("Сервер не вернул номер задания.");

  const resultRes = await fetch(
    `${SPACE_BASE_URL}/gradio_api/call/${API_NAME}/${eventId}`,
    { headers, signal: AbortSignal.timeout(5 * 60 * 1000) },
  );

  if (!resultRes.ok || !resultRes.body) {
    throw new InferenceError(`Соединение с сервером прервалось во время ожидания видео (HTTP ${resultRes.status}).`);
  }

  const raw = await resultRes.text();
  return parseSseResult(raw);
}

function parseSseResult(raw: string): GenerateVideoResult {
  // Gradio sends an SSE stream. A Video output is normally shaped as
  // { video: { path, url, ... }, subtitles: null }, followed by the seed.
  const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);

  for (const block of blocks.reverse()) {
    const eventMatch = block.match(/^event:\s*(\S+)/m);
    const dataMatch = block.match(/^data:\s*(.+)$/m);
    if (!eventMatch || !dataMatch) continue;

    const eventName = eventMatch[1];
    if (eventName === "error") {
      throw new InferenceError(`Ошибка генерации на сервере модели: ${dataMatch[1]}`);
    }
    if (eventName !== "complete") continue;

    let payload: unknown;
    try {
      payload = JSON.parse(dataMatch[1]);
    } catch {
      throw new InferenceError("Сервер вернул повреждённый ответ вместо видео.");
    }

    if (!Array.isArray(payload) || payload.length < 1) {
      throw new InferenceError("Сервер завершил задачу, но не вернул видео.");
    }

    const output = payload[0] as
      | { video?: string | { url?: string | null; path?: string | null } | null; url?: string | null; path?: string | null }
      | string
      | null;
    const file = typeof output === "string"
      ? output
      : output && typeof output === "object"
        ? output.video ?? output
        : null;
    const rawUrl = typeof file === "string"
      ? file
      : file && typeof file === "object"
        ? file.url ?? null
        : null;

    if (!rawUrl) {
      throw new InferenceError("Сервер завершил задачу, но не передал ссылку на видео.");
    }

    const videoUrl = rawUrl.startsWith("http")
      ? rawUrl
      : `${SPACE_BASE_URL}/${rawUrl.replace(/^\/+/, "")}`;
    const seedValue = payload[1];
    const seedUsed = typeof seedValue === "number" ? seedValue : 0;

    return { videoUrl, seedUsed };
  }

  throw new InferenceError("Время ожидания истекло или сервер закрыл соединение до завершения генерации.");
}
