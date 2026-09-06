from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import time
import traceback
from typing import Any

from playwright.sync_api import expect, sync_playwright

from native_codex_browser_smoke import (
    browser_headless,
    free_port,
    launch_browser,
    preflight_browser_runtime,
    request_json,
    selected_browser_name,
    start_daemon,
)
from native_smoke_process import terminate_process_tree
from safe_trash import move_path_to_trash


ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
CASE_IDS = [
    "ROOM-SHELL-001",
    "ROOM-CATALOG-DEEPLINK-PAGED-001",
    "ROOM-HISTORY-BOUNDED-001",
    "ROOM-HISTORY-ANCHOR-LATEST-001",
    "ROOM-TABS-KEYBOARD-001",
    "ROOM-EMPTY-STATE-001",
    "ROOM-DIVIDER-POINTER-BOUNDS-001",
    "ROOM-PROFILE-OWNERSHIP-001",
    "ROOM-TASK-CANONICAL-001",
    "ROOM-TASK-CARD-DISCLOSURE-001",
    "ROOM-TASK-PRESENTED-ACK-001",
    "ROOM-TASK-OFFSCREEN-PENDING-001",
    "ROOM-NOTIFICATION-PERMISSION-001",
    "ROOM-NOTIFICATION-INBOX-001",
    "ROOM-NOTIFICATION-MEMBERS-PENDING-001",
    "ROOM-NOTIFICATION-TASKS-PENDING-001",
    "ROOM-NOTIFICATION-HISTORY-PENDING-001",
    "ROOM-BREAKPOINT-767-768-001",
    "ROOM-MOBILE-390X844-001",
]

SOURCE_INPUTS = [
    "package.json",
    "package-lock.json",
    "packages/client-web/package.json",
    "packages/client-web/tsconfig.json",
    "packages/client-web/vite.config.ts",
    "scripts/build-web-client.mjs",
    "scripts/native_codex_browser_smoke.py",
    "scripts/native_smoke_process.py",
    "scripts/safe_trash.py",
    "scripts/room-browser-smoke.sh",
    "scripts/room_browser_smoke.py",
    "scripts/room_browser_fixture.ts",
    "scripts/room_browser_emit_notification.ts",
    "docs/ui/raft-behavior-registry.json",
    "packages/client-web/public/rah-notification-sw.js",
    "packages/client-web/src/App.tsx",
    "packages/client-web/src/api.ts",
    "packages/client-web/src/app-lazy-components.ts",
    "packages/client-web/src/browser-notifications.ts",
    "packages/client-web/src/hooks/useRoomNotificationMonitor.ts",
    "packages/client-web/src/room",
    "packages/client-web/src/room-ui",
    "packages/client-web/src/room-api.ts",
    "packages/client-web/src/room-projection.ts",
    "packages/runtime-daemon/src/http-server-routes.ts",
    "packages/runtime-daemon/src/http-server.ts",
    "packages/runtime-daemon/src/room",
    "packages/runtime-protocol/src/index.ts",
    "packages/runtime-protocol/src/room.ts",
    "packages/runtime-protocol/src/room-activation.ts",
    "packages/runtime-protocol/src/room-avatar.ts",
    "packages/runtime-protocol/src/room-command.ts",
    "packages/runtime-protocol/src/room-read.ts",
    "packages/runtime-protocol/src/room-read-requests.ts",
    "packages/runtime-protocol/src/room-task.ts",
    "packages/runtime-protocol/src/room-wake.ts",
]


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def web_build_receipt() -> dict[str, Any]:
    dist = ROOT_DIR / "packages/client-web/dist"
    metadata_path = dist / ".rah-web-build.json"
    manifest_path = dist / ".vite/manifest.json"
    required = [dist / "index.html", metadata_path, manifest_path]
    for candidate in required:
        if not candidate.is_file():
            raise AssertionError(f"Room browser smoke requires a complete Web build: {candidate}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    vite_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    build_files = set(required)
    for entry in vite_manifest.values():
        if not isinstance(entry, dict):
            continue
        for field in ("file",):
            value = entry.get(field)
            if isinstance(value, str):
                build_files.add(dist / value)
        for field in ("css", "assets"):
            values = entry.get(field, [])
            if isinstance(values, list):
                build_files.update(dist / value for value in values if isinstance(value, str))
    for candidate in list(build_files):
        for suffix in (".br", ".gz"):
            compressed = pathlib.Path(f"{candidate}{suffix}")
            if compressed.is_file():
                build_files.add(compressed)
    for candidate in dist.iterdir():
        if candidate.is_file() and candidate.name != ".rah-web-build-generations.json":
            build_files.add(candidate)
    missing = [str(path) for path in build_files if not path.is_file()]
    if missing:
        raise AssertionError(f"Web build manifest references missing files: {missing}")
    return {
        "webBuildId": metadata.get("webBuildId"),
        "builtAt": metadata.get("builtAt"),
        "files": {
            path.relative_to(ROOT_DIR).as_posix(): sha256_file(path)
            for path in sorted(build_files)
        },
    }


def source_receipt() -> dict[str, Any]:
    git_head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    inputs: dict[str, str] = {}
    for relative in SOURCE_INPUTS:
        source = ROOT_DIR / relative
        candidates = (
            sorted(path for path in source.rglob("*") if path.is_file())
            if source.is_dir()
            else [source]
        )
        for candidate in candidates:
            key = candidate.relative_to(ROOT_DIR).as_posix()
            inputs[key] = sha256_file(candidate)
    return {
        "gitHead": git_head,
        "sourceInputs": inputs,
        "servedWebBuild": web_build_receipt(),
    }


def observe_browser_identity(page, browser) -> dict[str, Any]:
    requested = selected_browser_name()
    observed = page.evaluate(
        """() => ({
          userAgent: navigator.userAgent,
          brands: navigator.userAgentData?.brands ?? [],
        })"""
    )
    engine = browser.browser_type.name
    brands = [str(entry.get("brand", "")) for entry in observed.get("brands", [])]
    if requested == "chrome":
        if engine != "chromium" or "Google Chrome" not in brands:
            raise AssertionError(
                f"requested Chrome channel but observed engine={engine!r}, brands={brands!r}"
            )
    elif requested == "firefox":
        if engine != "firefox" or "Firefox/" not in observed.get("userAgent", ""):
            raise AssertionError(
                f"requested Firefox but observed engine={engine!r}, userAgent={observed.get('userAgent')!r}"
            )
    elif requested != engine:
        raise AssertionError(f"requested browser {requested!r} but observed engine {engine!r}")
    return {
        "requested": requested,
        "engine": engine,
        "version": browser.version,
        **observed,
    }


def write_manifest(artifact_dir: pathlib.Path, manifest: dict[str, Any]) -> None:
    target = artifact_dir / "manifest.json"
    temporary = artifact_dir / "manifest.json.tmp"
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary, target)


