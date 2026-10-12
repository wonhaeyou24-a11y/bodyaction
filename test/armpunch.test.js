// 샌드백 펀치·발차기 판정 테스트 (몸 인식: 어깨 기준 3차원 속도):  node test/armpunch.test.js
// 합성한 팔/다리 움직임(잽·크로스·훅·킥 vs 가만히·흔들기·걷기)을 실제와 같은 경로(AI 20Hz+잡음 → 추적기 → 60fps)로 흘려 판정해요.
// 참고: 예전 방식(손목의 화면 속도 828px/s 기준)은 같은 펀치를 20번 중 0번 인식했어요.
import { ArmVel } from "../armtrack.js";
import { newPunchState, stepPunchN, PUNCH_N, KICK_N } from "../punch.js";
function mulberry(a){return()=>{a|=0;a=(a+0x6d2b79f5)|0;let x=Math.imul(a^(a>>>15),1|a);x=(x+Math.imul(x^(x>>>7),61|x))^x;return((x^(x>>>14))>>>0)/4294967296;}}
const PPM=440, SW=0.4*PPM, FPS=60;
const ease=(u)=>u<=0?0:u>=1?1:u*u*(3-2*u);
// 손목의 어깨 기준 3D 위치(m): z는 카메라 쪽이 +(펀치로 앞으로 나감)
const jab=(t0,len=.55)=>(t)=>{const a=ease((t-t0)/.12), b=ease((t-t0-.22)/.2);const k=a*(1-b);return{x:.05+.05*k,y:-.25+.25*k,z:.1+(len-.1)*k};};
const cross=(t0)=>(t)=>{const a=ease((t-t0)/.14), b=ease((t-t0-.24)/.22);const k=a*(1-b);return{x:-.1+.35*k,y:-.2+.15*k,z:.1+.4*k};};
const hook=(t0)=>(t)=>{const a=ease((t-t0)/.2), b=ease((t-t0-.3)/.25);const k=a*(1-b);return{x:.3+.0*k-.3*k*0+(-.4*k),y:-.1,z:.1+.25*k+0.0};};
const still=()=>({x:.1,y:-.2,z:.1});
const wave=(hz,amp)=>(t)=>({x:.1+amp*Math.sin(2*Math.PI*hz*t),y:-.2,z:.1});
const raise=(t0)=>(t)=>{const k=ease((t-t0)/.8);return{x:.1,y:-.2-.5*k+0.0,z:.1};};
const clap=(hz,amp)=>(t)=>({x:.1+amp*Math.sin(2*Math.PI*hz*t),y:-.1,z:.1+amp*0.5*Math.sin(2*Math.PI*hz*t)});
const breath=(t)=>({x:.1,y:-.2+.01*Math.sin(t*2),z:.1});

const kick = (t0) => (t) => { const a = ease((t - t0) / .18), b = ease((t - t0 - .3) / .25), k = a * (1 - b); return { x: .1 + .05 * k, y: .9 - .8 * k, z: .1 + .45 * k }; };
const lowkick = (t0) => (t) => { const a = ease((t - t0) / .2), b = ease((t - t0 - .3) / .25), k = a * (1 - b); return { x: .1 + .05 * k, y: .9 - .4 * k, z: .1 + .4 * k }; };
const walkLeg = (hz) => (t) => { const k = Math.sin(2 * Math.PI * hz * t); return { x: .1, y: .9 - .08 * Math.max(0, k), z: .1 + .25 * k }; };
const stillLeg = () => ({ x: .1, y: .9, z: .1 });
const stepLeg = (t0) => (t) => { const a = ease((t - t0) / .2), b = ease((t - t0 - .2) / .2), k = a * (1 - b); return { x: .1, y: .9 - .12 * k, z: .1 + .35 * k }; };

