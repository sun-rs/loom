// Loom-authored 32x32 pixel illustrations. Stable preset IDs and native frames remain unchanged.
import { readFileSync, writeFileSync } from "node:fs";
const path = "frontends/raft/loom/avatars/presets.json",
  data = JSON.parse(readFileSync(path, "utf8"));
const palette = {
  a: "#F9D8B7",
  b: "#D89A79",
  c: "#384F91",
  d: "#6E3E9C",
  e: "#D84250",
  f: "#FFC638",
  g: "#346BCA",
  h: "#72BDC5",
  i: "#448764",
  j: "#865132",
  k: "#62677C",
  l: "#FFF0D6",
  m: "#ECA1BA",
  n: "#B8DBED",
  o: "#9EB577",
  p: "#E27635",
  q: "#25273B",
  r: "#C9C3E8",
  s: "#A3DCE4",
  t: "#8D64BE",
  u: "#D4AD83",
  v: "#F6F4EC",
  w: "#8DAADE",
  x: "#F79744",
  y: "#7CADD5",
  z: "#B27570",
};
let grid;
const dot = (x, y, c) => {
  if (x >= 0 && x < 32 && y >= 0 && y < 32) grid[y][x] = c;
};
function rect(x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c);
}
function ellipse(cx, cy, rx, ry, c) {
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dot(x, y, c);
}
function line(x0, y0, x1, y1, c, width = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++)
    rect(
      Math.round(x0 + ((x1 - x0) * i) / (n || 1)),
      Math.round(y0 + ((y1 - y0) * i) / (n || 1)),
      width,
      width,
      c,
    );
}
function poly(points, c) {
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i],
          [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      if (inside) dot(x, y, c);
    }
}
function eye(x, y, color = "K") {
  ellipse(x, y, 2, 3, "K");
  rect(x, y - 1, 1, 2, color);
  dot(x - 1, y - 2, "W");
}
function smile(y = 24) {
  line(12, y, 15, y + 1, "K");
  line(15, y + 1, 19, y, "K");
}
function portrait(
  hair,
  shirt,
  { long = false, glasses = false, eyes = "c", bang = false } = {},
) {
  ellipse(16, 15, 12, 13, "K");
  ellipse(16, 14, 11, 12, hair);
  if (long) rect(5, 14, 22, 18, hair);
  ellipse(16, 18, 9, 11, "a");
  ellipse(7, 19, 2, 3, "a");
  ellipse(25, 19, 2, 3, "a");
  poly(
    [
      [8, 7],
      [24, 7],
      [25, 15],
      [21, 12],
      [20, 16],
      [17, 11],
      [14, 15],
      [12, 11],
      [7, 17],
    ],
    hair,
  );
  if (bang)
    poly(
      [
        [7, 10],
        [22, 8],
        [20, 16],
        [18, 20],
        [16, 12],
        [10, 16],
      ],
      hair,
    );
  eye(12, 19, eyes);
  eye(21, 19, eyes);
  line(15, 25, 18, 25, "b");
  if (glasses) {
    rect(8, 16, 8, 7, "K");
    rect(17, 16, 8, 7, "K");
    rect(9, 17, 6, 5, "a");
    rect(18, 17, 6, 5, "a");
    line(16, 18, 17, 18, "K");
    dot(12, 19, "K");
    dot(21, 19, "K");
  }
  rect(13, 28, 7, 4, "a");
  poly(
    [
      [2, 32],
      [6, 28],
      [12, 27],
      [16, 31],
      [21, 27],
      [27, 28],
      [31, 32],
    ],
    shirt,
  );
  line(16, 30, 16, 31, "W");
}
function robot(base, accent) {
  poly(
    [
      [4, 8],
      [10, 5],
      [11, 1],
      [15, 7],
      [26, 5],
      [29, 16],
      [25, 27],
      [16, 31],
      [6, 27],
      [3, 17],
    ],
    "K",
  );
  poly(
    [
      [5, 9],
      [11, 7],
      [12, 4],
      [16, 9],
      [25, 7],
      [27, 16],
      [23, 26],
      [16, 29],
      [8, 25],
      [5, 17],
    ],
    base,
  );
  poly(
    [
      [7, 13],
      [13, 12],
      [16, 15],
      [19, 12],
      [25, 13],
      [23, 19],
      [18, 20],
      [16, 25],
      [13, 20],
      [9, 19],
    ],
    "q",
  );
  line(8, 14, 12, 15, accent, 2);
  line(20, 15, 24, 14, accent, 2);
  poly(
    [
      [13, 19],
      [19, 19],
      [18, 27],
      [15, 29],
    ],
    "v",
  );
  line(16, 0, 17, 11, accent);
  rect(5, 23, 3, 5, accent);
  rect(24, 22, 3, 5, accent);
}
const glyphs = {
  A: ["01110", "11011", "11011", "11111", "11011", "11011", "11011"],
  C: ["01111", "11000", "11000", "11000", "11000", "11000", "01111"],
  G: ["01110", "11001", "11000", "11011", "11001", "11001", "01110"],
  K: ["11011", "11110", "11100", "11100", "11110", "11011", "11011"],
  M: ["10001", "11011", "11111", "10101", "10001", "10001", "10001"],
  O: ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
  P: ["11110", "11011", "11011", "11110", "11000", "11000", "11000"],
  X: ["11011", "11011", "01110", "00100", "01110", "11011", "11011"],
};
function glyph(letter, color) {
  glyphs[letter].forEach((r, y) =>
    r.split("").forEach((v, x) => {
      if (v === "1") rect(8 + x * 3, 6 + y * 3, 3, 3, color);
    }),
  );
}
function provider(id) {
  const backgrounds = {
    gemini: "n",
    kimi: "g",
    openai: "i",
    codex: "q",
    claude: "p",
    anthropic: "l",
    deepseek: "g",
    grok: "q",
    muse: "d",
    glm: "c",
    opencode: "q",
    pi: "p",
    antigravity: "q",
  };
  rect(0, 0, 32, 32, backgrounds[id]);
  if (id === "gemini" || id === "antigravity") {
    poly(
      [
        [16, 3],
        [20, 12],
        [29, 16],
        [20, 20],
        [16, 29],
        [12, 20],
        [3, 16],
        [12, 12],
      ],
      id === "gemini" ? "d" : "W",
    );
    poly(
      [
        [16, 4],
        [20, 12],
        [28, 16],
        [17, 16],
      ],
      "g",
    );
    poly(
      [
        [17, 17],
        [27, 17],
        [20, 21],
        [17, 28],
      ],
      "e",
    );
  } else if (id === "deepseek") {
    ellipse(16, 18, 12, 8, "W");
    poly(
      [
        [3, 17],
        [1, 10],
        [8, 15],
      ],
      "W",
    );
    ellipse(22, 17, 2, 2, "g");
    poly(
      [
        [20, 24],
        [25, 25],
        [23, 29],
      ],
      "W",
    );
    line(15, 9, 19, 5, "W", 2);
    line(19, 5, 23, 6, "W", 2);
  } else if (id === "claude") {
    for (let a = 0; a < 12; a++) {
      const t = (a * Math.PI) / 6;
      line(
        16 + Math.round(Math.cos(t) * 5),
        16 + Math.round(Math.sin(t) * 5),
        16 + Math.round(Math.cos(t) * 12),
        16 + Math.round(Math.sin(t) * 12),
        "l",
        2,
      );
    }
  } else if (id === "openai") {
    for (let a = 0; a < 6; a++) {
      const t = (a * Math.PI) / 3;
      ellipse(16 + Math.cos(t) * 6, 16 + Math.sin(t) * 6, 5, 6, "W");
      ellipse(16 + Math.cos(t) * 6, 16 + Math.sin(t) * 6, 3, 4, "i");
    }
    ellipse(16, 16, 4, 4, "i");
  } else if (id === "codex" || id === "opencode") {
    poly(
      [
        [11, 8],
        [3, 16],
        [11, 24],
        [14, 21],
        [8, 16],
        [14, 11],
      ],
      "W",
    );
    poly(
      [
        [21, 8],
        [29, 16],
        [21, 24],
        [18, 21],
        [24, 16],
        [18, 11],
      ],
      id === "codex" ? "C" : "W",
    );
  } else
    glyph(
      { kimi: "K", anthropic: "A", grok: "X", muse: "M", glm: "G", pi: "P" }[
        id
      ] ?? "C",
      id === "anthropic" ? "K" : "W",
    );
}
function pokemon(id) {
  const electric = ["pichu", "pikachu", "raichu"].includes(id),
    turtle = ["squirtle", "wartortle", "blastoise"].includes(id),
    plant = ["bulbasaur", "ivysaur", "venusaur"].includes(id),
    fire = ["charmander", "charmeleon", "charizard"].includes(id),
    ghost = ["gastly", "haunter", "gengar"].includes(id),
    bird = ["zapdos", "moltres", "articuno"].includes(id);
  const body = electric
    ? "f"
    : turtle
      ? "h"
      : plant
        ? "o"
        : fire
          ? id === "charmeleon"
            ? "e"
            : "x"
          : ghost
            ? "d"
            : bird
              ? id === "zapdos"
                ? "f"
                : id === "moltres"
                  ? "x"
                  : "y"
              : id === "snorlax"
                ? "c"
                : id === "lapras"
                  ? "y"
                  : id === "mew"
                    ? "m"
                    : "r";
  if (ghost) {
    poly(
      [
        [2, 8],
        [8, 11],
        [9, 4],
        [16, 8],
        [23, 4],
        [24, 11],
        [30, 7],
        [27, 19],
        [30, 26],
        [22, 26],
        [17, 30],
        [8, 27],
        [2, 28],
        [5, 19],
      ],
      "q",
    );
    poly(
      [
        [4, 11],
        [10, 13],
        [11, 7],
        [16, 11],
        [22, 7],
        [23, 13],
        [28, 11],
        [25, 20],
        [27, 25],
        [20, 24],
        [16, 28],
        [9, 24],
        [5, 25],
        [7, 18],
      ],
      body,
    );
    line(8, 15, 13, 17, "e", 2);
    line(20, 17, 24, 15, "e", 2);
    poly(
      [
        [8, 21],
        [24, 21],
        [21, 26],
        [12, 26],
      ],
      "W",
    );
    line(12, 21, 12, 25, "K");
    line(20, 21, 20, 25, "K");
    return;
  }
  if (plant) {
    poly(
      [
        [5, 10],
        [1, 3],
        [11, 8],
        [16, 1],
        [20, 8],
        [30, 4],
        [26, 15],
      ],
      "i",
    );
    if (id !== "bulbasaur") {
      ellipse(16, 7, id === "venusaur" ? 11 : 7, 6, "m");
      ellipse(16, 6, 3, 3, "f");
    }
  }
  if (electric) {
    poly(
      [
        [6, 14],
        [2, 1],
        [8, 3],
        [12, 14],
      ],
      "K",
    );
    poly(
      [
        [20, 14],
        [24, 2],
        [29, 0],
        [27, 14],
      ],
      "K",
    );
    poly(
      [
        [7, 13],
        [5, 5],
        [8, 6],
        [11, 14],
      ],
      body,
    );
    poly(
      [
        [21, 14],
        [25, 5],
        [27, 4],
        [25, 14],
      ],
      body,
    );
  }
  if (turtle && id !== "squirtle") {
    poly(
      [
        [6, 17],
        [1, 5],
        [8, 7],
        [12, 15],
      ],
      "r",
    );
    poly(
      [
        [21, 15],
        [27, 5],
        [31, 6],
        [26, 20],
      ],
      "r",
    );
    if (id === "blastoise") {
      rect(1, 17, 6, 12, "k");
      rect(25, 17, 6, 12, "k");
      rect(2, 18, 4, 3, "q");
      rect(26, 18, 4, 3, "q");
    }
  }
  if (fire && id === "charizard") {
    poly(
      [
        [5, 19],
        [2, 3],
        [12, 12],
      ],
      "x",
    );
    poly(
      [
        [21, 12],
        [30, 3],
        [28, 20],
      ],
      "x",
    );
    poly(
      [
        [5, 16],
        [4, 7],
        [10, 12],
      ],
      "g",
    );
    poly(
      [
        [23, 13],
        [28, 7],
        [27, 17],
      ],
      "g",
    );
  }
  if (id === "lapras") {
    poly(
      [
        [6, 16],
        [1, 9],
        [2, 5],
        [7, 9],
      ],
      body,
    );
    poly(
      [
        [25, 16],
        [30, 9],
        [29, 5],
        [24, 9],
      ],
      body,
    );
    poly(
      [
        [14, 10],
        [16, 2],
        [19, 12],
      ],
      "l",
    );
  }
  if (id === "snorlax" || id === "mew" || id === "mewtwo") {
    poly(
      [
        [5, 15],
        [6, 3],
        [13, 11],
      ],
      body,
    );
    poly(
      [
        [20, 11],
        [26, 3],
        [27, 15],
      ],
      body,
    );
  }
  if (bird) {
    poly(
      [
        [6, 13],
        [5, 4],
        [14, 10],
        [16, 1],
        [20, 11],
        [29, 5],
        [26, 15],
      ],
      body,
    );
  }
  ellipse(16, 21, 13, 13, "K");
  ellipse(16, 21, 12, 12, body);
  ellipse(15, 17, 8, 5, body);
  if (id === "snorlax") {
    ellipse(16, 23, 10, 10, "l");
    line(8, 19, 12, 20, "K");
    line(20, 20, 24, 19, "K");
    smile(25);
    return;
  }
  if (electric) {
    ellipse(6, 24, 3, 3, "e");
    ellipse(26, 24, 3, 3, "e");
  }
  if (plant) {
    poly(
      [
        [6, 17],
        [11, 15],
        [10, 20],
      ],
      "i",
    );
    poly(
      [
        [24, 22],
        [28, 20],
        [27, 26],
      ],
      "i",
    );
    poly(
      [
        [13, 28],
        [16, 26],
        [18, 30],
      ],
      "i",
    );
  }
  if (fire) ellipse(17, 29, 7, 5, "l");
  if (bird) {
    eye(10, 19);
    eye(22, 19);
    poly(
      [
        [13, 22],
        [19, 22],
        [16, 28],
      ],
      id === "zapdos" ? "p" : "f",
    );
  } else {
    eye(10, 21, plant ? "e" : fire ? "g" : "K");
    eye(22, 21, plant ? "e" : fire ? "g" : "K");
    poly(
      [
        [15, 23],
        [18, 23],
        [16, 25],
      ],
      "K",
    );
    smile(28);
  }
  if (id === "wartortle") line(3, 31, 7, 27, "r", 2);
}
for (const avatar of data.avatars) {
  grid = Array.from({ length: 32 }, () => Array(32).fill("_"));
  let id = avatar.id.slice(5);
  if (avatar.group === "providers") provider(id);
  else if (id.startsWith("eva-unit") || id === "eva-mark06") {
    const n = id.match(/\d+/)?.[0];
    robot(
      n === "02"
        ? "e"
        : n === "00"
          ? "f"
          : n === "08"
            ? "m"
            : n === "06"
              ? "c"
              : "t",
      n === "01" ? "L" : "f",
    );
  } else if (avatar.group === "pokemon") pokemon(id);
  else if (id === "doraemon" || id === "dorami") {
    const base = id === "doraemon" ? "g" : "f";
    ellipse(16, 17, 15, 15, "K");
    ellipse(16, 16, 14, 14, base);
    ellipse(16, 21, 12, 11, "W");
    ellipse(12, 11, 4, 5, "W");
    ellipse(20, 11, 4, 5, "W");
    rect(13, 10, 2, 4, "K");
    rect(18, 10, 2, 4, "K");
    ellipse(16, 17, 3, 3, "e");
    dot(15, 16, "W");
    line(16, 20, 16, 26, "K");
    line(8, 25, 12, 28, "K");
    line(12, 28, 21, 28, "K");
    line(21, 28, 24, 25, "K");
    for (let j = -1; j < 2; j++) {
      line(2, 20 + j * 3, 10, 22 + j, "K");
      line(22, 22 + j, 30, 20 + j * 3, "K");
    }
    rect(5, 30, 22, 2, "e");
    ellipse(16, 30, 3, 3, "f");
  } else {
    const people = {
      "eva-shinji": ["q", "W", {}],
      "eva-rei": ["w", "W", { eyes: "e" }],
      "eva-asuka": ["p", "e", { long: true, eyes: "g" }],
      "eva-misato": ["d", "e", { long: true, bang: true }],
      "eva-kaworu": ["r", "k", { eyes: "e" }],
      "eva-mari": ["j", "m", { long: true, glasses: true }],
      "eva-ritsuko": ["f", "W", { bang: true }],
      "eva-gendo": ["q", "q", { glasses: true }],
      "geass-lelouch": ["q", "q", { bang: true, eyes: "d" }],
      "geass-cc": ["o", "W", { long: true, eyes: "f" }],
      "geass-kallen": ["e", "e", { bang: true }],
      "geass-suzaku": ["j", "W", {}],
      nobita: ["K", "f", { glasses: true }],
      shizuka: ["q", "m", { long: true }],
      gian: ["j", "p", {}],
      suneo: ["q", "i", { bang: true }],
    };
    const [hair, shirt, options] = people[id] ?? ["q", "c", {}];
    portrait(hair, shirt, options);
    if (id === "eva-asuka") {
      rect(7, 8, 4, 2, "e");
      rect(23, 8, 4, 2, "e");
    }
    if (id === "eva-gendo") {
      rect(10, 24, 13, 4, "q");
      rect(13, 28, 6, 2, "a");
    }
    if (id === "geass-lelouch") {
      poly(
        [
          [13, 28],
          [16, 31],
          [20, 28],
          [23, 32],
          [10, 32],
        ],
        "f",
      );
    }
  }
  // Distinct silhouettes and evolution details; do not reuse one portrait for a family.
  if (avatar.group === "pokemon") {
    if (id === "pichu") {
      poly(
        [
          [4, 27],
          [12, 29],
          [16, 27],
          [21, 29],
          [28, 27],
          [27, 32],
          [5, 32],
        ],
        "q",
      );
    }
    if (id === "raichu") {
      ellipse(6, 24, 3, 3, "l");
      ellipse(26, 24, 3, 3, "l");
      line(2, 12, 4, 6, "j", 2);
      line(26, 9, 30, 6, "j", 2);
      rect(14, 29, 5, 3, "l");
    }
    if (id === "blastoise") {
      rect(0, 20, 5, 12, "k");
      rect(27, 20, 5, 12, "k");
      rect(1, 21, 3, 3, "q");
      rect(28, 21, 3, 3, "q");
    }
    if (id === "wartortle") {
      poly(
        [
          [1, 10],
          [7, 15],
          [6, 24],
          [2, 22],
        ],
        "r",
      );
      poly(
        [
          [31, 10],
          [25, 15],
          [26, 24],
          [30, 22],
        ],
        "r",
      );
    }
    if (id === "ivysaur") {
      poly(
        [
          [9, 8],
          [13, 3],
          [18, 3],
          [23, 8],
          [20, 12],
          [12, 12],
        ],
        "e",
      );
    }
    if (id === "venusaur") {
      ellipse(10, 8, 6, 4, "m");
      ellipse(22, 8, 6, 4, "m");
      ellipse(16, 5, 6, 4, "m");
      ellipse(16, 9, 3, 3, "f");
      dot(8, 8, "W");
      dot(23, 8, "W");
    }
    if (id === "charizard") {
      poly(
        [
          [0, 21],
          [2, 10],
          [7, 15],
          [7, 28],
        ],
        "p",
      );
      poly(
        [
          [32, 21],
          [30, 10],
          [25, 15],
          [25, 28],
        ],
        "p",
      );
      line(2, 13, 5, 24, "g", 2);
      line(28, 13, 26, 24, "g", 2);
    }
    if (id === "zapdos") {
      poly(
        [
          [5, 17],
          [0, 12],
          [9, 12],
          [7, 4],
          [15, 10],
          [18, 0],
          [21, 11],
          [30, 8],
          [26, 17],
        ],
        "f",
      );
      line(7, 17, 12, 19, "K");
      line(20, 19, 25, 17, "K");
    }
    if (id === "moltres") {
      poly(
        [
          [4, 15],
          [3, 8],
          [8, 11],
          [11, 2],
          [16, 8],
          [19, 0],
          [22, 10],
          [28, 5],
          [26, 16],
        ],
        "e",
      );
      poly(
        [
          [7, 13],
          [12, 5],
          [16, 12],
          [20, 4],
          [24, 14],
        ],
        "f",
      );
    }
    if (id === "articuno") {
      poly(
        [
          [10, 12],
          [11, 3],
          [16, 7],
          [22, 2],
          [21, 13],
        ],
        "g",
      );
      poly(
        [
          [12, 12],
          [13, 6],
          [16, 10],
          [20, 5],
          [19, 13],
        ],
        "n",
      );
    }
    if (id === "mewtwo") {
      line(5, 12, 8, 5, "t", 2);
      line(24, 5, 26, 12, "t", 2);
      line(7, 19, 13, 20, "q");
      line(19, 20, 25, 19, "q");
      ellipse(16, 26, 5, 3, "v");
      dot(14, 25, "q");
      dot(18, 25, "q");
    }
    if (id === "mew") {
      eye(10, 21, "g");
      eye(22, 21, "g");
      line(28, 28, 30, 18, "m", 2);
      ellipse(29, 17, 2, 3, "m");
    }
    if (id === "gastly") {
      grid = Array.from({ length: 32 }, () => Array(32).fill("_"));
      for (let a = 0; a < 12; a++) {
        let t = (a * Math.PI) / 6;
        ellipse(16 + Math.cos(t) * 11, 16 + Math.sin(t) * 11, 4, 4, "t");
      }
      ellipse(16, 17, 11, 11, "q");
      poly(
        [
          [6, 13],
          [13, 16],
          [7, 19],
        ],
        "W",
      );
      poly(
        [
          [26, 13],
          [19, 16],
          [25, 19],
        ],
        "W",
      );
      dot(10, 16, "K");
      dot(22, 16, "K");
      poly(
        [
          [10, 23],
          [22, 23],
          [19, 26],
          [13, 26],
        ],
        "m",
      );
    }
    if (id === "haunter") {
      poly(
        [
          [0, 21],
          [4, 18],
          [5, 23],
          [8, 20],
          [8, 28],
          [3, 30],
          [0, 27],
        ],
        "t",
      );
      poly(
        [
          [32, 21],
          [28, 18],
          [27, 23],
          [24, 20],
          [24, 28],
          [29, 30],
          [32, 27],
        ],
        "t",
      );
      line(8, 14, 13, 17, "W", 2);
      line(20, 17, 25, 14, "W", 2);
    }
  }
  avatar.bg = avatar.bg ?? "C";
  avatar.grid = grid.map((r) => r.join("")).join("/");
}
data.version = 2;
data.palette = palette;
data.provenance =
  "Loom-authored detailed 32x32 pixel interpretations; native Raft frames and original 8x8 presets unchanged. Stable IDs. Not official brand or franchise assets.";
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
