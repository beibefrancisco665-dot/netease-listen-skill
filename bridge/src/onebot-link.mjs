import { UserError, safeId } from './ncm.mjs';
import { modePolicy } from './1016_播放模式_v1.mjs';

export function createOneBotAuthorizer({ request = fetch, base = 'http://127.0.0.1:3210', musicUid = '', save = async () => {} } = {}) {
  return async input => {
    const origin = typeof base === 'function' ? await base() : base;
    let status, skills;
    try {
      const responses = await Promise.all(['/api/status', '/api/skills'].map(route => request(`${origin}${route}`, { signal: AbortSignal.timeout(5000), redirect: 'error' })));
      if (responses.some(response => !response.ok)) throw new Error('panel unavailable');
      [status, skills] = await Promise.all(responses.map(response => response.json()));
    } catch { throw new UserError('无法核实 QQAgent 的 OneBot 状态，请保持 QQAgent 控制台运行。', 'onebot_unavailable'); }
    if (!status.onebot?.connected || !status.onebot.self?.userId) throw new UserError('QQAgent 的 OneBot 尚未登录连接，暂不执行网易云操作。', 'onebot_offline');
    const botId = safeId(status.onebot.self.userId, 'OneBot 机器人 QQ');
    // Tool context supplies the real robot identity; no model-provided account can replace it.
    if (input.botId && String(input.botId) !== botId) throw new UserError('工具的 OneBot 身份与 QQAgent 当前机器人不一致。', 'onebot_mismatch');
    const skill = skills.skills?.find(item => item.id === 'netease-listen-together');
    if (!skill?.enabled || !skill.active) throw new UserError('网易云技能未启用或配置无效，请先修复技能设置。', 'skill_inactive');
    const raw = skill.settings?.allowedChats;
    if (typeof raw !== 'string' || raw === '******') throw new UserError('会话设置仍是旧版，请重新保存允许的 QQ 会话。', 'invalid_chat_config');
    const allowedChats = raw.split(/[\s,，]+/).filter(Boolean);
    if (!allowedChats.includes(input.chatKey)) throw new UserError('当前发起者会话没有网易云访问权限；private 后填写发起人的 QQ 号，不是机器人 QQ 号。', 'chat_not_allowed');
    if (input.chatKey === `private:${botId}`) throw new UserError('private 后不能填机器人自身 QQ，请填写向机器人发消息的个人 QQ。', 'bot_self_chat');
    const playModePolicy = modePolicy(skill.settings);
    if (input.action === 'auto-mode' && (!playModePolicy.allowed || status.paused || status.orchestrator?.paused
      || status.orchestrator?.running?.includes(input.chatKey))) throw new UserError('自主模式未开启、QQAgent暂停或会话忙碌。', 'autonomous_mode_disabled');
    if (input.action === 'auto-mode') {
      let settings, chats;
      try {
        const replies = await Promise.all(['/api/config', '/api/chats'].map(route => request(`${origin}${route}`, { signal: AbortSignal.timeout(5000), redirect: 'error' })));
        if (replies.some(r => !r.ok)) throw new Error('Mode authorization unavailable');
        [settings, chats] = await Promise.all(replies.map(r => r.json()));
      } catch { throw new UserError('无法再次核实自主模式权限，未发送模式指令。', 'mode_authorization_unavailable'); }
      const [kind, id] = input.chatKey.split(':');
      const allow = settings.allow?.[kind] ?? settings.allow?.[`${kind}s`] ?? [];
      const deny = settings.deny?.[kind] ?? settings.deny?.[`${kind}s`] ?? [];
      const chat = chats.chats?.find(c => c.key === input.chatKey || c.chatKey === input.chatKey);
      if (!Array.isArray(allow) || !Array.isArray(deny) || deny.map(String).includes(id)
        || (allow.length ? !allow.map(String).includes(id) : settings.allowAllWhenEmpty !== true)
        || settings.tools?.enabled === false || settings.tools?.categories?.media === false
        || settings.tools?.overrides?.['netease-listen-together__play_mode'] === false
        || !chat || Number(chat.unread) !== 0) throw new UserError('会话未授权、工具关闭或有未读消息，不自主切换模式。', 'autonomous_mode_disabled');
    }
    let autoLikePolicy;
    if (input.action === 'auto-like' || input.action === 'auto-like-search') {
      const review = skills.skills?.find(item => item.id === 'netease-song-review');
      const chats = String(review?.settings?.allowedChats || '').split(/[\s,，]+/);
      if (status.paused || status.orchestrator?.paused || !review?.enabled || !review.active || review.settings.autonomousLikeSongs !== true || review.settings.linkMusicPreferences !== true || !chats.includes(input.chatKey) || skill.settings.autonomousMusic !== true) {
        throw new UserError('自主收藏未开启或当前会话未获授权。', 'auto_like_disabled');
      }
      if (input.action === 'auto-like-search' && review.settings.autonomousDiscovery !== true) throw new UserError('自主搜歌已关闭，不能收藏搜歌结果。', 'discovery_disabled');
      autoLikePolicy = {
        intervalMs: Math.max(120, Math.min(3600, Number(review.settings.likeIntervalSeconds) || 180)) * 1000,
        maxPerHour: Math.max(1, Math.min(12, Math.floor(Number(review.settings.maxAutonomousLikesPerHour) || 6)))
      };
    }
    const link = { botId, musicUid, chatKey: input.chatKey, connected: true, checkedAt: Date.now() };
    await save(link);
    return { ...link, allowedChats, playModePolicy, ...(autoLikePolicy ? { autoLikePolicy } : {}) };
  };
}
