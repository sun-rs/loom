#ifndef LOOM_SHA256_H
#define LOOM_SHA256_H
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint32_t hash[8];
  uint64_t length;
  unsigned char block[64];
  size_t used;
} Sha256;

void sha_init(Sha256 *s);
void sha_update(Sha256 *s, const void *bytes, size_t size);
void sha_finish(Sha256 *s, unsigned char digest[32]);
#endif
