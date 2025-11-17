// 阻止 Windows 发布版显示额外的控制台窗口（请勿删除！）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 应用程序主入口点
///
/// 委托给 lib.rs 中的 run() 函数执行实际初始化逻辑
fn main() {
    ai_ask_lib::run()
}
