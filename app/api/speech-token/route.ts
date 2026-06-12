// Utsteder kortlevd Azure Speech-token (10 min) så API-nøkkelen
// aldri eksponeres i nettleseren.
export async function POST() {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) {
    return Response.json(
      { error: "AZURE_SPEECH_REGION/AZURE_SPEECH_KEY mangler i miljøet" },
      { status: 500 }
    );
  }

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
    }
  );

  if (!res.ok) {
    return Response.json(
      { error: `Azure token-utstedelse feilet: ${res.status}` },
      { status: 502 }
    );
  }

  const token = await res.text();
  return Response.json({ token, region });
}
