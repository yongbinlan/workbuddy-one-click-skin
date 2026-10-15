# workbuddy-skin — WorkBuddy 换肤工程

给 WorkBuddy（腾讯 CodeBuddy 桌面端）装上「夜街 · 白吊带」主题，
并让它**每次开机自动回来**。

装一次，之后全部操作都是**双击** —— 换壁纸、调透出强度、看状态、还原原生。

---

## 快速开始

```bat
rem 1. 展开工程（把 <skill目录> 换成实际路径）
node <skill目录>\scripts\init.mjs --dest D:\my\workbuddy-skin

rem 2. 自检，14 项全绿才算装好
node D:\my\workbuddy-skin\tools\verify-launcher.mjs

rem 3. 注入皮肤（WorkBuddy 需要在运行）
双击 D:\my\workbuddy-skin\launcher\注入皮肤.cmd
```

**让皮肤每次开机自动回来**：两件事都要做 ——

1. 把桌面 / 开始菜单的 WorkBuddy 快捷方式指向
   `launcher\workbuddy-skin-launcher.vbs`。原来的快捷方式会自动备份到 `backup\`，随时可还原。
2. 在「启动」文件夹放一个补注入入口（`init.mjs` 默认就会装）：
   `tools\_install-startup-entry.ps1` 生成 `WorkBuddySkinAutoInject.vbs`，
   登录时补一次主题层注入。**只补注入、不启动 WorkBuddy** ——
   要不要开机自启是用户的决定。

> 初始化脚本会探测本机路径、生成壁纸选择器（含带图标的入口）、构建并打包主题、补齐四张默认壁纸。
> 主程序装在非标准路径也能识别；识别不到就加 `--app "C:\...\WorkBuddy.exe"` 指定一次。
> **它不会去改 WorkBuddy 自己的开机自启项** —— 那条由应用每次启动重写，改了也留不住（见「架构」一节）。

---

## 前置条件

| 项 | 要求 |
|---|---|
| 系统 | **Windows**（依赖 `.cmd` / `.vbs` / `.hta` / `.lnk`） |
| Node.js | **≥ 22.4** |
| WorkBuddy | 已安装的桌面端 |
| CodeDrobe CLI | `npm install --prefix "%USERPROFILE%\.workbuddy\tools\codedrobe" @codedrobe/core` |

> Node 版本不是随便定的：主题打包交给上游 `@codedrobe/core`，它声明
> `engines.node >= 22.4`。Node 18/20 能跑本工程的脚本，但走到 `theme pack` 会失败。

---

## 日常使用（全部双击）

| 想做什么 | 双击什么 | 也可以 |
|---|---|---|
| 注入皮肤（装完必做一次） | `launcher\注入皮肤.cmd` | — |
| **换壁纸**（有缩略图） | `launcher\壁纸选择器.lnk`（带图标） | `launcher\壁纸选择器.hta` 是程序本体，双击亦可 |
| 换壁纸（列表版） | `launcher\换壁纸.cmd` | 把图片**拖到它图标上** → 收进库并立刻启用 |
| 调壁纸透出强度 | `launcher\调强度.cmd` | 按 1/2/3 选淡 / 中 / 浓 |
| 看当前状态 | `launcher\查看状态.cmd` | — |
| 还原成原生外观 | `launcher\还原原生.cmd` | — |

> ⚠️ **`.cmd` / `.hta` 都得「双击」，单击只是选中。**
> 这曾经造成一次误判「点了换壁纸没反应」—— 文件被单击选中（蓝色高亮 + 右侧预览窗格），
> 脚本其实一行都没跑。

---

## 目录结构

```
<工程根>\
├── launcher\                  ← 唯一需要接触的目录（全部双击）
│   ├── 注入皮肤.cmd / 换壁纸.cmd / 调强度.cmd / 查看状态.cmd / 还原原生.cmd
│   ├── 壁纸选择器.lnk          （生成物；带项目图标的入口 —— 双击这个）
│   ├── 壁纸选择器.hta          （生成物；程序本体。文件图标由 Windows 扩展名关联决定，
│   │                            与内容无关，所以它显示的是系统默认 HTA 图标 —— 正常）
│   ├── workbuddy-skin-launcher.vbs    ← 常驻启动器（快捷方式指向它）
│   ├── env.cmd                （生成物；本机路径，换机器要重生成）
│   └── 使用说明.txt
├── tools\                     ← 全部脚本
├── themes\<主题>\             ← 主题源（改配色改这里）
│   └── assets\legacy-skin-workbuddy.css   ← 四个核心色在 --heige-* 段
├── build\                     ← 主题包产物
├── wallpapers\                ← 壁纸库 + current.json
├── backup\                    ← 原始快捷方式的备份（还原用）
└── logs\                      ← 运行日志
```

> 第五个入口**不在工程目录里**：per-user「启动」文件夹下的
> `WorkBuddySkinAutoInject.vbs`（由 `tools\_install-startup-entry.ps1` 生成）。
> 放在那里是因为**应用不管这个位置** —— `HKCU\...\Run` 那条会被应用每次启动重写。

---

## 架构

```
四个入口，分两类：

