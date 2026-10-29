/** Run-length rows keep detailed portraits bounded; original native 8x8 SVG bytes stay untouched. */
export function detailedAvatarCells(
  grid: readonly (readonly string[])[],
  palette: Record<string, string>,
): string[] {
  const shapes: string[] = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const color = row[x],
        start = x;
      while (x < row.length && row[x] === color) x++;
      if (color !== "_")
        shapes.push(
          `<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${palette[color!]}"/>`,
        );
    }
  });
  return shapes;
}
