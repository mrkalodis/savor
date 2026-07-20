const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'css', 'style.css');
if (!fs.existsSync(cssPath)) {
  console.log('CSS file not found at:', cssPath);
  process.exit(1);
}

const content = fs.readFileSync(cssPath, 'utf8');

let braces = 0;
let lineNum = 1;
let colNum = 1;

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (char === '\n') {
    lineNum++;
    colNum = 1;
  } else {
    colNum++;
  }

  if (char === '{') {
    braces++;
  } else if (char === '}') {
    braces--;
    if (braces < 0) {
      console.log(`Error: Extra closing brace at line ${lineNum}, column ${colNum}`);
      braces = 0;
    }
  }
}

if (braces > 0) {
  console.log(`Error: Unbalanced braces! Closed count is less than opened count by ${braces}`);
} else {
  console.log('Braces check: OK (all opened braces are closed)');
}
