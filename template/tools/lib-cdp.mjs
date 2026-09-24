/**
 * lib-cdp.mjs — 共享 CDP 客户端 + 壁纸层注入
 *
 * 为什么需要它：CodeDrobe 的 apply 只能注入整个主题包，而"换壁纸"要求秒级、
 * 不重新打包。实测发现主题的壁纸变量定义在 `html.codedrobe-host-workbuddy #root`
 * 上（不是 :root），所以只要往页面注入一条 targeting #root 的规则，就能换掉壁纸，
 * 且立即生效、无需打包、无需重启。
 *
 * 实测证据（2026-09-17）：
 *   · file:// 本地图片在 renderer 中可正常加载（1920×1078，CSP 为 null）
 *   · 注入 `html.codedrobe-host-workbuddy #root { --codedrobe-image-hero: url("file:///...") !important; }`
 *     → 变量被改写 ✅、#root 背景引用到新图 ✅、移除后完全复原 ✅、无残留 ✅
 *
 * 零依赖：Node 22+ 内置 fetch / WebSocket。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 壁纸层 style 元素的 id（与 CodeDrobe 自己的主题 style 元素互不干扰） */
export const WALLPAPER_STYLE_ID = "workbuddy-skin-wallpaper";

/**
 * CodeDrobe 主题挂在 <html> 上的宿主类。
 *
 * 皮肤层的**每一条**规则都以 `html.<这个类>` 开头 —— 也就是说皮肤层
 * **依赖主题层先注入**。主题层不在时，整层规则会**静默失去匹配对象**：
 * 注入照样报"成功"（<style> 确实插进去了），但读回全是空值。
 *
 * 2026-09-24 的真实故障就是这么来的：WorkBuddy 走的是开机自启（HKCU Run），
 * 自启项直接拉 WorkBuddy.exe、绕过了启动器，于是 codedrobe apply 从未执行。
 * 而当时自检报的是"壁纸变量不是 file:// 路径""档位变量未生效"—— 全是果不是因，
 * 把人往错方向引了一整轮。所以自检必须**先单独判这个前提**。
 */
export const HOST_CLASS = "codedrobe-host-workbuddy";

// ---------------- CDP 基础 ----------------

export async function listTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

export function cdp(wsUrl, method, params = {}, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`timeout:${method}`));
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id === id) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(m);
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`ws-error:${method}`)); };
  });
}

/** 找到可注入的 renderer target（排除 devtools 等） */
export async function findRenderer(port) {
  const list = await listTargets(port);
  const t = list.find(
    (x) => x.webSocketDebuggerUrl && !String(x.url || "").startsWith("devtools://"),
  );
  if (!t) throw new Error(`端口 ${port} 上找不到可注入的 renderer（WorkBuddy 未以 CDP 方式启动？）`);
  return t;
}

export async function evaluate(port, expression, { awaitPromise = false, timeoutMs = 25000 } = {}) {
  const t = await findRenderer(port);
  const r = await cdp(t.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise,
  }, timeoutMs);
  if (r.result?.exceptionDetails) {
    throw new Error("页面执行异常：" + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  }
  return r.result?.result?.value;
}

// ---------------- 皮肤层（壁纸 / 薄纱 / 玻璃 三层合一） ----------------

/**
 * 强度档位。数值含义：
 *   rootX / rootY  重写 #root 方向性遮罩的混色比例（越小越透）
 *   glass          结构容器（对话区 / 侧栏 / 输入框）不透明度
 *   content        内容块（代码 / diff / 工具卡片）不透明度 —— 保可读，不跟着一起透
 *   blur           结构容器毛玻璃半径
 *
 * 为什么不把 content 也调很透：壁纸透得越狠，代码和 diff 越看不清。
 * 结构面可以糊，内容面不能糊 —— 这是换肤唯一不能破的底线。
 */
export const SKIN_PRESETS = {
  light: { rootX: 56, rootY: 42, glass: 46, content: 80, blur: 22 },
  medium: { rootX: 74, rootY: 60, glass: 62, content: 88, blur: 18 },
  strong: { rootX: 90, rootY: 78, glass: 80, content: 92, blur: 12 },
};

/** 中文档位别名 → 内部键 */
export const PRESET_ALIAS = {
  "淡": "light", light: "light",
  "中": "medium", medium: "medium",
  "浓": "strong", strong: "strong",
  "更淡": "light",
};

