import catalog from '../public/catalog.json';
import { describe, expect, it } from 'vitest';

const officialCategoryHrids = [
  '/item_categories/currency',
  '/item_categories/loot',
  '/item_categories/scroll',
  '/item_categories/labyrinth',
  '/item_categories/dungeon_key',
  '/item_categories/food',
  '/item_categories/drink',
  '/item_categories/ability_book',
  '/item_categories/equipment',
  '/item_categories/resource',
] as const;

describe('MWI item catalog', () => {
  it('contains exactly the official categories and only references them', () => {
    const categoryHrids = catalog.categories.map((category) => category.hrid);

    expect(catalog.items.length).toBeGreaterThan(100);
    expect(categoryHrids).toEqual([...officialCategoryHrids]);
    expect(new Set(categoryHrids).size).toBe(officialCategoryHrids.length);
    expect(catalog.items.every((item) => officialCategoryHrids.includes(item.categoryHrid as (typeof officialCategoryHrids)[number]))).toBe(true);
  });

  it('keeps item identifiers unique', () => {
    const itemHrids = catalog.items.map((item) => item.hrid);

    expect(new Set(itemHrids).size).toBe(itemHrids.length);
  });

  it('provides Chinese-first bilingual names without changing HRID identity', () => {
    const translated = catalog.items.filter((item) => item.nameZhHant);

    expect(translated.length).toBeGreaterThan(100);
    expect(catalog.items.every((item) => typeof item.nameEn === 'string' && item.nameEn.length > 0)).toBe(true);
    expect(catalog.categories.every((category) => typeof category.nameZhHant === 'string')).toBe(true);
  });

  it('sorts categories by sortIndex and items by category, sortIndex, then hrid', () => {
    const sortedCategories = [...catalog.categories].sort(
      (left, right) => left.sortIndex - right.sortIndex,
    );
    const sortedItems = [...catalog.items].sort(
      (left, right) =>
        left.categoryHrid.localeCompare(right.categoryHrid) ||
        left.sortIndex - right.sortIndex ||
        left.hrid.localeCompare(right.hrid),
    );

    expect(catalog.categories).toEqual(sortedCategories);
    expect(catalog.items).toEqual(sortedItems);
  });
});
