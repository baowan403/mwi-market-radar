import golden from './fixtures/milkonomy-manufacture-golden.json';
import { describe, expect, it } from 'vitest';
import { calculateManufacture, type ManufactureInput } from '../src/strategy/manufacture';

const zeroBuffs = {
  Speed: 0,
  Efficiency: 0,
  Artisan: 0,
  Gourmet: 0,
  EssenceFind: 0,
  RareFind: 0,
  drinkConcentration: 0,
};

function buildGoldenInput(value: typeof golden.case): ManufactureInput {
  return {
    baseTimeCost: value.baseTimeCost,
    actionLevel: value.actionLevel,
    playerLevel: value.playerLevel,
    buffs: zeroBuffs,
    ingredients: value.inputs.map((item) => ({
      itemHrid: item.itemHrid,
      count: item.count,
      price: item.ask,
    })),
    products: value.outputs.map((item) => ({
      itemHrid: item.itemHrid,
      count: item.count,
      price: item.bid,
    })),
    essenceDrops: [],
    rareDrops: [],
    teas: [],
  };
}

const coinOutputInput: ManufactureInput = {
  baseTimeCost: 3_600_000_000_000,
  actionLevel: 1,
  playerLevel: 1,
  buffs: zeroBuffs,
  ingredients: [],
  products: [{ itemHrid: '/items/coin', count: 100, price: 1 }],
  essenceDrops: [],
  rareDrops: [],
  teas: [],
};
const teaInput: ManufactureInput = {
  ...coinOutputInput,
  ingredients: [{ itemHrid: '/items/input', count: 1, price: 10 }],
  teas: [{ itemHrid: '/items/tea', count: 1, price: 5 }],
};
const missingAskInput: ManufactureInput = {
  ...coinOutputInput,
  ingredients: [{ itemHrid: '/items/input', count: 1, price: null }],
};
const missingBidInput: ManufactureInput = {
  ...coinOutputInput,
  products: [{ itemHrid: '/items/output', count: 1, price: null }],
};

describe('one-step manufacture parity', () => {
  it('matches Milkonomy ask-in, bid-out, five-percent-tax arithmetic', () => {
    const result = calculateManufacture(buildGoldenInput(golden.case));

    expect(result.efficiency).toBeCloseTo(golden.expected.efficiency, 12);
    expect(result.speed).toBeCloseTo(golden.expected.speed, 12);
    expect(result.actionsPerHour).toBeCloseTo(golden.expected.actionsPerHour, 9);
    expect(result.costPerHour).toBeCloseTo(golden.expected.costPerHour, 6);
    expect(result.incomePerHour).toBeCloseTo(golden.expected.incomePerHour, 6);
    expect(result.profitPerHour).toBeCloseTo(golden.expected.profitPerHour, 6);
    expect(result.profitPerDay).toBeCloseTo(golden.expected.profitPerDay, 4);
  });

  it('keeps coin output untaxed, charges tea consumption, and rejects missing quotes', () => {
    expect(calculateManufacture(coinOutputInput).incomePerHour).toBe(100);
    expect(calculateManufacture(teaInput).costPerHour).toBe(70);
    expect(calculateManufacture(missingAskInput).valid).toBe(false);
    expect(calculateManufacture(missingBidInput).valid).toBe(false);
  });

  it('accounts for artisan, gourmet, essence, and rare outputs', () => {
    const result = calculateManufacture({
      ...coinOutputInput,
      buffs: { ...zeroBuffs, Artisan: 0.1, Gourmet: 0.2, EssenceFind: 0.5, RareFind: 1 },
      ingredients: [{ itemHrid: '/items/input', count: 10, price: 2 }],
      products: [{ itemHrid: '/items/output', count: 2, price: 10 }],
      essenceDrops: [{ itemHrid: '/items/essence', count: 1, rate: 0.1, price: 100 }],
      rareDrops: [{ itemHrid: '/items/rare', count: 1, rate: 0.01, price: 1000 }],
    });

    expect(result.costPerHour).toBe(18);
    expect(result.productUnitsPerHour['/items/output']).toBeCloseTo(2.4);
    expect(result.productUnitsPerHour['/items/essence']).toBeCloseTo(0.15);
    expect(result.productUnitsPerHour['/items/rare']).toBeCloseTo(0.02);
  });

  it('does not tax a derived output whose price already represents net leaf liquidation', () => {
    const result = calculateManufacture({
      ...coinOutputInput,
      products: [],
      rareDrops: [{ itemHrid: '/items/crate', count: 1, price: 100, taxable: false }],
    });

    expect(result.incomePerHour).toBe(100);
    expect(result.profitPerHour).toBe(100);
  });

  it('uses expected drop units before applying the five-percent sale tax', () => {
    const result = calculateManufacture({
      ...coinOutputInput,
      products: [],
      rareDrops: [{ itemHrid: '/items/rare', count: 3, rate: 0.25, price: 100, taxable: true }],
    });

    expect(result.incomePerHour).toBeCloseTo(71.25);
  });
});
