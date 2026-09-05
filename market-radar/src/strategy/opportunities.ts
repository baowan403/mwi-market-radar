import type { Snapshot } from '../core/types';
import type { PlayerProfile } from '../profile/types';
import type { StrategyCandidate } from './candidates';
import type { NormalizedStrategyGameData } from './game-data';
import { repriceFixedCandidate } from './margin-series';
import { createStrategyPriceBook } from './price-book';
import { evaluateRealizableStrategy, externalStrategyFlows } from './realizable';
import { estimateStrategySession, type StrategySession } from './session';
import { marketCapacity } from './liquidity';
import type { StrategyFlow } from './types';

const HOUR = 3600000;
export interface OpportunityMetrics {
  profit6hPct: number | null; profit24hPct: number | null;
  cost6hPct: number | null; cost24hPct: number | null;
  income6hPct: number | null; income24hPct: number | null;
  gapClosing6h: number | null; gapClosing24h: number | null;
  inputVolumeChangePct: number | null; outputVolumeChangePct: number | null;
}
export interface PreparationPlan {
  hours: number; cash: number;
  items: Array<{ itemHrid: string; enhancementLevel: number; units: number; price: number }>;
}
export interface Opportunity {
  candidate: StrategyCandidate; session: StrategySession;
  action: 'watch' | 'prepare'; metrics: OpportunityMetrics; reasons: string[];
  preparation: PreparationPlan | null;
  invalidation: { maxCostPerHour: number; minIncomePerHour: number };
}
export interface OpportunityAnalysis {
  issuedAt: number; baseline: { candidate: StrategyCandidate; session: StrategySession } | null;
  opportunities: Opportunity[]; considered: number; reason: string;
}
interface Point { timestamp: number; value: StrategyCandidate }
function change(now: number, old: number | undefined): number | null {
  return old === undefined || old <= 0 ? null : (now - old) / old * 100;
}
function at(points: Point[], target: number): Point | undefined {
  return points.filter(p => p.timestamp <= target && p.timestamp >= target - HOUR).at(-1);
}
function coverage(points: Point[], latest: number, hours: number): number {
  return new Set(points.filter(p => p.timestamp > latest - hours * HOUR).map(p => Math.floor(p.timestamp / HOUR))).size;
}
function prepare(candidate: StrategyCandidate, session: StrategySession, budget: number, snapshots: Snapshot[]): PreparationPlan | null {
  if (!(budget > 0) || !Number.isFinite(budget) || !(candidate.costPerHour > 0)) return null;
  const cashLimit = budget * 0.1;
  const hours = Math.min(2, session.plannedHours, session.executionHours, cashLimit * .95 / candidate.costPerHour);
  if (!(hours > 0)) return null;
  const inputs = externalStrategyFlows(candidate).filter(f => f.side === 'input');
  const items: PreparationPlan['items'] = [];
  let marketCostPH = 0;
  for (const { flow } of inputs) {
    if (flow.unitPrice === null) return null;
    marketCostPH += flow.unitsPerHour * flow.unitPrice;
    const units = Math.ceil(flow.unitsPerHour * hours);
    const cap = marketCapacity(`${flow.itemHrid}::${flow.enhancementLevel}`, snapshots);
    if (cap.safeUnitsPerDay === null || !cap.volume24hSufficient || units > cap.safeUnitsPerDay) return null;
    items.push({ itemHrid: flow.itemHrid, enhancementLevel: flow.enhancementLevel, units, price: flow.unitPrice });
  }
  const cash = items.reduce((sum, item) => sum + item.units * item.price, 0)
    + Math.max(0, candidate.costPerHour - marketCostPH) * hours;
  if (!items.length || cash > cashLimit || !Number.isFinite(cash)) return null;
  return { hours, cash, items };
}

