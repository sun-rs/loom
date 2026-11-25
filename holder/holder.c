#define _GNU_SOURCE
#include "sha256.h"
#include "write-guard.h"
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <util.h>
#define ASSET "loom-holder-darwin-arm64"
#else
#include <pty.h>
#ifdef __aarch64__
#define ASSET "loom-holder-linux-arm64"
#else
#define ASSET "loom-holder-linux-x64"
#endif
#endif

#define RECORD_HEAD 21
#define RECORD_MAX (RECORD_HEAD + CHUNK_LIMIT)
#define SEGMENT_EVENTS 512
#define RING_EVENTS 256
#define CLIENTS 8
#define ID_SIZE 16
#define QUEUE_SIZE (4 * CHUNK_LIMIT)
#define MANIFEST_HEAD "LOOM-HOLDER 3 1\n"
#define BOOT_MAGIC UINT64_C(0x4c4f4f4d00000301)
#define PIPE_MAGIC UINT64_C(0x4c4f4f4d00000311)
#define PIPE_MANIFEST "LOOM-HOLDER PIPES 1\n"
#define JOURNAL_LIMIT (UINT64_C(256) * 1024 * 1024)

typedef unsigned char Byte;
extern char **environ;

struct queue {
  size_t size;
  Byte bytes[QUEUE_SIZE];
};

struct state {
  uint64_t magic, generation;
  struct cursor cursor;
  uint64_t mirror, master_input, journal_bytes;
  uint32_t init_cols, init_rows, cols, rows;
  pid_t child;
  int master, listener, journal, keeper, term_changed, in_flags, out_flags;
  int reaped, wait_status, eof;
  struct termios saved_tty;
  struct queue input, output;
  Byte incarnation[ID_SIZE], controller[ID_SIZE], transaction[ID_SIZE], build[32];
  char socket_path[PATH_MAX], dir[PATH_MAX], controller_path[PATH_MAX];
};

struct record {
  uint32_t size;
  Byte bytes[RECORD_MAX];
};

struct client {
  int fd;
  uint64_t deadline;
  size_t used, need, sent, response;
  Byte bytes[4 + FRAME_LIMIT];
};

static struct state s;
// Keep the original TUI state layout. Only pipe images use this extension.
static struct {
  uint64_t stderr_offset;
  int stdout_fd, stderr_fd;
} pipes;
static struct record ring[RING_EVENTS];
static struct client clients[CLIENTS];
static volatile sig_atomic_t winch, termination;

static bool pipe_mode(void) { return s.magic == PIPE_MAGIC; }

static uint64_t now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t) < 0) abort();
  return (uint64_t)t.tv_sec * 1000000000 + (uint64_t)t.tv_nsec;
}

static void fatal(const char *message) {
  perror(message);
  exit(125);
}

static bool path_copy(char *out, size_t size, const char *source) {
  size_t n = strlen(source);
  if (*source != '/' || n >= size) return false;
  memcpy(out, source, n + 1);
  return true;
}

static void signal_handler(int sig) {
  if (sig == SIGWINCH) winch = 1;
  else termination = sig;
}

static void install_signals(void) {
  struct sigaction a = {.sa_handler = signal_handler};
  sigemptyset(&a.sa_mask);
  const int signals[] = {SIGWINCH, SIGHUP, SIGTERM, SIGINT};
  for (size_t i = 0; i < sizeof(signals) / sizeof(signals[0]); ++i)
    if (sigaction(signals[i], &a, NULL) < 0) fatal("sigaction");
  signal(SIGPIPE, SIG_IGN);
}

static int descriptor_flags(int fd, bool close_on_exec) {
  return fcntl(fd, F_SETFD, close_on_exec ? FD_CLOEXEC : 0);
}

