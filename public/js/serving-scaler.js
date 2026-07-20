// Serving Scaler logic for Savor recipe manager

function adjustServings(delta) {
  const display = document.getElementById('servings-display');
  if (!display) return;
  
  let current = parseFloat(display.textContent);
  if (isNaN(current)) return;
  
  let next = current + delta;
  if (next < 0.5) next = 0.5; // allow half-servings minimum
  
  display.textContent = next;
  scaleIngredients(next);
}

// Convert a decimal value back into a user-friendly fraction
function decimalToFraction(val) {
  if (val % 1 === 0) return String(val);
  
  const tolerance = 0.05;
  const decimals = val % 1;
  const whole = Math.floor(val);
  const wholePrefix = whole > 0 ? `${whole} ` : '';
  
  if (Math.abs(decimals - 0.25) < tolerance) return `${wholePrefix}1/4`;
  if (Math.abs(decimals - 0.5) < tolerance) return `${wholePrefix}1/2`;
  if (Math.abs(decimals - 0.75) < tolerance) return `${wholePrefix}3/4`;
  if (Math.abs(decimals - 0.33) < tolerance) return `${wholePrefix}1/3`;
  if (Math.abs(decimals - 0.67) < tolerance) return `${wholePrefix}2/3`;
  if (Math.abs(decimals - 0.125) < tolerance) return `${wholePrefix}1/8`;
  
  return String(val.toFixed(2)).replace(/\.?0+$/, '');
}

// Map unicode fraction symbols to decimal values
const unicodeFractions = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 0.33,
  '⅔': 0.67,
  '⅛': 0.125
};

// Parse ingredient text to extract quantities, multiply by ratio, and format
function scaleIngredientText(text, ratio) {
  const trimmed = text.trim();
  
  // 1. Check for unicode fraction character at start
  if (unicodeFractions[trimmed[0]]) {
    const val = unicodeFractions[trimmed[0]] * ratio;
    return `<strong style="color: var(--color-primary);">${decimalToFraction(val)}</strong>${text.slice(1)}`;
  }
  
  // 2. Check for mixed fraction like "1 1/2" or "1 ½"
  const mixedFractionMatch = trimmed.match(/^(\d+)\s+([½¼¾⅓⅔⅛]|\d+\/\d+)/);
  if (mixedFractionMatch) {
    const whole = parseInt(mixedFractionMatch[1], 10);
    const fracPart = mixedFractionMatch[2];
    let fracVal = 0;
    
    if (unicodeFractions[fracPart]) {
      fracVal = unicodeFractions[fracPart];
    } else {
      const parts = fracPart.split('/');
      fracVal = parseInt(parts[0], 10) / parseInt(parts[1], 10);
    }
    
    const val = (whole + fracVal) * ratio;
    const rest = trimmed.slice(mixedFractionMatch[0].length);
    return `<strong style="color: var(--color-primary);">${decimalToFraction(val)}</strong>${rest}`;
  }
  
  // 3. Check for standard fraction like "1/2"
  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1], 10);
    const den = parseInt(fractionMatch[2], 10);
    const val = (num / den) * ratio;
    const rest = trimmed.slice(fractionMatch[0].length);
    return `<strong style="color: var(--color-primary);">${decimalToFraction(val)}</strong>${rest}`;
  }
  
  // 4. Check for standard decimal or integer number (e.g. "1.5" or "2")
  const numberMatch = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (numberMatch) {
    const num = parseFloat(numberMatch[1]);
    const val = num * ratio;
    const rest = trimmed.slice(numberMatch[0].length);
    return `<strong style="color: var(--color-primary);">${decimalToFraction(val)}</strong>${rest}`;
  }
  
  return text;
}

function scaleIngredients(newServings) {
  const display = document.getElementById('servings-display');
  const baseServings = parseFloat(display.dataset.baseServings);
  if (isNaN(baseServings) || baseServings <= 0) return;
  
  const ratio = newServings / baseServings;
  
  document.querySelectorAll('.ingredient-line').forEach(el => {
    const originalText = el.dataset.originalText;
    if (!originalText) return;
    
    el.innerHTML = scaleIngredientText(originalText, ratio);
  });
}