/**
 * 结构容器清单（会被玻璃化）。
 * 全部来自 tools/diag-occluders.mjs 的**实测**遮挡清单，不是猜的类名：
 *   .cr-agent__body      41.1% —— 最大元凶，ADAPTER 给了它 90% 不透明底色
 *   .conversation-sidebar 13.4%
 *   .cr-input-container   6.5%
 *   .sidebar-next         右侧详情面板（会话切换时出现）
 *   .cr-widget-card       卡片式回复（出现时才有）
 *
 * ⚠️ 这里只放**薄薄的结构面**。整屏的页面级外壳放下面 CLEAR_SELECTORS ——
 * 两者的处理方式完全不同，放错了会"越改越差"（2026-09-24 实测踩过）。
 */
const GLASS_SELECTORS = [
  // 第一、二条镜像 build-theme.mjs ADAPTER 的选择器（同为 (0,4,1)），靠"注入在后"取胜；
  // 第二条是同元素的降级兜底 —— 两条都留着，ADAPTER 改版也不至于整体失效。
  ".cr-agent__body:has(> .cr-agent__content:not(:empty))",
  ".cr-agent__body",
  ".conversation-sidebar",
  ".cr-input-container",
  ".sidebar-next",
  ".cr-widget-card",
];

/**
 * 页面级外壳清单 —— **直接清成透明，并且不给毛玻璃**。
 *
 * 目前只有一条：「工作区 / 团队」网格视图的滚动容器。
 * 实测 1920×1020 = **97.1% 视口**、rgb(20,20,20) **完全不透明** —— 它一挡，
 * 壁纸在整个屏幕上一点都看不到（2026-09-24 用户报「提示已生效但皮肤没变」的真凶）。
 *
 * **为什么不能按玻璃面处理**（试过，结果比不修更糟）：
 *   ① 它是**满屏的祖先容器**，加 backdrop-filter 会把**整个视口**的壁纸糊掉；
 *   ② 它下面还有 .cr-agent__body 这类自带毛玻璃的子元素 → 祖先糊一遍、子元素再糊一遍，
 *      叠成**双重模糊**。用户看到的是"一片模糊的暖色"，原话：「有是有，完全看不出来」。
 *
 * 它本来就只是个布局外壳，不该有底色 —— 清掉即可。
 *
 * ⚠️ 这类容器是**成批**的：切「技能 / 定时任务 / 资料库」视图都可能冒出新的。
 *    自检的 occluders 采样专门盯它们（见 checkWallpaperState）。
 */
const CLEAR_SELECTORS = [
  ".teams-grid-scroll-content",
];


/** 内容块清单（只轻调，保持高不透明以保可读） */
const CONTENT_SELECTORS = [
  ".cr-tool-exp__content",
  ".cr-tool-write__body",
  ".cr-tool-diff",
  ".sc-block-content",
  ".cr-code-like-box",
];

/**
 * 生成完整的皮肤层 CSS。
 *
 * @param {object} o
 * @param {string|null} o.imagePath  壁纸绝对路径；null = 用主题自带壁纸（仍会重写遮罩与玻璃层）
 * @param {string} o.preset          档位：light | medium | strong（或中文 淡/中/浓）
 * @param {string} [o.position]      壁纸定位，默认 center center
 * @param {object} [o.overrides]     逐项覆盖，如 { glass: 55 }（数字，单位 %）
 */
