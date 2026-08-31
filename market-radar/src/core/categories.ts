export const OFFICIAL_CATEGORIES = [
  'currency',
  'loot',
  'scroll',
  'labyrinth',
  'dungeon_key',
  'food',
  'drink',
  'ability_book',
  'equipment',
  'resource',
] as const;

export type OfficialCategory = (typeof OFFICIAL_CATEGORIES)[number];

export const CATEGORY_GROUPS: Readonly<Record<string, readonly OfficialCategory[]>> = {
  resource: ['resource'],
  consumable: ['food', 'drink', 'scroll'],
  ability_book: ['ability_book'],
  labyrinth: ['labyrinth'],
  equipment: ['equipment'],
  other: ['currency', 'loot', 'dungeon_key'],
};

const CATEGORY_PREFIX = '/item_categories/';

/** Return the category name only when the known prefix is at the start. */
export function shortCategory(categoryHrid: string): string {
  return categoryHrid.startsWith(CATEGORY_PREFIX)
    ? categoryHrid.slice(CATEGORY_PREFIX.length)
    : categoryHrid;
}
