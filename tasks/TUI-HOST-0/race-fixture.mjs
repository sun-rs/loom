const rule = '─'.repeat(48);
function render(status, draft = '') {
  process.stdout.write(`\x1b[2J\x1b[H${status}\r\n${rule}\r\n❯ ${draft.replaceAll('\n', '\r\n  ')}\r\n${rule}\r\n? for shortcuts\r\n`);
}
process.stdin.setRawMode(true);
let input = '';
let pasted;
let human = '';
let submitted = false;
process.stdin.on('data', chunk => {
  input += chunk.toString('utf8');
  if (!pasted) {
    const match = /^\x1b\[200~([\s\S]*?)\x1b\[201~/.exec(input);
    if (!match) return;
    pasted = match[1];
    input = input.slice(match[0].length);
    render('PASTE-RECEIVED');
    setTimeout(() => render(submitted ? 'ENTER-RECEIVED' : 'DRAFT-RETAINED', pasted + human), 650);
  }
  submitted ||= input.includes('\r');
  human += input.replaceAll('\r', '');
  input = '';
  if (submitted) render('ENTER-RECEIVED');
});
render('READY');