```
A) 「启动应用 + 注入」这一路（三处快捷方式都指向它）
  ├─ 桌面 / 开始菜单 / 任务栏快捷方式（三处 .lnk 均指向它）
        └─> wscript.exe + workbuddy-skin-launcher.vbs      （无窗口，零闪烁）
               ├─ 步骤 1：确保应用已启动 —— sh.Run WorkBuddy.exe
               │           ↑ 不依赖 node / launcher.mjs / CDP
               └─ 步骤 2：node tools/launcher.mjs --no-launch   （纯增强层，干完即退）
                            ├─ 等 CDP 端口就绪
                            ├─ 等 renderer landmark 就绪
                            ├─ codedrobe apply --no-launch       （注入主题）
                            ├─ codedrobe verify                  （主题自检）
                            └─ 应用皮肤层：壁纸 + 薄纱 + 玻璃     ← 必须在 apply 之后

B) 「只补注入、不启动应用」这一路（登录时的兜底）
  └─ 「启动」文件夹：WorkBuddySkinAutoInject.vbs（per-user Startup）
        └─> node tools/launcher.mjs --no-launch             （同上，只是不拉起应用）
```

**为什么 B 要单独一条，且刻意不启动应用**：注入只活在 renderer 内存里，重启必丢。
用户可能根本不开机自启 —— 那时 A 整条都不跑，只有 B 能在登录后补上。
但反过来，把一个"拉起 WorkBuddy"的入口塞进登录项，等于**替用户把他关掉的
开机自启又打开**。要不要开机自启是用户的决定。

### 皮肤层为什么必须排在主题之后

皮肤层（`tools/lib-cdp.mjs` 的 `buildSkinCss`）与 CodeDrobe 注入的主题 style
**选择器同特异性**，靠「谁在文档里靠后谁生效」取胜：

- 顺序对了 → 玻璃层压过主题给 `.cr-agent__body` 的 90% 不透明底色，壁纸透出来
- 顺序反了 → 被主题的 90% 压回去，表现为**「壁纸怎么都看不见」**

同理，还原时也要**先撤皮肤层再撤主题**，否则原生界面上会剩一层玻璃。

### 为什么「启动应用」和「注入皮肤」必须分开

最初的实现是 `vbs → node → node 判断并 spawn 应用`。这在**替换启动入口之后**是不可接受的
单向门：一旦 node 或 `launcher.mjs` 损坏，用户就**双击不开 WorkBuddy 了**。

拆开之后：

| 故障 | 结果 |
|---|---|
| node 不存在 / 版本目录被换掉 | 应用正常启动，日志记 `SKIN SKIPPED`，只是没皮肤 |
| `launcher.mjs` 语法错误 / 崩溃 | 同上 |
| 主题包被删 | 应用正常启动，日志记「主题包缺失，跳过注入」（退出码 2） |
| CDP 端口未就绪 | 应用正常启动，只是没注入（退出码 5） |

**皮肤层的任何故障，最坏结果都只是「没皮肤」，绝不影响应用可用性。**

### 为什么不做守护进程

WorkBuddy 的 `supportsControlChannel` 与 CodeDrobe 的 `host.supported` **都是 false** ——
官方不存在「常驻主题」钩子，注入只活在 renderer 内存里，重启必丢。所以「持久」只有三条路：

