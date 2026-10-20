import { UserError, safeId } from './ncm.mjs';

export const PLAY_MODES = Object.freeze({ single: 'SINGLE_LOOP', list: 'ORDER_LOOP', random: 'RANDOM' });
export function parseMode(value) {
  const mode = PLAY_MODES[value] || (Object.values(PLAY_MODES).includes(value) ? value : null);
  if (!mode) throw new UserError('模式仅支持 single（单曲循环）、list（列表循环）、random（随机循环）。', 'invalid_play_mode');
  return mode;
}
export function modePolicy(config = {}) {
  return { allowed: config.autonomousMusic === true && config.autonomousPlayModes === true,
    intervalMs: Math.max(10, Math.min(1440, Number(config.modeSwitchIntervalMinutes) || 10)) * 60000,
    maxPerHour: Math.max(1, Math.min(3, Math.floor(Number(config.maxModeSwitchesPerHour) || 3))) };
}
export function playlistSnapshot(data) {
  const source = data?.playlist;
  if (!Array.isArray(source?.displayList?.result)) throw new UserError('无法核实共享列表，未修改模式。', 'playlist_unknown');
  const ids = source.displayList.result.map(id => safeId(id, '共享歌曲编号'));
  const randomIds = Array.isArray(source.randomList?.result) ? source.randomList.result.map(id => safeId(id)) : [];
  return { ids, randomIds, version: Array.isArray(source.version) ? structuredClone(source.version) : [],
    mode: Object.values(PLAY_MODES).includes(source.playMode) ? source.playMode : null,
    listMode: source.listMode, listModeParam: source.listModeParam };
}
export function listCommand(snapshot, uid, sequence, { mode = snapshot.mode, ids = snapshot.ids, random = Math.random } = {}) {
  const versions = snapshot.version.filter(v => String(v.userId) !== String(uid));
  const previous = snapshot.version.find(v => String(v.userId) === String(uid));
  const version = Math.max(Number(sequence) || 1, (Number(previous?.version) || 0) + 1);
  let shuffled = snapshot.randomIds.filter(id => ids.includes(id));
  if (mode === 'RANDOM' && (shuffled.length !== ids.length || new Set(shuffled).size !== new Set(ids).size)) {
    shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  return { commandType: 'REPLACE', version: [...versions, { userId: String(uid), version }],
    anchorSongId: '', anchorPosition: -1, displayList: [...ids], randomList: shuffled,
    ...(mode ? { playMode: mode } : {}),
    ...(typeof snapshot.listMode === 'string' ? { listMode: snapshot.listMode } : {}),
    ...(snapshot.listModeParam != null ? { listModeParam: snapshot.listModeParam } : {}) };
}
export function quota(state, botId, now, policy) {
  const bot = state.bots?.[botId] || {};
  const attempts = (bot.attempts || []).filter(t => Number.isFinite(t) && t > now - 3600000);
  const last = Number(bot.lastAttemptAt) || 0;
  const due = Math.max(last ? last + policy.intervalMs : 0,
    attempts.length >= policy.maxPerHour ? [...attempts].sort((a, b) => a - b)[attempts.length - policy.maxPerHour] + 3600000 : 0);
  return { attempts, nextAt: due, allowed: now >= due && attempts.length < policy.maxPerHour };
}
