# WorkBuddy 一键换肤

给 [WorkBuddy](https://www.workbuddy.cn)（腾讯 CodeBuddy 桌面端）换一层皮肤，**重启之后还在**。

装的过程就一条命令，装完之后日常全是双击：换壁纸、调浓淡、看状态、一键还原。
不挂常驻程序，不动 WorkBuddy 的安装文件，反悔了也能干净退回原样。

![皮肤整体效果](docs/skin-overview.jpg)

---

## 装完是什么样

一个**自带完整工程的换肤包**，外面套一个一键初始化脚本。

| | |
|---|---|
| **皮肤** | 壁纸打底 + 一层薄纱 + 一层玻璃，把原生界面压住 |
| **浓淡** | 淡 / 中 / 浓 三档，想换档双击一下 |
| **开机自己回来** | 只换掉启动入口，开机就带上你选的皮肤 —— 不占后台、不留进程 |
| **随时反悔** | 还原原生一条命令，原来的快捷方式自动备份着，能回滚 |
| **换个位置也能用** | 工程里没写死任何本机路径，整个文件夹搬走照样跑 |
| **最坏就是没皮肤** | 皮肤这块哪个环节坏掉，都只是"没皮肤"，WorkBuddy 该怎么用还怎么用 |

皮肤引擎用的是成熟的开源项目 **CodeDrobe Core**（[CodeDrobe/core](https://github.com/CodeDrobe/core)，Apache-2.0）。
本仓库做的是外面那一圈：怎么装、怎么让它在开机后自己回来、怎么随时退回原样。

---

## 一键装好

```bat
rem 1. 展开工程（把 <仓库目录> 换成你 clone 下来的路径）
node <仓库目录>\scripts\init.mjs --dest D:\my\workbuddy-skin

rem 2. 自检，13 项全绿才算装好
node D:\my\workbuddy-skin\tools\verify-launcher.mjs

rem 3. 注入皮肤（WorkBuddy 需要在运行）
双击 D:\my\workbuddy-skin\launcher\注入皮肤.cmd
```

**还想让皮肤每次开机自己回来**：把桌面 / 开始菜单里的 WorkBuddy 快捷方式指向
`launcher\workbuddy-skin-launcher.vbs`。你原来的那个会自动备份到 `backup\`，随时能还原。

> 初始化脚本按顺序做这些事：找到 WorkBuddy 装在哪 → 展开工程 → 生成 `env.cmd`
> → 生成壁纸选择器（连图标一起）→ 打包主题 → 装一张默认壁纸。
> 每一步都告诉你它干了什么、跳过了什么。
>
> WorkBuddy 装在比较偏的位置它也能认出来；实在认不出来，加 `--app "C:\...\WorkBuddy.exe"` 指一次。

---

## 装之前先确认

| 项 | 要求 |
|---|---|
| 系统 | **Windows** |
| Node.js | **≥ 22.4** |
| WorkBuddy | 已经装好的桌面端 |
| CodeDrobe CLI | 跑一句 `npm install --prefix "%USERPROFILE%\.workbuddy\tools\codedrobe" @codedrobe/core` |

> 刻意**不用** `npm -g` —— 免得污染全局，也免得跟别的工具抢版本。
>
> Node 这个版本要求不是随便定的：打包主题那一步是交给上游 `@codedrobe/core` 做的，
> 它要求 Node ≥ 22.4。Node 18 / 20 跑本工程其它脚本都没问题，只有打包会失败。

---

## 日常使用（全都能双击）

| 想做什么 | 双击什么 | 也可以 |
|---|---|---|
| 注入皮肤（装完必做一次） | `launcher\注入皮肤.cmd` | `node tools\launcher.mjs` |
| **换壁纸**（有缩略图） | `launcher\壁纸选择器.lnk`（带图标） | 双击 `launcher\壁纸选择器.hta` 也行，那是程序本体 |
| 换壁纸（列表版） | `launcher\换壁纸.cmd` | 把图片**拖到它图标上**，收进库并立刻换上 |
| 调壁纸浓淡 | `launcher\调强度.cmd` | 按 1 / 2 / 3 选淡、中、浓 |
| 看现在是什么状态 | `launcher\查看状态.cmd` | `node tools\set-wallpaper.mjs list` |
| 还原成原样 | `launcher\还原原生.cmd` | `node tools\set-wallpaper.mjs none` |

> ⚠️ **`.cmd` 和 `.hta` 都得「双击」，单击只是选中。**
> 这个坑害过一次 —— 有人单击之后以为"换壁纸没反应"，
> 其实只是文件被选中了（变蓝 + 右边弹出预览），脚本一行都没跑。

---

## 换壁纸

最直观的方式：双击 `launcher\壁纸选择器.lnk`（部署的时候自动生成，带项目图标）。

| 壁纸库 | 点「在界面里翻…」之后 |
|---|---|
| ![选择器](template/docs/picker.png) | ![选择器-浏览](template/docs/picker-browse.png) |

> 📷 这两张图截自**更早的版本**：那会儿窗口标题还是英文的，按钮行也不一样。
> 现在主按钮叫「用资源管理器选…」，点它弹出来的是**资源管理器自己的选图框** ——
> 有缩略图、有左侧导航、能搜索；旁边还有一个「在界面里翻…」，走界面自带的那套。
> 界面主体（缩略图网格、状态栏、档位按钮）跟截图一致。

- 一屏就能看清「壁纸库里有哪些」和「现在用的是哪张」
- 翻的时候只是**给你看**，点中哪张才真收哪张进去 —— 不会把一整个文件夹全倒进来
- 选图有两条路，是**并列**的，不是主备。
  「**用资源管理器选…**」用的是系统那个通用选图框（缩略图 / 左侧导航 / 搜索 / 最近位置都齐），
  更顺手；「**在界面里翻…**」是界面自带的浏览器 —— 前一个被安全策略拦住的时候，它照样能挑到图
- 翻到哪一层，那层的**文件夹和图片一起列出来**；状态行上有「上一级 / 换个位置 / 返回壁纸库」
- 有个小地方专门修过：起点**不会**记成"壁纸库目录"自己。
  已经在这一层翻的时候再点那个按钮，等于回到"换个位置"那一屏 ——
  免得停在一个跟壁纸库长得一模一样的目录里，让人以为按钮坏了
- 这个窗口**不依赖 node** —— node 坏了，它照样能开

---

## 三档浓淡

| 档 | 什么时候用 |
|---|---|
| **淡** | 氛围优先，壁纸最抢眼 |
| **中**（默认） | 日常挂在后台干活 |
| **浓** | 看代码、审 diff |

| 淡 | 中 | 浓 |
|---|---|---|
| ![淡档](docs/skin-light.jpg) | ![中档](docs/skin-medium.jpg) | ![浓档](docs/skin-strong.jpg) |

> 上面几张是整屏截图，**左边的会话列表和中间的正文区做过模糊处理** ——
> 原图里有私人对话和个人项目名，不适合公开。
> 另外，代码块 / diff / 工具卡片**不跟着变淡**，三档下都保持足够不透明 ——
> 皮肤再好看，也不能拿可读性去换。

---

## 仓库里有什么

```
.
├── SKILL.md                  ← 给 AI Agent 读的操作手册（人也能看）
├── scripts\
│   └── init.mjs              ← 一键初始化：展开工程 + 探测本机 + 生成产物
├── template\                 ← 展开到用户机器上的工程模板（38 个文件）
│   ├── launcher\             ← 你唯一需要碰的目录（全是双击）
│   ├── tools\                ← 全部脚本
│   ├── themes\               ← 主题源（改配色改这里）
│   ├── README.md             ← 工程侧完整说明（设计取舍都写在这儿）
│   └── docs\                 ← 界面实拍
└── docs\                     ← 本 README 用的展示图（已脱敏）
```

展开到你自己机器上之后长这样：

```
<工程根>\
├── launcher\     注入皮肤.cmd / 换壁纸.cmd / 调强度.cmd / 查看状态.cmd / 还原原生.cmd
│                 壁纸选择器.lnk（生成物，带图标）+ 壁纸选择器.hta（程序本体）
│                 workbuddy-skin-launcher.vbs + env.cmd（生成物）
├── tools\        全部脚本
├── themes\       主题源和素材
├── build\        打包出来的主题
├── wallpapers\   壁纸库 + current.json
├── backup\       原始快捷方式的备份（还原用）
└── logs\         运行日志
```

---

## 升级已有的工程

```bat
node <仓库目录>\scripts\init.mjs --dest <已有工程> --upgrade
```

分界线只有一条：**代码刷成新版，你自己的东西一个不动。**

| 覆盖 | 保留 |
|---|---|
| `tools\**`、`launcher\**` | `themes\**`（你可能改过配色） |
| | `wallpapers\` `backup\` `logs\` |
| | `env.cmd`、`README.md`、`使用说明.txt` |

`--force` 和 `--upgrade` 是两件事：前者**补缺口**（已有的文件一个都不覆盖），
后者**换实现**（把代码刷成新版）。换了机器或者挪了目录，也要跑一次 `--upgrade`，
`env.cmd` 会照新机器重新生成。

---

## 出问题了怎么办

| 现象 | 怎么办 |
|---|---|
| 双击 `.cmd` 满屏「不是内部或外部命令」 | 编码或行尾不对 → 跑 `tools\_fix-cmd.ps1` |
| 快捷方式点了没反应 | 跑 `node tools\verify-launcher.mjs --only=1`；再跑一遍 `node tools\write-env.mjs` |
| 提示「主题包不存在」 | `build\` 下面没有 `.codedrobe-theme` → 重跑 `init.mjs --upgrade` |
| 皮肤注入了但界面没变 | 跑 `node tools\cdp-probe.mjs` 看 `targets` 数量（可能是打到另一个窗口上了） |
| 换了壁纸却看不见壁纸 | 把档位调到「淡」，或者跑 `node tools\diag-occluders.mjs` |
| 重启之后皮肤没了 | 快捷方式没指向启动器 → 照「一键装好」重新指一次 |
| 壁纸选择器打开是空的 | 壁纸库里还没图 → 用 `换壁纸.cmd` 拖一张进去 |
| 找不到 WorkBuddy 装在哪 | `init.mjs --app "C:\...\WorkBuddy.exe"` 指一次 |

**不管什么毛病，先跑这一条**：

```bat
node <工程>\tools\verify-launcher.mjs
```

13 项自检，会直接告诉你哪一环坏了。

闲时不必全跑 —— 第 6 / 9 / 10 / 11 项会动真实环境（临时改主题包名、重建选择器、
拉起界面、真跑一遍 `.cmd`）。哪一环坏了就单跑哪一项，快，而且动静最小：

```bat
node <工程>\tools\verify-launcher.mjs --list              rem 看各项编号
node <工程>\tools\verify-launcher.mjs --only=1,7          rem 只跑第 1、7 项
node <工程>\tools\verify-launcher.mjs --only=1,2,3,5,7,8,12   rem 只做静态检查
```

---

## 想改成自己的皮肤

1. 改 `themes\<主题>\assets\legacy-skin-workbuddy.css` 里的 `--heige-*` 值
2. `node tools\build-theme.mjs` —— 重新生成主题 CSS
3. `node tools\run-codedrobe.mjs theme pack <工程>\themes\<主题>\theme.json --output <工程>\build\<id>-<版本>.codedrobe-theme`
4. `node tools\launcher.mjs` —— 注入，然后**用眼睛看图确认**（别只看 JSON 里的 `pass: true`）
5. 看着满意了，把 `theme.json` 里的 `version` 加一，重新打包

想照着一张**参考图**做一整套新主题，走 [CodeDrobe Theme](https://github.com/CodeDrobe/core) 的
reference-image 流程。

---

## 出处与许可

Copyright 2026 蓝晟硕（大硕）。本仓库以 [Apache-2.0](LICENSE) 授权。

- 皮肤引擎：[**CodeDrobe Core**](https://github.com/CodeDrobe/core) v0.6.1（Apache-2.0）
  —— 这是**运行期依赖**，要你自己装（见「装之前先确认」），本仓库不含它的源码
- 本仓库：外面那一圈工程（启动入口、壁纸选择器、主题打包、路径探测、自检、排障）
- 随附主题「夜街」的素材和配色是本项目自制的，含 `assets/hero.webp`。
  `template\themes\` 下的样式由本项目的 `heige-codex-skin-studio` 生成，
  **不是**从上游派生的文件 —— 只是沿用了它的 CSS 变量名和类名
  （`.cr-theme` / `--cr-*` / `--codedrobe-image-hero`），为了能互通

许可见 [`LICENSE`](LICENSE)（Apache-2.0）和 [`NOTICE`](NOTICE)（出处与商标声明）。

想看得更深 —— 设计上怎么取舍、踩过哪些坑 —— 见 [`template\README.md`](template/README.md)
和 [`SKILL.md`](SKILL.md)。