export function buildSkinCss({ imagePath = null, preset = "medium", position = "center center", overrides = {} } = {}) {
  const key = PRESET_ALIAS[preset] || "medium";
  const p = { ...(SKIN_PRESETS[key] || SKIN_PRESETS.medium), ...overrides };
  const pct = (v) => `${Number(v)}%`;
  const H = "html." + HOST_CLASS;

  const wpVar = imagePath
    ? `  /* 自选壁纸（file:// 直连，renderer 实测可加载，无需 base64） */\n` +
      `  --codedrobe-image-hero: url("${pathToFileURL(path.resolve(imagePath)).href}") !important;\n`
    : `  /* 未选自选壁纸 —— 沿用主题自带图，只重写遮罩与玻璃层 */\n`;

  return `/* ============================================================
   WorkBuddy 皮肤层 v2 —— 由 workbuddy-skin 注入，请勿手改
   三层结构：
     ① 壁纸层  覆盖 --codedrobe-image-hero（#root background 的第三层）
     ② 薄纱层  重写 #root 的方向性遮罩，决定壁纸"透出多少"
     ③ 玻璃层  把挡在壁纸前面的结构容器改成半透明 + 毛玻璃
   强度档位：${key}（rootX=${p.rootX}% rootY=${p.rootY}% glass=${p.glass}% content=${p.content}% blur=${p.blur}px）
   改档位：node tools/set-wallpaper.mjs intensity 淡|中|浓
   移除本层：node tools/set-wallpaper.mjs none
   ============================================================ */
${H} {
  --wb-skin-root-x: ${pct(p.rootX)};
  --wb-skin-root-y: ${pct(p.rootY)};
  --wb-skin-glass: ${pct(p.glass)};
  --wb-skin-content: ${pct(p.content)};
  --wb-skin-blur: ${p.blur}px;
  --wb-skin-wp-pos: ${position};
}

/* ① + ② 壁纸与薄纱：与主题同特异性 (1,1,1)，注入在后 → 后者胜 */
${H} #root {
${wpVar}  background:
    linear-gradient(90deg, color-mix(in srgb, var(--heige-surface) var(--wb-skin-root-x), transparent) 0 20%, transparent 46%),
    linear-gradient(180deg, transparent 0 42%, color-mix(in srgb, var(--heige-surface) var(--wb-skin-root-y), transparent) 82% 100%),
    var(--codedrobe-image-hero) var(--wb-skin-wp-pos) / cover no-repeat !important;
}

/* ③ 玻璃层：结构容器半透明 + 毛玻璃（壁纸从这里透出来） */
${GLASS_SELECTORS.map((s) => `${H} ${s}`).join(",\n")} {
  background: color-mix(in srgb, var(--heige-surface) var(--wb-skin-glass), transparent) !important;
  backdrop-filter: blur(var(--wb-skin-blur)) saturate(1.12) !important;
  -webkit-backdrop-filter: blur(var(--wb-skin-blur)) saturate(1.12) !important;
}

/* ③b 页面级外壳：清成透明。**刻意不给 backdrop-filter** ——
   满屏的祖先容器一旦拥有毛玻璃，会把整个视口的壁纸糊掉，
   还会和子层（.cr-agent__body 等）的毛玻璃叠成双重模糊。
   2026-09-24 先按玻璃面处理过，用户的评价是「越改越差」。 */
${CLEAR_SELECTORS.map((s) => `${H} ${s}`).join(",\n")} {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* 嵌套容器去重：.conversation-list 在 .conversation-sidebar 内，
   两层都半透明会叠加成更实的一块，所以内层必须放空。 */
${H} .conversation-sidebar .conversation-list {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* 内容块：保可读，只做轻微压暗，不参与毛玻璃 */
${CONTENT_SELECTORS.map((s) => `${H} ${s}`).join(",\n")} {
  background-color: color-mix(in srgb, var(--heige-surface) var(--wb-skin-content), transparent) !important;
}
`;
}

/** 兼容旧调用：只给图片路径 → 完整皮肤层（medium 档） */
export function wallpaperCss(imagePath, opts = {}) {
  return buildSkinCss({ imagePath, ...opts });
}

/** 注入或替换壁纸层 style 元素（幂等：同 id 的旧元素会被替换） */
export async function applyWallpaperCss(port, cssText) {
  return await evaluate(port, `(() => {
    const ID = ${JSON.stringify(WALLPAPER_STYLE_ID)};
    document.getElementById(ID)?.remove();
    if (!${JSON.stringify(cssText)}.trim()) return { applied: false, reason: 'empty-css' };
    const s = document.createElement('style');
    s.id = ID;
    s.textContent = ${JSON.stringify(cssText)};
    document.head.appendChild(s);
    return { applied: true, id: ID };
  })()`);
}

/** 移除壁纸层（回到主题自带壁纸） */
export async function removeWallpaperLayer(port) {
  return await evaluate(port, `(() => {
    const ID = ${JSON.stringify(WALLPAPER_STYLE_ID)};
    const el = document.getElementById(ID);
    el?.remove();
    return { removed: !!el };
  })()`);
}