static int nonblock(int fd) {
  int flags = fcntl(fd, F_GETFL);
  return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static bool all_bytes(int fd, void *buffer, size_t length, bool writing) {
  Byte *p = buffer;
  while (length) {
    ssize_t n = writing ? write(fd, p, length) : read(fd, p, length);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return false;
    p += n;
    length -= (size_t)n;
  }
  return true;
}

static bool private_dir(const char *path) {
  struct stat st;
  return lstat(path, &st) == 0 && S_ISDIR(st.st_mode) && st.st_uid == getuid() && !(st.st_mode & 077);
}

static void hex(const Byte *bytes, size_t length, char *out) {
  static const char chars[] = "0123456789abcdef";
  for (size_t i = 0; i < length; ++i) {
    out[2 * i] = chars[bytes[i] >> 4];
    out[2 * i + 1] = chars[bytes[i] & 15];
  }
  out[2 * length] = 0;
}

static bool unhex(const char *text, Byte *out, size_t length) {
  if (strlen(text) != 2 * length) return false;
  for (size_t i = 0; i < length; ++i) {
    const char *chars = "0123456789abcdef";
    const char *a = strchr(chars, text[2 * i]), *b = strchr(chars, text[2 * i + 1]);
    if (!a || !b) return false;
    out[i] = (Byte)((a - chars) * 16 + (b - chars));
  }
  return true;
}

static bool same_uid(int fd) {
#ifdef __APPLE__
  uid_t uid;
  gid_t gid;
  return getpeereid(fd, &uid, &gid) == 0 && uid == getuid();
#else
  struct ucred cred;
  socklen_t n = sizeof(cred);
  return getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &n) == 0 && cred.uid == getuid();
#endif
}

static int open_listener(void) {
  struct sockaddr_un address = {.sun_family = AF_UNIX};
  if (!path_copy(address.sun_path, sizeof(address.sun_path), s.socket_path)) { errno = ENAMETOOLONG; return -1; }
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  if (descriptor_flags(fd, true) < 0 || nonblock(fd) < 0 ||
      bind(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
    close(fd);
    return -1;
  }
  if (chmod(s.socket_path, 0600) < 0 || listen(fd, CLIENTS) < 0) {
    close(fd);
    unlink(s.socket_path);
    return -1;
  }
  return fd;
}

static int open_segment(uint64_t seq, int flags) {
  char name[40];
  snprintf(name, sizeof(name), "events-%016llx", (unsigned long long)((seq - 1) / SEGMENT_EVENTS));
  return openat(s.journal, name, flags | O_CLOEXEC | O_NOFOLLOW, 0600);
}

static void append(enum event type, const void *payload, uint32_t length) {
  uint64_t seq = ++s.cursor.seq;
  struct record *r = &ring[seq % RING_EVENTS];
  r->size = length + RECORD_HEAD;
  set32(r->bytes, r->size - 4);
  r->bytes[4] = type;
  set64(r->bytes + 5, seq);
  set64(r->bytes + 13, type == ERROR_OUTPUT ? pipes.stderr_offset : s.cursor.output);
  if (length) memcpy(r->bytes + RECORD_HEAD, payload, length);
  if (s.cursor.gap || s.journal_bytes + r->size > JOURNAL_LIMIT) { s.cursor.gap = 1; return; }
  int flags = O_WRONLY | O_APPEND;
  if ((seq - 1) % SEGMENT_EVENTS == 0) flags |= O_CREAT | O_EXCL;
  int fd = open_segment(seq, flags);
  if (fd < 0) s.cursor.gap = 1;
  else {
    s.cursor.gap = !all_bytes(fd, r->bytes, r->size, true);
    close(fd);
    if (!s.cursor.gap) s.journal_bytes += r->size;
  }
}

static bool get_record(int fd, struct record *r, uint64_t expected) {
  if (!all_bytes(fd, r->bytes, 4, false)) return false;
  uint32_t n = get32(r->bytes);
  if (n < RECORD_HEAD - 4 || n > RECORD_MAX - 4) return false;
  r->size = n + 4;
  return all_bytes(fd, r->bytes + 4, n, false) && get64(r->bytes + 5) == expected;
}

static enum status replay(uint64_t after, Byte *out, uint32_t max, uint32_t *used) {
  if (after > s.cursor.seq) return INVALID;
  if (s.cursor.gap) return GAP;
  int fd = -1;
  struct record disk;
  *used = 0;
  for (uint64_t seq = after + 1; seq <= s.cursor.seq; ++seq) {
    struct record *r = &ring[seq % RING_EVENTS];
    if (!r->size || get64(r->bytes + 5) != seq) {
      if (fd < 0 || (seq - 1) % SEGMENT_EVENTS == 0) {
        if (fd >= 0) close(fd);
        fd = open_segment(seq, O_RDONLY);
        if (fd < 0) return GAP;
        uint64_t begin = seq - (seq - 1) % SEGMENT_EVENTS;
        while (begin < seq) {
          if (!get_record(fd, &disk, begin++)) { close(fd); return GAP; }
        }
      }
      if (!get_record(fd, &disk, seq)) { close(fd); return GAP; }
      r = &disk;
    }
    if (r->size > max - *used) break;
    memcpy(out + *used, r->bytes, r->size);
    *used += r->size;
  }
  if (fd >= 0) close(fd);
  return OK;
}

static ssize_t drain_queue(int fd, struct queue *queue) {
  if (!queue->size) return 0;
  ssize_t n = write(fd, queue->bytes, queue->size);
  if (n > 0) {
    queue->size -= (size_t)n;
    memmove(queue->bytes, queue->bytes + n, queue->size);
  }
  return n;
}

static void deliver_signal(int sig) {
  if (!s.reaped && kill(-s.child, sig) < 0 && errno == ESRCH) kill(s.child, sig);
}

static void drain_input(void) {
  ssize_t n = drain_queue(s.master, &s.input);
  if (n > 0) s.master_input += (uint64_t)n;
}

static void note_size(uint32_t cols, uint32_t rows) {
  if (!cols || !rows || cols > UINT16_MAX || rows > UINT16_MAX || (s.cols == cols && s.rows == rows) || s.eof) return;
  struct winsize w = {.ws_col = (unsigned short)cols, .ws_row = (unsigned short)rows};
  if (ioctl(s.master, TIOCSWINSZ, &w) < 0) return;
  s.cols = cols; s.rows = rows;
  Byte geometry[8];
  set32(geometry, cols); set32(geometry + 4, rows);
  append(SIZE, geometry, sizeof(geometry));
}

static void collect_tty(void) {
  if (winch) {
    winch = 0;
    struct winsize w;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &w) == 0) note_size(w.ws_col, w.ws_row);
  }
  ssize_t n = drain_queue(STDOUT_FILENO, &s.output);
  if (n > 0) s.mirror += (uint64_t)n;
  else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
    s.output.size = 0;
    deliver_signal(SIGHUP);
  }

  if (!s.eof) {
    while (s.input.size < QUEUE_SIZE) {
      n = read(STDIN_FILENO, s.input.bytes + s.input.size, QUEUE_SIZE - s.input.size);
      if (n <= 0) break;
      s.input.size += (size_t)n;
      s.cursor.human += (uint64_t)n;
      s.cursor.last_human = now();
      Byte input[16];
      set64(input, s.cursor.human); set64(input + 8, s.cursor.last_human);
      append(INPUT, input, sizeof(input));
      drain_input();
    }
    drain_input();
  }
  while (!s.eof && QUEUE_SIZE - s.output.size >= CHUNK_LIMIT) {
    n = read(s.master, s.output.bytes + s.output.size, CHUNK_LIMIT);
    if (n < 0 && errno != EIO) break;
    if (n <= 0) { s.eof = 1; break; }
    append(OUTPUT, s.output.bytes + s.output.size, (uint32_t)n);
    s.cursor.output += (uint64_t)n;
    s.output.size += (size_t)n;
  }
  s.cursor.human_pending = s.input.size > 0;
}

