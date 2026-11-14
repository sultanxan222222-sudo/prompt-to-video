"use client";

import { useEffect, useRef, useState } from "react";
import { ASPECT_PRESETS, type AspectKey, type GenerationRecord } from "@/lib/types";

const HISTORY_KEY = "prompt-to-video:history";
const MAX_HISTORY = 12;
const ENDING_SCENES = [
  {
    title: "1. Полицейский отпускает водителя",
    prompt: "Photorealistic cinematic Christmas night on a snowy European city street. A friendly smiling police officer warmly waves goodbye to a driver through the open car window. The driver smiles back, the moment feels kind and festive. Natural human faces and gestures, realistic police uniform, soft falling snow, warm street lights, smooth cinematic camera movement, realistic live-action film, no cartoon, no text, no logos.",
  },
  {
    title: "2. Машины начинают движение",
    prompt: "Photorealistic cinematic winter night, continuation of the same snowy European city street. A line of ordinary cars gently starts moving forward after being stopped, headlights illuminate falling snow, tires roll slowly over the snowy road. The camera follows the cars smoothly from a low street-level angle. Festive warm lights in shop windows, realistic vehicles and motion, live-action film, no cartoon, no text, no logos.",
  },
  {
    title: "3. Праздничная колонна автомобилей",
    prompt: "A joyful festive Christmas car parade drives along a beautiful snow-covered European city street at night. Several elegant cars are decorated with tasteful colorful Christmas lights and garlands, warm headlights glow through gentle snowfall, people smile from the sidewalks. Smooth cinematic tracking shot, realistic cars with correct proportions, photorealistic live-action movie, no cartoon, no text, no logos.",
  },
  {
    title: "4. Ёлка и новогодний салют",
    prompt: "Grand cinematic finale of a Christmas night in a snowy European city. The camera slowly pulls back and rises to reveal a magnificent glowing Christmas tree in a festive square, the decorated car parade passing below, warm lights across the city. Colorful fireworks bloom beautifully above the rooftops and illuminate the falling snow. Wide breathtaking photorealistic live-action shot, elegant joyful atmosphere, no cartoon, no text, no logos.",
  },
];



function loadHistory(): GenerationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as GenerationRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: GenerationRecord[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
}

function playableUrl(url: string) {
  return `/api/video?url=${encodeURIComponent(url)}`;
}