| 方案 | 结论 |
|---|---|
| 改 `app.asar` 内资源 | ❌ 禁止。破坏包完整性、升级失效 |
| 常驻守护 + `apply --watch` 轮询 | ⚠️ 可行但留常驻进程 |
| **启动器：启动后注入一次，即退** | ✅ **采用**。零常驻、零轮询 |

前提是应用自带 CDP 通道（用户级环境变量 `WORKBUDDY_REMOTE_DEBUGGING_PORT`）。
启动器要做的只是「等就绪 + 注入」。

### 为什么不用 WorkBuddy 自己的开机自启项

上面 A 那条链路有一个**没画在图里的前提**：开机启动必须经过桌面快捷方式。

WorkBuddy 自带「开机自启」，它在
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 里写一条
`WorkBuddy.WorkBuddy`，值**直接指向 `WorkBuddy.exe`** ——
开机那条路径**根本不经过 vbs 启动器**，注入从未发生。

它的症状很有欺骗性，因为**坏掉的是主题层，而报错的却是壁纸**：

| 看起来正常的 | 实际发生的 |
|---|---|
| 工具报「已注入」 | 皮肤层 `<style>` **插进 `document.head` 就算成功**，工具不检查它是否生效 |
| CDP 端口通、探针连得上 | 端口来自**用户级环境变量**，谁拉起应用都通，跟注入无关 |
| 日志没有报错 | 皮肤层每条规则都挂在 `html.codedrobe-host-workbuddy` 下面，宿主类不在，**整层静默失去匹配对象** |

所以判据只有一个：**看 `logs\launcher.log` 有没有当次记录**（或看页面上有没有那个宿主类）——
不是看 CDP 通不通，也不是看工具说没说自己成功。

#### 曾经试过「接管」它，失败了 —— 这段留着是为了别再来一次

2026-09-24 的做法：把那条 Run 项的值**改指向我们的启动器 vbs**，并特意**值名不动**，
理由是「让 WorkBuddy 以为自启还开着，别又多建一条造成双开」。
原值留档成 `backup\hkcu-run-*.original.json`，`_repoint-startup.ps1 -Rollback` 可复原。

**2026-09-29 同一故障原样复发。** 查应用自己的代码
（`src/main/features/desktop-host/auto-launch-controller.ts`）才看清：

```
每次应用启动：
  reconcileOnStartup() → getEnabled()
      if (desired === false) → 关闭并返回
      if (desired === true || settings.openAtLogin === true)   ← 我们保留值名 = 命中这里
      ... 默认开启分支 ...
      → enableCurrentBundleAutoLaunch() → app.setLoginItemSettings({ openAtLogin: true })
```

三条分支**殊途同归**，全落到同一次写入；Windows 上它把那条 Run 值写回**应用自己的 exe**。
**每次启动都重写一遍。**

而「保留值名」正是**重写条件之一**：`getLoginItemSettings()` 读到值在，
`openAtLogin` 就是 `true`。当年那条理由正好说反了 ——
保留值名不是「让应用别动它」，而是**每次开机都主动请它改回来**。

> **教训**：接管一个**由对方程序维护**的配置项之前，先去读对方的代码，
> 看它**读到这个值时做什么**。「读到 true」不等于「什么都不做」——
> 很可能是「确保它是 true，并按自己的理解写一遍」。

#### 所以现在放在应用管不着的地方

| 位置 | 谁管 | 我们的做法 |
|---|---|---|
| `HKCU\...\Run` | **应用自己** | 只体检与还原，**不再改指向**（`tools\_repoint-startup.ps1`） |
| per-user **「启动」文件夹** | **我们** | 装补注入入口（`tools\_install-startup-entry.ps1`） |

`_repoint-startup.ps1` 现在的语义是「体检 + 把老版本留下的痕迹还原给应用」：
**无备份不猜值**（报 `RESTORE-NO-BACKUP`）、**名字不匹配不还原**（报 `RESTORE-NAME-MISMATCH`）。

