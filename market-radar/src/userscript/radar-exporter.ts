/**
 * Market Radar 專屬遊戲內資料導出器 (Userscript Module)
 * 透過監聽遊戲 WebSocket 連線，抓取包含隨身背包與全套裝備、技能、房屋、公會 Buff 的超完整快照，
 * 並在遊戲畫面上渲染一個優雅的操作按鈕，一鍵複製代碼到剪貼簿。
 */

interface RawCharacterItem {
  itemHrid?: string;
  count?: number;
  enhancementLevel?: number;
  itemLocationHrid?: string;
}

interface RawCharacterSkill {
  skillHrid?: string;
  level?: number;
  experience?: number;
}

interface RawGameDataPacket {
  type?: string;
  character?: {
    id?: number;
    name?: string;
  };
  characterSkills?: RawCharacterSkill[];
  characterItems?: RawCharacterItem[];
  houseRoomLevelMap?: Record<string, number>;
  communityBuffLevelMap?: Record<string, number>;
  characterAchievements?: Array<{
    characterID?: number;
    achievementHrid?: string;
    progress?: number;
    isCompleted?: boolean;
  }>;
  actionTypeDrinkSlotsMap?: Record<string, Array<{ itemHrid?: string } | null>>;
}

let cachedGameData: RawGameDataPacket | null = null;

/**
 * 攔截原生 WebSocket 以捕獲遊戲伺服器推播的角色資料
 */
export function hookGameWebSocket(): void {
  if (typeof window === 'undefined' || !window.WebSocket) return;

  const originalWebSocket = window.WebSocket;

  const proxiedWebSocket = function (this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
    const ws = new originalWebSocket(...args);

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        if (typeof event.data !== 'string') return;
        const parsed = JSON.parse(event.data);

        // 監聽初始化資料或角色更新資料
        if (parsed.type === 'init_character_info' || parsed.type === 'init_client_data' || parsed.character) {
          cachedGameData = {
            ...cachedGameData,
            ...parsed,
          };
          updateButtonState();
        } else if (parsed.type === 'character_items_updated' && Array.isArray(parsed.endCharacterItems)) {
          if (cachedGameData) {
            cachedGameData.characterItems = parsed.endCharacterItems;
          }
        }
      } catch {
        // 忽略非 JSON 訊息
      }
    });

    return ws;
  } as unknown as typeof WebSocket;

  proxiedWebSocket.prototype = originalWebSocket.prototype;
  window.WebSocket = proxiedWebSocket;
}

/**
 * 將記憶體中的遊戲封包轉換為 Radar / Milkonomy v1 標準 JSON
 */
export function generateRadarSnapshot(): string | null {
  if (!cachedGameData || !cachedGameData.character) {
    return null;
  }

  const name = cachedGameData.character.name ?? 'Unknown';
  const characterId = cachedGameData.character.id ?? null;

  // 1. 技能等級映射
  const skills: Record<string, number> = {};
  if (Array.isArray(cachedGameData.characterSkills)) {
    for (const s of cachedGameData.characterSkills) {
      if (s.skillHrid && typeof s.level === 'number') {
        skills[s.skillHrid] = s.level;
      }
    }
  }

  // 2. 身上穿戴的裝備 (equipment) 與 全量物品庫存 (inventoryMap)
  const equipment: Record<string, { hrid: string; enhanceLevel: number }> = {};
  const inventoryMap: Record<string, number> = {};

  if (Array.isArray(cachedGameData.characterItems)) {
    for (const item of cachedGameData.characterItems) {
      if (!item.itemHrid) continue;
      const enhance = item.enhancementLevel ?? 0;

      // 只要是生活或戰鬥裝備，記錄到 inventoryMap（保留最高強化等級）
      const currentLevel = inventoryMap[item.itemHrid] ?? -1;
      if (enhance > currentLevel) {
        inventoryMap[item.itemHrid] = enhance;
      }

      // 若有特定部位穿戴
      if (item.itemLocationHrid && item.itemLocationHrid !== '/item_locations/inventory') {
        equipment[item.itemLocationHrid] = {
          hrid: item.itemHrid,
          enhanceLevel: enhance,
        };
      }
    }
  }

  // 3. 房屋房間
  const houses: Record<string, number> = cachedGameData.houseRoomLevelMap ?? {};

  // 4. 公會加成
  const communityBuffs: Record<string, number> = cachedGameData.communityBuffLevelMap ?? {};

  // 5. 成就
  const achievements = Array.isArray(cachedGameData.characterAchievements)
    ? cachedGameData.characterAchievements.map((a) => ({
        characterID: a.characterID ?? characterId,
        achievementHrid: a.achievementHrid ?? '',
        progress: a.progress ?? 1,
        isCompleted: a.isCompleted ?? true,
        isSteamGranted: false,
      }))
    : [];

  // 6. 茶飲
  const actionTeas: Record<string, string[]> = {};
  if (cachedGameData.actionTypeDrinkSlotsMap) {
    for (const [actionType, slots] of Object.entries(cachedGameData.actionTypeDrinkSlotsMap)) {
      const actionName = actionType.split('/').at(-1) ?? actionType;
      actionTeas[actionName] = (slots ?? [])
        .filter((s): s is { itemHrid: string } => typeof s?.itemHrid === 'string')
        .map((s) => s.itemHrid);
    }
  }

  const exportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    name,
    skills,
    equipment,
    houses,
    communityBuffs,
    achievements,
    achievementPoints: 0,
    achievementTierMap: {},
    shrines: {},
    actionTeas,
    inventoryMap,
    loadouts: [],
  };

  return JSON.stringify(exportPayload);
}