export default function Generator() {
  const [prompt, setPrompt] = useState(ENDING_SCENES[0].prompt);
  const [negativePrompt, setNegativePrompt] = useState("worst quality, blurry, distorted, watermark, deformed cars, extra wheels, unnatural faces, flicker");
  const [hfToken, setHfToken] = useState("");
  const [aspect, setAspect] = useState<AspectKey>("landscape");
  const [duration, setDuration] = useState(7);
  const [guidanceScale, setGuidanceScale] = useState(1);
  const [randomizeSeed, setRandomizeSeed] = useState(true);
  const [seed, setSeed] = useState(42);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "assembling" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState(STATUS_MESSAGES[0]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<GenerationRecord | null>(null);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [endingClips, setEndingClips] = useState<GenerationRecord[]>([]);
  const [endingProgress, setEndingProgress] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // localStorage is read after mount to avoid server/client rendering differences.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    let tick = 0;
    timerRef.current = setInterval(() => {
      tick += 1;
      setElapsed(tick);
      setStatusMessage("Сервер обрабатывает запрос…");
    }, 1000);
  }

  function finishTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function requestClip(
    clipPrompt: string,
    clipDuration: number,
    clipAspect: AspectKey,
  ): Promise<GenerationRecord> {
    const { width, height } = ASPECT_PRESETS[clipAspect];
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: clipPrompt,
        negativePrompt,
        width,
        height,
        durationSeconds: clipDuration,
        guidanceScale,
        hfToken: hfToken.trim() || undefined,
        randomizeSeed,
        seed,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось создать видео.");

    return {
      id: crypto.randomUUID(),
      prompt: clipPrompt,
      negativePrompt,
      width,
      height,
      durationSeconds: clipDuration,
      guidanceScale,
      seedUsed: data.seedUsed,
      videoUrl: data.videoUrl,
      createdAt: Date.now(),
    };
  }

  function addToHistory(record: GenerationRecord) {
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || status === "loading" || status === "assembling") return;

    setStatus("loading");
    setErrorMessage("");
    startTimer();
    try {
      const record = await requestClip(prompt, duration, aspect);
      setResult(record);
      addToHistory(record);
      setStatus("idle");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Произошла ошибка.");
      setStatus("error");
    } finally {
      finishTimer();
    }
  }

  async function handleCreateEnding() {
    if (status === "loading" || status === "assembling") return;
    setStatus("loading");
    setErrorMessage("");
    setEndingClips([]);
    setEndingProgress(0);
    if (finalVideoUrl) URL.revokeObjectURL(finalVideoUrl);
    setFinalVideoUrl(null);
    startTimer();

    const created: GenerationRecord[] = [];
    try {
      for (let i = 0; i < ENDING_SCENES.length; i += 1) {
        setStatusMessage(`Создаём сцену ${i + 1} из ${ENDING_SCENES.length}: ${ENDING_SCENES[i].title}`);
        const record = await requestClip(ENDING_SCENES[i].prompt, 7, "landscape");
        created.push(record);
        setEndingClips([...created]);
        setEndingProgress(i + 1);
        addToHistory(record);
        setResult(record);
      }
      setStatus("idle");
      setStatusMessage("Все четыре сцены готовы. Теперь можно собрать их в один ролик.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Не удалось завершить генерацию.");
      setStatus("error");
    } finally {
      finishTimer();
    }
  }

  async function handleAssembleEnding() {
    if (endingClips.length !== ENDING_SCENES.length || status === "loading" || status === "assembling") return;
    if (typeof MediaRecorder === "undefined") {
      setErrorMessage("Этот браузер не поддерживает сборку видео. Открой студию в актуальном Chrome.");
      setStatus("error");
      return;
    }

    setStatus("assembling");
    setErrorMessage("");
    setStatusMessage("Соединяем четыре сцены в один ролик…");

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 432;
      const context = canvas.getContext("2d");
      if (!context || typeof canvas.captureStream !== "function") {
        throw new Error("Браузер не поддерживает сборку видео на этом устройстве.");
      }

      stream = canvas.captureStream(30);
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve, reject) => {
        if (!recorder) {
          reject(new Error("Не удалось запустить сборку видео."));
          return;
        }
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("Ошибка записи итогового видео."));
      });
      recorder.start(500);

      for (let i = 0; i < endingClips.length; i += 1) {
        setStatusMessage(`Собираем сцену ${i + 1} из ${endingClips.length}…`);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = playableUrl(endingClips[i].videoUrl);

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`Не удалось загрузить сцену ${i + 1} для сборки.`));
          video.load();
        });

        await video.play();
        while (!video.ended) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (i === endingClips.length - 1) {
          const holdUntil = performance.now() + 2000;
          while (performance.now() < holdUntil) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        }
        video.pause();
        video.removeAttribute("src");
        video.load();
      }

      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      stream = null;

      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (blob.size === 0) throw new Error("Итоговый видеофайл оказался пустым.");
      const nextUrl = URL.createObjectURL(blob);
      if (finalVideoUrl) URL.revokeObjectURL(finalVideoUrl);
      setFinalVideoUrl(nextUrl);
      setStatus("idle");
      setStatusMessage("Готово! Все сцены соединены в один ролик.");
    } catch (err) {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      setErrorMessage(err instanceof Error ? err.message : "Не удалось собрать итоговый ролик.");
      setStatus("error");
    }
  }

  const isBusy = status === "loading" || status === "assembling";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Новогодняя видеостудия</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Создание видео на модели{" "}
          <a href="https://huggingface.co/spaces/Lightricks/ltx-video-distilled" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            LTX-Video 13B
          </a>
          . Бесплатный общий сервер; скорость и доступность зависят от очереди и квоты.
        </p>
      </header>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Готовая концовка — около 30 секунд</h2>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Студия последовательно создаст четыре фрагмента примерно по 7 секунд и добавит 2-секундную финальную паузу: прощание полицейского, движение машин, праздничную колонну и финальный салют. Затем соединит их в один видеофайл.
          </p>
          <ol className="list-inside list-decimal space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
            {ENDING_SCENES.map((scene) => <li key={scene.title}>{scene.title}</li>)}
          </ol>
          <button
            type="button"
            onClick={handleCreateEnding}
            disabled={isBusy}
            className="mt-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? `Создаём сцену ${endingProgress + 1} из 4…` : "Создать всю концовку"}
          </button>
          {endingClips.length > 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Готово фрагментов: {endingClips.length} из 4. Если генерация прервалась, уже созданные фрагменты сохранены в истории.
            </p>
          )}
          {endingClips.length === 4 && (
            <button
              type="button"
              onClick={handleAssembleEnding}
              disabled={isBusy}
              className="rounded-lg border border-neutral-400 px-4 py-3 text-sm font-semibold transition hover:bg-white/60 disabled:opacity-50 dark:hover:bg-neutral-900"
            >
              {status === "assembling" ? "Собираем итоговый ролик…" : "Собрать готовый ролик"}
            </button>
          )}
        </div>
      </section>

      <label className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <span className="font-medium">Бесплатный токен Hugging Face (необязательно)</span>
        <input type="password" autoComplete="off" value={hfToken} onChange={(e) => setHfToken(e.target.value)} placeholder="Вставь read-токен, если он у тебя есть" className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700" />
        <span className="text-xs text-neutral-500">Без токена используется общий анонимный лимит. Для четырёх сцен лучше бесплатный аккаунт и read-токен. Токен не сохраняется в истории и используется только для запросов. <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer" className="underline">Создать токен</a>.</span>
      </label>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-base font-semibold">Или создать отдельную сцену</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Описание сцены</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Опиши, что должно происходить в кадре…"
            rows={4}
            required
            className="resize-y rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(ASPECT_PRESETS) as AspectKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setAspect(key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${aspect === key ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"}`}
            >
              {ASPECT_PRESETS[key].label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="flex justify-between text-sm font-medium">
            <span>Длительность фрагмента</span>
            <span className="text-neutral-500 dark:text-neutral-400">{duration.toFixed(1)} сек.</span>
          </span>
          <input type="range" min={1} max={8.5} step={0.5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </label>

        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="self-start text-xs font-medium text-neutral-500 underline underline-offset-2">
          {showAdvanced ? "Скрыть дополнительные настройки" : "Дополнительные настройки"}
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Что исключить из кадра</span>
              <input type="text" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flex justify-between text-sm font-medium">
                <span>Точность описания (CFG)</span>
                <span>{guidanceScale.toFixed(1)}</span>
              </span>
              <input type="range" min={1} max={10} step={0.5} value={guidanceScale} onChange={(e) => setGuidanceScale(Number(e.target.value))} />
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={randomizeSeed} onChange={(e) => setRandomizeSeed(e.target.checked)} />
                Случайный вариант
              </label>
              {!randomizeSeed && <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-32 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700" />}
            </div>
          </div>
        )}

        <button type="submit" disabled={isBusy || !prompt.trim()} className="mt-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900">
          {status === "loading" ? `Создаём видео… ${elapsed} сек.` : "Создать один фрагмент"}
        </button>
      </form>

      {isBusy && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{statusMessage}</p>
          {status === "loading" && <p className="text-xs text-neutral-500">Прошло: {elapsed} сек.</p>}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      {finalVideoUrl && (
        <section className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm dark:border-emerald-900 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">Готовая концовка</h2>
          <video src={finalVideoUrl} controls playsInline className="w-full rounded-lg bg-black" />
          <a href={finalVideoUrl} download="novogodnyaya-koncovka.webm" className="rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500">
            Скачать готовое видео
          </a>
          <p className="text-xs text-neutral-500">Файл сохраняется в формате WebM без звука. При необходимости его можно преобразовать в MP4.</p>
        </section>
      )}

      {result && !isBusy && (
        <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold">Последний созданный фрагмент</h2>
          <video key={result.id} src={playableUrl(result.videoUrl)} controls playsInline preload="metadata" className="w-full rounded-lg bg-black" />
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span>Номер варианта: {result.seedUsed}</span>
            <a href={playableUrl(result.videoUrl)} download target="_blank" rel="noreferrer" className="underline underline-offset-2">Скачать фрагмент</a>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">История видео</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.map((item) => (
              <button key={item.id} type="button" onClick={() => setResult(item)} className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 text-left dark:border-neutral-800">
                <video src={playableUrl(item.videoUrl)} muted preload="metadata" playsInline onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.05; }} className="aspect-video w-full bg-black object-cover" />
                <span className="line-clamp-2 px-2 py-1.5 text-xs text-neutral-600 group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-100">{item.prompt}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
