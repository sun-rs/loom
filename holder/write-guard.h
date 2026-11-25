#ifndef LOOM_WRITE_GUARD_H
#define LOOM_WRITE_GUARD_H
#include "wire.h"
#include <errno.h>
#include <stddef.h>
#include <sys/types.h>

struct cursor {
  uint64_t epoch, seq, output, human, last_human;
  int human_pending, ended, gap;
};

struct condition {
  uint64_t epoch, seq, output, human, quiet_ns;
};

typedef ssize_t (*write_bytes)(int fd, const void *bytes, size_t size);

static inline enum status guarded_write(int fd, const struct cursor *current, const struct condition *expected,
    uint64_t now, const void *bytes, size_t size, write_bytes writer, uint32_t *written) {
  *written = 0;
  if (current->ended) return EXITED;
  if (current->gap) return GAP;
  if (current->epoch != expected->epoch || current->seq != expected->seq ||
      current->output != expected->output || current->human != expected->human) return STALE;
  if (current->human_pending || (current->last_human && now - current->last_human < expected->quiet_ns)) return HUMAN;

  // This is the first and only syscall after the final comparison. A retry
  // after EINTR or EAGAIN has to observe a fresh cursor before writing.
  ssize_t n = writer(fd, bytes, size);
  if (n < 0) return errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR ? WOULD_BLOCK : UNKNOWN;
  *written = (uint32_t)n;
  return n == (ssize_t)size ? OK : n ? PARTIAL : WOULD_BLOCK;
}
#endif
