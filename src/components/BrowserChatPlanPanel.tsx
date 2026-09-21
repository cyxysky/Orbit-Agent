'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@heroui/react/button';
import { Popover } from '@heroui/react/popover';
import { ArrowRight, Check, ChevronDown, Circle, CircleAlert, CircleMinus, CirclePause, ListChecks, Loader2, Plus, RefreshCw } from 'lucide-react';
import type { WorkflowItem, WorkflowPlan, WorkflowStage, WorkflowStatus } from '@/lib/workflow-plan';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

const labels: Record<WorkflowStatus, string> = { pending: '待执行', running: '进行中', passed: '已完成', failed: '需处理', blocked: '受阻', not_applicable: '不适用' };
const isDone = (item: WorkflowItem) => item.checks.every(check => check.status === 'passed' || check.status === 'not_applicable');
function itemStatus(item: WorkflowItem, currentItemId?: string): WorkflowStatus {
  if (isDone(item)) return item.checks.every(check => check.status === 'not_applicable') ? 'not_applicable' : 'passed';
  if (item.checks.some(check => check.status === 'blocked')) return 'blocked';
  if (item.checks.some(check => check.status === 'failed')) return 'failed';
  if (item.id === currentItemId || item.checks.some(check => check.status === 'running')) return 'running';
  return 'pending';
}

function StageProgress({ stage, index, current, currentItemId }: { stage: WorkflowStage; index: number; current: boolean; currentItemId?: string }) {
  const [expanded, setExpanded] = useState(current);
  const [showAll, setShowAll] = useState(false);
  const contentId = useId();
  const completed = stage.items.filter(isDone);
  useEffect(() => { setExpanded(current); setShowAll(false); }, [current]);
  return <section className={`browser-chat-plan-stage${current ? ' is-current' : ''}`}>
    <button type="button" className="browser-chat-plan-stage-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={contentId}>
      <span className="browser-chat-plan-stage-number">{completed.length === stage.items.length ? <Check size={13} /> : index + 1}</span>
      <span className="browser-chat-plan-stage-title" title={stage.title}>{stage.title}</span>
      <span className="browser-chat-plan-stage-count">{completed.length}/{stage.items.length}</span>
      <ChevronDown size={14} className={expanded ? 'is-expanded' : ''} />
    </button>
    <div className={`browser-chat-plan-stage-reveal${expanded ? ' is-open' : ''}`} id={contentId} inert={!expanded} aria-hidden={!expanded}>
      <div>
        <ul className="browser-chat-plan-items">
          {(showAll ? stage.items : stage.items.slice(0, 6)).map(item => {
            const status = itemStatus(item, currentItemId);
            const StatusIcon = { pending: Circle, running: Loader2, passed: Check, failed: CircleAlert, blocked: CirclePause, not_applicable: CircleMinus }[status];
            return <li key={item.id} className={`is-${status}`}>
              <StatusIcon size={14} role="img" aria-label={labels[status]} className={status === 'running' ? 'animate-spin' : undefined}><title>{labels[status]}</title></StatusIcon>
              <span title={`${item.id} · ${item.title}`}>{item.title}</span>
            </li>;
          })}
        </ul>
        {!stage.items.length && <p className="browser-chat-plan-list-empty">本阶段暂无事项</p>}
        {stage.items.length > 6 && <button type="button" className="ui-button browser-chat-plan-show-more" onClick={() => setShowAll(value => !value)}>{showAll ? '收起列表' : `查看其余 ${stage.items.length - 6} 项`}</button>}
      </div>
    </div>
  </section>;
}

