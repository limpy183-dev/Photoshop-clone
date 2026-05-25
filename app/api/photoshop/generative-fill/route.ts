import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const endpoint = process.env.GENERATIVE_IMAGE_ENDPOINT
  const apiKey = process.env.GENERATIVE_IMAGE_API_KEY
  if (!endpoint || !apiKey) {
    return NextResponse.json(
      { error: "GENERATIVE_IMAGE_ENDPOINT and GENERATIVE_IMAGE_API_KEY are required for model-backed generative fill." },
      { status: 501 },
    )
  }

  const body = await request.json()
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const text = await upstream.text()
  const contentType = upstream.headers.get("content-type") ?? "application/json"

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": contentType },
  })
}
