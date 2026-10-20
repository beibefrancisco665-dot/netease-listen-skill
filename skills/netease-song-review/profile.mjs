export const MUSIC_MARKER = '【音乐爱好】';
export const DEFAULT_MUSIC = `${MUSIC_MARKER}
喜欢和熟悉的人一起听歌，愿意聊歌词的意象、歌曲带来的联想、歌手和音乐背后的故事。具体喜欢哪些歌，以自己网易云账号“我喜欢的音乐”为真实收藏依据，不把对方收藏当成自己的喜好，也不凭空编造固定曲风或歌手偏好。
听到自己收藏的歌曲时，可以按本来的人设、语气和亲疏关系主动聊一句感受或问对方想起了什么；不必每次都写乐评，也可以分享有依据的联想、回忆和轻松的话题。这里的回忆不能编造成真实经历。主动音乐话题不请求换歌、点歌、暂停、结束或收藏，不因为自己喜欢或不喜欢就操作播放。
以后可在此段直接补充偏好的歌手、曲风、歌词主题和不喜欢的元素；文字偏好与收藏有冲突时照实区分，不擅自更改人设或网易云收藏。`;

export function personaFor(config, chatKey) {
  const base = config?.persona || {};
  if (config?.personaUnified !== false) return base;
  const [kind, id] = String(chatKey || '').split(':');
  const raw = config.personaByChat?.[id] ?? config.personaByChat?.[chatKey];
  if (!raw || !['private', 'group'].includes(kind)) return base;
  const result = { ...base };
  for (const field of ['roleText', 'customRules', 'systemPromptOverride']) if (typeof raw[field] === 'string' && raw[field].trim()) result[field] = raw[field].trim();
  if (['low', 'medium', 'high'].includes(raw.participation)) result.participation = raw.participation;
  return result;
}
export function musicFromRole(role) {
  const value = String(role || '');
  const start = value.indexOf(MUSIC_MARKER);
  if (start < 0) return '';
  const rest = value.slice(start + MUSIC_MARKER.length);
  const end = rest.search(/\n\s*【[^】]+】/);
  return rest.slice(0, end < 0 ? undefined : end).trim().slice(0, 4000);
}
export function addMusicRole(role) {
  const value = String(role || '');
  return value.includes(MUSIC_MARKER) ? value : `${value}\n\n${DEFAULT_MUSIC}`;
}
export function safeConversation(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 350) return false;
  // Generated proactive text is conversational only. Reject requests/announcements about playback.
  return !/(切歌|换[一首个下]?歌|换一首|下一首|上一首|点[一首个]?歌|暂停|停止播放|结束.*一起听|退出.*房|加入.*歌单|收藏|红心|取消.*喜欢|skip\b|next\s+(?:song|track)|change\s+(?:song|track)|pause\b)/i.test(text);
}
