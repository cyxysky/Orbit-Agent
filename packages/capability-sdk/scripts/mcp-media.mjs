import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);

async function codexCli(configured, projectRoot) {
  if (configured) return /[/\\]/.test(configured) ? path.resolve(projectRoot, configured) : configured;
  // The desktop app may bundle a newer CLI than the separately installed npm CLI.
  if (process.platform === 'win32') {
    const directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'OpenAI','Codex','bin');
    const entries = await readdir(directory,{withFileTypes:true}).catch(()=>[]);
    const candidates = await Promise.all(entries.filter(entry=>entry.isDirectory()).map(async entry=>{
      const filename=path.join(directory,entry.name,'codex.exe');
      const info=await stat(filename).catch(()=>undefined);return info?.isFile()?{filename,modified:info.mtimeMs}:undefined;
    }));
    for(const candidate of candidates.filter(Boolean).sort((a,b)=>b.modified-a.modified)){
      const result=await exec(candidate.filename,['--version'],{timeout:5000,windowsHide:true}).catch(()=>undefined);
      const version=result?.stdout.match(/codex-cli (\d+)\.(\d+)\.(\d+)/);
      if(version && (Number(version[1])>0 || Number(version[2])>=142))return candidate.filename;
    }
  }
  return undefined;
}

/** Join local media processing with the SDK's existing image/video/speech adapters. */
export async function createLocalMediaGeneration({ projectRoot, artifactsRoot, settings, resolveSource }) {
  const { createAiSdkMediaGenerationOperations } = await import('../dist/media/ai-sdk.js');
  const { mediaModelConfigurationSchema } = await import('../dist/media/models.js');
  const { builtInMediaModels } = await import('../dist/media/model-settings.js');
  let configured={models:[],defaults:{}};
  if(settings.modelsFile){
    configured=JSON.parse((await readFile(path.resolve(projectRoot,settings.modelsFile),'utf8')).replace(/^\uFEFF/,''));
    configured.models=configured.models.map(({apiKeyEnv,...model})=>{
      if(apiKeyEnv && !process.env[apiKeyEnv])throw new Error(`Missing media API key environment variable: ${apiKeyEnv}`);
      return {...model,...(apiKeyEnv?{apiKey:process.env[apiKeyEnv]}:{})};
    });
  }
  const builtin=settings.codexImage===false?[]:builtInMediaModels.map(item=>item.configuration);
  const configuration=mediaModelConfigurationSchema.parse({
    models:[...configured.models,...builtin.filter(item=>!configured.models.some(model=>model.id===item.id))],
    defaults:configured.defaults,
  });
  const codexPath=await codexCli(settings.codexPath || process.env.CAPABILITY_CODEX_PATH,projectRoot);
  return createAiSdkMediaGenerationOperations({configuration,codex:{codexPath},
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
