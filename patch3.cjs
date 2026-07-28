const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /        const stripHtml = [\s\S]*?\} else \{/m;

const replacement = `        if (parts.length > 1) {
          const tmp1 = document.createElement("DIV");
          tmp1.innerHTML = parts[0];
          const frontText = tmp1.textContent || tmp1.innerText || "";
          
          const tmp2 = document.createElement("DIV");
          tmp2.innerHTML = parts[1];
          const backText = tmp2.textContent || tmp2.innerText || "";

          return { front: frontText.trim(), back: backText.trim(), finished: false };
        } else {
          const tmp1 = document.createElement("DIV");
          tmp1.innerHTML = parts[0];
          const frontText = tmp1.textContent || tmp1.innerText || "";
          
`;

if (!regex.test(code)) {
   console.log("Could not find regex");
} else {
   code = code.replace(regex, replacement);
   fs.writeFileSync('server.ts', code);
   console.log("Replaced successfully");
}
