// Utsteder kortlevde credentials for browser-direkte live-transkribering, per
// leverandør. Mønsteret speiler /api/speech-token (Azure Speech): serveren holder
// API-nøkkelen, browseren får kun en kortlevd token og streamer lyden direkte.
//
// Foreløpig: azure-openai (Azure OpenAI Realtime, gpt-4o-transcribe).
// aws-streaming kommer i egen runde.

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/transcribe-token/[provider]">
) {
  const { provider } = await ctx.params;
  if (provider === "azure-openai") return azureOpenaiToken();
  return Response.json({ error: `Ukjent live-leverandør: ${provider}` }, { status: 404 });
}

async function azureOpenaiToken() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT;
  if (!endpoint || !key || !deployment) {
    return Response.json(
      { error: "AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_KEY/AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT mangler" },
      { status: 500 }
    );
  }
  const base = endpoint.replace(/\/$/, "");

  // GA-endepunkt for ephemeral realtime-credentials (ingen api-version).
  // Sesjonen settes opp som transkribering med rå PCM-input @ 24 kHz.
  const res = await fetch(`${base}/openai/v1/realtime/client_secrets`, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: deployment, language: "no" },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    return Response.json(
      { error: `Azure realtime token ${res.status}: ${(await res.text()).slice(0, 300)}` },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    value?: string;
    client_secret?: { value?: string };
  };
  // GA returnerer { value, ... }; preview returnerte { client_secret: { value } }.
  const ephemeralKey = data.value ?? data.client_secret?.value;
  if (!ephemeralKey) {
    return Response.json({ error: "Fikk ingen ephemeral nøkkel fra Azure" }, { status: 502 });
  }

  const wsUrl = `${base.replace(/^https/, "wss")}/openai/v1/realtime?intent=transcription`;
  return Response.json({ ephemeralKey, wsUrl });
}
