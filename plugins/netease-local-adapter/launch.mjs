// Electron 启动桥接时使用 PATH 中的 Node，也允许填写绝对路径。
// spawn 不经过 shell，路径中允许空格。
export function nodeCommand(settings = {}, runtime = process) {
  const configured = String(settings.nodeExecutable || '').trim();
  if (configured) return configured;
  return runtime.versions.electron ? 'node' : runtime.execPath;
}
