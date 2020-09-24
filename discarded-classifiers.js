function initFreqRatioClassifier(name) {
  const zones = 3;
  const winLength = 100;
  let lastResult;
  let zoneWindow;
  
  let resetFn = function() {
    lastResult = 0;
    zoneWindow = [];
    for (let i = 0; i < zones; i++) {
      zoneWindow.push(Array(winLength).fill(0))
    }
  }

  resetFn();

  let updateFn = function(timeArray, freqArray, freqIirArray) {
    const arr = freqIirArray;
    const n = Math.trunc(arr.length / zones);
    let zoneAvg = [];
    
    zoneWindow.forEach(window => window.shift()); // pop oldest entires for each zone

    for (let i = 0; i < zones; i++) {
      const end = i == (zones - 1) ? arr.length : (i+1) * n;
      const zoneSum = arr.slice(i*n, end).reduce((acc, v) => acc + v, 0);
      zoneWindow[i].push(zoneSum);
      const avg = zoneWindow[i].reduce((acc, v) => acc + v, 0) / zoneWindow[i].length; 
      zoneAvg.push(avg);
    }
    
    const avgSum = zoneAvg.reduce((acc, v) => acc + v, 0);
    //const ratio = zoneAvg[zoneAvg.length - 1] / avgSum;
    const ratio = zoneAvg[1] / avgSum;
    console.log(name, ratio.toFixed(2));
    return ratio;
  };

  let getFn = function() {
    return lastResult;
  }
  let nameFn = function() {
    return name;
  }

  return {updateFn, getFn, resetFn, nameFn};
}