另外，换壁纸时 `set-wallpaper.mjs` 读到页面上没有宿主类会**先自动补注入**
（`tools\ensure-theme.mjs`），再把皮肤层重新放一遍 —— 补注入在后，
同特异性靠"谁在后谁赢"。


### 为什么「注入成功」不等于「看得见」

这是本项目最容易自欺的一处，2026-09-24 被用户一句话点破：
**「提示已生效，但实际上皮肤并没有变。」**

当时的状态：宿主类在、皮肤层 `<style>` 在、壁纸变量是 `file://`、档位变量也对 ——
自检**每一条都过**，工具报「已生效」。而屏幕上有一个
`div.teams-grid-scroll-content`：**1920×1020 = 97.1% 视口、`rgb(20,20,20)` 完全不透明**，
把 `#root` 上的壁纸整块盖死。用户一个像素都没看到。

它为什么躲得过所有检查：

| 检查项 | 为什么没抓到 |
|---|---|
| 「注入成功」 | `applyWallpaperCss` 只把 `<style>` 插进 head，**不检查是否可见** |
| 「变量对不对」 | 变量完全正确 —— 壁纸画在 `#root` 上，只是被别人的背景盖住了 |
| 「玻璃层生效没」 | 生效了。`.cr-agent__body` 等**在名单里**的容器都被压成半透明 |
| 遗漏 | 那个容器**不在玻璃化名单里** —— 名单是实测出来的，而它是随版本/视图**新出现**的 |

于是加了一条自检判据（`checkWallpaperState` 的 `occluders`）：采样"覆盖 ≥50% 视口
且 alpha ≥0.95"的容器，有就报出来，并指出该改哪里。阈值刻意收紧 ——
半透明的玻璃层本来就该盖在上面，那是设计不是故障。

**但"报出来之后怎么改"，第一版就改错了。** 那个容器被直接加进了 `GLASS_SELECTORS`
（半透明 + 毛玻璃），结果用户回了一句：**「有是有，完全看不出来……怎么越改越差」**。

原因：容器分两类，处理方式**相反**。

| 类型 | 例子 | 怎么处理 | 搞错的后果 |
|---|---|---|---|
| **结构面**（薄薄一片） | `.cr-agent__body`、侧栏、输入框 | 半透明 + 毛玻璃（`GLASS_SELECTORS`） | 太实，壁纸透不出来 |
| **页面级外壳**（整屏） | `.teams-grid-scroll-content` | **清成 `transparent`，且不给毛玻璃**（`CLEAR_SELECTORS`） | 满屏的**祖先**容器一旦有毛玻璃，会把**整个视口**的壁纸糊掉，还和子层（`.cr-agent__body`）自己的毛玻璃叠成**双重模糊** |

判据看**面积**就够了：占满视口的是外壳（它本来就不该有底色，清掉即可）；
只占一块的是结构面（它需要一点底色才压得住内容）。

门禁里有一条专门锁死这一点：外壳只能出现在 `CLEAR_SELECTORS`、必须 `transparent`、
且**不许启用** `backdrop-filter`。（写这条断言时还踩了两个小坑：只查
`includes("backdrop-filter")` 会把正解里的 `backdrop-filter: none` 判成错的；
改用 `\s*(?!none)` 也不行 —— `\s*` 能回溯成 0 个空格，`(?!none)` 检的其实是空格。
最后改成把值取出来逐个判。）

**这类容器是成批的**：切到「技能 / 定时任务 / 资料库」任何一个视图，都可能冒出一个
新的全屏外壳。所以修法不是"把见过的类名加完"，而是让自检在下次漏掉时自己喊。

顺手修的第二个陷阱，同一类性质 —— **验证通道本身会说谎**：

> `tools/shot.mjs` 用 CDP `Page.captureScreenshot` 截图，拿的是**合成器的当前帧**。
> 目标窗口不在前台时（被别的窗口遮住 / 最小化），Chromium 不为新一帧做合成，
> 于是返回**过期画面**；而 DOM 查询永远是实时的。
> 排查当天就撞上了：探针说「覆盖屏幕中点且不透明的元素只有 `#root`（已临时改成纯红）」，
> 可截图里那一点是深色 —— 两张图对不上，一度被带到 `backdrop-filter` 上去。
> 现在 `shot.mjs` 在截图前先 `Page.bringToFront` 并等约 1 秒。
>
> **代价只有一秒，但"到底看没看见"这件事全靠这条通道。**

