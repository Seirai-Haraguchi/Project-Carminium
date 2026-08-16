const fs = require('fs');

for (const fpath of ['.github/workflows/nightly.yml', '.github/workflows/release.yml']) {
  let c = fs.readFileSync(fpath, 'utf8');
  const eol = c.includes('\r\n') ? '\r\n' : '\n';
  
  const oldBlock = [
    '      - name: Build native library (Zig)',
    '        working-directory: native',
    '        run: |',
    '          zig version',
    '          zig build copy copy-legacy -Doptimize=ReleaseFast --summary all'
  ].join(eol);
  
  const newBlock = [
    '      - name: Build native library (Zig)',
    '        working-directory: native',
    '        run: zig version && zig build copy copy-legacy -Doptimize=ReleaseFast'
  ].join(eol);
  
  if (c.includes(oldBlock)) {
    c = c.replace(oldBlock, newBlock);
    fs.writeFileSync(fpath, c);
    console.log('Fixed ' + fpath);
  } else {
    console.log('Pattern not found in ' + fpath);
  }
}
