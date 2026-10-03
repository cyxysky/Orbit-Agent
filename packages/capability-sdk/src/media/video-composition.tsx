import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComposeVideoInput } from './index.ts';

export const VIDEO_FPS = 30;
export function videoCompositionMetadata(input: ComposeVideoInput) {
  const [width, height] = (input.size || '1280x720').split('x').map(Number);
  return { width, height, fps: VIDEO_FPS, durationInFrames: input.scenes.reduce((sum, scene) => sum + Math.max(3, Math.round(scene.duration * VIDEO_FPS)), 0) };
}

function VideoScene({ scene, frames, narration }: { scene: ComposeVideoInput['scenes'][number]; frames: number; narration: boolean }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const progress = frame / Math.max(1, frames - 1);
  const motion = scene.motion || 'none';
  const scale = motion === 'zoomIn' ? 1 + progress * 0.12 : motion === 'zoomOut' ? 1.12 - progress * 0.12 : motion.startsWith('pan') ? 1.12 : 1;
  const translate = motion === 'panLeft' ? 5 - progress * 10 : motion === 'panRight' ? -5 + progress * 10 : 0;
  const style = { width: '100%', height: '100%', objectFit: 'contain' as const, transform: `translateX(${translate}%) scale(${scale})` };
  return <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
    {scene.kind === 'video'
      ? <OffthreadVideo src={scene.sourceRef} trimBefore={Math.round((scene.trimStart || 0) * VIDEO_FPS)} muted={narration || scene.muted === true} style={style} />
      : <Img src={scene.sourceRef} style={style} />}
    {scene.caption ? <div style={{ position: 'absolute', bottom: '7%', left: '8%', right: '8%', textAlign: 'center', color: 'white',
      fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: width * 0.03, lineHeight: 1.5, fontWeight: 600,
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textShadow: '0 2px 6px #000', padding: '12px 20px', borderRadius: 10,
      backgroundColor: '#0009', opacity: interpolate(frame, [0, Math.min(6, frames - 1)], [0, 1], { extrapolateRight: 'clamp' }) }}>{scene.caption}</div> : null}
  </AbsoluteFill>;
}

/** Shared by the in-chat Player and server rendering so edits match the MP4. */
export function MediaVideoComposition(input: ComposeVideoInput) {
  const metadata = videoCompositionMetadata(input);
  let start = 0;
  const audioStart = Math.round((input.audioOffset || 0) * VIDEO_FPS);
  const audioFrames = Math.min(metadata.durationInFrames - audioStart, Math.round((input.audioDuration || metadata.durationInFrames / VIDEO_FPS) * VIDEO_FPS));
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {input.scenes.map((scene, index) => {
      const frames = Math.max(3, Math.round(scene.duration * VIDEO_FPS));
      const from = start; start += frames;
      return <Sequence key={index} from={from} durationInFrames={frames}>
        <VideoScene scene={scene} frames={frames} narration={Boolean(input.audioRef)} />
      </Sequence>;
    })}
    {input.audioRef && audioFrames > 0 ? <Sequence from={audioStart} durationInFrames={audioFrames}>
      <Audio src={input.audioRef} trimBefore={Math.round((input.audioTrimStart || 0) * VIDEO_FPS)} volume={input.audioVolume ?? 1} />
    </Sequence> : null}
  </AbsoluteFill>;
}
