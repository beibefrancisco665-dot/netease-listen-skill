import { NcmClient, PAIR } from '../src/ncm.mjs';
import { Together } from '../src/together.mjs';

export const invite = 'https://st.music.163.com/listen-together/share/?songId=1001&roomId=room-one&inviterId=999';
export function fixture() {
  const state = { inRoom: false, uid: '123', songId: '1001', progress: 35000, playStatus: 'PLAY', roomId: 'room-one', queue: ['1001', '1002'], liked: ['1002'], calls: [], streamCalls: [], saved: null };
  const play = () => state.unknownPlay ? {} : { songId: state.songId, progress: state.progress, playStatus: state.playStatus };
  const snapshot = () => ({ roomId: state.roomId, roomUsers: [{ userId: '123', nickname: '测试成员' }], playState: play() });
  const ok = body => Promise.resolve({ status: 200, body: { code: 200, ...body } });
  const sdk = {
    login_status: () => ({ status: 200, body: { data: { code: 200, profile: { userId: state.uid, nickname: '测试账号' } } } }),
    song_detail: args => ok({ songs: [{ id: args.ids, name: `测试歌曲 ${args.ids}`, ar: [{ name: '测试歌手' }], al: { name: '测试专辑' }, dt: 180000 }] }),
    song_url_v1: args => {
      state.streamCalls.push({ id: args.id, level: args.level, crypto: args.crypto });
      if (state.streamDown || state.requireEapi && args.crypto !== 'eapi') throw { body: { code: 502 }, stage: 'xeapi_key' };
      return ok({ data: [{ id: args.id, url: state.unplayable === args.id ? null : 'https://example.invalid/audio.mp3', code: 200, freeTrialInfo: state.trial ? { start: 0, end: 30000 } : null }] });
    },
    like: args => { state.liked = [...new Set([...state.liked, String(args.id)])]; return ok({ code: 200 }); },
    likelist: () => ok({ ids: state.liked }),
    cloudsearch: () => ok({ result: { songs: [{ id: '1001', name: '测试歌', ar: [{ name: '测试歌手' }], al: { name: '测试专辑' } }] } }),
    lyric: () => ok({ lrc: { lyric: '[00:01]测试歌词一\n[00:30]测试歌词二\n[00:40]测试歌词三' } }),
    api: args => {
      state.calls.push(structuredClone(args));
      switch (args.uri) {
        case PAIR.status: return ok({ data: state.inRoom ? { inRoom: true, roomInfo: snapshot() } : { inRoom: false } });
        case PAIR.check: return ok({ data: { joinable: !state.full, status: state.full ? 'CLOSED' : 'AVAILABLE' } });
        case PAIR.create:
        case PAIR.join:
          if (state.rejectEnter) return ok({ data: { success: false } });
          if (!state.unknownJoin) state.inRoom = true;
          return ok({ data: { type: 'NEW_ROOM', roomInfo: snapshot() } });
        case PAIR.playlist: return ok({ data: { playlist: { displayList: { result: state.queue } }, playState: play() } });
        case PAIR.heartbeat: return ok({ data: { success: true, playState: play() } });
        case PAIR.sync:
          if (state.rejectWrite) return ok({ data: { success: false } });
          if (!state.delayedWrite) state.queue = JSON.parse(args.data.playlistParam).displayList;
          return ok({ data: { success: true } });
        case PAIR.command:
          if (state.rejectWrite) return ok({ data: { success: false } });
          if (!state.delayedWrite) {
            const command = JSON.parse(args.data.commandInfo);
            state.songId = command.targetSongId; state.progress = command.progress; state.playStatus = command.playStatus;
          }
          return ok({ data: { success: true } });
        case PAIR.end:
          if (state.rejectWrite) return ok({ data: { success: false } });
          state.inRoom = false; return ok({ data: { success: true } });
        default: throw new Error('Unexpected endpoint');
      }
    }
  };
  const client = new NcmClient('MUSIC_U=test-only', sdk);
  const together = new Together(client, { save: async value => { state.saved = structuredClone(value); }, ownerUid: '999' });
  return { state, client, together, snapshot };
}