static void collect_pipe(int *fd, enum event stream, uint64_t *offset) {
  if (*fd < 0) return;
  // Limit a pass so a noisy stream can't starve the other one or control RPC.
  for (int i = 0; i < 16; ++i) {
    Byte bytes[CHUNK_LIMIT];
    ssize_t n = read(*fd, bytes, sizeof(bytes));
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) return;
    if (n <= 0) {
      if (n < 0) s.cursor.gap = 1;
      close(*fd);
      *fd = -1;
      return;
    }
    append(stream, bytes, (uint32_t)n);
    *offset += (uint64_t)n;
  }
}

static void collect(void) {
  if (termination) {
    int sig = termination;
    termination = 0;
    deliver_signal(sig);
  }
  if (pipe_mode()) {
    collect_pipe(&pipes.stdout_fd, OUTPUT, &s.cursor.output);
    collect_pipe(&pipes.stderr_fd, ERROR_OUTPUT, &pipes.stderr_offset);
    s.eof = pipes.stdout_fd < 0 && pipes.stderr_fd < 0;
  } else collect_tty();

  if (!s.reaped) {
    pid_t got = waitpid(s.child, &s.wait_status, WNOHANG);
    if (got == s.child) s.reaped = 1;
    else if (got < 0 && errno != EINTR) fatal("waitpid");
  }
  if (s.reaped && s.eof && !s.cursor.ended) {
    s.cursor.ended = 1;
    Byte status[8];
    set32(status, WIFSIGNALED(s.wait_status) ? WTERMSIG(s.wait_status) : 0);
    set32(status + 4, WIFSIGNALED(s.wait_status) ? 128 + WTERMSIG(s.wait_status) : WEXITSTATUS(s.wait_status));
    append(END, status, sizeof(status));
  }
}

