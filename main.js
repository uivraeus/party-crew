import { guess } from 'web-audio-beat-detector';


document.addEventListener("pointerdown", toggleShow);

const lineup = document.querySelector(`.lineup`);
const all_fellows = Array.from(document.querySelectorAll('.fellow'));
const canvas = document.querySelector("#visualizer");
const canvasCtx = canvas.getContext("2d")


let mainAudioCtx = null;
let mainBeat = undefined;

function toggleShow(e) {
  const show = document.querySelector(`#show`);
  if (show.dataset.playing === "true") {
    show.dataset.playing = "false";
    stopBeat();
  } else {
    if (mainBeat !== null) {
      show.dataset.playing = "true";
      if (mainBeat === undefined) {
        mainBeat = null; // will be set eventually
        startTheShow();
      } else {
        playBeat();
      }
    } else {
      console.log(`Can't start now. Either things are being prepared or loading failed`);
    }
  }  
}

function startTheShow() {
  document.getElementById("user-message").innerHTML = "Loading...";
  
  if (!mainAudioCtx) {
    mainAudioCtx = new AudioContext();
  }
  getBeatBuffer(mainAudioCtx)
  .then(buffer => {
    document.getElementById("user-message").innerHTML = "Starting...";
    
    // Update/init global status (bpm/offset set below after "guess" call)
    mainBeat = { buffer, bpm: 0, offset: 0 };
    guess(buffer)
    .then(({bpm, offset}) => {
      console.log(`bpm: ${bpm}, offset: ${offset}`);
      mainBeat.bpm = bpm;
      mainBeat.offset = offset; 
      playBeat()
    })
    .catch(e => {
      console.error(`Couldn't guess the tempo! ${e}`)
      playBeat() // start playing the beat anyway
    });
  })
  .catch(e => {
    console.error(`Loading of beat buffer failed! ${e}`)
  });
}

// For some reason the standard doesn't cover repeated start/stop (nor pause/resume).
// These functions are a workaround for that.
function playBeat() {
  if (mainBeat && !mainBeat.source) {
      mainBeat.source = mainAudioCtx.createBufferSource();
      mainBeat.source.buffer = mainBeat.buffer;
      mainBeat.source.connect(mainAudioCtx.destination);
      mainBeat.source.loop = true;
      mainBeat.source.start();

      document.getElementById("user-message").innerHTML = "";

      setupChoreography();
      mainBeat.classifiers = [
        initFreqSumClassifier('midFreqSum', 5, 10, 20),
        //initFreqSumClassifier('lowFreqSum', 1, 5, 10),
      ];
      setupAnalyzer();
  }
}
function stopBeat() {
  stopAllChoreography()
  if (mainBeat && mainBeat.source) {
    mainBeat.source.stop();
  }
  // Delay some visuals to get a nice fade-out feeling (even though the sound stops immediately)
  // TBD: make this better such that no race between rapid toggles exists
  setTimeout(function () {
    stopAnalyzer();
    if (mainBeat) {
      mainBeat.source = undefined;
    }
    document.getElementById("user-message").innerHTML = "click to start again";
  }, 150);
}

function getBeatBuffer(audioCtx) {
  // Fetch the beat from an online source. Unfortunately I don't get a response with
  // Access-Control-Allow-Origin so I route it via a "proxy api".
  const srcUrl = document.querySelector('#beat').src;
  const proxyUrl = window.location.hostname === "localhost"
  ? "https://cors-anywhere.herokuapp.com"
  : "/cors-proxy";
  return fetch(`${proxyUrl}/${srcUrl}`)
    .then(response => response.arrayBuffer())
    .then(buffer => audioCtx.decodeAudioData(buffer))
    .then(buffer => buffer);    
}

function setupChoreography() {
  const dig_t = getDigT();
  const flip_t = getFlipT();
  lineup.style.setProperty(`--dig_t`, `${dig_t}s`);
  lineup.style.setProperty(`--flip_t`, `${flip_t}s`);
  all_fellows.forEach(fellow => {
    doFlip(fellow); // will kick off with a nice spin
  });

  setTimeout(scheduleMoves, 1000 * (flip_t - dig_t)); // start after initial flip
}

function stopAllChoreography() {
  stopMoves();
  all_fellows.forEach(fellow => {
    fellow.classList.remove("digging");
    fellow.classList.remove("flipping");
  });
}

function getDigT() {
  return (mainBeat && mainBeat.bpm) ? (60/mainBeat.bpm) : 1.0;
}

function getFlipT() {
  return 2 * getDigT();
}

