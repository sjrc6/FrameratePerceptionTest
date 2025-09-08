const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');
if (!gl) alert('WebGL not supported');

const vertexShaderSource = `
  attribute vec2 a_position;
  void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform vec2  u_resolution;
  uniform float u_time;
  uniform float u_leftFps;
  uniform float u_rightFps;
  uniform float u_circleSpeed;

  #define PI 3.14159
  #define SAMPLES 32
  const float ORBIT_RADIUS  = 0.30;
  const float SPHERE_RADIUS = 0.1;

  vec3 linearToSRGB(vec3 lin) {
      vec3 lo  = lin * 12.92;
      vec3 hi  = 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055;
      vec3 useLo = step(lin, vec3(0.0031308));
      return mix(hi, lo, useLo);
  }

  float cover(vec2 p, vec2 c){
      float d = length(p - c);
      return 1.0 - smoothstep(SPHERE_RADIUS, SPHERE_RADIUS * 1.05, d);
  }

  float shutterBlur(vec2 p, float fps, float tStart){
      float dt  = 1.0 / fps;
      float sum = 0.0;

      float n = fract(sin(dot(p.xy * 0.37, vec2(12.9898, 78.233))) * 43758.5453);

      for (int i = 0; i < SAMPLES; i++) {
          float ti = (float(i) + 0.5 + n) / float(SAMPLES);
          float t  = tStart + ti * dt;

          float ang   = u_circleSpeed * PI * t;
          vec2 centre = vec2(cos(ang), sin(ang)) * ORBIT_RADIUS;

          sum += cover(p, centre);
      }
      return sum / float(SAMPLES);
  }


  void main(){
      vec2 frag = gl_FragCoord.xy;
      vec2 p = (2.0 * frag - u_resolution) / u_resolution.y;

      float aspectHalf = u_resolution.x / u_resolution.y * 0.5;
      vec3  colLinear  = vec3(0.0);

      if (p.x < 0.0) {
          vec2 lp   = p - vec2(-aspectHalf, 0.0);
          float ft  = 1.0 / u_leftFps;
          float tS  = floor(u_time / ft) * ft;
          float op  = shutterBlur(lp, u_leftFps, tS);
          colLinear = vec3(op);
      } else {
          vec2 rp   = p - vec2( aspectHalf, 0.0);
          float ft  = 1.0 / u_rightFps;
          float tS  = floor(u_time / ft) * ft;
          float op  = shutterBlur(rp, u_rightFps, tS);
          colLinear = vec3(op);
      }

      if (abs(p.x) < 0.006) colLinear = vec3(1.0);

      vec3 colSRGB = linearToSRGB(clamp(colLinear, 0.0, 1.0));
      gl_FragColor = vec4(colSRGB, 1.0);
  }

`;