static bool registered(uint64_t epoch, const Byte *id) {
  char expected[128], actual[128], uuid[2 * ID_SIZE + 1];
  hex(id, ID_SIZE, uuid);
  int n = snprintf(expected, sizeof(expected), "{\"generation\":%llu,\"id\":\"%.8s-%.4s-%.4s-%.4s-%.12s\"}",
    (unsigned long long)epoch, uuid, uuid + 8, uuid + 12, uuid + 16, uuid + 20);
  int fd = open(s.controller_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return false;
  ssize_t used = read(fd, actual, sizeof(actual));
  close(fd);
  return n == used && memcmp(expected, actual, (size_t)n) == 0;
}

static uint32_t snapshot(Byte *out) {
  const uint64_t values[] = {s.generation, s.cursor.epoch, s.cursor.seq, s.cursor.output, s.cursor.human,
    s.cursor.last_human, now(), s.mirror, (uint64_t)getpid(), (uint64_t)s.child};
  for (size_t i = 0; i < sizeof(values) / sizeof(values[0]); ++i) set64(out + 8 * i, values[i]);
  const uint32_t geometry[] = {s.init_cols, s.init_rows, s.cols, s.rows};
  for (size_t i = 0; i < sizeof(geometry) / sizeof(geometry[0]); ++i) set32(out + 80 + 4 * i, geometry[i]);
  out[96] = s.cursor.ended;
  out[97] = s.cursor.gap;
  out[98] = s.cursor.human_pending;
  out[99] = pipe_mode();
  set32(out + 100, s.cursor.ended ? (uint32_t)s.wait_status : 0);
  memcpy(out + 104, s.transaction, ID_SIZE);
  memcpy(out + 120, s.build, sizeof(s.build));
  if (pipe_mode()) {
    set64(out + 152, pipes.stderr_offset);
    return 160;
  }
  return 152;
}

static enum status write_request(const Byte *body, size_t length, Byte *reply, uint32_t *reply_size) {
  const size_t header = 5 * 8 + ID_SIZE;
  if (length <= header || length > header + CHUNK_LIMIT) return INVALID;
  struct condition condition = {get64(body), get64(body + 8), get64(body + 16), get64(body + 24), get64(body + 32)};
  if (condition.epoch != s.cursor.epoch || !condition.epoch) return STALE;
  char name[48] = "write-";
  hex(body + 40, ID_SIZE, name + strlen(name));
  Sha256 hash;
  Byte digest[32], receipt[45];
  sha_init(&hash);
  sha_update(&hash, body + header, length - header);
  sha_finish(&hash, digest);
  int fd = openat(s.journal, name, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return FAILED;
  ssize_t size = read(fd, receipt, sizeof(receipt));
  if (size != 0) {
    close(fd);
    if (size != sizeof(receipt)) return UNKNOWN;
    if (memcmp(receipt, digest, sizeof(digest)) != 0) return INVALID;
    memcpy(reply, receipt + 33, 12);
    *reply_size = 12;
    return receipt[32];
  }
  memcpy(receipt, digest, sizeof(digest));
  receipt[32] = UNKNOWN;
  memset(receipt + 33, 0, 12);
  if (!all_bytes(fd, receipt, sizeof(receipt), true)) { close(fd); return FAILED; }

  // Journal preparation and client traffic may have raced with input. Drain
  // readable fds here, after the last blocking filesystem operation.
  collect();
  struct pollfd human = {STDIN_FILENO, POLLIN, 0};
  if (!pipe_mode() && poll(&human, 1, 0) > 0 && (human.revents & POLLIN)) collect();
  uint32_t written = 0;
  enum status result = guarded_write(s.master, &s.cursor, &condition, now(),
    body + header, length - header, write, &written);
  if (!written && result != UNKNOWN) {
    if (unlinkat(s.journal, name, 0) < 0) result = UNKNOWN;
    close(fd);
    return result;
  }
  receipt[32] = result;
  set64(receipt + 33, s.master_input);
  set32(receipt + 41, written);
  s.master_input += written;
  if (pwrite(fd, receipt + 32, 13, 32) != 13) result = UNKNOWN;
  close(fd);
  Byte record[ID_SIZE + 4];
  memcpy(record, body + 40, ID_SIZE);
  set32(record + ID_SIZE, written);
  append(WRITTEN, record, sizeof(record));
  memcpy(reply, receipt + 33, 12);
  *reply_size = 12;
  return result;
}

static bool digest_file(int source, int target, Byte digest[32]) {
  Sha256 hash;
  sha_init(&hash);
  for (;;) {
    Byte buffer[CHUNK_LIMIT];
    ssize_t n = read(source, buffer, sizeof(buffer));
    if (n < 0 && errno == EINTR) continue;
    if (n < 0 || (n && target >= 0 && !all_bytes(target, buffer, (size_t)n, true))) return false;
    if (!n) break;
    sha_update(&hash, buffer, (size_t)n);
  }
  sha_finish(&hash, digest);
  return true;
}

static bool manifest_matches(const char *path, const Byte *digest, const char *file, const char *header) {
  size_t n = strlen(path);
  if (n <= sizeof(ASSET) || path[n - sizeof(ASSET)] != '/' || strcmp(path + n - sizeof(ASSET) + 1, ASSET)) return false;
  char name[PATH_MAX], text[1024], wanted[128], hash[65];
  memcpy(name, path, n - sizeof(ASSET) + 1);
  strcpy(name + n - sizeof(ASSET) + 1, file);
  int fd = open(name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return false;
  ssize_t size = read(fd, text, sizeof(text) - 1);
  close(fd);
  if (size < (ssize_t)strlen(header)) return false;
  text[size] = 0;
  if (strncmp(text, header, strlen(header))) return false;
  hex(digest, 32, hash);
  snprintf(wanted, sizeof(wanted), "\n%s %s\n", ASSET, hash);
  return strstr(text, wanted) != NULL;
}

static enum status replace_image(const Byte *body, size_t length) {
  const size_t header = 8 + ID_SIZE + 32;
  if (length <= header || length >= header + PATH_MAX || memchr(body + header, 0, length - header) ||
      get64(body) != s.generation || s.cursor.ended || s.cursor.gap) return INVALID;
  char candidate[PATH_MAX], staged[PATH_MAX];
  memcpy(candidate, body + header, length - header);
  candidate[length - header] = 0;
  int n = snprintf(staged, sizeof(staged), "%s/.image-XXXXXX", s.dir);
  if (candidate[0] != '/' || n <= 0 || n >= (int)sizeof(staged) ||
      !manifest_matches(candidate, body + 24, "manifest", MANIFEST_HEAD) ||
      (pipe_mode() && !manifest_matches(candidate, body + 24, "pipes", PIPE_MANIFEST))) return INVALID;
  int input = open(candidate, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  if (input < 0) return FAILED;
  struct stat st;
  int target = -1;
  if (fstat(input, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= 4 * 1024 * 1024 &&
      st.st_mode & 0100) target = mkstemp(staged);
  Byte actual[32];
  bool valid = target >= 0 && digest_file(input, target, actual) && memcmp(actual, body + 24, 32) == 0 &&
    fchmod(target, 0500) == 0;
  close(input);
  if (target >= 0) close(target);
  if (!valid) {
    if (target >= 0) unlink(staged);
    return INVALID;
  }

  collect();
  struct state next = s;
  next.generation++;
  memcpy(next.transaction, body + 8, ID_SIZE);
  memcpy(next.build, actual, 32);
  const int inherit[] = {s.master, s.listener, s.journal, s.keeper,
    pipe_mode() ? pipes.stdout_fd : -1, pipe_mode() ? pipes.stderr_fd : -1};
  if (pwrite(s.keeper, &next, sizeof(next), 0) != sizeof(next) ||
      (pipe_mode() && pwrite(s.keeper, &pipes, sizeof(pipes), sizeof(next)) != sizeof(pipes))) {
    unlink(staged); return FAILED;
  }
  bool prepared = true;
  for (size_t i = 0; i < sizeof(inherit) / sizeof(inherit[0]); ++i)
    if (inherit[i] >= 0 && descriptor_flags(inherit[i], false) < 0) prepared = false;
  char state_fd[32];
  snprintf(state_fd, sizeof(state_fd), "%d", s.keeper);
  char *const argv[] = {staged, "--reattach", state_fd, NULL};
  if (prepared) execve(staged, argv, environ);
  for (size_t i = 0; i < sizeof(inherit) / sizeof(inherit[0]); ++i)
    if (inherit[i] >= 0) descriptor_flags(inherit[i], true);
  unlink(staged);
  return FAILED;
}

static void respond(struct client *c, enum status status, uint32_t size) {
  set32(c->bytes, size + 1);
  c->bytes[4] = status;
  c->response = size + 5;
}

static void dispatch(struct client *c) {
  Byte *request = c->bytes + 4, *out = c->bytes + 5;
  size_t length = c->used - 4;
  if (length < 2 + ID_SIZE || request[0] != PROTOCOL || memcmp(request + 2, s.incarnation, ID_SIZE)) {
    respond(c, INVALID, 0);
    return;
  }
  int method = request[1];
  const Byte *body = request + 2 + ID_SIZE;
  length -= 2 + ID_SIZE;
  if ((method == HELLO || method == SNAPSHOT) && !length) { respond(c, OK, snapshot(out)); return; }
  if (method == READ && length == 12) {
    uint64_t after = get64(body);
    uint32_t max = get32(body + 8), n = 0;
    if (max < RECORD_MAX || max >= FRAME_LIMIT) { respond(c, INVALID, 0); return; }
    enum status status = replay(after, out, max, &n);
    respond(c, status, status == OK ? n : 0);
    return;
  }
  if (length < 8 + ID_SIZE) { respond(c, INVALID, 0); return; }
  uint64_t epoch = get64(body);
  const Byte *controller = body + 8;
  bool owns = epoch && epoch == s.cursor.epoch && !memcmp(controller, s.controller, ID_SIZE);
  if (method == CLAIM && length == 24) {
    if (!owns && (epoch <= s.cursor.epoch || !registered(epoch, controller))) { respond(c, STALE, 0); return; }
    s.cursor.epoch = epoch;
    memcpy(s.controller, controller, ID_SIZE);
    respond(c, OK, snapshot(out));
    return;
  }
  if (!owns) { respond(c, STALE, 0); return; }
  body += 24; length -= 24;

  if (method == WRITE) {
    uint32_t size = 0;
    enum status status = write_request(body, length, out, &size);
    respond(c, status, size);
  } else if (method == RESIZE && length == 8 && !pipe_mode()) {
    uint32_t cols = get32(body), rows = get32(body + 4);
    if (!cols || !rows || cols > UINT16_MAX || rows > UINT16_MAX) respond(c, INVALID, 0);
    else { note_size(cols, rows); respond(c, s.eof ? EXITED : OK, snapshot(out)); }
  } else if (method == SIGNAL && length == 1) {
    const int allowed[] = {SIGINT, SIGTERM, SIGHUP};
    if (*body >= sizeof(allowed) / sizeof(allowed[0])) respond(c, INVALID, 0);
    else if (s.reaped) respond(c, EXITED, 0);
    else { deliver_signal(allowed[*body]); respond(c, OK, 0); }
  } else if (method == HANDOFF) respond(c, replace_image(body, length), 0);
  else respond(c, INVALID, 0);
}

static void service(struct client *c, short events) {
  bool done = now() >= c->deadline || (events & (POLLERR | POLLNVAL));
  if (!done && c->response) {
    ssize_t n = write(c->fd, c->bytes + c->sent, c->response - c->sent);
    if (n > 0) c->sent += (size_t)n;
    if (c->sent == c->response || (n < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK)) done = true;
  } else if (!done && (events & (POLLIN | POLLHUP))) {
    ssize_t n = read(c->fd, c->bytes + c->used, c->need - c->used);
    if (n > 0) c->used += (size_t)n;
    if (!n || (n < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK)) done = true;
    else if (c->used == 4 && c->need == 4) {
      uint32_t need = get32(c->bytes);
      if (need < 2 + ID_SIZE || need > FRAME_LIMIT) done = true;
      else c->need = need + 4;
    } else if (c->used == c->need) dispatch(c);
  }
  if (done) { close(c->fd); c->fd = -1; }
}

static void run(void) {
  uint64_t ended_at = 0;
  for (size_t i = 0; i < CLIENTS; ++i) clients[i].fd = -1;
  for (;;) {
    collect();
    if (s.cursor.ended && !s.output.size) {
      if (!ended_at) ended_at = now();
      if (now() - ended_at >= 300000000) break;
    }
    bool read_master = !s.eof && s.output.size <= QUEUE_SIZE - CHUNK_LIMIT;
    bool write_master = !s.eof && s.input.size > 0;
    bool pty = !pipe_mode();
    struct pollfd p[4 + CLIENTS] = {
      {pty ? (s.eof || s.input.size == QUEUE_SIZE ? -1 : STDIN_FILENO) : pipes.stdout_fd, POLLIN, 0},
      {pty ? (s.output.size ? STDOUT_FILENO : -1) : pipes.stderr_fd, pty ? POLLOUT : POLLIN, 0},
      {pty && (read_master || write_master) ? s.master : -1, (read_master ? POLLIN : 0) | (write_master ? POLLOUT : 0), 0},
      {s.listener, POLLIN, 0},
    };
    for (size_t i = 0; i < CLIENTS; ++i)
      p[i + 4] = (struct pollfd){clients[i].fd, clients[i].response ? POLLOUT : POLLIN, 0};
    if (poll(p, sizeof(p) / sizeof(p[0]), 100) < 0) {
      if (errno == EINTR) continue;
      fatal("poll");
    }
    collect();
    for (size_t i = 0; i < CLIENTS; ++i)
      if (clients[i].fd >= 0) service(&clients[i], p[i + 4].revents);
    if (p[3].revents & POLLIN) {
      int fd = accept(s.listener, NULL, NULL);
      if (fd < 0) continue;
      size_t i = 0;
      while (i < CLIENTS && clients[i].fd >= 0) ++i;
      if (i == CLIENTS || !same_uid(fd) || descriptor_flags(fd, true) < 0 || nonblock(fd) < 0) close(fd);
      else {
        clients[i].fd = fd; clients[i].deadline = now() + 5000000000;
        clients[i].need = 4; clients[i].used = clients[i].sent = clients[i].response = 0;
      }
    }
  }
}

static void restore_tty(void) {
  if (!s.term_changed) return;
  tcsetattr(STDIN_FILENO, TCSANOW, &s.saved_tty);
  fcntl(STDIN_FILENO, F_SETFL, s.in_flags);
  fcntl(STDOUT_FILENO, F_SETFL, s.out_flags);
}

static void start_pipes(char **argv) {
  int input[2], output[2], error[2];
  if (pipe(input) < 0 || pipe(output) < 0 || pipe(error) < 0) fatal("pipes");
  if ((s.child = fork()) < 0) fatal("fork");
  if (!s.child) {
    if (setpgid(0, 0) < 0 || dup2(input[0], STDIN_FILENO) < 0 || dup2(output[1], STDOUT_FILENO) < 0 ||
        dup2(error[1], STDERR_FILENO) < 0) _exit(126);
    close(input[0]); close(input[1]); close(output[0]); close(output[1]); close(error[0]); close(error[1]);
    signal(SIGPIPE, SIG_DFL);
    execve(argv[0], argv, environ);
    _exit(127);
  }
  close(input[0]); close(output[1]); close(error[1]);
  s.master = input[1]; pipes.stdout_fd = output[0]; pipes.stderr_fd = error[0];
  const int fds[] = {s.master, pipes.stdout_fd, pipes.stderr_fd};
  for (size_t i = 0; i < sizeof(fds) / sizeof(fds[0]); ++i)
    if (descriptor_flags(fds[i], true) < 0 || nonblock(fds[i]) < 0) fatal("nonblocking pipe");
}

static void start(char **argv) {
  s.magic = !strcmp(argv[1], "--pipes") ? PIPE_MAGIC : BOOT_MAGIC;
  s.generation = 1;
  if (!path_copy(s.socket_path, sizeof(s.socket_path), argv[2]) || !path_copy(s.dir, sizeof(s.dir), argv[3]) ||
      !path_copy(s.controller_path, sizeof(s.controller_path), argv[4]) || !unhex(argv[5], s.incarnation, ID_SIZE) ||
      !unhex(argv[6], s.build, 32) || *argv[7] != '/') { errno = EINVAL; fatal("launch options"); }
  char parent[PATH_MAX];
  strcpy(parent, s.socket_path);
  char *slash = strrchr(parent, '/');
  *slash = 0;
  if (!private_dir(parent) || !private_dir(s.dir)) { errno = EACCES; fatal("private holder directory"); }
  s.journal = open(s.dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (s.journal < 0) fatal("journal directory");
  char keep[PATH_MAX];
  int n = snprintf(keep, sizeof(keep), "%s/.state-XXXXXX", s.dir);
  if (n <= 0 || n >= (int)sizeof(keep)) { errno = ENAMETOOLONG; fatal("state path"); }
  s.keeper = mkstemp(keep);
  if (s.keeper < 0 || unlink(keep) < 0 || descriptor_flags(s.keeper, true) < 0) fatal("state descriptor");
  s.listener = open_listener();
  if (s.listener < 0) fatal("holder socket");
  if (pipe_mode()) { start_pipes(argv + 7); return; }

  struct winsize size = {24, 80, 0, 0};
  if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &size) < 0 || !size.ws_row || !size.ws_col) size = (struct winsize){24, 80, 0, 0};
  s.cols = s.init_cols = size.ws_col;
  s.rows = s.init_rows = size.ws_row;
  if (tcgetattr(STDIN_FILENO, &s.saved_tty) < 0) fatal("outer terminal");
  struct termios raw = s.saved_tty;
  cfmakeraw(&raw);
  s.in_flags = fcntl(STDIN_FILENO, F_GETFL);
  s.out_flags = fcntl(STDOUT_FILENO, F_GETFL);
  if (s.in_flags < 0 || s.out_flags < 0 || tcsetattr(STDIN_FILENO, TCSANOW, &raw) < 0) fatal("outer terminal mode");
  s.term_changed = 1;

  s.child = forkpty(&s.master, NULL, NULL, &size);
  if (s.child < 0) fatal("forkpty");
  if (!s.child) {
    signal(SIGPIPE, SIG_DFL);
    setenv("TERM", "xterm-256color", 1);
    execve(argv[7], argv + 7, environ);
    _exit(127);
  }
  if (descriptor_flags(s.master, true) < 0 || nonblock(s.master) < 0 ||
      nonblock(STDIN_FILENO) < 0 || nonblock(STDOUT_FILENO) < 0) fatal("nonblocking terminal");
}

int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "--self-check")) {
    puts(MANIFEST_HEAD ASSET);
    return 0;
  }
  if (argc == 2 && !strcmp(argv[1], "--self-check-pipes")) {
    puts(PIPE_MANIFEST ASSET);
    return 0;
  }
  umask(077);
  if (atexit(restore_tty)) return 125;
  install_signals();
  if (argc == 3 && !strcmp(argv[1], "--reattach")) {
    int fd = atoi(argv[2]);
    if (fd <= STDERR_FILENO || pread(fd, &s, sizeof(s), 0) != sizeof(s) ||
        (s.magic != BOOT_MAGIC && !pipe_mode()) || s.keeper != fd ||
        (pipe_mode() && pread(fd, &pipes, sizeof(pipes), sizeof(s)) != sizeof(pipes))) {
      s.term_changed = 0;
      errno = EINVAL; fatal("incompatible holder state");
    }
    const int inherited[] = {s.master, s.listener, s.journal, s.keeper,
      pipe_mode() ? pipes.stdout_fd : -1, pipe_mode() ? pipes.stderr_fd : -1};
    for (size_t i = 0; i < sizeof(inherited) / sizeof(inherited[0]); ++i)
      if (inherited[i] >= 0 && descriptor_flags(inherited[i], true) < 0) fatal("restore descriptor");
    unlink(argv[0]);
    winch = 1;
  } else if (argc >= 8 && (!strcmp(argv[1], "--launch") || !strcmp(argv[1], "--pipes"))) {
    // hc only owns stdio at this boundary. Drop accidental inherited fds
    // before allocating the explicitly managed descriptors.
    int limit = getdtablesize();
    for (int fd = 3; fd < limit; ++fd) close(fd);
    start(argv);
  } else return 64;
  run();
  unlink(s.socket_path);
  return WIFSIGNALED(s.wait_status) ? 128 + WTERMSIG(s.wait_status) : WEXITSTATUS(s.wait_status);
}
