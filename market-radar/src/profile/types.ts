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

export type OwnershipState = 'unknown' | 'owned' | 'not-owned';
export type LoadoutMode = 'auto' | 'manual';
export type TeaMode = 'auto' | 'manual';
export type MechanicsCompleteness = 'complete' | 'estimated' | 'incomplete';
export type FieldProvenance = 'unknown' | 'imported' | 'user-confirmed';

export interface ActionProfile {
  playerLevel: number;
  tool: ProfileEquipment | null;
  body: ProfileEquipment | null;
  legs: ProfileEquipment | null;
  back: ProfileEquipment | null;
  charm: ProfileEquipment | null;
  houseLevel: number;
  teas: string[];
  loadoutMode?: LoadoutMode;
  teaMode?: TeaMode;
}

export interface PlayerProfile {
  id: string;
  characterId: number | null;
  name: string;
  source: 'milkonomy-v1' | 'milkonomy-preset';
  importedAt: number;
  completeness: 'full' | 'partial';
  mechanicsCompleteness?: MechanicsCompleteness;
  loadoutMode?: LoadoutMode;
  missingFields: string[];
  provenanceMap?: Record<string, FieldProvenance>;
  equipmentOwnership?: Record<string, OwnershipState>;
  actions: Record<SkillingAction, ActionProfile>;
  specialEquipment: Record<string, ProfileEquipment>;
  communityBuffs: Record<string, number>;
  shrines: Record<string, number>;
  achievements: Record<string, boolean>;
  /** Milkonomy Exporter semantics: owned equipment HRID -> enhancement level, not stack quantity. */
  inventoryMap: Record<string, number>;
  /** Material stack quantities are not present in Exporter v1; keep separate to prevent false cash offsets. */
  materialInventoryMap: Record<string, number>;
  seals: string[];
}
