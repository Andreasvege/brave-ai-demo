import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Last .env.local fra prosjektroten (to nivåer opp fra denne filen)
loadEnv({ path: resolve(__dirname, "../../.env.local") });

function opt(name: string): string | undefined {
  return process.env[name];
}

export const env = {
  azureKey: opt("AZURE_SPEECH_KEY"),
  azureRegion: opt("AZURE_SPEECH_REGION"),
  awsAccessKeyId: opt("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: opt("AWS_SECRET_ACCESS_KEY"),
  awsRegion: opt("AWS_REGION"),
  googleCredentials: opt("GOOGLE_APPLICATION_CREDENTIALS"),
  openaiKey: opt("OPENAI_API_KEY"),
  deepgramKey: opt("DEEPGRAM_API_KEY"),
};
