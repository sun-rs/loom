#ifndef LOOM_HOLDER_INPUT_CLASS_H
#define LOOM_HOLDER_INPUT_CLASS_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// INPUT keeps its existing wire size. A high timestamp bit marks a classified
// chunk, with the next bit set only for terminal reports. Old readers ignore
// this field and conservatively treat every INPUT as editing.
#define INPUT_CLASSIFIED (UINT64_C(1) << 63)
#define INPUT_REPORT (UINT64_C(1) << 62)

static inline bool input_digits(const unsigned char *bytes, size_t *pos, size_t size, unsigned char terminator) {
  size_t start = *pos;
  while (*pos < size && bytes[*pos] >= '0' && bytes[*pos] <= '9') ++*pos;
  return *pos > start && *pos < size && bytes[(*pos)++] == terminator;
}

static inline size_t terminal_report(const unsigned char *bytes, size_t size) {
  if (size < 3 || bytes[0] != 27 || bytes[1] != '[') return 0;
  unsigned char first = bytes[2];
  if (first == 'I' || first == 'O') return 3; // Focus in/out.
  if (first == 'M' && size >= 6 && bytes[3] >= 32 && bytes[4] >= 32 && bytes[5] >= 32) return 6; // X10 mouse.
  if (first == '2' && size >= 6 && bytes[3] == '0' && (bytes[4] == '0' || bytes[4] == '1') && bytes[5] == '~') return 6;
  if (first == '<') { // SGR mouse.
    size_t pos = 3;
    if (!input_digits(bytes, &pos, size, ';') || !input_digits(bytes, &pos, size, ';')) return 0;
    size_t start = pos;
    while (pos < size && bytes[pos] >= '0' && bytes[pos] <= '9') ++pos;
    return pos > start && pos < size && (bytes[pos] == 'M' || bytes[pos] == 'm') ? pos + 1 : 0;
  }
  size_t pos = 2;
  bool private = first == '?' || first == '>' || first == '=';
  if (private) ++pos;
  size_t start = pos;
  unsigned fields = 1;
  while (pos < size) {
    unsigned char value = bytes[pos++];
    if (value >= '0' && value <= '9') continue;
    if (pos == start + 1) return 0;
    if (value == ';') { ++fields; start = pos; continue; }
    if (value == 'c' && private) return pos; // Device attributes.
    if (value == 'R' && fields == 2 && first != '>' && first != '=') return pos; // Cursor report.
    if (value == 'n' && fields == 1 && first != '>' && first != '=') return pos; // Device status.
    return 0;
  }
  return 0;
}

static inline bool only_terminal_reports(const unsigned char *bytes, size_t size) {
  for (size_t offset = 0; offset < size;) {
    size_t count = terminal_report(bytes + offset, size - offset);
    if (!count) return false;
    offset += count;
  }
  return size > 0;
}
#endif