/** 读回当前实际生效的皮肤层状态（用于自检，而不是靠"注入返回 true"当证据） */
export async function readWallpaperState(port) {
  return await evaluate(port, `(async () => {
    /*
     * 等样式重算后再读。
     *
     * 原实现只写「等两帧 rAF」，理由是同一同步任务里连续读写 DOM 来不及重算。
     * 但 rAF 在页面不可见时会被浏览器完全暂停 —— 而「换壁纸」这个动作发生时，
     * WorkBuddy 恰好被选择器窗口遮在后台，正是 hidden 状态。
     *
     * 后果（2026-09-18 实测）：这个 Promise 永不 resolve → 25 秒后抛
     * timeout:Runtime.evaluate → 被 set-wallpaper.mjs 误报成「CDP 不可达，
     * 下次启动生效」。而壁纸其实已经换成功了，用户看到「没生效」就去重启 ——
     * 「换个皮肤得重启」这个印象就是这么来的。
     *
     * 实测同一时刻：document.hidden=true、rAF 4.4 秒零回调，
     * 而同步 getComputedStyle 读到的值完全正确。
     *
     * 所以给 rAF 加 400ms 兜底：可见时仍走两帧（精确），不可见时也能落地。
     */
    await Promise.race([
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise(r => setTimeout(r, 400)),
    ]);
    const root = document.getElementById('root');
    const rs = root ? getComputedStyle(root) : null;
    const varVal = rs ? rs.getPropertyValue('--codedrobe-image-hero').trim() : '';
    const body = document.querySelector('.cr-agent__body');
    const glassVar = rs ? rs.getPropertyValue('--wb-skin-glass').trim() : '';
    const bg = rs ? rs.backgroundImage : '';
    /*
     * 主题层的前提：宿主类在不在 <html> 上。
     * 皮肤层所有规则都挂在它下面，它不在 = 整层静默失效 —— 必须单独读出来，
     * 否则自检只会报出一堆"果"（变量为空），真因（主题层没注入）反而看不见。
     */
    const htmlEl = document.documentElement;
    const htmlCls = String(htmlEl.className || '');
    return {
      /*
       * 用 classList.contains 而不是正则 —— 不只是更准，也是**必须**。
       *
       * 这段代码是被外层模板字符串拼出来的：反斜杠转义在到达浏览器之前就
       * 已经被 JS 吃掉一层，正则里的空白类字符会静默退化成别的样子，判据全错。
       * 2026-09-24 本人刚踩过：宿主类明明在 html 元素上，却报「主题层未注入」。
       * 要在这类拼接代码里写正则，反斜杠必须写两遍；注释里也别用反引号，
       * 它会当场终止模板字符串（同一天踩了两次）。
       */
      hostClassPresent: htmlEl.classList.contains(${JSON.stringify(HOST_CLASS)}),
      htmlClassHead: htmlCls.slice(0, 120),
      wallpaperStylePresent: !!document.getElementById(${JSON.stringify(WALLPAPER_STYLE_ID)}),
      heroVarHead: varVal.slice(0, 120),
      heroVarIsFile: varVal.includes('file:///'),
      heroVarIsBlob: varVal.includes('blob:'),
      bgLen: bg.length,
      bgTail: bg.slice(-160),
      // 三层是否真的落地
      preset: {
        glass: glassVar || '(unset)',
        rootX: rs ? rs.getPropertyValue('--wb-skin-root-x').trim() || '(unset)' : '(unset)',
        blur: rs ? rs.getPropertyValue('--wb-skin-blur').trim() || '(unset)' : '(unset)',
      },
      agentBodyBg: body ? getComputedStyle(body).backgroundColor : '(no .cr-agent__body)',
      agentBodyBlur: body ? (getComputedStyle(body).backdropFilter || '(none)') : '',
      /*
       * 遮挡采样 —— 找「覆盖大半个视口、且视觉上全不透明」的容器。
       *
       * 为什么要加这个：2026-09-24 用户报「提示已生效，但界面没变」。
       * 注入确实成功了，皮肤层 style 在位、变量也对 —— 但页面上有一个
       * 满屏 1920x1020（97.1% 视口）、rgb(20,20,20) **完全不透明**的容器
       * 把壁纸整块盖死。皮肤层那时"全绿"，用户眼里"没变"。
       *
       * 「注入成功」和「看得见」是两件事。没有这条判据，前者会一直冒充后者。
       *
       * 阈值刻意收紧到「≥50% 视口 且 alpha ≥ 0.95」：
       * 半透明的玻璃层（alpha 0.46~0.8）本来就该盖在上面，那不是故障；
       * 内容块、iframe 之类面积小、也不是背景容器，同样不该误报。
       */
      occluders: (() => {
        const vw = innerWidth, vh = innerHeight;
        const alphaOf = (col) => {
          if (!col || col === 'transparent') return 0;
          let m = col.match(/^rgba?\\(([^)]+)\\)$/);
          if (m) { const p = m[1].split(/[,\\/]/).map(s => s.trim());
            return p[3] === undefined ? 1 : parseFloat(p[3]); }
          m = col.match(/^color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)$/);
          if (m) return m[4] === undefined ? 1 : parseFloat(m[4]);
          m = col.match(/^#([0-9a-f]{3,8})$/i);
          if (m) return m[1].length >= 8 ? parseInt(m[1].slice(6, 8), 16) / 255 : 1;
          return 1;
        };
        const desc = (el) => {
          let s2 = el.tagName.toLowerCase();
          if (el.id) s2 += '#' + el.id;
          const cls = (el.className && typeof el.className === 'string')
            ? el.className.trim().split(/\\s+/) : [];
          if (cls.length) s2 += '.' + cls.slice(0, 2).join('.');
          return s2;
        };
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          if (el.id === 'root' || el.tagName === 'HTML' || el.tagName === 'BODY') continue;
          if (el.closest && el.closest('[id^="workbuddy-skin-"]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
          const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
          const pct = ix * iy / (vw * vh) * 100;
          if (pct < 50) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (alphaOf(cs.backgroundColor) < 0.95) continue;
          out.push({ sel: desc(el), areaPct: Math.round(pct), bg: cs.backgroundColor });
        }
        out.sort((a2, b2) => b2.areaPct - a2.areaPct);
        return out.slice(0, 5);
      })(),
      strayStyles: [...document.querySelectorAll('style')]
        .filter(s => String(s.textContent || '').includes('wb-skin-glass'))
        .map(s => s.id || '(anonymous)'),
    };
  })()`, { awaitPromise: true });
}

