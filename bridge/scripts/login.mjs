import fs from 'node:fs/promises';
import path from 'node:path';
import { NcmClient, UserError } from '../src/ncm.mjs';
import { ROOT, RUNTIME, readJson, writeJson, connectionInfo } from '../src/server.mjs';

async function main() {
  const ncm = new NcmClient();
  try {
  const first = await ncm.call('login_qr_key');
  const key = first.data?.unikey;
  if (!key) throw new UserError('没有获得二维码登录 key。');
  const created = await ncm.call('login_qr_create', { key, qrimg: true });
  const image = created.data?.qrimg;
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) throw new UserError('二维码图片格式不符合预期。');
  const directory = path.join(RUNTIME, 'login-qr');
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/:/g, '');
  const imageFile = path.join(directory, `login-qr-${stamp}.png`);
  await fs.writeFile(imageFile, Buffer.from(image.split(',')[1], 'base64'));
  console.log(`请打开二维码图片，用给 qqa 的第二个网易云账号扫码并确认（请勿使用本人开房账号）：\n${imageFile}`);
  console.log('登录票据仅保存到本项目 runtime 内，不会打印到终端。');
  const end = Date.now() + 180000;
  let confirmed = false;
  while (Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = await ncm.call('login_qr_check', { key, noCookie: true }, { qr: true });
    if (Number(status.code) === 800) throw new UserError('二维码已过期，请重新执行登录。');
    if (Number(status.code) === 802 && !confirmed) { console.log('已扫码，请在手机上确认登录。'); confirmed = true; }
    if (Number(status.code) === 803) {
      if (!status.cookie || !String(status.cookie).includes('MUSIC_U=')) throw new UserError('登录确认成功，但没有获得有效票据。');
      ncm.cookie = status.cookie;
      const account = await ncm.account();
      const personal = await readJson(path.join(RUNTIME, '1014_网易云会话_v1.json'), null);
      if (personal?.uid && String(personal.uid) === account.uid) throw new UserError('扫的是本人账号，未保存为 qqa 会话。请改用第二个账号。', 'same_account');
      await writeJson(path.join(RUNTIME, '1014_qqa专用会话_v2.json'), { cookie: status.cookie, uid: account.uid, role: 'qqa' });
      await connectionInfo();
      console.log('网易云账号登录已核实。现在可执行 npm start。若桥接服务已运行，请先停止再启动。');
      return;
    }
  }
  throw new UserError('扫码等待超时，请重新执行登录。');
  } finally { await ncm.close(); }
}

main().catch(error => { console.error(error instanceof UserError ? error.message : '登录失败，请检查依赖和网络连接。'); process.exitCode = 1; });
