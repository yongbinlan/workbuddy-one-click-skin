/**
 * lib-startup-report.mjs — 把 tools\_repoint-startup.ps1 的英文输出读成结构化结果。
 *
 * 为什么单独一个文件、为什么是纯函数：
 *
 *   1. 那个 .ps1 必须是**纯 ASCII** —— PowerShell 5.1 在无 BOM 时按 GBK 解析，
 *      文件里的中文会坏掉路径（本工程为此专门写过说明）。所以"翻译"只能在
 *      JS 这一侧做。
 *   2. 翻译错了，用户看到的结论**正好是反的**：2026-09-24 实测过一次 ——
 *      注册表里明明躺着我们写的启动器路径，脚本却报 NONE（没有自启项），
 *      于是 init.mjs 会告诉用户「开机不会绕过启动器，无需处理」。
 *      结论对不上事实，比不报还糟。
 *   3. 抽成纯函数才能被单独喂样本断言。原来这段逻辑埋在一堆 console.log
 *      中间，而它外面还裹着「spawn powershell」—— 在受限环境里子进程起不来，
 *      于是这条分支**从来跑不到**，也就从来没被验过。同一课今天已经上过一次：
 *      自检判据因为没法独立验证，有一条分支写了很久没人发现是死的。
 */

/**
 * @param {string} raw  _repoint-startup.ps1 的 stdout + stderr 原文
 * @returns {{
 *   kind: "none" | "found" | "unparsed",
 *   found: { name: string, value: string, alreadyOurs: boolean }[],
 *   repointed: { name: string, confirmed: boolean }[],
 *   alreadyOurs: string[],
 *   changed: number | null
 * }}
 */
export function parseStartupReport(raw) {
  const text = String(raw || "");

  const found = [];
  for (const m of text.matchAll(/^FOUND name=(\S+) value=(.*)$/gm)) {
    // (.*) 会把行尾的 \r 一起吃进来（ps1 的输出是 CRLF），所以必须 trim
    const value = m[2].trim();
    found.push({
      name: m[1],
      value,
      alreadyOurs: /workbuddy-skin-launcher\.vbs/.test(value),
    });
  }

  const repointed = [];
  for (const m of text.matchAll(/^REPOINTED name=(\S+) nowPointsAtOurVbs=(\w+)/gm)) {
    repointed.push({ name: m[1], confirmed: m[2].toLowerCase() === "true" });
  }

  const alreadyOurs = [];
  for (const m of text.matchAll(/^ALREADY-OURS name=(\S+)/gm)) alreadyOurs.push(m[1]);

  const cm = text.match(/^CHANGED (\d+)/m);

  /*
   * 三种 kind 必须互斥且穷尽：
   *   none     —— 明确说了 NONE，这台机器没有指向 WorkBuddy 的自启项
   *   found    —— 读到了至少一条
   *   unparsed —— 两个标记都没有：说明不是"没有"，而是**没读懂**
   *
   * unparsed 绝不能并进 none。把"没读懂"当成"没有"，正是上面那类
   * "结论与事实相反"的来源。调用方对它的处理是「原样打印 + 报错」，
   * 而不是「安静地当作无事发生」。
   */
  let kind = "unparsed";
  if (/^NONE/m.test(text)) kind = "none";
  else if (found.length) kind = "found";

  return { kind, found, repointed, alreadyOurs, changed: cm ? Number(cm[1]) : null };
}
