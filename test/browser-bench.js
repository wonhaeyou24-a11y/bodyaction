// 브라우저 성능 비교 도구 (자세한 사용법은 README의 "성능 점검" 참고). 개발자 도구 콘솔에서 실행하는 한 줄 함수예요.
(async (gameMode, secs) => {
  localStorage.clear(); localStorage.setItem('kk_setup_done_v1', '1');
  const html = await (await fetch('/index.html?x=' + Date.now())).text();
  const inject = `<base href="/"><script>
window.__fr=[]; window.__ft=[]; window.__errs=[]; addEventListener('error',function(e){window.__errs.push(e.message)}); addEventListener('unhandledrejection',function(e){window.__errs.push(String(e.reason&&e.reason.message||e.reason))});
window.requestAnimationFrame=function(cb){return setTimeout(function(){var t=performance.now(); cb(t); if(cb.name==='frame'){window.__fr.push(performance.now()-t); window.__ft.push(t);}},16)};
window.cancelAnimationFrame=clearTimeout;
(function(){ var c=document.createElement('canvas'); c.width=640; c.height=480; var g=c.getContext('2d'); var k=0;
 setInterval(function(){ k++; g.fillStyle='#456'; g.fillRect(0,0,640,480); g.fillStyle='#e0b090'; g.beginPath(); g.arc(320+Math.sin(k/10)*150,240+Math.cos(k/13)*100,70,0,7); g.fill(); },33);
 navigator.mediaDevices.getUserMedia=async function(){ return c.captureStream(30); }; })();
<\/script>`;
  document.open(); document.write(html.replace('<head>', '<head>' + inject).replace(/main\.js\?v=[0-9_]+/, 'main.js?v=t' + Date.now())); document.close();
  await new Promise((r) => setTimeout(r, 3000));
  document.getElementById('useMouse').checked = false;
  document.querySelector('.mode[data-mode=' + gameMode + ']').click();
  await new Promise((r) => setTimeout(r, 16000));
  const i0 = window.__fr.length; await new Promise((r) => setTimeout(r, secs * 1000));
  const fr = window.__fr.slice(i0), ft = window.__ft.slice(i0);
  const s = [...fr].sort((a, b) => a - b), q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  const span = (ft[ft.length - 1] - ft[0]) / 1000;
  return { port: location.port, game: gameMode, fps: +(ft.length / span).toFixed(1), avgMs: +(fr.reduce((a, b) => a + b, 0) / fr.length).toFixed(2), p50: q(0.5), p99: q(0.99), max: q(1), hud: document.getElementById('hudFpsText')?.textContent, errs: window.__errs.slice(0, 3) };
})