function run(seconds, pos, { zs = 20, xs = 2.5, seed = 1, cfg = PUNCH_N } = {}) {
  const rng = mulberry(seed), av = new ArmVel(), f = newPunchState(); let aiNext = 0, n = 0;
  for (let i = 0; i < seconds * FPS; i++) {
    const tt = i / FPS, now = 1000 + tt * 1000;
    if (tt >= aiNext) { aiNext = tt + .05 * (.7 + rng() * .6); const p = pos(tt - .04); const g = () => (rng() + rng() + rng() - 1.5) * 2; av.update(now, p.x * PPM + g() * xs, p.y * PPM + g() * xs, p.z * PPM + g() * zs, SW); }
    if (stepPunchN(f, av.vN(now), 1 / FPS, cfg).strike) n++;
  }
  return n;
}
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const recall = (mk, opt) => { let n = 0; for (let s = 0; s < 20; s++) if (run(2, mk(.5), { ...opt, seed: s + 1 }) >= 1) n++; return n; };
const falsePos = (pos, opt) => { let n = 0; for (let s = 0; s < 3; s++) n += run(20, pos, { ...opt, seed: s + 1 }); return n; };

for (const zs of [10, 20, 35]) {
  t(`깊이(z) 잡음 ${zs}px: 잽·짧은 잽·크로스·훅을 20번 중 19번 이상 인식`, () => {
    for (const [name, mk] of [["잽", jab], ["짧은 잽", (t0) => jab(t0, .35)], ["크로스", cross], ["훅", hook]]) { const n = recall(mk, { zs }); ok(n >= 19, `${name} ${n}/20`); }
  });
}
t("가만히·숨쉬기·손 흔들기·손뼉은 60초 동안 펀치 2번 이하", () => {
  for (const [name, pos] of [["가만히", still], ["숨쉬기", breath], ["손흔들기", wave(1, .15)], ["손뼉", clap(2, .1)]]) { const n = falsePos(pos, { zs: 20 }); ok(n <= 2, `${name} ${n}번`); }
});
t("어깨와 같이 움직이면(몸 흔들기/걷기/물러서기) 손목 상대 속도가 0 → 펀치 0번", () => { ok(falsePos(still, { zs: 35, xs: 3 }) === 0, "오인식"); });
t("발차기(하이킥·로우킥)는 20번 중 19번 이상 인식", () => {
  for (const [name, mk] of [["하이킥", kick], ["로우킥", lowkick]]) { let n = 0; for (let s = 0; s < 20; s++) if (run(2, mk(.5), { seed: s + 1, cfg: KICK_N }) >= 1) n++; ok(n >= 19, `${name} ${n}/20`); }
});
t("한 걸음 내딛기·걷기·가만히 서 있기는 킥이 아님 (발이 땅에서 안 올라오면 main에서도 걸러요)", () => {
  let n = 0; for (let s = 0; s < 20; s++) n += run(2, stepLeg(.5), { seed: s + 1, cfg: KICK_N }); ok(n === 0, "한 걸음 " + n + "번");
  ok(falsePos(stillLeg, { cfg: KICK_N }) === 0, "서 있기");
});
t("손이 안 보이면(결과가 끊기면) 속도 0 → 허공에서 펀치가 나가지 않음", () => {
  const av = new ArmVel(); for (let i = 0; i < 5; i++) av.update(1000 + i * 50, i * 40, 0, i * 40, 176);
  ok(av.vN(1000 + 4 * 50 + 50) > 1, "빠르게 움직이는 중엔 속도가 있음"); ok(av.vN(1000 + 4 * 50 + 400) === 0, "끊기면 0");
});
t("잘못된 값(NaN/어깨너비 0)은 무시", () => { const av = new ArmVel(); av.update(1000, NaN, 0, 0, 100); av.update(1050, 1, 1, 1, 0); ok(av.vN(1060) === 0, "무시 안 됨"); });
t("강도: 센 펀치일수록 intensity가 커짐(1~2.5)", () => {
  const f = newPunchState(); const a = stepPunchN(f, 2.4, .016), b = stepPunchN(f, 2.4, .016);
  const g = newPunchState(); stepPunchN(g, 9, .016); const c = stepPunchN(g, 9, .016);
  ok(b.strike && b.intensity >= 1 && b.intensity < 1.5, "보통 " + b.intensity); ok(c.strike && c.intensity === 2.5, "센 펀치 " + c.intensity);
});
console.log(`팔·다리 펀치/킥 판정: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
