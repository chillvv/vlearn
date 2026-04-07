import { useEffect, useMemo, useState } from 'react';
import { Compass, Rocket, SlidersHorizontal } from 'lucide-react';
import type { Subject } from '../../lib/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type ReviewPreset = {
  subject: Subject;
  scope: 'all' | 'due' | 'unmastered' | 'stubborn';
  amount: number;
  sortBy: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  strategy?: 'due_rescue' | 'stubborn_focus' | 'unmastered_boost' | 'custom';
};

type DrillPreset = {
  subject: Subject;
  nodes: string[];
  amount: number;
  strategy: '递进' | '随机' | '攻坚';
};

type BaseProps = {
  open: boolean;
  capabilityLabel: string;
  sourceLabel: string;
  reason: string;
  expectedBenefit: string;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
};

type ReviewProps = BaseProps & {
  kind: 'review';
  initialPreset: ReviewPreset;
  onStart: (preset: ReviewPreset) => void;
};

type DrillProps = BaseProps & {
  kind: 'practice';
  initialPreset: DrillPreset;
  onStart: (preset: DrillPreset) => void;
};

type CopilotHandoffDialogProps = ReviewProps | DrillProps;

const SUBJECT_OPTIONS: Subject[] = ['英语', 'C语言'];

const REVIEW_SCOPE_LABELS: Record<ReviewPreset['scope'], string> = {
  all: '全部错题',
  due: '待复习',
  unmastered: '未掌握',
  stubborn: '顽固错题',
};

const REVIEW_SORT_LABELS: Record<ReviewPreset['sortBy'], string> = {
  nearestDue: '优先最近到期',
  lowestMastery: '优先最低掌握度',
  latestWrong: '优先最近错题',
};

const REVIEW_STRATEGY_LABELS: Record<NonNullable<ReviewPreset['strategy']>, string> = {
  due_rescue: '近期遗忘抢救',
  stubborn_focus: '高频易错突击',
  unmastered_boost: '未掌握补强',
  custom: '自定义复习',
};

const DRILL_STRATEGY_LABELS: Record<DrillPreset['strategy'], string> = {
  递进: '递进',
  随机: '随机',
  攻坚: '攻坚',
};

const toPositiveAmount = (value: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.round(numeric);
};

const formatReviewScope = (preset: ReviewPreset) => {
  const strategyLabel = REVIEW_STRATEGY_LABELS[preset.strategy || 'custom'];
  return `${preset.subject} · ${strategyLabel} · ${REVIEW_SCOPE_LABELS[preset.scope]} · ${preset.amount} 题 · ${REVIEW_SORT_LABELS[preset.sortBy]}`;
};

const formatDrillScope = (preset: DrillPreset) => {
  const nodes = preset.nodes.length > 0 ? preset.nodes.join('、') : '未指定知识点';
  return `${preset.subject} · ${nodes} · ${preset.amount} 题 · ${DRILL_STRATEGY_LABELS[preset.strategy]}`;
};