function updateButtonState(): void {
  const btn = document.getElementById('mwi-radar-export-btn');
  if (!btn) return;
  if (cachedGameData && cachedGameData.character) {
    btn.textContent = `⚡ 導出 ${cachedGameData.character.name ?? ''} Radar 快照`;
    (btn as HTMLButtonElement).disabled = false;
    btn.style.opacity = '1';
    btn.style.boxShadow = '0 0 12px rgba(52, 211, 153, 0.4)';
  }
}

/**
 * 彈出 Toast 提示
 */
function showToast(message: string, isSuccess = true): void {
  let toast = document.getElementById('mwi-radar-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mwi-radar-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '999999',
      padding: '12px 24px',
      borderRadius: '8px',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(toast);
  }

  toast.style.background = isSuccess ? '#059669' : '#dc2626';
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  setTimeout(() => {
    if (toast) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-10px)';
    }
  }, 3500);
}

/**
 * 在遊戲畫面左下角渲染浮動按鈕
 */
export function installRadarExportButton(): void {
  if (typeof document === 'undefined') return;

  const tryMount = () => {
    if (document.getElementById('mwi-radar-export-btn')) return;

    const container = document.createElement('div');
    container.id = 'mwi-radar-export-container';
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '18px',
      left: '18px',
      zIndex: '99999',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    });

    const btn = document.createElement('button');
    btn.id = 'mwi-radar-export-btn';
    btn.textContent = '⚡ 導出 Radar 快照 (載入中...)';
    btn.title = '一鍵導出包含全套生活裝備、背包、房屋與公會 Buff 的完整快照';
    Object.assign(btn.style, {
      padding: '9px 16px',
      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      color: '#ffffff',
      border: '1px solid #34d399',
      borderRadius: '6px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'all 0.2s ease',
      opacity: '0.7',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.boxShadow = '0 4px 12px rgba(52, 211, 153, 0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    });

    btn.addEventListener('click', async () => {
      const payload = generateRadarSnapshot();
      if (!payload) {
        showToast('⚠️ 尚未收到角色完整資料，請先在遊戲中切換一下角色或刷新頁面', false);
        return;
      }

      try {
        if (typeof GM_setClipboard !== 'undefined') {
          GM_setClipboard(payload);
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(payload);
        }
        showToast(`🎉 成功複製 ${cachedGameData?.character?.name ?? ''} 的 Radar 超級快照至剪貼簿！`);
      } catch (err) {
        showToast('❌ 複製到剪貼簿失敗，請檢查瀏覽器權限', false);
      }
    });

    container.appendChild(btn);
    document.body.appendChild(container);
    updateButtonState();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount);
  } else {
    tryMount();
  }
}
