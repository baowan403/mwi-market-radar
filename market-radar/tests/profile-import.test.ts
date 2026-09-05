import exporter from './fixtures/profile-export-v1.json';
import preset from './fixtures/profile-preset.json';
import { describe, expect, it } from 'vitest';
import { ProfileImportError, importPlayerProfile } from '../src/profile/import';

describe('Milkonomy profile import', () => {
  it('retains known skill levels for equipment requirements, but not arbitrary fields', () => {
    const value={...exporter,skills:{...exporter.skills,'/skills/total_level':1250,'/skills/intelligence':80,private_value:999}};
    const profile=importPlayerProfile(JSON.stringify(value),0);
    expect(profile.skillLevels?.['/skills/total_level']).toBe(1250);
    expect(profile.skillLevels?.['/skills/intelligence']).toBe(80);
    expect(profile.skillLevels).not.toHaveProperty('private_value');
  });
  it('normalizes version-one exporter data without retaining unknown private fields', () => {
    const profile = importPlayerProfile(JSON.stringify(exporter), 1_788_220_800_000);

    expect(profile).toMatchObject({
      id: 'character:700001',
      name: '測試牛一號',
      source: 'milkonomy-v1',
      importedAt: 1_788_220_800_000,
      completeness: 'full',
    });
    expect(profile.actions.alchemy.playerLevel).toBe(103);
    expect(profile.actions.alchemy.tool).toEqual({
      itemHrid: '/items/holy_alembic',
      enhancementLevel: 10,
    });
    expect(profile.specialEquipment.pouch).toEqual({
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: 5,
    });
    expect(profile.specialEquipment).not.toHaveProperty('alchemy_tool');
    expect(profile.specialEquipment).not.toHaveProperty('body');
    expect(profile.specialEquipment).not.toHaveProperty('legs');
    expect(profile.inventoryMap).toEqual({
      '/items/holy_alembic': 10,
      '/items/guzzling_pouch': 5,
    });
    expect(profile.materialInventoryMap).toEqual({});
    expect(profile.communityBuffs.production_efficiency).toBe(10);
    expect(profile.shrines.rhythm).toBe(3);
    expect(JSON.stringify(profile)).not.toContain('must-not-survive');
    expect(JSON.stringify(profile)).not.toContain('token');
    expect(JSON.stringify(profile)).not.toContain('cookie');
  });

  it('imports presets as partial profiles and reports absent fields', () => {
    const profile = importPlayerProfile(JSON.stringify(preset), 1_788_220_800_000);

    expect(profile.source).toBe('milkonomy-preset');
    expect(profile.completeness).toBe('partial');
    expect(profile.missingFields).toEqual(expect.arrayContaining(['characterId', 'inventoryMap']));
    expect(profile.actions.brewing.teas).toHaveLength(3);
    expect(profile.specialEquipment.pouch).toEqual({
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: 5,
    });
  });

  it('rejects unrecognized, oversized, and invalid documents with a fixed safe error', () => {
    expect(() => importPlayerProfile('{}')).toThrow(ProfileImportError);
    expect(() => importPlayerProfile('{"version":1,"skills":[]}')).toThrow(ProfileImportError);
    expect(() => importPlayerProfile('x'.repeat(1_000_001))).toThrow(ProfileImportError);
    try {
      importPlayerProfile('{"password":"secret-value"}');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
    }
  });
});