export function CopilotHandoffDialog(props: CopilotHandoffDialogProps) {
  const [editing, setEditing] = useState(false);
  const [reviewPreset, setReviewPreset] = useState<ReviewPreset>(
    props.kind === 'review' ? props.initialPreset : { subject: '英语', scope: 'due', amount: 10, sortBy: 'nearestDue' },
  );
  const [drillPreset, setDrillPreset] = useState<DrillPreset>(
    props.kind === 'practice' ? props.initialPreset : { subject: '英语', nodes: [], amount: 10, strategy: '递进' },
  );
  const [nodeText, setNodeText] = useState(props.kind === 'practice' ? props.initialPreset.nodes.join('、') : '');

  useEffect(() => {
    if (!props.open) return;
    setEditing(false);
    if (props.kind === 'review') {
      setReviewPreset(props.initialPreset);
      return;
    }
    setDrillPreset(props.initialPreset);
    setNodeText(props.initialPreset.nodes.join('、'));
  }, [props.open, props.kind, props.initialPreset]);

  const resolvedDrillPreset = useMemo<DrillPreset>(() => {
    if (props.kind !== 'practice') return drillPreset;
    const nodes = Array.from(new Set(
      nodeText
        .split(/[\n,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ));
    return {
      ...drillPreset,
      amount: toPositiveAmount(drillPreset.amount),
      nodes,
    };
  }, [drillPreset, nodeText, props.kind]);

  const scopeSummary = props.kind === 'review'
    ? formatReviewScope({ ...reviewPreset, amount: toPositiveAmount(reviewPreset.amount) })
    : formatDrillScope(resolvedDrillPreset);

  const handleStart = () => {
    if (props.kind === 'review') {
      props.onStart({
        ...reviewPreset,
        amount: toPositiveAmount(reviewPreset.amount),
      });
      return;
    }
    props.onStart(resolvedDrillPreset);
  };

  return (
    <Dialog open={props.open} onOpenChange={(nextOpen) => {
      props.onOpenChange(nextOpen);
      if (!nextOpen) props.onCancel();
    }}>
      <DialogContent className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-100 p-0 shadow-2xl">
        <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 text-left">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm ${
              props.kind === 'review' ? 'bg-gradient-to-br from-indigo-500 to-blue-600' : 'bg-gradient-to-br from-purple-500 to-indigo-600'
            }`}>
              {props.kind === 'review' ? <Compass className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                  {props.capabilityLabel}
                </span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                  {props.kind === 'review' ? '复习中心' : '专项练习'}
                </span>
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {props.kind === 'review' ? '开始这轮复习前，先确认 handoff card' : '开始这轮专项前，先确认 handoff card'}
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-600">
                {props.sourceLabel}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">为什么推荐</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{props.reason}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">预期收益</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{props.expectedBenefit}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-500">本次范围</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{scopeSummary}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {editing ? '收起调整' : '调整范围'}
              </button>
            </div>

            {editing && props.kind === 'review' && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">科目</span>
                  <select
                    value={reviewPreset.subject}
                    onChange={(event) => setReviewPreset((current) => ({ ...current, subject: event.target.value as Subject }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  >
                    {SUBJECT_OPTIONS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">题量</span>
                  <input
                    type="number"
                    min={1}
                    value={reviewPreset.amount}
                    onChange={(event) => setReviewPreset((current) => ({ ...current, amount: Number(event.target.value) || 1 }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">复习范围</span>
                  <select
                    value={reviewPreset.scope}
                    onChange={(event) => setReviewPreset((current) => ({ ...current, scope: event.target.value as ReviewPreset['scope'] }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  >
                    {Object.entries(REVIEW_SCOPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">排序方式</span>
                  <select
                    value={reviewPreset.sortBy}
                    onChange={(event) => setReviewPreset((current) => ({ ...current, sortBy: event.target.value as ReviewPreset['sortBy'] }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  >
                    {Object.entries(REVIEW_SORT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {editing && props.kind === 'practice' && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">科目</span>
                  <select
                    value={resolvedDrillPreset.subject}
                    onChange={(event) => setDrillPreset((current) => ({ ...current, subject: event.target.value as Subject }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  >
                    {SUBJECT_OPTIONS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">题量</span>
                  <input
                    type="number"
                    min={1}
                    value={resolvedDrillPreset.amount}
                    onChange={(event) => setDrillPreset((current) => ({ ...current, amount: Number(event.target.value) || 1 }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-slate-700">
                  <span className="text-xs font-medium text-slate-500">策略</span>
                  <select
                    value={resolvedDrillPreset.strategy}
                    onChange={(event) => setDrillPreset((current) => ({ ...current, strategy: event.target.value as DrillPreset['strategy'] }))}
                    className="h-11 w-full rounded-2xl border border-white bg-white px-3 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  >
                    {Object.entries(DRILL_STRATEGY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <div className="space-y-1.5 text-sm text-slate-700 md:col-span-2">
                  <span className="text-xs font-medium text-slate-500">节点范围</span>
                  <textarea
                    rows={3}
                    value={nodeText}
                    onChange={(event) => setNodeText(event.target.value)}
                    placeholder="多个知识点可用顿号、逗号或换行分隔"
                    className="w-full rounded-2xl border border-white bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-1 ring-indigo-100 focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-100 bg-slate-50 px-6 py-4 sm:justify-between">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            取消
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-2xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
            >
              调整范围
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {editing ? '按当前范围开始' : '立即开始'}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
