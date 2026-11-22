#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Write,
    sync::Mutex,
    time::Duration,
};
use tauri::{
    ipc::CapabilityBuilder,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
struct Preferences {
    site: String,
    shortcut: String,
    local: bool,
    always_on_top: bool,
    hide_on_blur: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            site: String::new(),
            shortcut: "CmdOrCtrl+Space".into(),
            local: false,
            always_on_top: true,
            hide_on_blur: false,
        }
    }
}

#[derive(Serialize)]
struct DesktopState {
    settings: Preferences,
    registered: bool,
    startup: bool,
}

struct Desktop {
    state: Mutex<DesktopState>,
    active: Mutex<String>,
}
type Result<T> = std::result::Result<T, String>;
fn error(e: impl ToString) -> String {
    e.to_string()
}

fn site_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(error)?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (loopback && url.scheme() == "http"))
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Enter the HTTPS address of your Checky server. Localhost also supports HTTP.".into(),
        );
    }
    Ok(url)
}

fn workspace_origin(settings: &Preferences) -> Result<Option<Url>> {
    if settings.local {
        Ok(None)
    } else {
        site_url(&settings.site).map(Some)
    }
}

fn app_url(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    )
}

fn show(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
fn active(app: &AppHandle) -> Option<WebviewWindow> {
    let desktop = app.state::<Desktop>();
    let label = desktop.active.lock().ok()?.clone();
    app.get_webview_window(&label)
}
fn toggle(app: &AppHandle) {
    if let Some(win) = active(app) {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show(&win);
        }
    } else {
        let _ = preferences(app);
    }
}
fn preferences(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("preferences") {
        show(&win);
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        "preferences",
        WebviewUrl::App("preferences.html".into()),
    )
    .title("Checky Desktop settings")
    .always_on_top(true)
    .inner_size(475., 665.)
    .on_navigation(app_url)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()
    .map_err(error)?;
    Ok(())
}
#[tauri::command]
fn read_preferences(app: AppHandle) -> Result<DesktopState> {
    let desktop = app.state::<Desktop>();
    let state = desktop.state.lock().map_err(error)?;
    Ok(DesktopState {
        settings: state.settings.clone(),
        registered: state.registered,
        startup: app.autolaunch().is_enabled().unwrap_or(false),
    })
}
#[tauri::command]
async fn save_preferences(app: AppHandle, mut settings: Preferences, startup: bool) -> Result<()> {
    if !settings.local {
        settings.site = site_url(&settings.site)?.origin().ascii_serialization();
    }
    if settings.shortcut.len() > 80 {
        return Err("Shortcut is too long.".into());
    }
    let key: Shortcut = settings.shortcut.parse().map_err(error)?;
    if key.mods.is_empty() {
        return Err("Choose a shortcut with Ctrl, Alt, Shift or Command.".into());
    }
    let desktop = app.state::<Desktop>();
    let mut state = desktop.state.lock().map_err(error)?;
    let old_startup = app.autolaunch().is_enabled().map_err(error)?;
    let old = state.settings.shortcut.parse::<Shortcut>().ok();
    let change = !state.registered || Some(key) != old;
    // If the OS cannot register any key, the current preference still opens Checky from the tray.
    let registered = if change {
        match app.global_shortcut().register(key) {
            Ok(()) => true,
            Err(_) if old == Some(key) && !state.registered => false,
            Err(_) => {
                return Err(
                    "The shortcut could not be registered. Try a different combination.".into(),
                )
            }
        }
    } else {
        true
    };
    let set_startup = |enable| {
        if enable {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
    };
    let write = || -> Result<()> {
        let dir = app.path().app_config_dir().map_err(error)?;
        fs::create_dir_all(&dir).map_err(error)?;
        let mut file = tempfile::NamedTempFile::new_in(&dir).map_err(error)?;
        serde_json::to_writer(&mut file, &settings).map_err(error)?;
        file.flush().map_err(error)?;
        if startup != old_startup {
            set_startup(startup).map_err(error)?;
        }
        if let Err(e) = file.persist(dir.join("desktop.json")) {
            if startup != old_startup {
                let _ = set_startup(old_startup);
            }
            return Err(error(e));
        }
        Ok(())
    };
    if let Err(e) = write() {
        if change && registered {
            let _ = app.global_shortcut().unregister(key);
        }
        return Err(e);
    }
    if change && state.registered {
        if let Some(old) = old {
            let _ = app.global_shortcut().unregister(old);
        }
    }
    *state = DesktopState {
        settings,
        registered,
        startup,
    };
    Ok(())
}

fn workspace(app: &AppHandle) -> Result<()> {
    let settings = read_preferences(app.clone())?.settings;
    let origin = workspace_origin(&settings)?;
    let mut hash = DefaultHasher::new();
    settings.site.hash(&mut hash);
    let label = if settings.local {
        "local".into()
    } else {
        format!("hosted-{:x}", hash.finish())
    };
    let previous = active(app);
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(settings.always_on_top)
            .map_err(error)?;
        show(&win);
    } else {
        let local = settings.local;
        let url = if local {
            WebviewUrl::App("index.html".into())
        } else {
            let origin = origin.as_ref().ok_or("Enter your Checky server address.")?;
            app.add_capability(
                CapabilityBuilder::new(format!("notify-{label}"))
                    .local(false)
                    .window(&label)
                    .remote(format!("{}/*", origin.origin().ascii_serialization()))
                    .permission("allow-desktop-notify"),
            )
            .map_err(error)?;
            WebviewUrl::External(origin.clone())
        };
        let handle = app.clone();
        let check_origin = origin.as_ref().map(Url::origin);
        let guard = if local {
            "['tauri://localhost','http://tauri.localhost','https://tauri.localhost'].includes(location.origin) || location.protocol === 'tauri:'" .into()
        } else {
            format!(
                "location.origin === {}",
                serde_json::to_string(
                    &origin.as_ref().ok_or("Enter your Checky server address.")?
                        .origin().ascii_serialization()
                ).map_err(error)?
            )
        };
        let init = format!("if (window === window.top && ({guard})) {{ window.checkyDesktop = Object.freeze({{local:{local}, preferences:()=>location.assign('https://checky-desktop.invalid/preferences'), notify:body=>window.__TAURI__.core.invoke('desktop_notify',{{body}})}}); }}");
        WebviewWindowBuilder::new(app, &label, url)
            .title("Checky's List")
            .always_on_top(settings.always_on_top)
            .inner_size(550., 740.)
            .initialization_script(init)
            .disable_drag_drop_handler()
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_navigation(move |next| {
                if next.as_str() == "https://checky-desktop.invalid/preferences" {
                    let app = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = preferences(&app);
                    });
                    return false;
                }
                if local {
                    app_url(next)
                } else {
                    Some(next.origin()) == check_origin
                }
            })
            .build()
            .map_err(error)?;
    }
    *app.state::<Desktop>().active.lock().map_err(error)? = label.clone();
    if let Some(win) = previous {
        if win.label() != label {
            let _ = win.hide();
        }
    }
    if let Some(win) = app.get_webview_window("preferences") {
        let _ = win.hide();
    }
    Ok(())
}
#[tauri::command]
async fn open_workspace(app: AppHandle) -> Result<()> {
    workspace(&app)
}

