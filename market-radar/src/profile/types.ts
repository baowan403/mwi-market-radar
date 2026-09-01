export const SKILLING_ACTIONS = [
  'milking',
  'foraging',
  'woodcutting',
  'cheesesmithing',
  'crafting',
  'tailoring',
  'cooking',
  'brewing',
  'alchemy',
  'enhancing',
] as const;

export type SkillingAction = typeof SKILLING_ACTIONS[number];

export interface ProfileEquipment {
  itemHrid: string;
  enhancementLevel: number;
}

export interface ActionProfile {
  playerLevel: number;
  tool: ProfileEquipment | null;
  body: ProfileEquipment | null;
  legs: ProfileEquipment | null;
  back: ProfileEquipment | null;
  charm: ProfileEquipment | null;
  houseLevel: number;
  teas: string[];
}

export interface PlayerProfile {
  id: string;
  characterId: number | null;
  name: string;
  source: 'milkonomy-v1' | 'milkonomy-preset';
  importedAt: number;
  completeness: 'full' | 'partial';
  missingFields: string[];
  actions: Record<SkillingAction, ActionProfile>;
  specialEquipment: Record<string, ProfileEquipment>;
  communityBuffs: Record<string, number>;
  shrines: Record<string, number>;
  achievements: Record<string, boolean>;
  inventoryMap: Record<string, number>;
  seals: string[];
}
