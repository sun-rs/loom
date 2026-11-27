#define _GNU_SOURCE
#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#ifdef __APPLE__
#include <libproc.h>
#include <sys/un.h>
#else
#include <poll.h>
#include <stdlib.h>
#include <sys/stat.h>
#ifndef SO_PEERPIDFD
#define SO_PEERPIDFD 77
#endif
#endif

struct process {
    pid_t pid;
    pid_t parent;
    uint64_t birth;
    uint64_t started_ms;
};

struct peer {
    pid_t pid;
#ifdef __APPLE__
    audit_token_t token;
#else
    int pidfd;
#endif
};

static bool read_peer(int fd, struct peer *peer) {
#ifdef __APPLE__
    uid_t uid;
    gid_t gid;
    socklen_t pid_size = sizeof(peer->pid);
    socklen_t token_size = sizeof(peer->token);
    return getpeereid(fd, &uid, &gid) == 0 && uid == getuid() &&
        getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peer->pid, &pid_size) == 0 && pid_size == sizeof(peer->pid) &&
        getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &peer->token, &token_size) == 0 && token_size == sizeof(peer->token);
#else
    struct ucred credentials;
    socklen_t size = sizeof(credentials);
    if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &credentials, &size) != 0 || size != sizeof(credentials) ||
            credentials.uid != getuid()) return false;
    peer->pid = credentials.pid;
    size = sizeof(peer->pidfd);
    return getsockopt(fd, SOL_SOCKET, SO_PEERPIDFD, &peer->pidfd, &size) == 0 && size == sizeof(peer->pidfd);
#endif
}

static bool peer_alive(struct peer *peer) {
#ifdef __APPLE__
    // libproc validates the audit token's PID generation. Discard its path.
    char path[PROC_PIDPATHINFO_MAXSIZE];
    return proc_pidpath_audittoken(&peer->token, path, sizeof(path)) > 0;
#else
    struct pollfd monitor = { .fd = peer->pidfd, .events = POLLIN };
    return poll(&monitor, 1, 0) == 0;
#endif
}

#ifndef __APPLE__
static uint64_t boot_seconds(void) {
    FILE *stat = fopen("/proc/stat", "r");
    if (!stat) return 0;
    char line[256];
    uint64_t time = 0;
    while (fgets(line, sizeof(line), stat)) if (sscanf(line, "btime %" SCNu64, &time) == 1) break;
    fclose(stat);
    return time;
}
#endif

static bool read_process(pid_t pid, struct process *out) {
#ifdef __APPLE__
    struct proc_bsdinfo info;
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) ||
            info.pbi_pid != (uint32_t)pid || info.pbi_uid != getuid() || !info.pbi_start_tvsec) return false;
    const uint64_t birth = info.pbi_start_tvsec * 1000000 + info.pbi_start_tvusec;
    *out = (struct process){ pid, (pid_t)info.pbi_ppid, birth, birth / 1000 };
#else
    static uint64_t boot;
    if (!boot) boot = boot_seconds();
    const long hz = sysconf(_SC_CLK_TCK);
    if (!boot || hz <= 0) return false;
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/stat", pid);
    FILE *file = fopen(path, "r");
    if (!file) return false;
    struct stat info;
    char line[4096];
    bool ok = fstat(fileno(file), &info) == 0 && info.st_uid == getuid() && fgets(line, sizeof(line), file);
    fclose(file);
    if (!ok) return false;
    char *end = strrchr(line, ')');
    if (!end) return false;
    // /proc/PID/stat fields after comm: state (3), PPID (4), starttime (22).
    char *next;
    char *field = strtok_r(end + 1, " ", &next);
    if (!field || *field == 'Z' || *field == 'X') return false;
    field = strtok_r(NULL, " ", &next);
    if (!field) return false;
    pid_t parent = (pid_t)strtol(field, NULL, 10);
    for (int i = 4; field && i < 22; ++i) field = strtok_r(NULL, " ", &next);
    if (!field) return false;
    uint64_t birth = strtoull(field, NULL, 10);
    if (!birth) return false;
    *out = (struct process){ pid, parent, birth, boot * 1000 + birth * 1000 / (uint64_t)hz };
#endif
    return true;
}

static int ancestry(int fd) {
    struct peer peer;
    if (!read_peer(fd, &peer) || peer.pid <= 1 || !peer_alive(&peer)) return 1;
    struct process chain[64];
    size_t size = 0;
    pid_t pid = peer.pid;
    while (pid > 1 && size < sizeof(chain) / sizeof(*chain)) {
        struct process current;
        if (!read_process(pid, &current)) break;
        if (size && current.birth > chain[size - 1].birth) return 1;
        chain[size++] = current;
        pid = current.parent;
    }
    if (!size) return 1;
    for (size_t i = 0; i < size; ++i) {
        struct process current;
        if (!read_process(chain[i].pid, &current) || current.birth != chain[i].birth ||
                current.parent != chain[i].parent) return 1;
    }
    if (!peer_alive(&peer)) return 1;
    for (size_t i = 0; i < size; ++i) {
        struct process item = chain[i];
        printf("%d %d %" PRIu64 " %" PRIu64 "\n", item.pid, item.parent, item.birth, item.started_ms);
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 1) return ancestry(3);
    if (argc == 2 && !strcmp(argv[1], "--self-check")) {
        int pair[2];
        if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != 0) return 1;
        return ancestry(pair[0]);
    }
    return 1;
}
