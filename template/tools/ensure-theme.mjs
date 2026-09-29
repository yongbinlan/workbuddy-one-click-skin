#!/usr/bin/env node
/**
 * ensure-theme.mjs — 补注入「主题层」（进程内，不起任何子进程）
 *
 * ---------------------------------------------------------------------------
 * 为什么需要它
 *
 * WorkBuddy 自己维护着开机自启项（HKCU Run 的 `WorkBuddy.WorkBuddy`）：
 * 它启动时跑一次 `reconcileOnStartup()`，把该项的值重写成自己的 exe 路径。
 * 所以「把自启项改指向皮肤启动器」这条路**从设计上就赢不了** ——
 * 只要应用启动一次，值就被覆盖回去（2026-09-29 取到了应用自己的日志与
 * settings.json 时间戳作证）。而一旦开机走的是 exe，启动器就不会跑，
 * CodeDrobe 的主题层从未注入 —— 皮肤层每条规则都挂在
 * `html.codedrobe-host-workbuddy` 下，宿主类不在 = 整层静默失效。
 *
 * 因此补注入不能只依赖「启动器一定会跑」，得有一个**随时能补**的入口。
 * 本文件就是那个入口：谁发现宿主类不在，谁就调它。
 *
 * ---------------------------------------------------------------------------
 * 为什么不直接调 CodeDrobe 官方 CLI
 *
 * 官方 CLI 的调用形态是「node 起 node 子进程」：
 *     run-codedrobe.mjs → spawnSync(node, [codedrobe.mjs, ...])
 * 在受限环境里 spawn 会被安全策略拦掉，返回 EBUSY：status=null、
 * stdout/stderr 全空。**CLI 看起来"跑了"，实际什么都没干** ——
 * 调用方拿到空输出后只能靠超时发现，表现成「等 90 秒然后放弃注入」。
 *
 * 而注入链路本身（@codedrobe/core 的 injector.mjs / skin.mjs）**全程只走 CDP**，
 * 根本不需要子进程。所以这里直接 import 官方库、在进程内调用：
 * 同一份实现、同一个结果，只是少了那一层 spawn。
 *
 * ---------------------------------------------------------------------------
 * 用法
 *   node tools/ensure-theme.mjs            # 宿主类不在就补注入
 *   node tools/ensure-theme.mjs --status    # 只报告，不注入
 *
 * 退出码：0 已就绪或补注入成功 ｜ 1 补注入失败 ｜ 3 CDP 不可达
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLI_ROOT } from "./run-codedrobe.mjs";
import { HOST_CLASS, evaluate } from "./lib-cdp.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, "..");

/**
 * 主题包解析：环境变量 → workbuddy.local.json → build/ 下最新的 *.codedrobe-theme。
 *
 * 注意 tools\launcher.mjs 里有一份**等价的行内实现**（detectTheme）。
 * 这里没有抽成公共模块，是为了把改动限制在"新增文件"上 ——
 * 启动器是端到端验过的东西，动它要重跑一整套门禁（其中几项起子进程，
 * 在受限环境里跑不了）。两边规则若将来只改一处，以本文件为准：
 * 补注入是兜底路径，宁可它多认几种写法，也不要它认不出来。
 */
function resolveThemePath() {
  const cands = [];
  if (process.env.WORKBUDDY_THEME) cands.push(process.env.WORKBUDDY_THEME);
  try {
    const local = JSON.parse(fs.readFileSync(path.join(ROOT, "workbuddy.local.json"), "utf8"));
    if (local.theme) cands.push(local.theme);
  } catch { /* 没有本机记录就继续往下探 */ }
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch { /* 探不到就试下一个 */ }
  }
  try {
    const bd = path.join(ROOT, "build");
    const hit = fs.readdirSync(bd).filter((f) => f.endsWith(".codedrobe-theme")).sort();
    if (hit.length) return path.join(bd, hit[hit.length - 1]);
  } catch { /* 没有 build 目录 */ }
  return path.join(ROOT, "build", "theme.codedrobe-theme");
}

/**
 * 找到 @codedrobe/core 的库入口。
 *
 * 读包自己的 package.json（exports["."] / module / main）而不是写死
 * `src/index.mjs` —— 同一个包换个版本就可能改成 dist/ 布局，
 * 写死的话会在升级后静默变成"文件不存在"，而那种失败最容易被当成
 * "主题包坏了"去排查。
 */
