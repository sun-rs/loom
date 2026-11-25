#ifndef LOOM_HOLDER_WIRE_H
#define LOOM_HOLDER_WIRE_H
#include <stdint.h>

#define FRAME_LIMIT 65536
#define CHUNK_LIMIT 8192
#define PROTOCOL 3
#define SCHEMA 1

enum method { HELLO = 1, CLAIM, SNAPSHOT, READ, WRITE, RESIZE, SIGNAL, HANDOFF };
enum status { OK, INVALID, STALE, HUMAN, WOULD_BLOCK, PARTIAL, EXITED, GAP, UNKNOWN, FAILED };
enum event { OUTPUT = 1, SIZE, INPUT, WRITTEN, END };

static inline uint32_t get32(const unsigned char *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static inline uint64_t get64(const unsigned char *p) {
  return (uint64_t)get32(p) << 32 | get32(p + 4);
}
static inline void set32(unsigned char *p, uint32_t n) {
  p[0] = n >> 24; p[1] = n >> 16; p[2] = n >> 8; p[3] = n;
}
static inline void set64(unsigned char *p, uint64_t n) {
  set32(p, (uint32_t)(n >> 32)); set32(p + 4, (uint32_t)n);
}
#endif
