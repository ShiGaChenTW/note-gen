// Fork（almanac ALMNC-63）：專注模式的視窗。macOS 上用原生動畫把視窗平順放大到整個螢幕
// （同時隱藏選單列與 Dock、藏起紅綠燈），退出時平順縮回原本的位置與大小。
// 不用系統全螢幕（會開新的桌面空間、有滑動動畫），也不用 simple fullscreen（瞬間跳過去、沒有動畫）。
// 其他平台交給前端用 setFullscreen 處理。

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSRect;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    // NSApplicationPresentationOptions
    const HIDE_DOCK: usize = 1 << 1;
    const HIDE_MENU_BAR: usize = 1 << 3;

    #[derive(Clone, Copy)]
    struct Saved {
        frame: NSRect,
        presentation: usize,
    }

    // NSRect 只是四個 f64
    unsafe impl Send for Saved {}

    fn saved() -> &'static Mutex<HashMap<String, Saved>> {
        static SAVED: OnceLock<Mutex<HashMap<String, Saved>>> = OnceLock::new();
        SAVED.get_or_init(|| Mutex::new(HashMap::new()))
    }

    unsafe fn animate_frame(window: *mut AnyObject, frame: NSRect, duration: f64) {
        let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
        let context: *mut AnyObject = msg_send![class!(NSAnimationContext), currentContext];
        let _: () = msg_send![context, setDuration: duration];
        // 先快後慢（kCAMediaTimingFunctionEaseOut），和前端卡片動畫的曲線相近
        let name = objc2_foundation::NSString::from_str("easeOut");
        let timing: *mut AnyObject = msg_send![class!(CAMediaTimingFunction), functionWithName: &*name];
        let _: () = msg_send![context, setTimingFunction: timing];
        let animator: *mut AnyObject = msg_send![window, animator];
        let _: () = msg_send![animator, setFrame: frame, display: true];
        let _: () = msg_send![class!(NSAnimationContext), endGrouping];
    }

    unsafe fn set_traffic_lights_hidden(window: *mut AnyObject, hidden: bool) {
        for kind in 0usize..3 {
            let button: *mut AnyObject = msg_send![window, standardWindowButton: kind];
            if !button.is_null() {
                let _: () = msg_send![button, setHidden: hidden];
            }
        }
    }

    /// 在主執行緒上執行。
    pub unsafe fn apply(label: &str, window: *mut AnyObject, enable: bool, duration: f64) {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let mut map = saved().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if enable {
            if map.contains_key(label) {
                return;
            }
            let screen: *mut AnyObject = msg_send![window, screen];
            if screen.is_null() {
                return;
            }
            let frame: NSRect = msg_send![window, frame];
            let presentation: usize = msg_send![app, presentationOptions];
            map.insert(label.to_string(), Saved { frame, presentation });
            let target: NSRect = msg_send![screen, frame];
            let _: () = msg_send![app, setPresentationOptions: presentation | HIDE_DOCK | HIDE_MENU_BAR];
            set_traffic_lights_hidden(window, true);
            animate_frame(window, target, duration);
        } else if let Some(previous) = map.remove(label) {
            let _: () = msg_send![app, setPresentationOptions: previous.presentation];
            set_traffic_lights_hidden(window, false);
            animate_frame(window, previous.frame, duration);
        }
    }
}

/// enable：true 放大到整個螢幕、false 回到進入前的位置與大小。duration 是秒。
/// 呼叫後立刻回傳；動畫在主執行緒上進行，前端依 duration 等它結束。
#[tauri::command]
pub fn focus_window_animate(window: tauri::WebviewWindow, enable: bool, duration: f64) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let label = window.label().to_string();
        let pointer = window.ns_window().map_err(|error| error.to_string())? as usize;
        let duration = duration.clamp(0.0, 2.0);
        window
            .run_on_main_thread(move || unsafe {
                mac::apply(&label, pointer as *mut objc2::runtime::AnyObject, enable, duration);
            })
            .map_err(|error| error.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enable, duration);
        Ok(false)
    }
}
