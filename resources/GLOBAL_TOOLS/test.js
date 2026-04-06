/**
 * qingyu_warehouse 适配脚本占位模板
 *
 * 用途：
 * - Beta 阶段，在不新增学校索引的情况下，用 GENERAL_TOOL_02 做软件内适配验证
 * - 可以先把你在浏览器扩展里跑通的逻辑粘贴到这里继续测试
 *
 * 提醒：
 * - 正式提交学校适配时，不要把临时测试逻辑保留在这个文件里
 * - 完成正式适配后，请把代码移到对应 resources/<folder>/*.js
 */

async function main() {
  try {
    AndroidBridge.showToast('测试脚本已启动，请把这里替换成你的适配代码');

    const demoCourses = [
      {
        name: '示例课程',
        teacher: '测试教师',
        position: '测试教室',
        day: 1,
        startSection: 1,
        endSection: 2,
        weeks: [1, 2, 3],
      },
    ];

    await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(demoCourses),
    );

    AndroidBridge.notifyTaskCompletion();
  } catch (error) {
    await window.AndroidBridgePromise.showAlert(
      '测试脚本执行失败',
      String(error?.message || error),
      '确定',
    );
  }
}

main();
