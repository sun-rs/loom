import { useContext, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  TaskVirtualLayout,
  TaskVirtualRegistration,
} from "@rah-os/ui-web/neo-brutalist/task-virtual-layout";

function Rows() {
  const register = useContext(TaskVirtualRegistration);
  useLayoutEffect(
    () =>
      register?.("fixture", (key) => ({
        index: Number(key),
        estimatedStep: 100,
      })),
    [register],
  );
  return Array.from({ length: 30 }, (_, i) => (
    <div
      key={i}
      data-task-virtual-key={i}
      data-task-virtual-stack-id="fixture"
      data-index={i}
      style={{ height: 100 }}
    >
      Task {i}
    </div>
  ));
}

function Fixture() {
  const scroll = useRef<HTMLDivElement>(null);
  const [revision, refresh] = useState(0);
  return (
    <>
      <button
        onClick={() => {
          // A compositor scroll can precede the main-thread scroll event. A fresh
          // projection committing in that interval must not restore its old offset.
          scroll.current!.scrollTop += 40;
          flushSync(() => refresh((n) => n + 1));
        }}
      >
        Scroll during refresh
      </button>
      <button
        onClick={() => {
          scroll.current!.scrollTop -= 40;
          flushSync(() => refresh((n) => n + 1));
        }}
      >
        Scroll back during refresh
      </button>
      <output>{revision}</output>
      <div
        ref={scroll}
        data-testid="scroll"
        style={{ height: 400, overflow: "auto" }}
      >
        <TaskVirtualLayout scrollElementRef={scroll}>
          <Rows />
        </TaskVirtualLayout>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
