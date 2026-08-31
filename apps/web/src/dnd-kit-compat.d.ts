import type React from "react";
// @dnd-kit/core 6.3.1 uses React 18's global JSX.Element in six declarations.
// Bridge that name to React 19's scoped type; keep library checking enabled.
declare global {
  namespace JSX {
    type Element = React.JSX.Element;
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
