import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Join local media processing with configured OpenAI-compatible image/speech adapters. */
export async function createLocalMediaGeneration({ projectRoot, artifactsRoot, settings, resolveSource }) {
  const { createAiSdkMediaGenerationOperations } = await import('../dist/media/ai-sdk.js');
  const { mediaModelConfigurationSchema } = await import('../dist/media/models.js');
  let configured={models:[],defaults:{}};
  const modelsFile = settings.modelsFile || process.env.CAPABILITY_MEDIA_MODELS_FILE;
  if(modelsFile){
    configured=JSON.parse((await readFile(path.resolve(projectRoot,modelsFile),'utf8')).replace(/^\uFEFF/,''));
    configured.models=configured.models.map(({apiKeyEnv,...model})=>{
      if(apiKeyEnv && !process.env[apiKeyEnv])throw new Error(`Missing media API key environment variable: ${apiKeyEnv}`);
      return {...model,...(apiKeyEnv?{apiKey:process.env[apiKeyEnv]}:{})};
    });
  }
  const configuration=mediaModelConfigurationSchema.parse(configured);
  return createAiSdkMediaGenerationOperations({configuration,
    async readSource(ref){
      const filename=await resolveSource(ref);
      if((await stat(filename)).size>50*1024*1024)throw new Error('Reference image exceeds 50 MiB.');
      return readFile(filename);
    },
    async publishArtifact(file){
      const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/aac':'aac','audio/flac':'flac','audio/mp4':'m4a'};
      const extension=extensions[file.mediaType.split(';')[0]] || 'bin';
      const artifactId=randomUUID(),fileName=`${file.kind}.${extension}`;
      const directory=path.join(artifactsRoot,'media',artifactId);await mkdir(directory,{recursive:true});
      const filename=path.join(directory,fileName);await writeFile(filename,file.data,{flag:'wx'});
      return {artifactId,fileName,mediaType:file.mediaType,url:pathToFileURL(filename).href,downloadUrl:pathToFileURL(filename).href};
    },
  });
}