export function BrowserChatPlanPanel({ sessionId, busy, onResume, onStart, onContinue }: { sessionId: string; busy: boolean; onResume: () => void; onStart: () => void; onContinue: () => void }) {
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editingReview, setEditingReview] = useState(false);
  const url = withWebPilotBasePath(`/api/browser-chat/${sessionId}/workflow`);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? '计划接口暂不可用（404）' : String(data.error?.message || data.error || '无法读取计划'));
    if (signal?.aborted) return;
    setPlan(previous => previous?.sessionId === sessionId && data.plan && previous.revision > data.plan.revision ? previous : data.plan);
    setError('');
  }, [url, sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    setPlan(null); setLoading(true); setError('');
    const refresh = () => { void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); };
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  const submission = plan?.submissions.at(-1);
  const items = plan?.stages.flatMap(stage => stage.items) || [];
  const finished = items.filter(isDone).length;
  const stage = plan?.stages[plan.stageIndex];
  const currentItem = stage?.items.find(item => item.id === plan?.currentItemId && !isDone(item));
  useEffect(() => { setSelected([]); setFeedback(''); setEditingReview(false); }, [submission?.id]);
  async function review(decision: 'approve' | 'accept_with_gaps' | 'request_changes' | 'cancel') {
    if (!plan || !submission) return;
    setSending(true); setError('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: plan.revision, submissionId: submission.id, decision, feedback, reopenIds: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || '审核失败');
      setPlan(data.plan); onResume();
    } catch (e) { setError(e instanceof Error ? e.message : '审核失败'); await load().catch(() => {}); }
    finally { setSending(false); }
  }
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Button type="button" variant="ghost" className="browser-chat-conversation-direct-action browser-chat-plan-trigger" aria-label="执行计划">
      <ListChecks size={17} aria-hidden="true" />
      <span className="browser-chat-plan-heading">执行计划</span>
      {plan && <span className="browser-chat-plan-count" title="已完成或不适用 / 全部事项">{finished}/{items.length}</span>}
      {error && <CircleAlert size={14} className="browser-chat-plan-error-dot" />}
    </Button>
    <Popover.Content className="browser-chat-plan-popover" placement="bottom end" offset={8} containerPadding={12}>
      <Popover.Dialog className="browser-chat-plan-card is-popover" aria-label="执行计划">
      <div className="browser-chat-plan-body">
        {error && <div className="browser-chat-plan-error" role="alert"><CircleAlert size={16} /><div><strong>暂时无法读取计划</strong><p>{error}</p><button type="button" className="ui-button" onClick={() => { void load().catch(e => setError(String(e.message))); }}><RefreshCw size={13} />重新加载</button></div></div>}
        {!plan ? (loading ? <div className="browser-chat-plan-loading"><Loader2 size={16} className="animate-spin" />正在读取计划</div> : !error && <div className="browser-chat-plan-empty"><strong>整理任务，跟踪进度</strong><p>查看 AI 要做什么，以及还有哪些事项待完成。</p></div>) : <>
          <div className="browser-chat-plan-overview">
            <strong title={plan.title}>{plan.title}</strong>
            <span className={`browser-chat-plan-status is-${plan.status}`}>{plan.status === 'awaiting_review' ? '待确认' : plan.status === 'completed' ? '已结束' : plan.status === 'cancelled' ? '已停止' : busy ? '进行中' : '待继续'}</span>
            <div className="browser-chat-plan-progress" role="progressbar" aria-label="已完成或不适用的事项" aria-valuenow={finished} aria-valuemin={0} aria-valuemax={items.length}><span style={{ width: `${items.length ? finished / items.length * 100 : 0}%` }} /></div>
          </div>
          {currentItem && plan.status === 'active' && <div className="browser-chat-plan-focus"><small>{busy ? '正在执行' : '当前事项'}</small><span title={currentItem.title}>{currentItem.title}</span></div>}
          <div className="browser-chat-plan-stages">{plan.stages.map((item, index) => <StageProgress key={item.id} stage={item} index={index} current={index === plan.stageIndex} currentItemId={plan.currentItemId} />)}</div>
        </>}
      </div>
      {plan?.status === 'awaiting_review' && submission ? <footer className="browser-chat-plan-footer browser-chat-plan-review">
        <div className="browser-chat-plan-review-heading"><strong>确认本阶段</strong><small>{stage?.title}</small></div>
        {editingReview ? <div className="browser-chat-plan-correction">
          <div className="browser-chat-plan-review-selection">{submission.items.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(value => e.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><span>{item.title}</span></label>)}</div>
          <textarea aria-label="反馈问题" value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="选择要修正的事项，并说明问题" />
          <button type="button" className="ui-button ui-button--primary browser-chat-plan-primary" disabled={busy || sending || !feedback.trim() || !selected.length} onClick={() => void review('request_changes')}><span>{sending ? '正在提交…' : '提交反馈并继续修正'}</span><ArrowRight size={15} /></button>
          <button type="button" className="ui-button browser-chat-plan-text-button" disabled={sending} onClick={() => setEditingReview(false)}>返回确认</button>
        </div> : <>
          <p className="browser-chat-plan-review-hint">{submission.gaps.length ? `仍有 ${submission.gaps.length} 项检查未完成或不适用。` : '本阶段已提交，结果说明见对话。'}</p>
          <button type="button" className="ui-button ui-button--primary browser-chat-plan-primary" disabled={busy || sending} onClick={() => void review(submission.gaps.length ? 'accept_with_gaps' : 'approve')}><span>{sending ? '正在提交…' : submission.gaps.length ? '接受缺口并继续' : plan.stageIndex + 1 === plan.stages.length ? '确认完成' : '确认并继续'}</span><ArrowRight size={15} /></button>
          <div className="browser-chat-plan-review-actions"><button type="button" className="ui-button browser-chat-plan-text-button" disabled={busy || sending} onClick={() => setEditingReview(true)}>有问题，退回修正</button><button type="button" className="ui-button browser-chat-plan-text-button is-danger" disabled={busy || sending} onClick={() => void review('cancel')}>停止计划</button></div>
        </>}
      </footer> : plan?.status === 'active' ? (!busy && <footer className="browser-chat-plan-footer"><button type="button" className="ui-button ui-button--primary browser-chat-plan-primary" disabled={sending} onClick={onContinue}><span>继续当前阶段</span><ArrowRight size={14} /></button></footer>) : !loading && !error && <footer className="browser-chat-plan-footer"><button type="button" className="ui-button ui-button--primary browser-chat-plan-primary" disabled={busy || sending} onClick={onStart}><Plus size={15} /><span>{plan ? '创建新计划' : '生成执行计划'}</span><ArrowRight size={15} /></button></footer>}
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
