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
  // Azure OpenAI = egen ressurs (ikke Azure Speech). Trenger endpoint + key +
  // navnet på modell-deploymenten (f.eks. en gpt-4o-transcribe-deployment).
  azureOpenaiEndpoint: opt("AZURE_OPENAI_ENDPOINT"),
  azureOpenaiKey: opt("AZURE_OPENAI_KEY"),
  azureOpenaiDeployment: opt("AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT"),
  azureOpenaiApiVersion: opt("AZURE_OPENAI_API_VERSION"),
};