function resolveCoreEntry() {
  const pkgDir = path.join(CLI_ROOT, "node_modules", "@codedrobe", "core");
  const pkgFile = path.join(pkgDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  } catch (e) {
    throw new Error(
      `找不到 CodeDrobe 库：${pkgFile}\n` +
      `  （CLI_ROOT=${CLI_ROOT}；可设环境变量 CODEDROBE_HOME 指向安装位置）\n` +
      `  重新安装：npm install --prefix "${CLI_ROOT}" @codedrobe/core`
    );
  }
  const dot = pkg.exports?.["."];
  const rel = typeof dot === "string" ? dot : (dot?.default || dot?.import);
  const entry = path.join(pkgDir, rel || pkg.module || pkg.main || "src/index.mjs");
  if (!fs.existsSync(entry)) throw new Error(`CodeDrobe 库入口不存在：${entry}`);
  return entry;
}

let coreCache = null;
async function loadCore() {
  if (coreCache) return coreCache;
  coreCache = await import(pathToFileURL(resolveCoreEntry()).href);
  return coreCache;
}

/** 宿主类在不在 <html> 上 —— 这是「主题层有没有注入」唯一可靠的判据。 */
export async function hasHostClass(port) {
  const cls = await evaluate(port, "document.documentElement.className", { timeoutMs: 8000 });
  return String(cls || "").split(/\s+/).includes(HOST_CLASS);
}

/**
 * 保证主题层在。宿主类已存在 → 直接返回，不做任何多余动作（幂等）。
 *
 * 参数 probeHostClass 是**判据接缝**，默认用真实的 hasHostClass。
 * 为什么留这个口子：CodeDrobe 注入的载荷自带 MutationObserver + 每 5 秒
 * 一次的 setInterval 兜底（renderer-payload.mjs），所以「人为把宿主类摘掉」
 * 这个故障模拟撑不过几秒 —— 载荷会把它放回去。于是注入分支
 * （宿主类不在 → 真的去 applySkin）在正常机器上**根本没法复现**，
 * 只能靠把判据换成 `() => false` 来强制走到。本工程的铁律是
 * 「判据不可独立验证 = 等于没有判据」，所以宁可在签名上留个口子。
 *
 * 返回 { ok, alreadyThere, themeId, why }
 */
export async function ensureTheme({
  port = Number(process.env.WORKBUDDY_REMOTE_DEBUGGING_PORT) || 9342,
  themePath = "",
  timeoutMs = 30000,
  probeHostClass = hasHostClass,
} = {}) {
  if (await probeHostClass(port)) return { ok: true, alreadyThere: true };

  const theme = themePath || resolveThemePath();
  if (!fs.existsSync(theme)) {
    return { ok: false, alreadyThere: false, why: `主题包不存在：${theme}` };
  }

  const core = await loadCore();
  const adapter = core.getAdapter("workbuddy");
  const bundle = await core.readThemePackage(path.resolve(theme));
  const targetTheme = core.resolveThemeTarget(bundle, adapter.id);

  /*
   * launch:false —— 本文件的职责是**补注入**，不是启动应用。
   * 应用没起来时该由启动器负责，这里硬等只会白等一场。
   */
  await core.applySkin({ adapter, targetTheme, port, launch: false, timeoutMs });

  // 回读确认。applySkin 返回 pass=true 是它自己的判据，宿主类才是我们要的判据
  // —— 不看回读的写入等于没写，本工程在这上面栽过不止一次。
  const after = await hasHostClass(port);
  return {
    ok: after,
    alreadyThere: false,
    themeId: targetTheme.theme?.id,
    why: after ? undefined : "注入命令已执行，但页面上仍读不到宿主类",
  };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.SKIN_PORT) || Number(process.env.WORKBUDDY_REMOTE_DEBUGGING_PORT) || 9342;
  try {
    if (process.argv.includes("--status")) {
      const on = await hasHostClass(PORT);
      console.log(on ? "主题层：在 ✅" : "主题层：不在 ✗（皮肤层整层失去匹配对象）");
      process.exit(on ? 0 : 1);
    }
    const r = await ensureTheme({ port: PORT });
    if (r.ok) {
      console.log(r.alreadyThere
        ? "主题层已在 ✅（无需补注入）"
        : `主题层已补注入 ✅（themeId=${r.themeId}）`);
      process.exit(0);
    }
    console.error("✗ 补注入失败：" + r.why);
    process.exit(1);
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("✗ " + msg);
    /*
     * 把"连不上页面"与"注入失败"分开报。
     * 两者都退出非 0，但对人的含义完全不同：前者是应用没开/端口不对，
     * 后者是真的注入不了 —— 混成一句话会让人往错的方向查。
     */
    process.exit(/ECONNREFUSED|WebSocket|CDP|fetch failed|不可达/i.test(msg) ? 3 : 1);
  }
}
