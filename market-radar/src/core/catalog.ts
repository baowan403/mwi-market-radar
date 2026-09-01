import type { CatalogCategory, CatalogItem } from './types';

export function catalogItemName(item: CatalogItem): string {
  return item.nameZhHant?.trim() || item.nameEn?.trim() || item.name;
}

export function catalogCategoryName(category: CatalogCategory): string {
  return category.nameZhHant?.trim() || category.nameEn?.trim() || category.name;
}

export function catalogSearchText(item: CatalogItem): string {
  return [catalogItemName(item), item.nameEn, item.name, item.hrid]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLocaleLowerCase('zh-Hant');
}
