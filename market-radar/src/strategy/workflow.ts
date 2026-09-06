import type { StrategyFlow, StrategyStepResult } from './types';
import { marketTaxFactor } from './tax';

const MAX_WORKFLOW_STEPS = 7;
export interface WorkflowConnection { from:number; to:number; itemHrid:string }

export interface WorkflowStepResult extends StrategyStepResult {
  workFraction: number;
}

export interface WorkflowResult {
  id: string;
  steps: WorkflowStepResult[];
  valid: boolean;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  inputs: StrategyFlow[];
  outputs: StrategyFlow[];
}

export class StrategyWorkflowError extends Error {
  readonly code = 'strategy_workflow';

  constructor() {
    super('策略工作流無法使用');
    this.name = 'StrategyWorkflowError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function flowKey(flow: StrategyFlow): string {
  return `${flow.itemHrid}::${flow.enhancementLevel}`;
}

function unitsFor(flows: readonly StrategyFlow[], hrid: string): number {
  return flows
    .filter((flow) => flow.itemHrid === hrid)
    .reduce((sum, flow) => sum + flow.unitsPerHour, 0);
}

function scaled(flow: StrategyFlow, fraction: number): StrategyFlow {
  return { ...flow, unitsPerHour: flow.unitsPerHour * fraction };
}

function scaledMetric(value: number | null, fraction: number): number | null {
  return value === null ? null : value * fraction;
}

function aggregate(flows: readonly StrategyFlow[]): Map<string, StrategyFlow> {
  const result = new Map<string, StrategyFlow>();
  for (const flow of flows) {
    const key = flowKey(flow);
    const current = result.get(key);
    if (!current) {
      result.set(key, { ...flow });
      continue;
    }
    if (current.unitPrice !== flow.unitPrice) throw new StrategyWorkflowError();
    current.unitsPerHour += flow.unitsPerHour;
  }
  return result;
}

function netFlows(
  inputs: readonly StrategyFlow[],
  outputs: readonly StrategyFlow[],
): { inputs: StrategyFlow[]; outputs: StrategyFlow[] } {
  const inputMap = aggregate(inputs);
  const outputMap = aggregate(outputs);
  for (const [key, input] of inputMap) {
    const output = outputMap.get(key);
    if (!output) continue;
    const canceled = Math.min(input.unitsPerHour, output.unitsPerHour);
    input.unitsPerHour -= canceled;
    output.unitsPerHour -= canceled;
  }
  return {
    inputs: [...inputMap.values()].filter((flow) => flow.unitsPerHour > 1e-10),
    outputs: [...outputMap.values()].filter((flow) => flow.unitsPerHour > 1e-10),
  };
}

function validatePath(steps: readonly StrategyStepResult[]): void {
  if (steps.length < 2 || steps.length > MAX_WORKFLOW_STEPS) throw new StrategyWorkflowError();
  const seenItems = new Set<string>();
  const firstInput = steps[0]?.inputs[0]?.itemHrid;
  if (firstInput) seenItems.add(firstInput);
  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index]!;
    if (seenItems.has(current.outputHrid)) throw new StrategyWorkflowError();
    seenItems.add(current.outputHrid);
    const next = steps[index + 1];
    if (!next) continue;
    const nextInput = unitsFor(next.inputs, current.outputHrid);
    const currentOutput = unitsFor(current.outputs, current.outputHrid);
    if (nextInput <= 0 || currentOutput <= 0) throw new StrategyWorkflowError();
  }
}

export function calculateWorkflow(sourceSteps: readonly StrategyStepResult[]): WorkflowResult {
  validatePath(sourceSteps);
  const cumulative = [1];
  for (let index = 0; index < sourceSteps.length - 1; index += 1) {
    const current = sourceSteps[index]!;
    const next = sourceSteps[index + 1]!;
    const outputRate = unitsFor(current.outputs, current.outputHrid);
    const inputRate = unitsFor(next.inputs, current.outputHrid);
    const ratio = outputRate / inputRate;
    if (!Number.isFinite(ratio) || ratio <= 0) throw new StrategyWorkflowError();
    cumulative.push(cumulative[index]! * ratio);
  }
  return assembleWorkflow(sourceSteps,cumulative,`workflow:${sourceSteps.map(step=>step.id).join('|')}`);
}