---

## 自定义壁纸与透出强度

### 三层结构

换壁纸不是「换张图」那么简单 —— 壁纸画在 `#root` 的 `background` 上，
而它上面盖着一堆不透明容器。所以皮肤层是**三层一起下**：

| 层 | 作用 | 手段 |
|---|---|---|
| ① 壁纸层 | 换图 | 覆盖 `--codedrobe-image-hero`（`#root` background 的第三层） |
| ② 薄纱层 | 决定壁纸「透出多少」 | 重写 `#root` 的两个方向性遮罩 |
| ③ 玻璃层 | 让挡路的容器透光 | 结构容器降不透明度 + `backdrop-filter: blur()` |

三层共用一个档位，所以换图和调观感都是**一条命令**。

### 档位

| 档 | 遮罩 X/Y | 结构面 | 内容面 | 毛玻璃 | 适用 |
|---|---|---|---|---|---|
| **淡** `light` | 56% / 42% | 46% | 80% | 22px | 氛围优先，壁纸最抢眼 |
| **中** `medium`（默认） | 74% / 60% | 62% | 88% | 18px | 日常挂后台干活 |
| **浓** `strong` | 90% / 78% | 80% | 92% | 12px | 看代码、审 diff |

### 为什么不把内容面也调透

**结构面可以糊，内容面不能糊。** 代码块、diff、工具卡片如果跟着壁纸一起透，
文字就会糊在墙上，皮肤越好看看起来越没法干活。所以这三类保持 80~92% 不透明，
不参与毛玻璃 —— 这是换肤唯一不能破的底线。

### 为什么不用 base64、不重打包

renderer 是 `file://` 协议、CSP 为 `null`，**实测能直接加载本地图片**。所以：

| 做法 | 代价 | 结论 |
|---|---|---|
| 图片 base64 进 CSS + 重打包主题 | 每换一张图就要重建、重打包、重新 apply | ❌ |
| 改 `theme.json` 的 `images.hero` | 同上，且要过 CodeDrobe 的 pack | ❌ |
| **注入一条 targeting `#root` 的规则** | 秒级、不打包、不重启、可一键撤销 | ✅ **采用** |

### 壁纸库的语义

**每收一张就多一张，旧的一张不动。**

想清理用 `node tools\set-wallpaper.mjs prune` —— 它只留当前那张，其余**移进归档目录**
（可逆），不是删除。

### 关闭语义

「还原原生」写的是**禁用标记**（`{"disabled": true}`），而不是删记录文件。
删了的话启动器下次会当成「从未配置」并默认装回玻璃层，用户看到的是「关了又自己回来」。

---

## 图形化壁纸选择器（HTA）

**为什么是 HTA**：Windows 原生（`mshta.exe`）、双击即开、能跑 `ActiveXObject`
（读目录 / 跑 node）、能显示缩略图，且**不依赖 node**（node 坏了界面照样能开，只是换不了图）。

**核心设计 —— 产物必须是纯 ASCII。** HTA 跑在 MSHTML（IE 内核），
而 MSHTML 对 `<meta charset>` 缺失时的解码行为不可控。所以走「**模板 + 生成器**」两步：

```
tools/picker.template.hta        正常写中文（可读、可维护）
        │  node tools/build-wallpaper-picker.mjs
        │  ① 所有非 ASCII → \uXXXX 转义
        ▼
launcher/壁纸选择器.hta          纯 ASCII 产物（中文字符数以转义形式存在）
```

无论 MSHTML 按哪种编码解析，**纯 ASCII 的结果都一样** —— 从根上绕开编码坑。

### 选图：主入口就是资源管理器自己的那个框

第一版用 `Shell.Application.BrowseForFolder`（Windows 自带的选文件夹框）让用户直接点中一张图。
**它能用，但看不见图** —— 那个框是 XP 时代的 `SHBrowseForFolder`，只列文件名、不画缩略图，
而挑壁纸恰恰是「看图」的活。而且它内部还互斥：让它能点中文件（`BIF_BROWSEINCLUDEFILES 0x4000`），
就不能同时升到新式外观（`BIF_NEWDIALOGSTYLE 0x40` —— 新式会忽略前者）。