/**
 * 自检判据 —— **纯函数**，输入 readWallpaperState 的返回值，输出该报的问题与提示。
 *
 * 为什么抽出来：原来这段逻辑写在 set-wallpaper.mjs 的 applyState 里，夹在 CDP 调用
 * 与 console.log 之间，于是它**没法单独验**。2026-09-24 验证异常路径时就卡在这：
 * 想造「宿主类缺席」的故障，得先经 CDP 移除宿主类，可等下一个进程跑起来时，
 * 宿主类已经被别的东西（多半是应用自己重新 apply 主题）加回来了 —— 窗口期抓不住，
 * 报出来永远是"全过"，于是这条分支**从未被真正验过**。
 * 判据一旦不可独立验证，就等于没有判据。
 *
 * 抽成纯函数后，验证方式是直接喂合成状态、逐路断言，不依赖任何时序：
 *   · 宿主类缺席 → 必须报「主题层未注入」并给出补救指引，**且不许**报后面的果
 *   · 宿主类在但 style 丢了 / 变量为空 / 对话区不透 → 各报各的
 *   · 一切正常 → problems 为空
 *
 * @param {object} s  readWallpaperState() 的返回值
 * @param {object} [o]
 * @param {string} [o.imagePath]  本次要用的壁纸路径（有值时才有"壁纸变量是 file://"这条判据）
 * @param {string} [o.preset]     本次档位（仅用于文案，不参与判断）
 * @returns {{ problems: string[], notes: string[] }}
 */
