fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "read_preferences",
        "save_preferences",
        "open_workspace",
        "legacy_checklist",
        "desktop_notify",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).unwrap();
}