**「系统对话框看不见图」这句话后来被证明说过头了** —— 问题出在**用的是哪一个**。
Vista+ 的通用对话框（`IFileOpenDialog`，也就是资源管理器自己弹的那个框）
有缩略图、有左侧导航、有搜索；只是从 HTA 里拿不到它。

所以主入口现在就是它：点 **「用资源管理器选…」**，由 PowerShell
（WinForms 的 `OpenFileDialog` 开 `AutoUpgradeEnabled`）弹出那个新框，挑一张直接换上。
旁边**并列**一个 **「在界面里翻…」**，走界面自带的图片浏览器：当前这一层的文件夹和图片
一起铺成缩略图网格，点文件夹进去、点图片换上，状态行给
「上一级 / 换个位置 / 返回壁纸库」，并记住上次挑图的位置。

两条路不是主备关系（"挑一个文件"与"成排看缩略图"是两种需求），
但兜底那一面是真的：**「用资源管理器选…」被安全策略拦住时，界面会立刻切到
「在界面里翻…」**，照样挑得到图。老的那个 `BrowseForFolder` 入口本轮**整个删掉了** ——
摆着两个"系统对话框"，用户只会点到错的那一个。

**「在界面里翻…」有两个会让人以为「按钮坏了」的坑（2026-09-18 修）**：

1. 起点记忆原先会把**壁纸库目录自己**记成"上次挑图的地方"（旧版自检写的，
   而且自检不还原）→ 点它跳进去，看到的图和壁纸库视图**一模一样**；
2. 已经在这一层翻的时候再点它，本来就是原地踏步（重绘同一个目录，画面不变）。

现在：壁纸库目录**不记也不认**（历史脏值会自愈，不用手工清文件）；
浏览态点它 = 回到「换个位置」那一屏。另外 `last-dir` 的读写原先**字符集不对称**
（写 ANSI、读 UTF-8），路径含中文时记忆静默失效 —— 现已两端统一 ANSI。

---

## 两条必须守的编码铁律（都是踩出来的）

**铁律一：`.cmd` 必须是 GBK 无 BOM + CRLF 行尾。**

| 维度 | 错了会怎样 |
|---|---|
| 编码 | 中文满屏乱码 —— **不报错**，只是没法读 |
| 行尾（写成裸 LF） | **cmd 会把注释和 echo 残片当命令执行**，双击弹一串「不是内部或外部命令」 |

行尾这一条发现得晚：当时 5 个 cmd 全是裸 LF，报错原文如 `'给出口。少了这一行...'`、`'/p'`
—— 此前双击一直是坏的。中文看着完全正常，**只有在字节层才看得见缺了 `0x0D`**。

规范化用 `tools\_fix-cmd.ps1`（GBK + CRLF 双归一，幂等，写完回读验证）。
自检第 7 项做**字节级裸 LF 断言**（逐字节找 `0x0A` 且前一个不是 `0x0D`）防复发。

**铁律二：`.ps1` / `.vbs` 自己必须纯 ASCII。**

连中文路径都不能写进去 —— 目录靠枚举拿，不硬编码。PowerShell 5.1 在 `.ps1` 无 BOM 时
按 ANSI 解析，脚本里出现非 ASCII 字节会**自己坏掉**（不是读不对，是整段语法错误）。

> 真实案例：诊断脚本里写了中文 marker 文本，而文件按 `"ascii"` 写 →
> 非 ASCII 被按位截断产生 NUL → 整段脚本语法错误 → 表现「什么都没跑」，
> 看起来像产物坏了。**打桩文本一律纯 ASCII。**

> ⚠️ 还有些环境里 PowerShell 不回传 stdout（退出码 0 但零输出），
> 所以脚本都把结果写进 `logs\*.log`。
> **退出码 0 不等于成功 —— 必须读日志。**

---

## 产物可移植性

**工程里没有任何一处写死绝对路径。** 产物要能整体搬走、换机器还能用，
所以路径全部**运行时从自身位置推导**：

