import type { SpeechRecognizer } from "microsoft-cognitiveservices-speech-sdk";
import type { LiveTranscriber } from "../types";

export function createAzureSpeechLive(): LiveTranscriber {
  let rec: SpeechRecognizer | null = null;
  const phrases: string[] = [];
  let interim = "";

  const t: LiveTranscriber = {
    async start() {
      const tokenRes = await fetch("/api/speech-token", { method: "POST" });
      const { token, region, error } = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(error || "Kunne ikke hente taletoken");

      const sdk = await import("microsoft-cognitiveservices-speech-sdk");
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = "nb-NO";
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const r = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      r.recognizing = (_s, e) => {
        interim = e.result.text;
        t.onPartial?.(e.result.text);
      };
      r.recognized = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
          phrases.push(e.result.text);
          t.onFinal?.(e.result.text);
        }
        interim = "";
      };
      r.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) t.onError?.(new Error(e.errorDetails));
      };

      await new Promise<void>((resolve, reject) => r.startContinuousRecognitionAsync(resolve, reject));
      rec = r;
    },
    async stop() {
      if (rec) {
        await new Promise<void>((resolve) => rec!.stopContinuousRecognitionAsync(resolve, () => resolve()));
        rec.close();
        rec = null;
      }
      const transcript = [...phrases, interim].join(" ").replace(/\s+/g, " ").trim();
      return { transcript };
    },
  };
  return t;
}
