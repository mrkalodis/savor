let currentStepIndex = 0;
let wakeLockInstance = null;
let activeTimers = [];
let timerIdCounter = 0;
let socket = null;

// Initialize Cook Mode on load
document.addEventListener('DOMContentLoaded', () => {
  renderStep(false);
  requestWakeLock();
  
  // Listen for visibility changes to re-acquire wake lock
  document.addEventListener('visibilitychange', () => {
    if (wakeLockInstance !== null && document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      nextStep(true);
    } else if (e.key === 'ArrowLeft') {
      prevStep(true);
    }
  });

  // Initialize voice control on boot
  startVoiceControl();

  // Connect WebSocket for screen sync
  connectWebSocket();
});

// WebSocket connection for real-time kitchen device synchronization
function connectWebSocket() {
  if (typeof recipeId === 'undefined') return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/cook?recipeId=${recipeId}`;
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    console.log('[WS] Connected to Cook Mode sync server');
  };
  
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleIncomingWSMessage(msg);
    } catch (err) {
      console.warn('[WS] Error processing sync message:', err.message);
    }
  };
  
  socket.onclose = () => {
    console.log('[WS] Connection closed. Reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  };
}

function sendWSMessage(type, data = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  }
}

function handleIncomingWSMessage(msg) {
  const { type, data } = msg;
  console.log('[WS] Incoming event:', type, data);
  
  switch (type) {
    case 'stepChange':
      currentStepIndex = data.index;
      renderStep(false);
      break;
      
    case 'timerCreate':
      // Avoid duplicate timers on sync loop
      if (!activeTimers.some(t => t.id === data.id)) {
        createTimer(data.totalSeconds, data.label, false, data.id);
      }
      break;
      
    case 'timerPauseToggle':
      togglePauseTimer(data.id, false);
      break;
      
    case 'timerReset':
      resetTimer(data.id, false);
      break;
      
    case 'timerDelete':
      deleteTimer(data.id, false);
      break;
  }
}

// Text-To-Speech (Speech Synthesis) Announcement Alert helper
function speakAlert(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // cancel any active speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95; // clean natural pacing
    window.speechSynthesis.speak(utterance);
  }
}

// Parse duration mentions (e.g. "10 minutes", "1.5 hours", "10-15 mins") and wrap in clickable spans
function parseDurations(text) {
  if (!text) return '';
  
  const durationRegex = /\b(\d+(?:\.\d+)?|\d+\s*-\s*\d+)\s*(minutes?|mins?|hours?|hrs?)\b/gi;
  
  return text.replace(durationRegex, (match, numStr, unitStr) => {
    let num = parseFloat(numStr.split('-')[0].trim());
    if (isNaN(num)) return match;
    
    const unit = unitStr.toLowerCase();
    let seconds = num * 60;
    if (unit.startsWith('hr') || unit.startsWith('hour')) {
      seconds = num * 3600;
    }
    
    // Label for timer
    const label = `Step ${currentStepIndex + 1} (${match})`;
    return `<span class="cook-timer-trigger" onclick="createTimer(${seconds}, '${label}', true)">${match}</span>`;
  });
}

// Display the current step
function renderStep(broadcast = false) {
  const stepNumberEl = document.getElementById('step-number-el');
  const stepTextEl = document.getElementById('step-text-el');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  
  if (!recipeSteps || recipeSteps.length === 0) {
    stepNumberEl.textContent = 'Step 0 of 0';
    stepTextEl.innerHTML = 'No instructions listed for this recipe.';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }
  
  // Update step labels
  stepNumberEl.textContent = `Step ${currentStepIndex + 1} of ${recipeSteps.length}`;
  stepTextEl.innerHTML = parseDurations(recipeSteps[currentStepIndex]);
  
  // Enable/disable buttons
  btnPrev.disabled = (currentStepIndex === 0);
  if (currentStepIndex === recipeSteps.length - 1) {
    btnNext.textContent = 'Finish';
  } else {
    btnNext.textContent = 'Next';
  }

  // Broadcast step navigation state to other clients
  if (broadcast) {
    sendWSMessage('stepChange', { index: currentStepIndex });
  }
}

// Go to next step
function nextStep(broadcast = true) {
  if (currentStepIndex < recipeSteps.length - 1) {
    currentStepIndex++;
    renderStep(broadcast);
  } else {
    // Finish cook mode -> Redirect to recipe page
    window.location.href = window.location.pathname.replace('/cook', '');
  }
}

// Go to previous step
function prevStep(broadcast = true) {
  if (currentStepIndex > 0) {
    currentStepIndex--;
    renderStep(broadcast);
  }
}

// Request screen wake lock to keep screen turned on
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockInstance = await navigator.wakeLock.request('screen');
      
      // Update UI badge
      document.getElementById('wake-lock-dot').style.background = 'var(--color-success)';
      document.getElementById('wake-lock-text').textContent = 'Awake Active';
      
      wakeLockInstance.addEventListener('release', () => {
        document.getElementById('wake-lock-dot').style.background = 'var(--color-text-tertiary)';
        document.getElementById('wake-lock-text').textContent = 'Awake Disabled';
      });
    } catch (err) {
      console.warn('Screen Wake Lock failed to initialize:', err.message);
      document.getElementById('wake-lock-text').textContent = 'Awake Blocked';
    }
  } else {
    document.getElementById('wake-lock-text').textContent = 'Awake Unsupported';
  }
}

// TIMER DRAWER LOGIC
let drawerOpen = false;
function toggleTimerDrawer() {
  const drawer = document.getElementById('cook-timer-drawer');
  const arrow = document.getElementById('drawer-toggle-arrow');
  drawerOpen = !drawerOpen;
  
  if (drawerOpen) {
    drawer.style.transform = 'translateY(0)';
    arrow.textContent = '▼';
  } else {
    drawer.style.transform = 'translateY(calc(100% - 40px))';
    arrow.textContent = '▲';
  }
}

// Create a new timer
function createTimer(seconds, label, broadcast = true, assignedId = null) {
  const timerId = assignedId || ++timerIdCounter;
  
  const timer = {
    id: timerId,
    totalSeconds: seconds,
    secondsLeft: seconds,
    label: label,
    paused: false,
    intervalId: null
  };
  
  activeTimers.push(timer);
  
  // Start the timer countdown
  startTimerCountdown(timer);
  
  // Update UI lists
  updateTimersList();
  
  // Open the drawer to show the running timer
  if (!drawerOpen) toggleTimerDrawer();

  // Send WebSocket sync update
  if (broadcast) {
    sendWSMessage('timerCreate', { id: timerId, totalSeconds: seconds, label: label });
  }
}

// Start timer tick interval
function startTimerCountdown(timer) {
  timer.intervalId = setInterval(() => {
    if (timer.paused) return;
    
    timer.secondsLeft--;
    
    // Update the visual representation
    const timeEl = document.getElementById(`timer-time-${timer.id}`);
    if (timeEl) {
      timeEl.textContent = formatTimeDisplay(timer.secondsLeft);
    }
    
    if (timer.secondsLeft <= 0) {
      clearInterval(timer.intervalId);
      timer.intervalId = null;
      
      // Trigger auditory beep
      playAlarmBeep();

      // Trigger Text-to-Speech alert
      const cleanedLabel = timer.label.replace(/[\(\)]/g, '').replace('Step', 'step');
      speakAlert(`Timer alert: ${cleanedLabel} completed.`);
      
      // Notify user visually
      if (timeEl) {
        timeEl.textContent = 'DONE!';
        timeEl.style.color = 'var(--color-danger)';
        timeEl.style.fontWeight = '800';
      }
    }
  }, 1000);
}

// Toggle play/pause on a running timer
function togglePauseTimer(timerId, broadcast = true) {
  const timer = activeTimers.find(t => t.id === timerId);
  if (!timer) return;
  
  timer.paused = !timer.paused;
  const pauseBtn = document.getElementById(`timer-pause-btn-${timerId}`);
  
  if (pauseBtn) {
    pauseBtn.textContent = timer.paused ? '▶' : '⏸';
    pauseBtn.title = timer.paused ? 'Resume' : 'Pause';
  }

  if (broadcast) {
    sendWSMessage('timerPauseToggle', { id: timerId });
  }
}

// Reset an active timer
function resetTimer(timerId, broadcast = true) {
  const timer = activeTimers.find(t => t.id === timerId);
  if (!timer) return;
  
  // Clear existing interval
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }
  
  timer.secondsLeft = timer.totalSeconds;
  timer.paused = false;
  
  // Re-start
  startTimerCountdown(timer);
  updateTimersList();

  if (broadcast) {
    sendWSMessage('timerReset', { id: timerId });
  }
}

// Delete/Close a timer
function deleteTimer(timerId, broadcast = true) {
  const index = activeTimers.findIndex(t => t.id === timerId);
  if (index === -1) return;
  
  const timer = activeTimers[index];
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }
  
  activeTimers.splice(index, 1);
  updateTimersList();

  if (broadcast) {
    sendWSMessage('timerDelete', { id: timerId });
  }
}

// Format seconds into MM:SS or HH:MM:SS
function formatTimeDisplay(totalSeconds) {
  if (totalSeconds < 0) return '00:00';
  
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  const mDisplay = String(mins).padStart(2, '0');
  const sDisplay = String(secs).padStart(2, '0');
  
  if (hrs > 0) {
    return `${hrs}:${mDisplay}:${sDisplay}`;
  }
  return `${mDisplay}:${sDisplay}`;
}

// Re-render the active timers panel list
function updateTimersList() {
  const list = document.getElementById('active-timers-list');
  const countEl = document.getElementById('timer-count');
  if (!list || !countEl) return;
  
  countEl.textContent = activeTimers.length;
  
  if (activeTimers.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; color: var(--color-text-tertiary); font-size: 0.8rem; padding: 1rem 0;">
        No active timers. Click a duration in the instructions to start one.
      </div>
    `;
    return;
  }
  
  list.innerHTML = '';
  
  activeTimers.forEach(timer => {
    const isDone = timer.secondsLeft <= 0;
    
    const row = document.createElement('div');
    row.className = 'active-timer';
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '0.35rem';
    row.style.marginBottom = '0.5rem';
    
    row.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 0.5rem;">
        <span style="font-size: 0.8rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text); flex-grow: 1;">
          ${timer.label}
        </span>
        <span id="timer-time-${timer.id}" style="font-family: monospace; font-size: 1.15rem; font-weight: 700; ${isDone ? 'color: var(--color-danger); font-weight: 800;' : ''}">
          ${isDone ? 'DONE!' : formatTimeDisplay(timer.secondsLeft)}
        </span>
      </div>
      
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; border-top: 1px solid var(--color-border); padding-top: 0.35rem;">
        ${!isDone ? `
          <button id="timer-pause-btn-${timer.id}" class="btn-icon" style="font-size: 0.85rem;" onclick="togglePauseTimer(${timer.id}, true)" title="Pause">⏸</button>
        ` : ''}
        <button class="btn-icon" style="font-size: 0.85rem;" onclick="resetTimer(${timer.id}, true)" title="Reset">🔄</button>
        <button class="btn-icon" style="font-size: 0.85rem; color: var(--color-danger);" onclick="deleteTimer(${timer.id}, true)" title="Remove">&times;</button>
      </div>
    `;
    
    list.appendChild(row);
  });
}

// Synthesize alarm beep sound using Web Audio API
function playAlarmBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play 3 distinct beeps
    const times = [0, 0.3, 0.6];
    
    times.forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime + delay); // A5 pitch
      
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
      
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch (err) {
    console.error('[AudioContext] Dynamic synthesize failed:', err.message);
  }
}

// ============================================================
// HANDS-FREE VOICE CONTROLS (SPEECH RECOGNITION)
// ============================================================
let speechRecognitionInstance = null;
let voiceControlActive = false;

window.toggleVoiceControl = function() {
  if (voiceControlActive) {
    stopVoiceControl();
  } else {
    startVoiceControl();
  }
};

function startVoiceControl() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateVoiceBadge('unsupported', 'Voice Unsupported');
    return;
  }
  
  try {
    speechRecognitionInstance = new SpeechRecognition();
    speechRecognitionInstance.continuous = true;
    speechRecognitionInstance.interimResults = false;
    speechRecognitionInstance.lang = 'en-US';
    
    speechRecognitionInstance.onstart = () => {
      voiceControlActive = true;
      updateVoiceBadge('active', 'Voice Active');
    };
    
    speechRecognitionInstance.onresult = (event) => {
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.trim().toLowerCase();
      console.log('Voice command heard:', transcript);
      
      if (transcript.includes('next') || transcript.includes('forward')) {
        nextStep(true);
      } else if (transcript.includes('back') || transcript.includes('previous')) {
        prevStep(true);
      } else if (transcript.includes('exit') || transcript.includes('quit') || transcript.includes('close')) {
        window.location.href = window.location.pathname.replace('/cook', '');
      } else if (transcript.includes('timer') || transcript.includes('start')) {
        const triggers = document.querySelectorAll('.cook-timer-trigger');
        if (triggers.length > 0) {
          triggers[0].click();
        }
      }
    };
    
    speechRecognitionInstance.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      if (e.error === 'not-allowed') {
        updateVoiceBadge('blocked', 'Voice Blocked');
        voiceControlActive = false;
      }
    };
    
    speechRecognitionInstance.onend = () => {
      if (voiceControlActive) {
        speechRecognitionInstance.start();
      } else {
        updateVoiceBadge('idle', 'Voice Idle');
      }
    };
    
    speechRecognitionInstance.start();
  } catch (err) {
    console.error('Speech recognition setup failed:', err);
    updateVoiceBadge('failed', 'Voice Error');
  }
}

function stopVoiceControl() {
  voiceControlActive = false;
  if (speechRecognitionInstance) {
    speechRecognitionInstance.stop();
  }
  updateVoiceBadge('idle', 'Voice Idle');
}

function updateVoiceBadge(status, text) {
  const dot = document.getElementById('voice-control-dot');
  const txt = document.getElementById('voice-control-text');
  if (!dot || !txt) return;
  
  txt.textContent = text;
  
  if (status === 'active') {
    dot.style.background = 'var(--color-success)';
  } else if (status === 'blocked' || status === 'unsupported' || status === 'failed') {
    dot.style.background = 'var(--color-danger)';
  } else {
    dot.style.background = 'var(--color-text-tertiary)';
  }
}

// Start a manual user-created timer
function startCustomTimer() {
  const minsInput = document.getElementById('custom-timer-mins');
  const labelInput = document.getElementById('custom-timer-label');
  if (!minsInput) return;
  
  const mins = parseFloat(minsInput.value);
  if (isNaN(mins) || mins <= 0) {
    alert('Please enter a valid number of minutes.');
    return;
  }
  
  const label = labelInput && labelInput.value.trim() ? labelInput.value.trim() : 'Custom Timer';
  createTimer(mins * 60, label);
  
  // Clear inputs
  minsInput.value = '';
  labelInput.value = '';
}