| 载体 | 怎么推导自身位置 |
|---|---|
| `.hta` | `document.location.href`（要对空格/中文做百分号解码） |
| `.cmd` | `%~dp0`；上一级用 `for %%I in ("%~dp0..") do set "ROOT=%%~fI"` |
| `.vbs` | `WScript.ScriptFullName` → 取两次父目录 |
| `.ps1` | `$PSScriptRoot` |
| `.mjs` | `import.meta.url` |

**推导不出来的东西用 env 桥接**：node 解释器与 WorkBuddy 主程序的位置无法从工程位置推出，
由 `tools\write-env.mjs` 探测后写进 `launcher\env.cmd`，`.cmd` / `.vbs` / `.hta` 三方统一读它。

> 反模式：构建时把绝对路径**注入**模板（替换 `__ROOT__` 之类占位符）。
> 那正是「产物被绑死在生成它的那台机器上」的根因。

**换机器 / 挪目录之后**：重跑一次 `init.mjs --upgrade` 即可，`env.cmd` 会按新机器重新生成。

---

## 升级已有工程

```bat
node <skill目录>\scripts\init.mjs --dest <已有工程> --upgrade
```

分界线只有一条：**代码刷成新版，用户的东西一律不动。**

| 覆盖 | 保留 |
|---|---|
| `tools\**`、`launcher\**` | `themes\**`（用户可能改过配色） |
| | `wallpapers\` `backup\` `logs\` |
| | `env.cmd`、`README.md`、`使用说明.txt` |

`--force` 与 `--upgrade` 是两件事：前者**补缺口**（不覆盖任何已有文件），
后者**换实现**（把代码刷成新版）。

---

## 排障

| 现象 | 怎么办 |
|---|---|
| 双击 `.cmd` 满屏「不是内部或外部命令」 | 编码或行尾不对 → 跑 `tools\_fix-cmd.ps1` |
| 快捷方式点了没反应 | 跑 `node tools\verify-launcher.mjs --only=1`；重跑 `node tools\write-env.mjs` |
| 提示「主题包不存在」 | `build\` 下没有 `.codedrobe-theme` → 重跑 `init.mjs --upgrade` |
| 皮肤注入了但界面没变 | `node tools\cdp-probe.mjs` 看 `targets` 数量（可能打到了另一个窗口） |
| 换壁纸后看不见壁纸 | 档位调到「淡」，或跑 `node tools\diag-occluders.mjs` |
| 重启后皮肤没了 | ① 快捷方式没指向启动器 → 按「快速开始」重新指向；② 「启动」文件夹的补注入入口没装 → `powershell -File tools\_install-startup-entry.ps1` |
| 换壁纸报「已注入，但自检说主题层未注入」 | 开机这一路绕过了启动器 → 先 `注入皮肤.cmd` 当场补上，再装开机入口（同一行） |
| 壁纸选择器打开是空的 | 壁纸库还没图 → 用 `换壁纸.cmd` 拖一张进去 |
| 找不到 WorkBuddy 主程序 | `init.mjs --app "C:\...\WorkBuddy.exe"` 指定一次 |

**通用第一步**：

```bat
node <工程>\tools\verify-launcher.mjs
```

14 项自检，会直接告诉你哪一环坏了。

---

## 想改成自己的皮肤

1. 改 `themes\<主题>\assets\legacy-skin-workbuddy.css` 里的 `--heige-*` 令牌值
2. `node tools\build-theme.mjs` —— 重新生成主题 CSS（产物会自报规则块数 / 令牌数）
3. `node tools\run-codedrobe.mjs theme pack <工程>\themes\<主题>\theme.json --output <工程>\build\<id>-<版本>.codedrobe-theme`
4. `node tools\launcher.mjs` —— 注入并**看图确认**（不要只看 JSON 的 `pass: true`）
5. 视觉达标后递增 `theme.json` 的 `version`，重打包

> `theme pack` 会报几条 `long-selector` / `deep-child-chain` 警告 —— 那是选择器与 DOM
> 结构耦合的提示，**不阻塞**，属已知技术债。

想从**参考图**做一套全新主题，走 `codedrobe-theme` skill 的 reference-image 流程。