function initDigAmpFn(inputAttr, minInput, maxInput, minOutput, maxOutput, numLevels) {
  // Calculate thresholds with 10% hysteresis
  const stepSize = (maxInput - minInput) / numLevels;
  const stepUpThr = [];
  const stepDownThr = [];
  for (let i = 1; i < numLevels; i++) {
    const thr = minInput + (stepSize * i);
    stepUpThr.push(thr + (0.1 * stepSize));
    stepDownThr.push(thr - (0.1 * stepSize));
  }
  // Linear mapping between input and output (TBD: use something fancier?)
  const outputMapping = [];
  const outputStepSize = (maxOutput - minOutput) / numLevels;
  for (let i = 0; i < numLevels; i++) {
    outputMapping.push(minOutput + (i * outputStepSize));
  }

  // Current state
  const levelUpdateInterval = 1; // i.e. update towards target at each iteration
  let timeToNextUpdate = levelUpdateInterval;
  let currentLevel = 0; 
  let currentTargetLevel = 0;

  let getDigAmp = function() {
    if (!mainBeat || !mainBeat[inputAttr]) {
      return `${minOutput.toFixed(2)}vmin`;
    }
    // Limit input according to configured range (cut-off)
    const rawInput = mainBeat[inputAttr];
    let input = Math.max(minInput, rawInput);
    input = Math.min(maxInput, input);

    // Update target
    if (currentTargetLevel < (numLevels-1) && input > stepUpThr[currentTargetLevel]) {
      currentTargetLevel++;
    } else if (currentTargetLevel > 0 && input < stepDownThr[currentTargetLevel - 1]) {
      currentTargetLevel--;
    }

    // Steer towards target at controlled speed
    if (timeToNextUpdate > 0) {
      timeToNextUpdate--;
    } else {
      if (currentTargetLevel > currentLevel) {
        currentLevel = currentTargetLevel; // direct increase
      } else if (currentTargetLevel < currentLevel) {
        currentLevel--;
      }
      timeToNextUpdate = levelUpdateInterval;
    }
    const output = `${outputMapping[currentLevel].toFixed(2)}vmin`;
    //console.log(`getDigAmp: rawInput: ${rawInput} -> input:${input}, currentLevel/Target: ${currentLevel}/${currentTargetLevel} -> output:${output}`);
    return output;
  }

  return getDigAmp;
}


function setupAnalyzer() {
  if (mainBeat && !mainBeat.analyzer) {
    mainBeat.analyzer = mainAudioCtx.createAnalyser();
    mainBeat.source.connect(mainBeat.analyzer);
    mainBeat.analyzer.fftSize = 1024;
    const freqBufferLength = mainBeat.analyzer.frequencyBinCount;
    const timeBufferLength = mainBeat.analyzer.fftSize; 
    mainBeat.analyzerFreqArray = new Uint8Array(freqBufferLength);
    mainBeat.analyzerTimeArray = new Uint8Array(timeBufferLength);
    mainBeat.analyzerFreqIirArray = new Float64Array(mainBeat.analyzer.fftSize/32);
    console.log("Visual Analyzer prepared - let's draw stuff!")
    analyzeAudio();
  }
}

function stopAnalyzer() {
  // Not sure how much of this is needed... maybe just set to undefined?
  if (mainBeat && mainBeat.analyzer) {
    mainBeat.source.disconnect(mainBeat.analyzer);
    mainBeat.analyzer = undefined
    mainBeat.analyzerTimeArray = undefined;
    mainBeat.analyzerTimeArray = undefined;
    console.log("Visual Analyzer removed")
  }
}

function analyzeAudio() {
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  if (mainBeat && mainBeat.analyzer) {
    var drawVisual = requestAnimationFrame(analyzeAudio); // TBD: store this for tear-down?
    mainBeat.analyzer.getByteTimeDomainData(mainBeat.analyzerTimeArray);
    mainBeat.analyzer.getByteFrequencyData(mainBeat.analyzerFreqArray);

    updateIirFilter();
    mainBeat.classifiers.forEach(c => {
      mainBeat[c.nameFn()] = c.updateFn(
        mainBeat.analyzerTimeArray, 
        mainBeat.analyzerFreqArray, 
        mainBeat.analyzerFreqIirArray)
    });

    plotFreq();
    plotTime();
  }
}

