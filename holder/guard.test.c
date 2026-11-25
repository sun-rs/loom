#include "write-guard.h"
#include <assert.h>

static ssize_t result;
static unsigned calls;
static int failure;

static ssize_t fake_write(int fd, const void *bytes, size_t size) {
  assert(fd == 17 && bytes && size == 4);
  ++calls;
  errno = failure;
  return result;
}

int main(void) {
  struct cursor observed = {.epoch = 2, .seq = 8, .output = 10, .human = 17};
  struct condition expected = {2, 8, 10, 17, 800000000};
  uint32_t written;
  struct cursor live = observed;
  ++live.human;
  assert(guarded_write(17, &live, &expected, 0, "test", 4, fake_write, &written) == STALE && calls == 0);
  live = observed;
  ++live.epoch;
  assert(guarded_write(17, &live, &expected, 0, "test", 4, fake_write, &written) == STALE && calls == 0);
  live = observed;
  live.last_human = 100;
  assert(guarded_write(17, &live, &expected, 800000099, "test", 4, fake_write, &written) == HUMAN && calls == 0);
  result = 2;
  assert(guarded_write(17, &live, &expected, 800000100, "test", 4, fake_write, &written) == PARTIAL && written == 2 && calls == 1);
  result = -1;
  failure = EAGAIN;
  assert(guarded_write(17, &live, &expected, 800000100, "test", 4, fake_write, &written) == WOULD_BLOCK && written == 0 && calls == 2);
  result = 4;
  assert(guarded_write(17, &live, &expected, 800000100, "test", 4, fake_write, &written) == OK && written == 4 && calls == 3);
}
