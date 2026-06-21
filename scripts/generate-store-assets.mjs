#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "store", "assets");
const tmp = join(out, ".render");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(out, { recursive: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const css = `
  :root{
    --bg:#f6f8fb;--paper:#fff;--soft:#eef4f9;--soft2:#f9fbfd;--ink:#0f1720;--mut:#66758a;
    --line:rgba(15,23,42,.065);--blue:#006de5;--blue2:#0057be;--good:#087a55;--bad:#c2415a;
    --shadow:0 0 0 1px rgba(15,23,42,.045),0 24px 58px rgba(27,42,66,.13);
    --soft-shadow:0 0 0 1px rgba(15,23,42,.045),0 10px 24px rgba(27,42,66,.07);
  }
  *{box-sizing:border-box}
  body{margin:0;width:100vw;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .stage{position:relative;width:100%;height:100%;padding:58px;background:var(--bg)}
  .brand{display:flex;align-items:center;gap:12px;font-weight:760;font-size:25px;letter-spacing:-.01em}
  .logo{width:38px;height:38px;border-radius:14px;background:var(--blue);display:grid;place-items:center;color:#fff;font-weight:780;letter-spacing:-.04em;box-shadow:0 14px 30px rgba(0,109,229,.18)}
  .headline{font-size:48px;line-height:1.02;letter-spacing:0;margin:30px 0 14px;max-width:610px;text-wrap:balance}
  .sub{font-size:19px;line-height:1.45;color:var(--mut);max-width:600px;text-wrap:pretty}
  .browser,.overlay,.side,.settings,.error,.promo-card{background:linear-gradient(180deg,#fff,#f9fbfd);border-radius:26px;box-shadow:var(--shadow);overflow:hidden}
  .browser{position:absolute;right:62px;bottom:54px;width:650px;height:462px}
  .bar{height:48px;background:rgba(255,255,255,.72);display:flex;align-items:center;gap:8px;padding:0 16px;box-shadow:inset 0 -1px 0 rgba(15,23,42,.045)}
  .dot{width:10px;height:10px;border-radius:50%;background:#d9e2ed}.url{height:26px;flex:1;border-radius:999px;background:var(--soft);color:#8794a5;font-size:12px;display:flex;align-items:center;padding:0 14px}
  .page{padding:34px}.question{font-size:22px;font-weight:680;margin-bottom:16px}.choice{display:grid;gap:10px}.choice span{padding:12px 14px;border-radius:16px;background:var(--soft2);color:#344052;font-size:16px}.choice .on{background:rgba(0,109,229,.09);color:var(--blue);box-shadow:inset 0 0 0 1px rgba(0,109,229,.12)}
  .overlay{position:absolute;right:84px;top:132px;width:386px}.top{height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;box-shadow:inset 0 -1px 0 rgba(15,23,42,.045)}
  .mini{display:flex;gap:7px}.mini b{width:38px;height:38px;border-radius:999px;background:var(--soft2);display:grid;place-items:center;color:var(--mut);font-size:13px;box-shadow:var(--soft-shadow)}
  .answer{margin:16px;padding:17px;border-radius:20px;background:#fff;box-shadow:var(--soft-shadow)}.label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--blue);font-weight:800}
  .ansrow{display:flex;align-items:center;gap:12px;margin-top:10px}.badge{width:44px;height:44px;border-radius:15px;background:var(--blue);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:800}.confidence{margin-left:auto;background:#e8f7ef;color:#096243;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800}.reason{margin:0 16px 16px;padding:13px 14px;border-radius:18px;background:var(--soft2);color:var(--mut);line-height:1.45}
  .side{position:absolute;right:82px;top:76px;width:410px;height:650px}.controls{height:108px;background:rgba(255,255,255,.74);padding:16px}.selects{display:flex;gap:9px}.select{flex:1;background:#fff;border-radius:16px;padding:11px 12px;color:#3f4b5b;font-size:14px;box-shadow:inset 0 0 0 1px var(--line)}.modes{display:flex;gap:7px;margin-top:12px}.mode{flex:1;border-radius:999px;background:#fff;padding:8px;text-align:center;color:var(--mut);font-size:12px;box-shadow:var(--soft-shadow)}.mode.on{background:var(--blue);color:#fff}.chat{padding:18px;display:grid;gap:16px}.user{justify-self:end;max-width:280px;border-radius:20px 20px 8px 20px;background:#fff;padding:12px 14px;box-shadow:var(--soft-shadow)}.final{border-radius:20px;background:#fff;padding:16px;box-shadow:var(--soft-shadow)}.composer{position:absolute;left:0;right:0;bottom:0;padding:14px;background:rgba(255,255,255,.86);display:flex;gap:10px;box-shadow:0 -18px 34px rgba(27,42,66,.06)}.input{flex:1;border-radius:999px;background:#fff;padding:13px 16px;color:#8794a5;box-shadow:inset 0 0 0 1px var(--line)}.send{width:44px;height:44px;border-radius:999px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:800}
  .settings{position:absolute;right:78px;top:70px;width:570px;padding:30px}.settings h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--blue2);margin:0 0 18px}.row{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end;margin-bottom:14px}.field{height:46px;border-radius:16px;background:var(--soft2);display:flex;align-items:center;padding:0 14px;color:#657386;box-shadow:inset 0 0 0 1px var(--line)}.btn{height:46px;border-radius:999px;background:var(--blue);color:white;display:flex;align-items:center;padding:0 18px;font-weight:740}.switch{display:flex;justify-content:space-between;padding:14px 0;color:#3d4a5a;box-shadow:inset 0 1px 0 rgba(15,23,42,.045)}.toggle{width:44px;height:26px;border-radius:999px;background:var(--blue);position:relative}.toggle:after{content:"";position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:50%;background:white}
  .capture{position:absolute;right:72px;bottom:62px;width:650px;height:462px;border-radius:26px;background:rgba(15,23,32,.72);box-shadow:var(--shadow);overflow:hidden}.hint{position:absolute;top:22px;left:50%;transform:translateX(-50%);background:var(--blue);color:white;border-radius:999px;padding:10px 18px;font-weight:740}.rect{position:absolute;left:132px;top:118px;width:365px;height:205px;border:3px solid #74b9ff;border-radius:20px;box-shadow:0 0 0 9999px rgba(15,23,32,.34);background:rgba(116,185,255,.14)}
  .error{position:absolute;right:96px;top:170px;width:420px;padding:20px}.error h3{margin:0 0 8px;color:var(--bad)}.error ol{margin:0 0 14px;padding-left:20px;color:var(--mut);line-height:1.55}.error .retry{display:inline-flex;background:var(--blue);color:white;border-radius:999px;padding:11px 17px;font-weight:740}
  .promo{padding:30px}.promo .headline{font-size:30px;max-width:300px;margin-top:22px}.promo .sub{font-size:14px;max-width:278px}.promo-card{position:absolute;right:66px;top:42px;width:152px;padding:14px}.promo-card .ansrow{gap:8px}.promo-card .badge{width:36px;height:36px;font-size:19px}.promo-card .confidence{display:none}
`;

const brand = `<div class="brand"><div class="logo">S</div>Solv</div>`;
const overlay = `<div class="overlay"><div class="top"><div class="brand" style="font-size:17px"><div class="logo" style="width:25px;height:25px;border-radius:10px">S</div>Solv</div><div class="mini"><b>+</b><b>-></b><b>x</b></div></div><div class="answer"><div class="label">Correct choice</div><div class="ansrow"><div class="badge">B</div><strong>5</strong><span class="confidence">94%</span></div></div><div class="reason">Subtract 7 from both sides to get 3x = 15, then divide by 3.</div></div>`;
const browser = `<div class="browser"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><div class="url">learning.example/algebra-practice</div></div><div class="page"><div class="question">What is the value of x in 3x + 7 = 22?</div><div class="choice"><span>A) 3</span><span class="on">B) 5</span><span>C) 7</span><span>D) 9</span></div></div></div>`;
const side = `<div class="side"><div class="top"><div class="brand" style="font-size:17px"><div class="logo" style="width:25px;height:25px;border-radius:10px">S</div>Solv</div><span style="color:var(--mut)">+</span></div><div class="controls"><div class="selects"><div class="select">OpenAI API</div><div class="select">GPT-5.4 mini</div></div><div class="modes"><div class="mode">Answer</div><div class="mode on">Short</div><div class="mode">Steps</div><div class="mode">Hint</div></div></div><div class="chat"><div class="user">Can you check this derivative?</div><div class="final"><div class="label">Answer</div><p><strong>6x + 2</strong></p><p style="color:var(--mut)">Use the power rule on 3x^2 and the constant multiple rule on 2x.</p></div></div><div class="composer"><div class="input">Ask a follow-up...</div><div class="send">^</div></div></div>`;

const marqueeOverlay = overlay.replace('class="overlay"', 'class="overlay" style="right:72px;top:76px"');
const marqueeSide = side.replace('class="side"', 'class="side" style="right:500px;top:84px;width:340px;height:462px"');

const scenes = {
  "screenshot-1-overlay.html": `<div class="stage">${brand}<h1 class="headline">Check study questions without leaving the page.</h1><p class="sub">Select text and get a clear answer-first explanation inline.</p>${browser}${overlay}</div>`,
  "screenshot-2-capture.html": `<div class="stage">${brand}<h1 class="headline">Capture diagrams, charts, and handwritten prompts.</h1><p class="sub">Drag a region around the question. Solv sends only the cropped image to the provider you choose.</p><div class="browser"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><div class="url">course.example/physics</div></div><div class="page"><div class="question">Find the missing angle.</div><div style="height:240px;border-radius:22px;background:var(--soft2);display:grid;place-items:center;color:#92a0b1;font-size:90px">A</div></div></div><div class="capture"><div class="hint">Drag around the question</div><div class="rect"></div></div></div>`,
  "screenshot-3-sidepanel.html": `<div class="stage">${brand}<h1 class="headline">Keep a focused study thread beside the page.</h1><p class="sub">Ask follow-ups, attach images, switch modes, and keep moving.</p>${side}</div>`,
  "screenshot-4-settings.html": `<div class="stage">${brand}<h1 class="headline">Bring your own AI access. Keep control.</h1><p class="sub">Use API keys, local Ollama, Chrome built-in AI, or logged-in ChatGPT, Claude, and Gemini sessions.</p><div class="settings"><h2>API keys and models</h2><div class="row"><div class="field">OpenAI key</div><div class="field">gpt-5.4-mini</div><div class="btn">Test</div></div><div class="row"><div class="field">Anthropic key</div><div class="field">claude-sonnet-4-6</div><div class="btn">Test</div></div><div class="row"><div class="field">Gemini key</div><div class="field">gemini-2.5-flash</div><div class="btn">Test</div></div><div class="switch"><span>Auto-verify low confidence answers</span><span class="toggle"></span></div><div class="switch"><span>Compact overlay controls</span><span class="toggle"></span></div></div></div>`,
  "screenshot-5-error.html": `<div class="stage">${brand}<h1 class="headline">Helpful setup guidance instead of dead ends.</h1><p class="sub">Clear recovery steps keep users moving when a key, model, or page permission needs attention.</p>${browser}<div class="error"><h3>API key not accepted</h3><ol><li>Open Settings and re-paste your key with no spaces.</li><li>Make sure the key matches the selected provider.</li><li>Check that billing or credit is enabled.</li></ol><span class="retry">Retry</span></div></div>`,
  "promo-small.html": `<div class="stage promo">${brand}<h1 class="headline">A second opinion, right on the page.</h1><p class="sub">Select text or capture a region. Get a clear answer first.</p><div class="promo-card"><div class="label">Answer</div><div class="ansrow"><div class="badge">B</div><strong>5</strong></div></div></div>`,
  "promo-marquee.html": `<div class="stage">${brand}<h1 class="headline" style="font-size:46px;max-width:500px">Study with a fast second opinion, not another tab.</h1><p class="sub" style="max-width:500px">Inline answers, screenshots, follow-ups, local storage privacy, and your choice of AI provider.</p>${marqueeOverlay}${marqueeSide}</div>`
};

function page(body) {
  return `<!doctype html><meta charset="utf-8"><style>${css}</style>${body}`;
}

function render(name, width, height, output) {
  const html = join(tmp, name);
  writeFileSync(html, page(scenes[name]));
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${join(out, output)}`,
    pathToFileURL(html).href
  ], { stdio: "ignore" });
  console.log(`wrote store/assets/${output}`);
}

for (let i = 1; i <= 5; i++) render(`screenshot-${i}-${["overlay", "capture", "sidepanel", "settings", "error"][i - 1]}.html`, 1280, 800, `screenshot-${i}.png`);
render("promo-small.html", 440, 280, "promo-small.png");
render("promo-marquee.html", 1400, 560, "promo-marquee.png");