#[tauri::command]
fn desktop_notify(app: AppHandle, window: WebviewWindow, body: String) -> Result<()> {
    if !active(&app).is_some_and(|w| w.label() == window.label())
        || body.chars().count() > 200
        || body.is_empty()
    {
        return Err("Invalid reminder.".into());
    }
    app.notification()
        .builder()
        .title("Checky's List reminder")
        .body(body)
        .show()
        .map_err(error)
}

#[tauri::command]
fn legacy_checklist(app: AppHandle) -> Result<Option<String>> {
    let Some(dir) = legacy_directory(&app) else {
        return Ok(None);
    };
    let path = dir.join("checkTabs.json");
    fs::read_to_string(path).map(Some).map_err(error)
}

fn legacy_directory(app: &AppHandle) -> Option<std::path::PathBuf> {
    let config = app.path().config_dir().ok()?;
    ["Checky's List", "checkys-app"]
        .iter()
        .map(|folder| config.join(folder).join("data"))
        .find(|dir| {
            fs::metadata(dir.join("checkTabs.json"))
                .is_ok_and(|meta| meta.is_file() && meta.len() <= 64 * 1024 * 1024)
        })
}

// Carry device preferences forward without importing account credentials.
fn first_preferences(app: &AppHandle) -> Preferences {
    let mut settings = Preferences::default();
    let Some(dir) = legacy_directory(app) else {
        return settings;
    };
    settings.local = true;
    let Some(old) = fs::read(dir.join("settings.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
    else {
        return settings;
    };
    if let Some(site) = old
        .pointer("/advanced/serverUrl")
        .and_then(|v| v.as_str())
        .and_then(|s| site_url(s).ok())
    {
        settings.site = site.origin().ascii_serialization();
        settings.local = false;
    }
    if let Some(key) = old["hotkey"].as_str() {
        let value = key.replace("CommandOrControl", "CmdOrCtrl");
        if value.len() <= 80
            && value
                .parse::<Shortcut>()
                .is_ok_and(|key| !key.mods.is_empty())
        {
            settings.shortcut = value;
        }
    }
    settings.always_on_top = old["alwaysOnTop"]
        .as_bool()
        .unwrap_or(settings.always_on_top);
    settings.hide_on_blur = old["autoHideOnBlur"]
        .as_bool()
        .unwrap_or(settings.hide_on_blur);
    settings
}

#[tauri::command]
fn open_releases() -> Result<()> {
    open::that_detached("https://github.com/The-Vibe-Code-Dad/checky/releases/latest")
        .map_err(error)
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--toggle") {
                toggle(app);
            } else if let Some(win) = active(app) {
                show(&win);
            } else {
                let _ = preferences(app);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            read_preferences,
            save_preferences,
            open_workspace,
            open_releases,
            desktop_notify,
            legacy_checklist
        ])
        .setup(|app| {
            let config = app.path().app_config_dir()?.join("desktop.json");
            let saved = fs::read(&config)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok());
            let first = saved.is_none();
            let settings = saved.unwrap_or_else(|| first_preferences(app.handle()));
            let registered = app
                .global_shortcut()
                .register(settings.shortcut.as_str())
                .is_ok();
            app.manage(Desktop {
                state: Mutex::new(DesktopState {
                    settings,
                    registered,
                    startup: false,
                }),
                active: Mutex::new(String::new()),
            });
            let toggle_item =
                MenuItem::with_id(app, "toggle", "Show or hide Checky", true, None::<&str>)?;
            let prefs = MenuItem::with_id(app, "settings", "Desktop settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Checky", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &prefs, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle(app),
                    "settings" => {
                        let _ = preferences(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            if first || workspace(app.handle()).is_err() {
                preferences(app.handle())?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(20));
                if let Some(win) = active(&handle) {
                    let _ = win.eval("window.checkyDesktopTick?.()?.catch(console.error)");
                }
            });
            Ok(())
        })
        .on_window_event(|win, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if win.label() != "preferences"
                    && win
                        .state::<Desktop>()
                        .state
                        .try_lock()
                        .is_ok_and(|s| s.settings.hide_on_blur)
                {
                    let _ = win.hide();
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start Checky Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_install_requires_a_server_or_local_mode() {
        let mut settings = Preferences::default();
        assert!(settings.site.is_empty());
        assert!(workspace_origin(&settings).is_err());
        settings.local = true;
        assert!(workspace_origin(&settings).unwrap().is_none());
        settings.local = false;
        settings.site = "https://example.domain".into();
        assert!(workspace_origin(&settings).unwrap().is_some());
    }

    #[test]
    fn server_addresses() {
        for url in [
            "https://example.domain",
            "http://127.0.0.1:17760",
            "http://[::1]:17760",
        ] {
            assert!(site_url(url).is_ok());
        }
        for url in [
            "file:///tmp/x",
            "http://example.domain",
            "https://user@a.com",
            "https://a.com/path",
            "https://a.com/?x",
            "https://a.com/#x",
        ] {
            assert!(site_url(url).is_err());
        }
    }
}
