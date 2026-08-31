import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import { MessageMarkdown } from "../src/components/message-markdown.tsx";
import { MessageTimeline } from "../src/components/message-timeline.tsx";

const original = [
  "Markdown 稳定性回归",
  "```mermaid",
  "graph LR",
  "Room --> Agent",
  "```",
  "```ts",
  "const canonical = true;",
  "```",
  "[打开本地文件](file:///tmp/markdown-regression.ts)",
  "![RAH icon](/rah-app-icon.svg)",
].join("\n");

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 15_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("等待图表加载超时");
    await frame();
  }
}

function Fixture() {
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState(original);
  const [report, setReport] = useState("等待开始");
  const [running, setRunning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const linkRevision = useRef(-1);

  async function run() {
    setRunning(true);
    const failures: string[] = [];
    const check = (condition: boolean, label: string) => {
      if (!condition && !failures.includes(label)) failures.push(label);
    };
    try {
      flushSync(() => {
        setSource(original);
        setRevision(0);
      });
      await until(
        () =>
          scroller.current?.querySelector("iframe") !== null &&
          scroller.current?.querySelector(".shiki") !== null,
      );
      await frame();
      await frame();
      const initialFrame = scroller.current!.querySelector("iframe")!;
      const initialImage = scroller.current!.querySelector("img")!;
      const initialCode =
        scroller.current!.querySelector(".rah-markdown-code")!;
      let refreshes = 0;
      for (let next = 1; next <= 20; next++) {
        flushSync(() => setRevision(next));
        await frame();
        check(
          scroller.current!.querySelector("iframe") === initialFrame,
          "图表 iframe 被状态刷新替换",
        );
        check(
          scroller.current!.querySelector("img") === initialImage,
          "图片被状态刷新替换",
        );
        check(
          scroller.current!.querySelector(".rah-markdown-code") === initialCode,
          "代码块被状态刷新替换",
        );
        const rows = [
          ...scroller.current!.querySelectorAll(".rah-message-virtual-row"),
        ];
        check(
          rows.length === 2 &&
            rows[1]!.getBoundingClientRect().top >=
              rows[0]!.getBoundingClientRect().bottom - 1,
          "图表与后续消息重叠",
        );
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const sourceButton = [
        ...scroller.current!.querySelectorAll<HTMLButtonElement>("button"),
      ].find((b) => b.textContent === "源码")!;
      sourceButton.click();
      await frame();
      flushSync(() => setRevision(21));
      await frame();
      check(
        scroller.current!.querySelector(".rah-mermaid-source") !== null,
        "源码选择被状态刷新重置",
      );
      scroller
        .current!.querySelector<HTMLButtonElement>(".rah-markdown-file")!
        .click();
      check(linkRevision.current === 21, "文件链接没有使用最新回调");
      flushSync(() =>
        setSource(original.replace("Room --> Agent", "Room --> Changed")),
      );
      await frame();
      check(
        scroller
          .current!.querySelector(".rah-mermaid-source")
          ?.textContent?.includes("Changed") === true,
        "正文更新未显示新源码",
      );
      [...scroller.current!.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "图表")!
        .click();
      await until(
        () =>
          scroller
            .current!.querySelector("iframe")
            ?.srcdoc.includes("Changed") === true,
      );
      const updated = scroller.current!.querySelector("iframe")!;
      check(
        updated.getAttribute("sandbox") === "" &&
          updated.srcdoc.includes("default-src 'none'"),
        "图表沙箱/CSP边界变化",
      );
      setReport(
        JSON.stringify(
          {
            result: failures.length === 0 ? "PASS" : "FAIL",
            refreshes,
            failures,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setReport(`FAIL: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1>消息渲染稳定性（无后端、无模型调用）</h1>
      <button disabled={running} onClick={() => void run()} type="button">
        开始回归
      </button>
      <pre role="status">{report}</pre>
      <p>父组件刷新：{revision}</p>
      <div
        ref={scroller}
        style={{
          height: 700,
          overflow: "auto",
          border: "2px solid black",
          width: "100%",
        }}
      >
        <MessageTimeline
          followOnAppend={false}
          getItemKey={(item) => item.id}
          items={[
            { id: "markdown", body: source },
            { id: "after", body: "后续消息，不能被图表覆盖" },
          ]}
          renderItem={(item) => (
            <MessageMarkdown
              source={item.body}
              onOpenFile={() => {
                linkRevision.current = revision;
              }}
            />
          )}
          scrollElementRef={scroller}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