function compileShader(src, type){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    console.error('Shader error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh); return null;
  }
  return sh;
}
const vsh = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
const fsh = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
const program = gl.createProgram();
gl.attachShader(program, vsh); gl.attachShader(program, fsh); gl.linkProgram(program);
if(!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('Link error:', gl.getProgramInfoLog(program));

const posBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(program, 'a_position');
const uRes = gl.getUniformLocation(program, 'u_resolution');
const uTime = gl.getUniformLocation(program, 'u_time');
const uLeft = gl.getUniformLocation(program, 'u_leftFps');
const uRight= gl.getUniformLocation(program, 'u_rightFps');
const uCircleSpeed = gl.getUniformLocation(program, 'u_circleSpeed');

let detectedHz = 60;
let frameCount = 0; let lastTime = performance.now();

let baseFps;
let diffPct;
let minBase;
let compFps;
let higherSide = 'right';
let awaitingChoice = true;

let step; let minStep;
let direction = null; let prevDirection = null;
let reversals = 0; let targetReversals; let maxTrials;
let trialIndex = 0; let consecutiveCorrect = 0;
let correctAnswers = 0; let totalAnswers = 0;
let trials = [];
let testFinished = false;

const refreshRateSpan = document.getElementById('refreshRate');
const leftBtn = document.getElementById('leftBtn');
const rightBtn = document.getElementById('rightBtn');
const resetBtn = document.getElementById('resetBtn');
const restartBtn = document.getElementById('restartBtn');
const trialNumSpan = document.getElementById('trialNum');
const correctSpan = document.getElementById('correct');
const totalSpan = document.getElementById('total');
const percentSpan = document.getElementById('percentage');
const fpsDisplay = document.getElementById('fpsDisplay');
const historyDiv = document.getElementById('history');
const threshDisp = document.getElementById('thresholdDisplay');
const threshCI = document.getElementById('thresholdCI');
const progressFill = document.getElementById('progressFill');
const diffWarning = document.getElementById('diffWarning');

const settingsEl = document.getElementById('settings');
const settingsToggle = document.getElementById('settingsToggle');

settingsToggle.addEventListener('click', ()=>{
  settingsEl.classList.toggle('expanded');
});

document.getElementById('showFps').addEventListener('change', updateFpsDisplay);
resetBtn.addEventListener('click', ()=>{ initTest(); });
restartBtn.addEventListener('click', ()=>{ initTest(); });

function detectRefresh(){
  const now = performance.now(); frameCount++;
  if(now - lastTime >= 1000){
    detectedHz = Math.round(frameCount / ((now - lastTime)/1000));
    refreshRateSpan.textContent = detectedHz;
    lastTime = now; frameCount = 0;
  }
  requestAnimationFrame(detectRefresh);
}
detectRefresh();

function initTest(){
  baseFps = parseFloat(document.getElementById('startBase').value);
  minBase = parseFloat(document.getElementById('minBase').value);
  diffPct = parseFloat(document.getElementById('diffPct').value) / 100;
  step    = parseFloat(document.getElementById('initialStep').value);
  minStep = parseFloat(document.getElementById('minStep').value);
  targetReversals = parseInt(document.getElementById('targetReversals').value,10);
  maxTrials = parseInt(document.getElementById('maxTrials').value,10);

  direction = null; prevDirection = null; reversals = 0; trialIndex = 0;
  consecutiveCorrect = 0; correctAnswers = 0; totalAnswers = 0; trials = [];
  testFinished = false; historyDiv.innerHTML = '';
  threshDisp.textContent = '—'; threshCI.textContent = '';
  diffWarning.textContent = '';
  progressFill.style.width = '0%';
  
  restartBtn.style.display = 'none';
  leftBtn.style.display = 'block';
  rightBtn.style.display = 'block';

  baseFps = clamp(baseFps, minBase, detectedHz);

  generateTrial();
  updateScoreUI();
  clearChart(); 
}

function clamp(v, lo, hi){ return Math.min(Math.max(v, lo), hi); }

function generateTrial(){
  if(testFinished) return;
  compFps = baseFps * (1 + diffPct);
  compFps = Math.min(compFps, detectedHz);
  baseFps = clamp(baseFps, minBase, detectedHz);
  
  const actualDiff = (compFps - baseFps) / baseFps;
  const targetDiff = diffPct;
  
  if(actualDiff < targetDiff) {
    diffWarning.textContent = `⚠️ Monitor refresh rate limiting comparison: ${(actualDiff * 100).toFixed(0)}% difference instead of target ${(targetDiff * 100).toFixed(0)}%`;
  } else {
    diffWarning.textContent = '';
  }
  
  if(compFps === baseFps){
    finishTest();
    return;
  }

  if(Math.random() < 0.5){
    currentLeftFps = baseFps;
    currentRightFps = compFps;
    higherSide = 'right';
  } else {
    currentLeftFps = compFps;
    currentRightFps = baseFps;
    higherSide = 'left';
  }
  awaitingChoice = true;
  updateFpsDisplay();
  leftBtn.disabled = false; rightBtn.disabled = false;
}

function updateFpsDisplay(){
  const show = document.getElementById('showFps').checked;
  if(show && awaitingChoice){
    let arr = [currentLeftFps, currentRightFps];
    if(arr[0].toFixed(0)>arr[1].toFixed(0)) arr.reverse();
    fpsDisplay.textContent = `${arr[0].toFixed(0)}fps - ${arr[1].toFixed(0)}fps`;
  } else { fpsDisplay.textContent = ''; }
}

function logHistory(correct){
  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `<span class="${correct? 'correct':'incorrect'}">${correct?'✓':'✗'}</span> `+
    `${baseFps.toFixed(0)} | ${(baseFps*(1+diffPct)).toFixed(0)}`;
  historyDiv.insertBefore(item, historyDiv.firstChild);
}

function handleChoice(side){
  if(!awaitingChoice || testFinished) return;
  awaitingChoice = false; leftBtn.disabled = true; rightBtn.disabled = true;
  const correct = side === higherSide;

  totalAnswers++; if(correct){ correctAnswers++; consecutiveCorrect++; } else { consecutiveCorrect = 0; }

  trialIndex++;
  trials.push({ trial: trialIndex, base: baseFps, comp: compFps, left: currentLeftFps, right: currentRightFps, correct, direction });
  logHistory(correct);
  updateScoreUI();
  staircaseUpdate(correct);
}

function staircaseUpdate(correct){
  let newDirection = direction;
  if(!correct){
    newDirection = 'down';
    baseFps = clamp(baseFps - step, minBase, detectedHz);
  } else if(consecutiveCorrect >= 2){
    newDirection = 'up';
    baseFps = clamp(baseFps + step, minBase, detectedHz);
    consecutiveCorrect = 0;
  }

  if(direction && newDirection && direction !== newDirection){
    reversals++;
    step = Math.max(minStep, step/2);
  }
  direction = newDirection;

  if(reversals >= targetReversals || trialIndex >= maxTrials || baseFps >= detectedHz){
    finishTest();
    return;
  }
  generateTrial();
}

function finishTest(){
  testFinished = true;
  fpsDisplay.textContent = '';
  diffWarning.textContent = '';
  leftBtn.disabled = true; rightBtn.disabled = true;
  
  leftBtn.style.display = 'none';
  rightBtn.style.display = 'none';
  restartBtn.style.display = 'block';
  
  progressFill.style.width = '100%';
  estimateThreshold();
  updateScoreUI();
}

function updateScoreUI(){
  trialNumSpan.textContent = trialIndex;
  correctSpan.textContent = correctAnswers;
  totalSpan.textContent = totalAnswers;
  percentSpan.textContent = totalAnswers? Math.round((correctAnswers/totalAnswers)*100):0;
  const progress = testFinished ? 1 : Math.min(1, reversals/targetReversals);
  progressFill.style.width = (progress*100)+"%";
}

function estimateThreshold(){
  let revs = [];
  for(let i=1;i<trials.length;i++){
    const prev = trials[i-1];
    const cur  = trials[i];
    if(prev.direction && cur.direction && prev.direction !== cur.direction){
      revs.push(cur.base);
    }
  }
  if(baseFps >= detectedHz)
  {
    threshDisp.textContent = 'Not determined, exceeded monitor Hz'; 
    drawChart(); 
    return; 
  }
  if(revs.length === 0){ 
    threshDisp.textContent = 'Not determined'; 
    drawChart(); 
    return; 
  }
  const use = revs.slice(-4);
  const mean = use.reduce((a,b)=>a+b,0)/use.length;
  const sd = Math.sqrt(use.map(x=> (x-mean)**2).reduce((a,b)=>a+b,0)/(use.length-1||1));
  const ciLow = mean - 1.96*sd/Math.sqrt(use.length);
  const ciHi  = mean + 1.96*sd/Math.sqrt(use.length);
  
  threshDisp.textContent = mean.toFixed(1) + ' fps';
        
  if(use.length>1) threshCI.textContent = `95% CI ≈ ${ciLow.toFixed(1)} – ${ciHi.toFixed(1)} fps`;
  drawChart();
}

const chartCanvas = document.getElementById('chart');
const ctx = chartCanvas.getContext('2d');
function drawChart(){
  const ratio = window.devicePixelRatio || 1;
  chartCanvas.width  = chartCanvas.clientWidth  * ratio;
  chartCanvas.height = chartCanvas.clientHeight * ratio;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(ratio, ratio);
  const w = chartCanvas.clientWidth;
  const h = chartCanvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(30,h-20); ctx.lineTo(w-10,h-20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(30,10); ctx.lineTo(30,h-20); ctx.stroke();
  if(trials.length===0) return;
  const bases = trials.map(t=>t.base);
  const maxBase = Math.max(...bases, detectedHz);
  const minBase = Math.min(...bases);
  const xScale = (i)=> 30 + (i/(trials.length-1||1))*(w-40);
  const yScale = (v)=> (h-20) - ( (v-minBase)/(maxBase-minBase||1) )*(h-40);
  ctx.beginPath(); ctx.strokeStyle = '#0af'; ctx.lineWidth = 2;
  trials.forEach((t,i)=>{ const x=xScale(i), y=yScale(t.base); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
  trials.forEach((t,i)=>{ const x=xScale(i), y=yScale(t.base); ctx.fillStyle = t.correct? '#4caf50' : '#f44336'; ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill(); });
}
function clearChart(){
  ctx.clearRect(0,0,chartCanvas.clientWidth,chartCanvas.clientHeight);
}
let startTime = performance.now();
let currentLeftFps = 30; let currentRightFps = 60;
function renderLoop(){
  const t = (performance.now()-startTime)/1000;
  const circleSpeed = parseFloat(document.getElementById('circleSpeed').value);
  
  gl.viewport(0,0,canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, t);
  gl.uniform1f(uLeft, currentLeftFps);
  gl.uniform1f(uRight,currentRightFps);
  gl.uniform1f(uCircleSpeed, circleSpeed);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0,0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(renderLoop);
}
renderLoop();

leftBtn.addEventListener('click', ()=>handleChoice('left'));
rightBtn.addEventListener('click', ()=>handleChoice('right'));

initTest();

