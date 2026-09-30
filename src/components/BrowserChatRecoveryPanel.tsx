'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react/button';
import { Popover } from '@heroui/react/popover';
import { ArrowRight, Brain, Check, CircleAlert, Loader2, Sparkles, X } from 'lucide-react';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

type MemoryProposal = { id: string; items: Array<{ key: string; value: string; status: string; evidence?: string[]; applicability?: { when: string }; expiresAt?: string }> };
type MemoryJob = { id: string; status: string; attempts: number; error?: string; result?: {
  reason?: string; pendingCandidateId?: string;
  diagnostics?: { candidateCount: number; rejectedCount: number; rejectedCandidates: Array<{ key: string; reasonDescription: string }> };
} };
export function BrowserChatRecoveryPanel({ sessionId, busy }: { sessionId: string; busy: boolean }) {
  const [candidates, setCandidates] = useState<MemoryProposal[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [jobs, setJobs] = useState<MemoryJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [extractionEnabled, setExtractionEnabled] = useState(true);
  const actionRequest = useRef<AbortController | null>(null);
  const url = withWebPilotBasePath(`/api/browser-chat/${sessionId}/recovery`);
  useEffect(() => {
    actionRequest.current?.abort(); actionRequest.current = null;
    setCandidates([]); setJobs([]); setSelectedJobId(undefined); setError(''); setLoadError(''); setSaving(false); setPendingAction('');
    return () => { actionRequest.current?.abort(); actionRequest.current = null; };
  }, [url]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.error || '无法读取记忆候选');
        if (!controller.signal.aborted) {
          setCandidates(data.candidates || []); setJobs(data.jobs || []);
          setExtractionEnabled(data.extractionEnabled !== false); setLoadError('');
        }
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error)); }
      finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (open) timer = setTimeout(() => { void refresh(); }, 3000);
        }
      }
    };
    if (!saving) { setLoading(true); void refresh(); }
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url, open, saving]);
  async function memoryAction(proposal?: MemoryProposal, approved = false) {
    if (actionRequest.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    actionRequest.current = controller;
    setSaving(true); setPendingAction(proposal ? `${proposal.id}:${approved}` : 'extract'); setError('');
    try {
      const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal ? { action: 'memory-review', id: proposal.id, approved } : { action: 'memory-extract' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || result.error || '记忆操作失败');
      if (!controller.signal.aborted && proposal) setCandidates(current => current.filter(item => item.id !== proposal.id));
      if (!controller.signal.aborted && result.jobId) setSelectedJobId(result.jobId);
      const latest = await fetch(url, { signal, cache: 'no-store' });
      const data = await latest.json();
      if (!latest.ok) throw new Error(data.error?.message || data.error || '无法刷新记忆候选');
      if (!controller.signal.aborted) { setCandidates(data.candidates || []); setJobs(data.jobs || []); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally {
      if (actionRequest.current === controller) actionRequest.current = null;
      if (!controller.signal.aborted) { setSaving(false); setPendingAction(''); }
    }
  }
  const extractionDisabled = busy || saving || loading;
  const currentJob = jobs.find(job => job.id === selectedJobId) || jobs[0];
  const extracting = jobs.some(job => job.status === 'queued' || job.status === 'running');
  const jobMessage = currentJob?.status === 'running' ? '正在提炼并核对本轮记忆…'
    : currentJob?.status === 'queued' ? currentJob.attempts ? '提炼暂时失败，正在等待自动重试…' : '已加入提炼队列，即将开始…'
      : currentJob?.status === 'failed' ? '记忆提炼失败，可点击下方按钮重试。'
        : currentJob?.status === 'completed' ? currentJob.result?.reason === 'disabled' ? '记忆提炼已关闭。'
          : currentJob.result?.reason === 'already-processed' ? '本轮已经提炼过，无需重复处理。'
            : candidates.length ? '提炼完成，请核对下方候选记忆。'
              : currentJob.result?.pendingCandidateId ? '本轮候选记忆已处理。'
                : '提炼完成，本轮没有新增可保存的长期记忆。'
          : '';
  const pendingCount = candidates.length;
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Button type="button" variant="ghost" className="browser-chat-conversation-direct-action browser-chat-recovery-trigger"
      aria-label={`长期记忆${pendingCount ? `，${pendingCount} 项待处理` : ''}`} aria-expanded={open}>
      <Brain size={17} aria-hidden="true" />
      <span className="browser-chat-recovery-trigger-label">长期记忆</span>
      {pendingCount > 0 && <span className="browser-chat-recovery-badge">{pendingCount}</span>}
      {(error || loadError) && !pendingCount && <CircleAlert size={14} aria-label="读取失败" />}
    </Button>
    <Popover.Content className="browser-chat-recovery-popover" placement="bottom end" offset={8} containerPadding={12}>
      <Popover.Dialog aria-label="长期记忆" className="browser-chat-recovery-dialog">
        <header className="browser-chat-recovery-header">
          <strong><span className="browser-chat-recovery-header-icon"><Brain size={17} aria-hidden="true" /></span><span>长期记忆<small>审核后用于后续对话</small></span></strong>
          <button type="button" className="ui-icon-button" aria-label="关闭长期记忆" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className="browser-chat-recovery-body" aria-busy={loading && !candidates.length}>
          {busy && <p className="browser-chat-recovery-hint browser-chat-recovery-notice" role="status">任务执行中，已有候选可直接审核；结束后可提炼本轮记忆。</p>}
          {loading && !candidates.length && <p className="browser-chat-recovery-hint" role="status"><Loader2 size={14} className="animate-spin" />正在读取…</p>}
          {!extractionEnabled && <p className="browser-chat-recovery-hint">记忆提炼已关闭，请在运行设置中开启“个性化记忆召回”和“个性化记忆提炼”。</p>}
          {jobMessage && <p className="browser-chat-recovery-hint" role="status">{extractionEnabled && extracting ? <Loader2 size={14} className="animate-spin" /> : null}{jobMessage}</p>}
          {currentJob?.status === 'failed' && currentJob.error ? <details><summary>失败详情</summary><p className="browser-chat-recovery-error">{currentJob.error}</p></details> : null}
          {Boolean(currentJob?.result?.diagnostics?.rejectedCount) && <details><summary>查看未保留的候选原因</summary>{currentJob?.result?.diagnostics?.rejectedCandidates.map((item, index) => <p className="browser-chat-recovery-hint" key={index}>{item.key}：{item.reasonDescription}</p>)}</details>}
          {!loading && !candidates.length && !error && !jobMessage && <p className="browser-chat-recovery-empty">暂无待审核的记忆</p>}
          {candidates.length > 0 && <h3 className="browser-chat-recovery-section-title">待审核 · {candidates.length}</h3>}
          {candidates.map(proposal => <section className="browser-chat-recovery-section" key={proposal.id}>
            <div className="browser-chat-recovery-content">
            {proposal.items.map((item, index) => <div className="browser-chat-recovery-memory" key={index}>
              <strong>{item.key}{item.status === 'disabled' ? '（停用）' : ''}</strong><p>{item.value}</p>
              {item.applicability && <p className="browser-chat-recovery-hint">适用条件：{item.applicability.when}</p>}
              {item.evidence?.length ? <details><summary>查看记忆依据</summary><blockquote>{item.evidence.join('\n')}</blockquote></details> : null}
              {item.expiresAt && <p className="browser-chat-recovery-hint">有效期至：{item.expiresAt}</p>}
            </div>)}
            </div>
            <div className="browser-chat-recovery-actions">
              <button type="button" className="browser-chat-recovery-review-button" disabled={saving} onClick={() => void memoryAction(proposal, false)}>{pendingAction === `${proposal.id}:false` ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}丢弃</button>
              <button type="button" className="browser-chat-recovery-review-button is-approve" disabled={saving} onClick={() => void memoryAction(proposal, true)}>{pendingAction === `${proposal.id}:true` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}批准</button>
            </div>
          </section>)}
          {(error || loadError) && <p className="browser-chat-recovery-error" role="alert">{error || loadError}</p>}
        </div>
        <footer className="browser-chat-recovery-footer">
          <button type="button" className="ui-button browser-chat-recovery-extract" disabled={extractionDisabled || extracting || !extractionEnabled} onClick={() => void memoryAction()}>
            {pendingAction === 'extract' || (extracting && extractionEnabled) ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}<span>{pendingAction === 'extract' ? '正在处理…' : extracting && extractionEnabled ? '正在提炼…' : '提炼本轮记忆'}</span><ArrowRight size={15} />
          </button>
        </footer>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
