const size = () => process.stdout.write(`SIZE=${process.stdout.columns}x${process.stdout.rows}\r\n`);
process.stdin.setRawMode(true);
process.stdout.on('resize', size);
process.on('SIGWINCH', size);
process.stdin.on('data', buffer => {
  process.stdout.write(`INPUT=${buffer.toString('hex')}\r\n`);
  if (buffer.includes(3)) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exitCode = 7;
  }
});
size();
