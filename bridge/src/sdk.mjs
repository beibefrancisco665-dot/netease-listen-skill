import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export class Sdk {
  constructor() {
    this.sequence = 0; this.pending = new Map();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    this.worker = new Worker(new URL('./sdk-worker.mjs', import.meta.url), { workerData: { root }, execArgv: [], stdout: true, stderr: true });
    // Drain without logging: SDK failures sometimes include cookies and signed URLs.
    this.worker.stdout.resume(); this.worker.stderr.resume();
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', message => {
        if ('ready' in message) { message.ready ? resolve() : reject(new Error('SDK initialization failed')); return; }
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        if (message.response) task.resolve(message.response);
        else task.reject({ body: { code: message.errorCode || 502 }, stage: message.stage === 'xeapi_key' ? 'xeapi_key' : 'request' });
      });
      const fail = () => {
        reject(new Error('SDK worker stopped'));
        for (const task of this.pending.values()) task.reject({ body: { code: 502 } });
        this.pending.clear();
      };
      this.worker.on('error', fail); this.worker.on('exit', fail);
    });
    this.ready.catch(() => {});
  }
  async invoke(name, args) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, name, args });
    });
  }
  close() { return this.worker.terminate(); }
}
