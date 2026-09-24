#!/usr/bin/env node
/**
 * shot.mjs — 给 WorkBuddy 渲染进程截图（用于换肤效果的证据留档）
 *
 * 为什么单独做成工具：换肤这件事"看起来对不对"只能靠眼睛。每次改完主题
 * 或壁纸，都需要一张可复核的截图，而不是靠"注入返回 applied:true"当作完成。
 *
 * 用法：
 *   node tools/shot.mjs                          → docs/shot-<时间戳>.png
 *   node tools/shot.mjs docs/after.png           → 指定输出路径
 *   node tools/shot.mjs docs/after.png 1200      → 指定宽度（默认取窗口实际尺寸）
 *
 * 退出码：0 成功 ｜ 3 CDP 不可达（WorkBuddy 未以调试端口启动）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cdp, findRenderer } from "./lib-cdp.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, "..");
const PORT = Number(process.env.SKIN_PORT || 9342);

const rel = process.argv[2];
const widthArg = Number(process.argv[3] || 0);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = rel
  ? path.resolve(process.cwd(), rel)
  : path.join(ROOT, "docs", `shot-${stamp}.png`);

let target;
try {
  target = await findRenderer(PORT);
} catch (e) {
  console.error(`✗ CDP 不可达：${e.message}`);
  console.error("  先确认 WorkBuddy 已启动，且带 WORKBUDDY_REMOTE_DEBUGGING_PORT=9342");
  process.exit(3);
}

// 取视口尺寸；必要时先按指定宽度调整，再截整页可视区
const metrics = await cdp(target.webSocketDebuggerUrl, "Page.getLayoutMetrics", {});
const vp = metrics.result?.cssVisualViewport || metrics.result?.visualViewport || {};
const realW = Math.round(vp.clientWidth || 1440);
const realH = Math.round(vp.clientHeight || 900);

if (widthArg && widthArg !== realW) {
  await cdp(target.webSocketDebuggerUrl, "Emulation.setDeviceMetricsOverride", {
    width: widthArg,
    height: Math.round((realH * widthArg) / realW),
    deviceScaleFactor: 1,
    mobile: false,
  });
}

/*
 * 先让目标页面到前台，再截图。
 *
 * 为什么必须：Page.captureScreenshot 拿的是**合成器的当前帧**。目标窗口不在
 * 前台时（被别的窗口遮住 / 最小化），Chromium 不会为新一帧做合成，于是可能
 * 返回**过期画面** —— 而 DOM 查询（getComputedStyle / 探针）永远是实时的。
 *
 * 2026-09-24 实测踩中：探针说"覆盖屏幕中点且不透明的元素只有 #root（已被改成
 * 纯红）"，可截图里那一点是深色。两张图对不上，排查被带偏了一整轮 ——
 * 一度以为是 backdrop-filter 的问题。代价只有约 1 秒，但"到底看没看见"
 * 这件事全靠这条通道，不能省。
 */
try {
  await cdp(target.webSocketDebuggerUrl, "Page.bringToFront", {});
  await new Promise((r) => setTimeout(r, 900));
} catch (e) {
  console.warn("⚠️ bringToFront 失败（继续截图，但拿到的可能是过期帧）：" + e.message);
}

const shot = await cdp(target.webSocketDebuggerUrl, "Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});

if (widthArg && widthArg !== realW) {
  await cdp(target.webSocketDebuggerUrl, "Emulation.clearDeviceMetricsOverride", {});
}

const b64 = shot.result?.data;
if (!b64) {
  console.error("✗ 截图失败：" + JSON.stringify(shot).slice(0, 300));
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(b64, "base64"));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`✅ 截图已保存：${out}  (${realW}×${realH} → ${kb}KB)`);