function updateIirFilter() {
  const rawBufferLength = mainBeat.analyzerFreqArray.length;
  const iirBufferLength = mainBeat.analyzerFreqIirArray.length;
  const sampPerBin = rawBufferLength / iirBufferLength;
  const alpha = 1.0;
  
  // TBD: rewrite/test using array-methods instead of raw looping ... 
  for (let i = 0; i < iirBufferLength; i++) {
    let newPart = 0.0;
    for (let r = (i * sampPerBin); r < (i+1) * sampPerBin; r++) {
      newPart += mainBeat.analyzerFreqArray[r];
    }
    newPart /= sampPerBin;

    let oldPart = mainBeat.analyzerFreqIirArray[i];
    mainBeat.analyzerFreqIirArray[i] = (alpha * newPart) + ((1-alpha) * oldPart);
  }
}

function plotFreq() {
  // filtered averaged values
  let gradient = canvasCtx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, 'rgba(127,0,0,0.2)');
  gradient.addColorStop(0.6, 'rgba(0,127,0,0.2)');
  gradient.addColorStop(0.9, 'rgba(0,127,0,0)');
  canvasCtx.fillStyle = gradient;
  const numBins = mainBeat.analyzerFreqIirArray.length;
  const xRatio = canvas.width / numBins;
  const margin = 5;
  for (let i = 0; i < numBins; i++) {
    const w = xRatio - margin;
    const h = Math.trunc(mainBeat.analyzerFreqIirArray[i]);
    const x = i * xRatio + margin;
    const y = 255 - h;
    canvasCtx.fillRect(x, y, w, h)
  }
}

function plotTime() {
  const bufferLength = mainBeat.analyzerTimeArray.length;
  const x_fct = canvas.width/bufferLength;
  
  canvasCtx.lineWidth = 5;

  canvasCtx.beginPath();
  canvasCtx.strokeStyle = 'rgba(127, 0, 0, 0.2)';
  canvasCtx.moveTo(0, 128)
  for(let i = 0; i < bufferLength; i++) {
    let x = i * x_fct;
    let y = 255 - mainBeat.analyzerTimeArray[i];
    canvasCtx.lineTo(x, y);
  }
  canvasCtx.stroke();
}

function doFlip(element) {
  element.classList.add("flipping");
  const flip_t = getFlipT();
  setTimeout(function () {
    element.classList.remove("flipping");
  }, 1000 * flip_t); //remove when complete
}

function scheduleMoves() {
  if (mainBeat && !mainBeat.movesInterval)
  {
    const getDigAmp = initDigAmpFn('midFreqSum', 0.46, 0.55, 14, 30, 4);
    const dig_t = getDigT();
    mainBeat.movesInterval = setInterval(function () {
      if (mainBeat && mainBeat.source)
      {
        all_fellows.forEach(fellow => {
          if (!fellow.classList.contains('flipping')) {
            const r = Math.random();
            const lower = 0.48;
            const upper = 0.55;
            const input = Math.min(upper, Math.max(lower, mainBeat.midFreqSum));
            const ratio = (input - lower) / (upper - lower); // [0.0 ... 1.0]
            const thr = 0.8 + (0.2 * (1.0-ratio)); // [0.8 ... 1.0]
            //console.log(`thr: ${thr}`);
            if (r > thr) {
              doFlip(fellow);          
            }    
          }

          // start digging at first invocation
          if(!fellow.classList.contains('digging')) {
            fellow.classList.add('digging');
          }
        })
        
        lineup.style.setProperty(`--dig_amp`, getDigAmp());
      }  
    }, 1000 * dig_t);
  }
}

function stopMoves() {
  if (mainBeat && mainBeat.movesInterval) {
    clearInterval (mainBeat.movesInterval);
    mainBeat.movesInterval = undefined;
  }
}


// == Characteristics classifiers ==

function initFreqSumClassifier(name, startBin, endBin, winLength) {
  const numBins = endBin - startBin;
  let lastResult;
  let binWindows;
  
  let resetFn = function() {
    lastResult = 0;
    binWindows = [];
    for (let i = 0; i < numBins; i++) {
      binWindows.push(Array(winLength).fill(0))
    }
  }

  resetFn();

  let updateFn = function(timeArray, freqArray, freqIirArray) {
    const arr = freqIirArray;
       
    binWindows.forEach(window => window.shift()); // pop oldest entires for each zone
    arr.slice(startBin, endBin).forEach((v, i) => binWindows[i].push(v));
    const binAvg = binWindows.map(w => w.reduce((acc, v) => acc + v)/winLength);
    const normSum = binAvg.reduce((acc, v) => acc + v) / (256*numBins);
    //console.log(name, normSum.toFixed(2));
    return normSum;
  };

  let getFn = function() {
    return lastResult;
  }
  let nameFn = function() {
    return name;
  }

  return {updateFn, getFn, resetFn, nameFn};
}