export function calculateConnectedWorkflow(sourceSteps:readonly StrategyStepResult[], connections:readonly WorkflowConnection[]):WorkflowResult {
  if(sourceSteps.length<2||sourceSteps.length>MAX_WORKFLOW_STEPS||connections.length!==sourceSteps.length-1)throw new StrategyWorkflowError();
  const cumulative=Array(sourceSteps.length).fill(0) as number[];cumulative[0]=1;
  const allocated=new Set<string>();
  for(let to=1;to<sourceSteps.length;to++){
    const links=connections.filter(c=>c.to===to),link=links[0];
    if(links.length!==1||!link||!Number.isInteger(link.from)||link.from<0||link.from>=to)throw new StrategyWorkflowError();
    const allocation=`${link.from}:${link.itemHrid}`;
    if(allocated.has(allocation))throw new StrategyWorkflowError();allocated.add(allocation);
    const input=unitsFor(sourceSteps[to]!.inputs,link.itemHrid),output=unitsFor(sourceSteps[link.from]!.outputs,link.itemHrid);
    if(!(input>0)||!(output>0)||!Number.isFinite(input)||!Number.isFinite(output))throw new StrategyWorkflowError();
    // No recycling/circular execution in this bounded, acyclic search.
    if(sourceSteps.slice(0,to).some(s=>s.id===sourceSteps[to]!.id||s.inputs.some(f=>f.market&&f.itemHrid===sourceSteps[to]!.outputHrid)))throw new StrategyWorkflowError();
    cumulative[to]=cumulative[link.from]! * output/input;
  }
  return assembleWorkflow(sourceSteps,cumulative,`combination:${sourceSteps.map(s=>s.id).join('|')}:${connections.map(c=>`${c.from}>${c.to}:${c.itemHrid}`).join('|')}`);
}

function assembleWorkflow(sourceSteps:readonly StrategyStepResult[], cumulative:number[], id:string):WorkflowResult {
  const total = cumulative.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new StrategyWorkflowError();
  const fractions = cumulative.map((value) => value / total);
  const steps = sourceSteps.map((step, index) => ({
    ...step,
    actionsPerHour: step.actionsPerHour * fractions[index]!,
    costPerHour: scaledMetric(step.costPerHour, fractions[index]!),
    incomePerHour: scaledMetric(step.incomePerHour, fractions[index]!),
    profitPerHour: scaledMetric(step.profitPerHour, fractions[index]!),
    experiencePerHour: step.experiencePerHour * fractions[index]!,
    inputs: step.inputs.map((flow) => scaled(flow, fractions[index]!)),
    outputs: step.outputs.map((flow) => scaled(flow, fractions[index]!)),
    workFraction: fractions[index]!,
  }));
  const net = netFlows(
    steps.flatMap((step) => step.inputs),
    steps.flatMap((step) => step.outputs),
  );
  const valid = [...net.inputs, ...net.outputs].every((flow) => (
      typeof flow.unitPrice === 'number' && Number.isFinite(flow.unitPrice) && flow.unitPrice >= 0
    ));
  const costPerHour = valid
    ? net.inputs.reduce((sum, flow) => sum + flow.unitsPerHour * flow.unitPrice!, 0)
    : null;
  const incomePerHour = valid
    ? net.outputs.reduce((sum, flow) => (
      sum + flow.unitsPerHour * flow.unitPrice! * (flow.market ? marketTaxFactor(flow.itemHrid) : 1)
    ), 0)
    : null;

  return {
    id,
    steps,
    valid,
    costPerHour,
    incomePerHour,
    profitPerHour: valid ? incomePerHour! - costPerHour! : null,
    inputs: net.inputs,
    outputs: net.outputs,
  };
}
