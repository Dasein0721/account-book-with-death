#!/usr/bin/env node
/* lint.js — 单文件项目的静态体检（npm run lint）
   为什么需要：index.html 没有构建步骤，出错只有运行时才知道。
   这里做四件零依赖的检查：语法、$("id") 目标存在性、label[for] 目标存在性、引用锚点存在性。
   退出码：有问题 = 1，干净 = 0。 */
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const problems = [];
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if(!m){ console.error("✗ 找不到 <script> 块"); process.exit(1); }
const code = m[1];
try { new Function(code); } catch(err){ problems.push("脚本语法错误：" + err.message); }

const ids = new Set();
for(const mm of html.matchAll(/\sid="([^"]+)"/g)) ids.add(mm[1]);

const missingIds = new Set();
for(const mm of code.matchAll(/\$\("([^"]+)"\)/g)) if(!ids.has(mm[1])) missingIds.add(mm[1]);
for(const id of missingIds) problems.push('$("' + id + '") 指向的 id 在 HTML 里不存在');

for(const mm of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) if(!ids.has(mm[1])) problems.push('label[for="' + mm[1] + '"] 目标不存在');

const refIds = new Set();
for(const mm of html.matchAll(/\sid="(ref-[^"]+)"/g)) refIds.add(mm[1]);
const dynamicRefs = /id="ref-'\s*\+/.test(code) || /'ref-'\+/.test(code);   // renderRefs 运行时生成
if(refIds.size && !dynamicRefs){
  for(const mm of html.matchAll(/href="#(ref-[^"]+)"/g)){
    if(!refIds.has(mm[1])) problems.push('引用锚点 #' + mm[1] + " 没有对应节点");
  }
}

const inputs = [...html.matchAll(/<(input|select|textarea)[^>]*id="([^"]+)"[^>]*>/g)];
const unlabeled = inputs.filter(x => {
  const id = x[2];
  if(/type="(checkbox|radio)"/.test(x[0])) return false;
  if(new RegExp('<label[^>]*for="' + id + '"').test(html)) return false;
  if(new RegExp('aria-(label|labelledby)="[^"]*"').test(x[0])) return false;
  return true;
});
if(unlabeled.length) problems.push(unlabeled.length + " 个输入控件既无 label[for] 也无 aria-label：" + unlabeled.map(x => x[2]).join(", "));

if(problems.length){
  console.error("✗ lint 发现 " + problems.length + " 个问题：");
  problems.forEach(p => console.error("  · " + p));
  process.exit(1);
}
console.log("✓ lint 通过：语法 OK、" + ids.size + " 个 id、" + inputs.length + " 个控件均可达名、" + refIds.size + " 个引用锚点自洽");