def drag_separator(page, separator, delta_x: float) -> None:
    box = separator.bounding_box()
    if box is None:
        raise AssertionError("visible separator has no bounding box")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + delta_x, y, steps=6)
    page.mouse.up()


def settle_layout(page) -> None:
    page.evaluate(
        "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )


def seed_fixture(data_root: pathlib.Path, result_path: pathlib.Path) -> dict[str, Any]:
    subprocess.run(
        [
            "node",
            "--import",
            "tsx",
            "scripts/room_browser_fixture.ts",
            str(data_root),
            str(result_path),
        ],
        cwd=ROOT_DIR,
        check=True,
    )
    return json.loads(result_path.read_text(encoding="utf-8"))


def write_screenshot(page, artifact_dir: pathlib.Path, name: str) -> str:
    target = artifact_dir / f"{name}.png"
    page.screenshot(path=str(target), full_page=False)
    return str(target.relative_to(ROOT_DIR))


def wait_for_task_state(base_url: str, room_id: str, task_id: str, state: str) -> None:
    deadline = time.time() + 10
    while time.time() < deadline:
        response = request_json(base_url, "/api/room/v1/tasks", {"roomId": room_id, "limit": 100})
        items = response.get("data", {}).get("items", [])
        match = next((item for item in items if item.get("taskId") == task_id), None)
        if match and match.get("state") == state:
            return
        time.sleep(0.1)
    raise AssertionError(f"Task {task_id} never reached canonical state {state}")


def read_inbox_item(base_url: str, event_id: str) -> dict[str, Any] | None:
    response = request_json(base_url, "/api/room/v1/inbox", {"limit": 200})
    return next(
        (item for item in response.get("data", {}).get("items", []) if item.get("eventId") == event_id),
        None,
    )


def wait_for_inbox_item_state(base_url: str, event_id: str, state: str) -> dict[str, Any]:
    deadline = time.time() + 10
    while time.time() < deadline:
        item = read_inbox_item(base_url, event_id)
        if item and item.get("state") == state:
            return item
        time.sleep(0.1)
    raise AssertionError(f"Room Inbox item {event_id} never reached state {state}")


def verify_room_inbox_notification(
    page,
    base_url: str,
    data_root: pathlib.Path,
    fixture_path: pathlib.Path,
    checks: dict[str, Any],
    probe_label: str,
    check_key: str,
) -> dict[str, Any]:
    page.wait_for_function(
        "async () => Boolean(await navigator.serviceWorker.getRegistration())",
        timeout=10_000,
    )
    emitted_process = subprocess.run(
        [
            "node",
            "--import",
            "tsx",
            "scripts/room_browser_emit_notification.ts",
            str(data_root),
            str(fixture_path),
            probe_label,
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    emitted = json.loads(emitted_process.stdout)
    inbox_notification = None
    notification_deadline = time.time() + 12
    while time.time() < notification_deadline and not inbox_notification:
        inbox_notification = page.evaluate(
            """async () => {
              const registration = await navigator.serviceWorker.ready;
              const notifications = await Promise.race([
                registration.getNotifications(),
                new Promise(resolve => setTimeout(() => resolve([]), 750)),
              ]);
              const match = notifications.find(item => {
                const target = new URL(item.data?.url ?? '/', window.location.origin);
                return item.title === 'Room: Browser Audit' &&
                  item.body === 'You were mentioned in a message.' &&
                  target.searchParams.get('surface') === 'room' &&
                  target.searchParams.get('roomId') === 'room-browser-audit' &&
                  target.searchParams.get('messageId') === %s;
              });
              if (!match) return null;
              const result = {
                title: match.title,
                body: match.body,
                tag: match.tag,
                url: match.data?.url,
                target: match.data?.target,
              };
              match.close();
              return result;
            }""" % json.dumps(emitted["messageId"])
        )
        if not inbox_notification:
            time.sleep(0.1)
    if not inbox_notification:
        raise AssertionError("Room Inbox did not produce a browser notification")
    # The browser monitor may advance its delivery cursor, but merely being on
    # a different Room tab/history window must not acknowledge canonical Inbox.
    item = read_inbox_item(base_url, emitted["eventId"])
    if not item or item.get("state") != "pending":
        raise AssertionError(f"Room Inbox item was consumed without being presented: {item}")
    checks[check_key] = {
        "notification": inbox_notification,
        "inboxState": item["state"],
        "eventId": emitted["eventId"],
        "messageId": emitted["messageId"],
    }
    return emitted


def verify_native_notification_readiness(page, checks: dict[str, Any]) -> None:
    page.wait_for_function(
        "async () => Boolean(await navigator.serviceWorker.getRegistration())",
        timeout=10_000,
    )
    notification_state = page.evaluate(
        """async () => ({
          permission: Notification.permission,
          secure: window.isSecureContext,
          worker: Boolean(await navigator.serviceWorker.getRegistration()),
        })"""
    )
    if notification_state != {"permission": "granted", "secure": True, "worker": True}:
        raise AssertionError(f"notification readiness mismatch: {notification_state}")
    checks["notificationReadiness"] = notification_state


def main() -> int:
    started_at = time.time()
    preflight_browser_runtime()
    tmp_root = pathlib.Path(tempfile.mkdtemp(prefix="rah-room-browser-"))
    data_root = tmp_root / "rah-data"
    codex_home = tmp_root / "codex-home"
    claude_config = tmp_root / "claude-config"
    xdg_data = tmp_root / "xdg-data"
    fixture_path = tmp_root / "fixture.json"
    artifact_dir = ROOT_DIR / "test-results" / "browser-e2e" / "room-browser-contract" / str(int(time.time()))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    codex_home.mkdir(parents=True)
    fixture = seed_fixture(data_root, fixture_path)
    daemon = None
    screenshots: list[str] = []
    checks: dict[str, Any] = {}
    receipt = source_receipt()
    browser_identity: dict[str, Any] | None = None
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    skip_notifications = os.environ.get("RAH_ROOM_BROWSER_SKIP_NOTIFICATIONS") == "1"
    try:
        daemon = start_daemon(
            {
                "RAH_DATA_HOME": str(data_root),
                "CODEX_HOME": str(codex_home),
                "CLAUDE_CONFIG_DIR": str(claude_config),
                "XDG_DATA_HOME": str(xdg_data),
            },
            port,
        )
        with sync_playwright() as playwright:
            browser = launch_browser(playwright)
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                permissions=["notifications"],
            )
            page = context.new_page()
            page.goto(
                f"{base_url}/?surface=room&roomId={fixture['roomId']}",
                wait_until="networkidle",
            )
            browser_identity = observe_browser_identity(page, browser)
            expect(page.locator(".room-page")).to_be_visible(timeout=30_000)
            expect(page.locator(".room-page__identity-text h2")).to_have_text(
                "Browser Audit", timeout=30_000
            )
            catalog_size = page.locator(".room-directory__item").count()
            if catalog_size != fixture["expectedCatalogSize"]:
                raise AssertionError(
                    f"Room catalog stopped before the deep-link page: {catalog_size}"
                )
            checks["completeCatalogAndDeepLink"] = {
                "items": catalog_size,
                "selected": "Browser Audit",
            }

            review_attention = read_inbox_item(
                base_url, fixture["reviewAttentionEventId"]
            )
            if not review_attention or review_attention.get("state") != "pending":
                raise AssertionError(
                    f"Task review attention was not pending before presentation: {review_attention}"
                )

            task_link = context.new_page()
            task_link.goto(
                f"{base_url}/?surface=room&roomId={fixture['roomId']}&tab=tasks&taskId={fixture['submittedTaskId']}",
                wait_until="networkidle",
            )
            expect(task_link.get_by_role("tab", name="Tasks")).to_have_attribute(
                "aria-selected", "true"
            )
            expect(task_link.locator(f"#room-task-{fixture['submittedTaskId']}")).to_be_focused(
                timeout=30_000
            )
            wait_for_inbox_item_state(
                base_url, fixture["reviewAttentionEventId"], "acknowledged"
            )
            task_link.close()
            checks["exactTaskAttentionAcknowledgement"] = {
                "before": "pending",
                "afterFocusedTaskDeepLink": "acknowledged",
                "eventId": fixture["reviewAttentionEventId"],
                "taskId": fixture["submittedTaskId"],
            }

            message_link = context.new_page()
            message_link.goto(
                f"{base_url}/?surface=room&roomId={fixture['roomId']}&messageId={fixture['submittedSourceMessageId']}",
                wait_until="networkidle",
            )
            expect(message_link.get_by_role("tab", name="Chat")).to_have_attribute(
                "aria-selected", "true"
            )
            expect(
                message_link.locator(f"#room-message-{fixture['submittedSourceMessageId']}")
            ).to_be_focused(timeout=30_000)
            message_link.close()
            checks["typedDeepLinkLanding"] = ["task", "message"]

            chat_tab = page.get_by_role("tab", name="Chat")
            chat_tab.focus()
            chat_tab.press("End")
            members_tab = page.get_by_role("tab", name="Members")
            expect(members_tab).to_have_attribute("aria-selected", "true")
            expect(members_tab).to_be_focused()
            members_tab.press("Home")
            expect(chat_tab).to_have_attribute("aria-selected", "true")
            expect(chat_tab).to_be_focused()
            chat_tab.press("ArrowRight")
            tasks_tab = page.get_by_role("tab", name="Tasks")
            expect(tasks_tab).to_have_attribute("aria-selected", "true")
            expect(tasks_tab).to_be_focused()
            tasks_tab.press("ArrowLeft")
            expect(chat_tab).to_have_attribute("aria-selected", "true")
            checks["tabKeyboard"] = ["End", "Home", "ArrowRight", "ArrowLeft"]

            directory = page.locator(".room-directory")
            default_directory_width = directory.evaluate("el => Math.round(el.getBoundingClientRect().width)")
            if default_directory_width != 320:
                raise AssertionError(f"Room directory default width was {default_directory_width}, expected 320")
            checks["desktopDirectoryDefaultPx"] = default_directory_width

            directory_separator = page.get_by_role("separator", name="Resize Room directory")
            directory_separator.focus()
            directory_separator.press("End")
            expect(directory_separator).to_have_attribute("aria-valuenow", "480")
            settle_layout(page)
            if directory.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 480:
                raise AssertionError("Room directory did not reach its 480px maximum")
            directory_separator.press("Home")
            expect(directory_separator).to_have_attribute("aria-valuenow", "240")
            settle_layout(page)
            if directory.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 240:
                raise AssertionError("Room directory did not reach its 240px minimum")
            drag_separator(page, directory_separator, 400)
            expect(directory_separator).to_have_attribute("aria-valuenow", "480")
            settle_layout(page)
            directory_pointer_max = directory.evaluate("el => Math.round(el.getBoundingClientRect().width)")
            if directory_pointer_max != 480:
                directory_debug = directory.evaluate(
                    "el => ({ style: el.getAttribute('style'), cssWidth: getComputedStyle(el).width, token: getComputedStyle(el).getPropertyValue('--room-directory-width') })"
                )
                raise AssertionError(
                    f"Room directory pointer drag did not clamp at 480px: {directory_pointer_max}; {directory_debug}"
                )
            drag_separator(page, directory_separator, -400)
            expect(directory_separator).to_have_attribute("aria-valuenow", "240")
            settle_layout(page)
            if directory.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 240:
                raise AssertionError("Room directory pointer drag did not clamp at 240px")
            if page.evaluate("window.getSelection()?.toString() ?? ''"):
                raise AssertionError("Room directory resize selected page text")

            separator_box = directory_separator.bounding_box()
            if separator_box is None:
                raise AssertionError("Room directory separator has no box for cancellation test")
            separator_x = separator_box["x"] + separator_box["width"] / 2
            separator_y = separator_box["y"] + separator_box["height"] / 2
            page.evaluate(
                """() => {
                  window.__rahPointerId = null;
                  document.addEventListener('pointerdown', event => {
                    window.__rahPointerId = event.pointerId;
                  }, { capture: true, once: true });
                }"""
            )
            page.mouse.move(separator_x, separator_y)
            page.mouse.down()
            pointer_id = page.evaluate("window.__rahPointerId")
            directory_separator.dispatch_event(
                "pointercancel",
                {"pointerId": pointer_id, "clientX": separator_x, "clientY": separator_y},
            )
            page.mouse.move(separator_x + 120, separator_y)
            page.mouse.up()
            if directory.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 240:
                raise AssertionError("pointercancel allowed a stale Room directory resize")

            page.evaluate(
                """() => {
                  window.__rahPointerId = null;
                  document.addEventListener('pointerdown', event => {
                    window.__rahPointerId = event.pointerId;
                  }, { capture: true, once: true });
                }"""
            )
            page.mouse.move(separator_x, separator_y)
            page.mouse.down()
            pointer_id = page.evaluate("window.__rahPointerId")
            released = directory_separator.evaluate(
                """(element, id) => {
                  if (!element.hasPointerCapture(id)) return false;
                  element.releasePointerCapture(id);
                  return true;
                }""",
                pointer_id,
            )
            if not released:
                raise AssertionError("Room directory separator did not capture the active pointer")
            page.mouse.move(separator_x + 120, separator_y)
            page.mouse.up()
            if directory.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 240:
                raise AssertionError("lostpointercapture allowed a stale Room directory resize")
            checks["desktopDirectoryBoundsPx"] = {
                "keyboard": [240, 480],
                "pointer": [240, 480],
                "cancelledPointerStayedPx": 240,
                "lostCaptureStayedPx": 240,
            }

            messages = page.locator(".room-message")
            expect(messages.first).to_be_visible()
            initial_messages = messages.count()
            if initial_messages > 200:
                raise AssertionError(f"initial Room history exceeded 200 rows: {initial_messages}")
            anchor = page.locator(".room-message__text").first
            anchor_text = anchor.inner_text()
            anchor_y = anchor.bounding_box()["y"]
            expect(page.get_by_role("button", name="Load earlier messages")).to_be_visible()
            page.get_by_role("button", name="Load earlier messages").click()
            expect(page.get_by_role("button", name="Return to latest messages")).to_be_visible()
            page.evaluate(
                "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
            )
            expanded_messages = messages.count()
            if expanded_messages > 600 or expanded_messages <= initial_messages:
                raise AssertionError(
                    f"bounded history expansion invalid: {initial_messages} -> {expanded_messages}"
                )
            retained_anchor = page.locator(".room-message__text").filter(has_text=anchor_text)
            if retained_anchor.count() != 1:
                raise AssertionError(f"history anchor was not unique after prepend: {anchor_text}")
            retained_y = retained_anchor.bounding_box()["y"]
            if abs(retained_y - anchor_y) > 2:
                raise AssertionError(
                    f"history prepend moved the visible anchor: {anchor_y} -> {retained_y}"
                )
            checks["messageWindow"] = {"initial": initial_messages, "afterOlder": expanded_messages, "cap": 600}
            checks["historyAnchorDeltaPx"] = round(retained_y - anchor_y, 2)
            screenshots.append(write_screenshot(page, artifact_dir, "01-room-chat-desktop"))
            page.get_by_role("button", name="Return to latest messages").click()
            expect(page.locator(".room-message")).to_have_count(initial_messages)
            expect(page.locator(".room-message__text").filter(has_text=anchor_text)).to_have_count(1)
            checks["returnToLatestCount"] = initial_messages

            page.get_by_role("tab", name="Members").click()
            page.get_by_role("button", name="Alice @alice member").click()
            profile = page.get_by_label("Alice profile")
            expect(profile).to_be_visible()
            if profile.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 380:
                raise AssertionError("member profile default width was not 380px")
            profile_separator = page.get_by_role("separator", name="Resize member profile")
            profile_separator.focus()
            profile_separator.press("ArrowLeft")
            expect(profile_separator).to_have_attribute("aria-valuenow", "390")
            settle_layout(page)
            if profile.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 390:
                raise AssertionError("member profile keyboard resize did not reach 390px")
            drag_separator(page, profile_separator, -500)
            expect(profile_separator).to_have_attribute("aria-valuenow", "640")
            settle_layout(page)
            profile_pointer_max = profile.evaluate("el => Math.round(el.getBoundingClientRect().width)")
            if profile_pointer_max != 640:
                raise AssertionError(
                    f"member profile pointer drag did not clamp at 640px: {profile_pointer_max}"
                )
            drag_separator(page, profile_separator, 500)
            expect(profile_separator).to_have_attribute("aria-valuenow", "300")
            settle_layout(page)
            profile_pointer_min = profile.evaluate("el => Math.round(el.getBoundingClientRect().width)")
            if profile_pointer_min != 300:
                raise AssertionError(
                    f"member profile pointer drag did not clamp at 300px: {profile_pointer_min}"
                )
            if page.evaluate("window.getSelection()?.toString() ?? ''"):
                raise AssertionError("member profile resize selected page text")
            checks["profileDefaultAndBoundsPx"] = {
                "default": 380,
                "keyboard": 390,
                "pointer": [300, 640],
            }
            screenshots.append(write_screenshot(page, artifact_dir, "02-room-members-profile"))

            page.get_by_role("button", name="Second Room").click()
            expect(profile).to_have_count(0)
            expect(page.locator(".room-page__identity-text h2")).to_have_text("Second Room", timeout=30_000)
            checks["profileClosedOnRoomSwitch"] = True

            page.get_by_role("button", name="Empty Room").click()
            expect(page.locator(".room-page__identity-text h2")).to_have_text(
                "Empty Room", timeout=30_000
            )
            page.get_by_role("tab", name="Chat").click()
            empty_state = page.get_by_role("status")
            expect(empty_state.get_by_text("No messages", exact=True)).to_be_visible()
            expect(empty_state.get_by_text("Start the conversation.", exact=True)).to_be_visible()
            if empty_state.locator(".room-neo-empty__icon svg").count() != 1:
                raise AssertionError("Room empty state omitted its shared icon slot")
            checks["emptyMessageState"] = {
                "icon": "shared-slot",
                "title": "No messages",
                "description": "Start the conversation.",
            }

            page.get_by_role("button", name="Browser Audit").click()
            expect(page.locator(".room-page__identity-text h2")).to_have_text("Browser Audit", timeout=30_000)

            if skip_notifications:
                checks["notificationsSkipped"] = "UI-only cross-browser run"
            else:
                verify_native_notification_readiness(page, checks)
                verify_room_inbox_notification(
                    page, base_url, data_root, fixture_path, checks,
                    "members-tab", "roomMembersMessageStayedPending",
                )

            page.get_by_role("tab", name="Tasks").click()
            expect(page.locator(".room-task-board")).to_be_visible(timeout=30_000)
            if not skip_notifications:
                verify_room_inbox_notification(
                    page, base_url, data_root, fixture_path, checks,
                    "tasks-tab", "roomTasksMessageStayedPending",
                )
            task_snapshot = request_json(
                base_url,
                "/api/room/v1/tasks",
                {"roomId": fixture["roomId"], "limit": 100},
            )
            task_titles = [item.get("title") for item in task_snapshot.get("data", {}).get("items", [])]
            if "Audited delivery awaiting Human acceptance" not in task_titles:
                raise AssertionError(f"canonical Task read omitted fixture: {task_titles}")
            task_title = page.get_by_text("Audited delivery awaiting Human acceptance", exact=False)
            expect(task_title).to_be_visible(timeout=30_000)
            delivery = page.locator(
                f"#room-task-{fixture['submittedTaskId']} .room-task-delivery"
            )
            expect(delivery).not_to_have_attribute("open", "")
            delivery.locator("summary").click()
            expect(delivery.get_by_text("Revision", exact=True)).to_be_visible()
            delivery.locator("summary").click()
            expect(delivery.get_by_text("Revision", exact=True)).to_be_hidden()
            checks["compactTaskDelivery"] = {
                "default": "collapsed",
                "expandedEvidence": "visible",
            }
            page.get_by_role("button", name="Accept").click()
            wait_for_task_state(base_url, fixture["roomId"], fixture["submittedTaskId"], "completed")
            done_column = page.locator(".room-task-column").nth(3)
            expect(
                done_column.get_by_text("Audited delivery awaiting Human acceptance", exact=False)
            ).to_be_visible(timeout=10_000)
            expect(page.get_by_role("alert")).to_have_count(0)
            checks["canonicalTaskStateAfterHumanAccept"] = "completed"
            checks["taskProjectionReachedDoneWithoutTransportError"] = True
            screenshots.append(write_screenshot(page, artifact_dir, "03-room-task-canonical-completed"))

            page.get_by_role("tab", name="Chat").click()
            expect(page.get_by_role("button", name="Load earlier messages")).to_be_visible()
            page.get_by_role("button", name="Load earlier messages").click()
            expect(page.get_by_role("button", name="Return to latest messages")).to_be_visible()
            if not skip_notifications:
                historical_probe = verify_room_inbox_notification(
                    page, base_url, data_root, fixture_path, checks,
                    "history-window", "roomHistoryMessageStayedPending",
                )
                # The projection polls more frequently than the notification
                # monitor. At this point a broken ACK owner would already have
                # consumed the item even though the latest window is not shown.
                time.sleep(3)
                historical_item = read_inbox_item(base_url, historical_probe["eventId"])
                if not historical_item or historical_item.get("state") != "pending":
                    raise AssertionError(
                        f"historical window acknowledged unseen message: {historical_item}"
                    )
                page.get_by_role("button", name="Return to latest messages").click()
                expect(
                    page.locator(".room-message__text").filter(
                        has_text="Browser notification pipeline probe: history-window"
                    )
                ).to_be_visible(timeout=10_000)
                wait_for_inbox_item_state(base_url, historical_probe["eventId"], "acknowledged")
                checks["roomHistoryMessageStayedPending"]["afterReturn"] = "acknowledged"
            else:
                page.get_by_role("button", name="Return to latest messages").click()

            page.set_viewport_size({"width": 767, "height": 900})
            expect(page.locator(".room-directory-resizer")).to_be_hidden()
            expect(page.get_by_role("button", name="Back to Rooms")).to_be_visible()
            page.set_viewport_size({"width": 768, "height": 900})
            expect(page.locator(".room-directory")).to_be_visible()
            expect(page.locator(".room-directory-resizer")).to_be_visible()
            expect(page.get_by_role("button", name="Back to Rooms")).to_be_hidden()
            checks["primaryBreakpoint"] = {"mobileMaxPx": 767, "desktopMinPx": 768}
            page.set_viewport_size({"width": 1440, "height": 900})

            mobile_context = browser.new_context(
                viewport={"width": 390, "height": 844},
                permissions=["notifications"],
            )
            mobile = mobile_context.new_page()
            mobile.goto(
                f"{base_url}/?surface=room&roomId={fixture['roomId']}",
                wait_until="networkidle",
            )
            expect(mobile.locator(".room-page")).to_be_visible(timeout=30_000)
            expect(mobile.locator(".room-directory")).to_be_visible()
            offscreen_attention = read_inbox_item(
                base_url, fixture["offscreenReviewAttentionEventId"]
            )
            if not offscreen_attention or offscreen_attention.get("state") != "pending":
                raise AssertionError(
                    f"offscreen Task attention was not initially pending: {offscreen_attention}"
                )
            mobile.get_by_role("button", name="Offscreen Tasks").click()
            expect(mobile.locator(".room-main")).to_be_visible()
            mobile.get_by_role("tab", name="Tasks").click()
            offscreen_task = mobile.locator(
                f"#room-task-{fixture['offscreenTaskId']}"
            )
            expect(offscreen_task).to_be_attached(timeout=30_000)
            time.sleep(3)
            still_pending = read_inbox_item(
                base_url, fixture["offscreenReviewAttentionEventId"]
            )
            if not still_pending or still_pending.get("state") != "pending":
                raise AssertionError(
                    f"horizontally offscreen Task was acknowledged: {still_pending}"
                )
            offscreen_task.evaluate(
                "element => element.scrollIntoView({block: 'center', inline: 'center'})"
            )
            expect(offscreen_task).to_be_in_viewport(ratio=0.5)
            wait_for_inbox_item_state(
                base_url,
                fixture["offscreenReviewAttentionEventId"],
                "acknowledged",
            )
            checks["offscreenTaskAttention"] = {
                "beforeIntersection": "pending",
                "afterFiftyPercentIntersection": "acknowledged",
                "taskId": fixture["offscreenTaskId"],
            }
            mobile.get_by_role("button", name="Back to Rooms").click()
            mobile.get_by_role("button", name="Browser Audit").click()
            expect(mobile.locator(".room-main")).to_be_visible()
            expect(mobile.get_by_role("button", name="Back to Rooms")).to_be_visible()
            mobile.get_by_role("tab", name="Tasks").click()
            task_scroll = mobile.locator(".room-scroll")
            expect(mobile.locator(".room-task-board")).to_be_visible()
            if not task_scroll.evaluate("el => el.scrollWidth > el.clientWidth"):
                raise AssertionError("390px Task board did not retain its local horizontal scroll")
            if mobile.evaluate("document.documentElement.scrollWidth") != 390:
                raise AssertionError("390px Task board leaked overflow to the page shell")
            mobile.get_by_role("tab", name="Members").click()
            mobile.get_by_role("button", name="Alice @alice member").click()
            mobile_profile = mobile.get_by_label("Alice profile")
            expect(mobile_profile).to_be_visible()
            if mobile_profile.evaluate("el => Math.round(el.getBoundingClientRect().width)") != 390:
                raise AssertionError("mobile member profile did not occupy the 390px viewport")
            expect(mobile.get_by_role("separator", name="Resize member profile")).to_be_hidden()
            screenshots.append(write_screenshot(mobile, artifact_dir, "04-room-mobile-390x844"))
            checks["mobileViewport"] = {
                "size": [390, 844],
                "taskBoardScroll": "local",
                "profileWidth": 390,
            }
            mobile_context.close()
            context.close()
            browser.close()

        manifest = {
            "schemaVersion": 1,
            "suite": "room-browser-contract",
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
            "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **receipt,
            "fixtureOutputSha256": sha256_file(fixture_path),
            "browser": selected_browser_name(),
            "browserIdentity": browser_identity,
            "headless": browser_headless(),
            "cases": [
                case_id for case_id in CASE_IDS
                if not (skip_notifications and "NOTIFICATION" in case_id)
            ],
            "checks": checks,
            "screenshots": screenshots,
            "screenshotSha256": {
                screenshot: sha256_file(ROOT_DIR / screenshot)
                for screenshot in screenshots
            },
            "passed": True,
        }
        write_manifest(artifact_dir, manifest)
        print(f"PASS Room browser contract; artifacts={artifact_dir}")
        return 0
    except Exception as exc:
        trace = traceback.format_exc()
        traceback.print_exc()
        write_manifest(
            artifact_dir,
            {
                "schemaVersion": 1,
                "suite": "room-browser-contract",
                "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
                "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                **receipt,
                "browser": selected_browser_name(),
                "browserIdentity": browser_identity,
                "headless": browser_headless(),
                "cases": CASE_IDS,
                "checks": checks,
                "screenshots": screenshots,
                "screenshotSha256": {
                    screenshot: sha256_file(ROOT_DIR / screenshot)
                    for screenshot in screenshots
                    if (ROOT_DIR / screenshot).is_file()
                },
                "passed": False,
                "error": str(exc),
                "traceback": trace,
            },
        )
        return 1
    finally:
        if daemon is not None:
            terminate_process_tree(daemon)
        move_path_to_trash(tmp_root)


if __name__ == "__main__":
    raise SystemExit(main())
