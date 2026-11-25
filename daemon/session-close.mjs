export async function disposeSession(session, timeoutMs = 8_000) {
  let timer;
  try {
    await Promise.race([
      session.dispose(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('OAR session disposal timed out'), { code: 'close-timeout' })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