/** Observations, not extrapolated price promises. All comparisons freeze the same physical workload. */
export function analyzeOpportunities(options: {
  candidates: readonly StrategyCandidate[]; snapshots: readonly Snapshot[]; data: NormalizedStrategyGameData;
  profile: PlayerProfile; plannedHours: number; budget?: number | null; now?: number;
}): OpportunityAnalysis {
  const now = options.now ?? Date.now();
  const snapshots = [...new Map(options.snapshots.filter(s => s.timestamp <= now).map(s => [s.timestamp, s])).values()]
    .sort((a,b) => a.timestamp-b.timestamp);
  const latest = snapshots.at(-1);
  const empty = (reason: string): OpportunityAnalysis => ({ issuedAt: latest?.timestamp ?? 0, baseline: null, opportunities: [], considered: 0, reason });
  if (!latest || now-latest.timestamp > 3*HOUR) return empty('行情不足或超過3H，暫不產生機會建議。');
  const books = new Map<number, ReturnType<typeof createStrategyPriceBook>>();
  const repriced = (c: StrategyCandidate, s: Snapshot) => {
    let book = books.get(s.timestamp);
    if (!book) { book=createStrategyPriceBook(s, options.data); books.set(s.timestamp,book); }
    return repriceFixedCandidate(c,book);
  };
  const assessed = options.candidates.flatMap(source => {
    const candidate = repriced(source,latest); if (!candidate) return [];
    const liquidity=evaluateRealizableStrategy(candidate,snapshots);
    const session=estimateStrategySession({candidate,liquidity,profile:options.profile,plannedHours:options.plannedHours,latestSnapshotAgeMs:now-latest.timestamp});
    return session.actionable ? [{candidate,session,liquidity}] : [];
  }).sort((a,b) => b.session.rankValue!-a.session.rankValue! || a.candidate.id.localeCompare(b.candidate.id));
  const unique = new Set<string>();
  const pool=assessed.filter(({candidate})=>{const key=candidate.kind+'|'+candidate.path.join('|');if(unique.has(key))return false;unique.add(key);return true;}).slice(0,30);
  const baseline=pool[0]; if (!baseline) return empty('目前沒有可比較的正收益策略。');
  const window=snapshots.filter(s=>s.timestamp >= latest.timestamp-25*HOUR);
  const series=(c: StrategyCandidate): Point[] => window.flatMap(s=>{const value=repriced(c,s);return value?[{timestamp:s.timestamp,value}]:[];});
  const baselineSeries=series(baseline.candidate);
  const baselineByTime=new Map(baselineSeries.map(p=>[p.timestamp,p]));
  const opportunities: Opportunity[]=[];
  for(const {candidate,session,liquidity} of pool.slice(1)) {
    if(session.rankValue! < baseline.session.rankValue!*.75) continue;
    const points=series(candidate);
    const common=points.filter(p=>baselineByTime.has(p.timestamp));
    const enough6=coverage(common,latest.timestamp,6)>=5;
    const enough24=coverage(common,latest.timestamp,24)>=18;
    const b6=enough6?at(common,latest.timestamp-6*HOUR):undefined;
    const b24=enough24?at(common,latest.timestamp-24*HOUR):undefined;
    const a6=b6?baselineByTime.get(b6.timestamp):undefined;
    const a24=b24?baselineByTime.get(b24.timestamp):undefined;
    const gapNow=baseline.session.rankValue!-session.rankValue!;
    const closing=(a:Point|undefined,b:Point|undefined)=>a&&b
      ? a.value.profitPerHour*baseline.session.executionHours-b.value.profitPerHour*session.executionHours-gapNow : null;
    const volumeChange=(flow:StrategyFlow|undefined):number|null=>{
      if(!flow)return null;
      const key=`${flow.itemHrid}::${flow.enhancementLevel}` as const;
      const current=marketCapacity(key,snapshots);
      const previous=marketCapacity(key,snapshots.filter(s=>s.timestamp<=latest.timestamp-24*HOUR));
      if(current.coverageHours24h<18||previous.coverageHours24h<18||current.volume24h===null)return null;
      return change(current.volume24h,previous.volume24h??undefined);
    };
    const external=externalStrategyFlows(candidate);
    const inputVolumes=external.filter(f=>f.side==='input').map(f=>volumeChange(f.flow));
    const inputVolumesKnown=inputVolumes.every(v=>v!==null);
    const metrics: OpportunityMetrics={
      profit6hPct:change(candidate.profitPerHour,b6?.value.profitPerHour), profit24hPct:change(candidate.profitPerHour,b24?.value.profitPerHour),
      cost6hPct:change(candidate.costPerHour,b6?.value.costPerHour),cost24hPct:change(candidate.costPerHour,b24?.value.costPerHour),
      income6hPct:change(candidate.incomePerHour,b6?.value.incomePerHour),income24hPct:change(candidate.incomePerHour,b24?.value.incomePerHour),
      gapClosing6h:closing(a6,b6),gapClosing24h:closing(a24,b24),
      inputVolumeChangePct:inputVolumes.length&&inputVolumesKnown?Math.min(...inputVolumes as number[]):null,
      outputVolumeChangePct:volumeChange(external.find(f=>f.side==='output'&&f.flow.itemHrid===liquidity.primaryOutputHrid)?.flow),
    };
    const shortImproving=(metrics.profit6hPct??0)>=1 && (metrics.gapClosing6h??0)>0;
    const dayImproving=(metrics.profit24hPct??0)>=2 && (metrics.gapClosing24h??0)>0;
    if(!shortImproving&&!dayImproving) continue;
    const reasons=['收益正在改善，且與目前基準的差距縮小。'];
    const falling=(metrics.cost6hPct??0)<-.5 || (metrics.cost24hPct??0)<-.5;
    if(falling) reasons.push('原料／消耗成本仍在下跌，先觀察買價，不催促囤料。');
    else if((metrics.income6hPct??0)>0) reasons.push('改善主要來自產出收入提高，仍需留意承接。');
    if(!shortImproving||!dayImproving) reasons.push('6H與24H尚未同時支持改善，先觀察。');
    const healthy=session.durationCovered && ['low','medium'].includes(session.risk.riskSeverity);
    if(!healthy) reasons.push('所選時長的供應或承接有壓力，不建議提前備料。');
    if(!(options.budget!=null&&options.budget>0)) reasons.push('未設定備料預算，只列觀察。');
    const volumeKnown=liquidity.primaryOutputMode!=='derived'
      && (liquidity.primaryOutputMode!=='market'||metrics.outputVolumeChangePct!==null)
      && inputVolumesKnown;
    const volumeWeak=(metrics.inputVolumeChangePct??0)<-20||(metrics.outputVolumeChangePct??0)<-20;
    if(!volumeKnown)reasons.push('成交量對照不足，先觀察。');
    else if(volumeWeak)reasons.push('原料或成品成交量明顯萎縮，先觀察而非備料。');
    const preparation=shortImproving&&dayImproving&&!falling&&healthy&&volumeKnown&&!volumeWeak&&options.budget!=null
      ? prepare(candidate,session,options.budget,snapshots) : null;
    if(!preparation&&options.budget!=null&&options.budget>0&&!falling&&healthy&&volumeKnown&&!volumeWeak&&shortImproving&&dayImproving)
      reasons.push('預算或整數採購量不支持保守小批備料。');
    opportunities.push({candidate,session,metrics,reasons,preparation,action:preparation?'prepare':'watch',
      invalidation:{maxCostPerHour:candidate.costPerHour+candidate.profitPerHour*.25,
        minIncomePerHour:candidate.incomePerHour-candidate.profitPerHour*.25}});
  }
  opportunities.sort((a,b)=>b.session.rankValue!-a.session.rankValue! || (b.metrics.gapClosing6h??0)-(a.metrics.gapClosing6h??0));
  return {issuedAt:latest.timestamp,baseline,opportunities:opportunities.slice(0,3),considered:pool.length,
    reason:opportunities.length?'':'目前沒有收益接近基準、且正在縮小差距的候選。'};
}
