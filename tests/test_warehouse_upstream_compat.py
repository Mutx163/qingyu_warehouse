#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from warehouse_upstream_compat import (  # noqa: E402
    SHIM_MARKER,
    apply_v2_bridge_shim,
    validate_adapter_script,
    validate_index_compatibility,
    validate_protected_paths,
    validate_sync_plan,
)
from sync_upstream import parse_asset_js_path  # noqa: E402


class WarehouseUpstreamCompatTest(unittest.TestCase):
    def test_parses_quoted_asset_path_with_inline_comment(self) -> None:
        self.assertEqual(
            parse_asset_js_path('asset_js_path: "JLU_01.js" #相对路径'),
            "JLU_01.js",
        )

    def test_parses_asset_path_with_quoted_hash(self) -> None:
        self.assertEqual(
            parse_asset_js_path('asset_js_path: "adapter#v2.js" #说明'),
            "adapter#v2.js",
        )

    def test_empty_asset_path_is_allowed(self) -> None:
        self.assertIsNone(parse_asset_js_path("asset_js_path: # 无脚本"))

    def test_blocks_protected_paths(self) -> None:
        report = validate_protected_paths(["tools/CourseImporterTestTool/popup.js"])
        self.assertFalse(report.ok)
        self.assertEqual(report.blocking[0].code, "protected_path")

    def test_blocks_local_only_schools(self) -> None:
        local = '''
schools:
  - id: "QINGYU_ONLY"
    name: "本地学校"
    initial: "Q"
    resource_folder: "QINGYU_ONLY"
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU"
'''
        upstream = '''
schools:
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU"
'''
        report = validate_index_compatibility(local, upstream)
        self.assertFalse(report.ok)
        self.assertEqual(report.blocking[0].code, "local_only_school")

    def test_blocks_resource_folder_change(self) -> None:
        local = '''
schools:
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU"
'''
        upstream = '''
schools:
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU_NEW"
'''
        report = validate_index_compatibility(local, upstream)
        self.assertFalse(report.ok)
        self.assertEqual(report.blocking[0].code, "resource_folder_changed")

    def test_blocks_unsupported_bridge(self) -> None:
        script = Path(ROOT / "tests" / "_tmp_test_script.js")
        script.write_text(
            "await window.AndroidBridgePromise.showConfirmDialog('a','b');",
            encoding="utf-8",
        )
        try:
            report = validate_adapter_script(script, "TEST", "TEST_01")
            self.assertFalse(report.ok)
            self.assertEqual(report.blocking[0].code, "unsupported_bridge")
        finally:
            script.unlink(missing_ok=True)

    def test_allows_guarded_confirm_dialog(self) -> None:
        script = Path(ROOT / "tests" / "_tmp_test_script.js")
        script.write_text(
            """
if (typeof window.AndroidBridgePromise.showConfirmDialog === 'function') {
  await window.AndroidBridgePromise.showConfirmDialog('a', 'b');
}
await window.AndroidBridgePromise.saveImportedCourses('[]');
AndroidBridge.notifyTaskCompletion();
""",
            encoding="utf-8",
        )
        try:
            report = validate_adapter_script(script, "TEST", "TEST_01")
            self.assertFalse(report.ok)
            self.assertEqual(report.blocking[0].code, "unsupported_bridge")
        finally:
            script.unlink(missing_ok=True)

    def test_apply_v2_bridge_shim_adds_alias_for_v2_script(self) -> None:
        script = "window.shiguangBridge.showToast('hi');"
        new_text, applied = apply_v2_bridge_shim(script)
        self.assertTrue(applied)
        self.assertTrue(new_text.startswith(SHIM_MARKER))
        self.assertIn("window.shiguangBridge = window.AndroidBridge;", new_text)
        self.assertIn(
            "window.shiguangBridgePromise = window.AndroidBridgePromise;",
            new_text,
        )
        self.assertTrue(new_text.endswith(script))

    def test_apply_v2_bridge_shim_skips_pure_v1_script(self) -> None:
        script = "AndroidBridge.showToast('hi');"
        new_text, applied = apply_v2_bridge_shim(script)
        self.assertFalse(applied)
        self.assertEqual(new_text, script)

    def test_apply_v2_bridge_shim_is_idempotent(self) -> None:
        script = "await window.shiguangBridgePromise.saveImportedCourses('[]');"
        once, _ = apply_v2_bridge_shim(script)
        twice, applied_again = apply_v2_bridge_shim(once)
        self.assertFalse(applied_again)
        self.assertEqual(once.count(SHIM_MARKER), 1)
        self.assertEqual(twice, once)

    def test_v2_unknown_bridge_method_is_blocked(self) -> None:
        script = Path(ROOT / "tests" / "_tmp_test_script.js")
        script.write_text(
            "await window.shiguangBridgePromise.showConfirmDialog('a','b');",
            encoding="utf-8",
        )
        try:
            report = validate_adapter_script(script, "TEST", "TEST_01")
            self.assertFalse(report.ok)
            self.assertEqual(report.blocking[0].code, "unknown_bridge_method")
        finally:
            script.unlink(missing_ok=True)

    def test_v2_supported_methods_pass_validation(self) -> None:
        script = Path(ROOT / "tests" / "_tmp_test_script.js")
        script.write_text(
            """
window.shiguangBridge.showToast('x');
await window.shiguangBridgePromise.saveImportedCourses('[]');
""",
            encoding="utf-8",
        )
        try:
            report = validate_adapter_script(script, "TEST", "TEST_01")
            self.assertTrue(report.ok)
        finally:
            script.unlink(missing_ok=True)

    def test_validate_sync_plan_ok_for_new_school(self) -> None:
        local = '''
schools:
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU"
'''
        upstream = '''
schools:
  - id: "CQU"
    name: "重庆大学"
    initial: "C"
    resource_folder: "CQU"
  - id: "NWPU"
    name: "西北工业大学"
    initial: "X"
    resource_folder: "NWPU"
'''
        report = validate_sync_plan(
            local_yaml=local,
            upstream_yaml=upstream,
            checkout_paths=["index/root_index.yaml", "resources/NWPU"],
        )
        self.assertTrue(report.ok)


if __name__ == "__main__":
    unittest.main()
