import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOST = "lightricks-ltx-video-distilled.hf.space";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Не указана ссылка на видео." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Некорректная ссылка на видео." }, { status: 400 });
  }

  const allowedPath =
    target.pathname.startsWith("/gradio_api/file=") ||
    target.pathname.startsWith("/file=");

  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST || !allowedPath) {
    return NextResponse.json({ error: "Источник видео не разрешён." }, { status: 403 });
  }

  try {
    const range = request.headers.get("range");
    const upstream = await fetch(target, {
      headers: range ? { Range: range } : undefined,
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Не удалось получить видео (HTTP ${upstream.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Cache-Control": "no-store",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    });

    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить видео с сервера модели." }, { status: 502 });
  }
}