export function checkWallpaperState(s, { imagePath = "" } = {}) {
  const problems = [];
  const notes = [];
  if (!s) {
    problems.push("拿不到页面状态（读回为空）");
    return { problems, notes };
  }

  /*
   * **先单独判「主题层在不在」，再判具体变量。这个顺序不能反。**
   *
   * 皮肤层的每一条规则都挂在 html.<HOST_CLASS> 下面；宿主类不在时，下面那几条
   * 断言会**全部**命中，报出一串「壁纸变量不是 file:// 路径」「档位变量未生效」
   * —— 全是果不是因。2026-09-24 就是这么把人引偏了一整轮：真因是 WorkBuddy
   * 走开机自启、自启项绕过了启动器，主题层从未注入；而报错读起来像
   * 「换壁纸这个功能坏了」。报错指向错方向，比不报错更费时间。
   */
  if (!s.hostClassPresent) {
    problems.push(`主题层未注入 —— 页面上没有 html.${HOST_CLASS}`);
    notes.push("皮肤层每条规则都挂在这个宿主类下面，宿主类不在 = 整层规则失去匹配对象。");
    notes.push("这是根因，不是壁纸的问题 —— 写入那一步其实成功了。");
    notes.push("");
    notes.push("补主题层：跑一次 launcher\\注入皮肤.cmd");
    notes.push("  或者：双击桌面 WorkBuddy 快捷方式（应用已在运行时，它会补注入）");
    notes.push("");
    notes.push("主题层为什么会丢：WorkBuddy 走的是开机自启（HKCU Run），");
    notes.push("  而自启项默认直接拉 WorkBuddy.exe，绕过了启动器 —— 注入从未发生。");
    notes.push("根治：node tools\\_repoint-startup.ps1（把自启项改指向启动器）");
    return { problems, notes };
  }

  if (!s.wallpaperStylePresent) problems.push("皮肤层 style 元素不存在（注入没落地）");
  /*
   * heroVarIsFile 单独看是**假阳性**判据：宿主类缺席时，主题自带的 hero 是
   * blob:file:///... 形态，里面同样含 file:///。只因上面已先行拦截宿主类缺席，
   * 这个假阳性才被遮住。所以这一条必须留在 else 分支里 —— 挪上去就会开始误报。
   */
  if (imagePath && !s.heroVarIsFile) problems.push("壁纸变量不是 file:// 路径");
  if (s.preset.glass === "(unset)") problems.push("档位变量未生效（--wb-skin-glass 为空）");
  if (/\s\/\s*1\)$/.test(s.agentBodyBg)) problems.push("对话区仍完全不透明（玻璃层没压过去）");
  const strays = (s.strayStyles || []).filter((x) => x !== WALLPAPER_STYLE_ID);
  if (strays.length) problems.push(`发现重复注入层：${strays.join(", ")}`);

  /*
   * 「注入成功」不等于「看得见」—— 这两件事必须分开判。
   *
   * 2026-09-24 用户的原话是「提示已生效，但实际上皮肤并没有变」。当时：
   * 宿主类在、style 在、变量对、档位对 —— 上面每一条都过，工具报「自检全过」。
   * 而页面上有一个满屏 97.1% 视口、rgb(20,20,20) 完全不透明的容器把壁纸盖死，
   * 用户屏幕上一像素的壁纸都没透出来。
   *
   * 这类容器随 WorkBuddy 改版、以及**切换视图**成批出现（团队网格、技能列表、
   * 定时任务……各有各的外壳），所以不能靠"把见过的类名加完"了事 ——
   * 得让自检在下次漏掉时自己喊出来。
   */
  const blockers = s.occluders || [];
  if (blockers.length) {
    problems.push(
      "有容器把壁纸挡住了：" +
        blockers.map((b) => `${b.sel}（${b.areaPct}% 面积、完全不透明）`).join("、")
    );
    notes.push("");
    notes.push("注入本身是成功的 —— 卡在「壁纸看不见」：");
    notes.push("  皮肤层的玻璃化名单（GLASS_SELECTORS）没覆盖到上面这个容器。");
    notes.push("");
    notes.push("修法：把类名加进 lib-cdp.mjs 的 GLASS_SELECTORS（结构容器清单）。");
    notes.push("  ⚠️ 这类容器是**成批**的 —— 换一个视图（技能 / 定时任务 / 资料库）");
    notes.push("  就可能冒出一个新的。加完记得再跑一遍本自检确认没有新的。");
    notes.push("");
    notes.push("想看清全貌：node tools/diag-occluders.mjs 30000 0.5");
  }

  if (!problems.length) notes.push("排查：node tools/diag-occluders.mjs 30000 0.5");

  return { problems, notes };
}
