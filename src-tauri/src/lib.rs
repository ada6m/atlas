//! Desktop app shell.
//!
//! On start-up this launches the Python backend (FastAPI, backend/main.py) on a
//! free local port and tells the page where to find it. The backend quits when
//! the app exits — even if the app crashes or `tauri dev` restarts it — because
//! it watches a pipe from this process (see exit_when_app_closes in main.py).

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// The backend process and where it listens (or why it couldn't start).
struct Backend {
    url: Result<String, String>,
    process: Mutex<Option<Child>>,
}

/// The page asks this for the backend's address before making requests.
#[tauri::command]
fn backend_url(backend: tauri::State<Backend>) -> Result<String, String> {
    backend.url.clone()
}

/// The project's backend folder.
/// For now this is the source checkout (development). A release build will
/// ship the backend as a bundled executable instead.
fn backend_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("backend")
}

/// Ask the operating system for a port nothing else is using.
fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Start `python -m uvicorn main:app` from the backend's own virtual environment.
fn start_backend(port: u16) -> std::io::Result<Child> {
    let dir = backend_dir();
    let python = dir.join(".venv").join("Scripts").join("python.exe");

    let mut command = Command::new(python);
    command
        .args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", &port.to_string()])
        .current_dir(&dir)
        // The backend quits when this pipe closes, i.e. when the app goes away.
        .env("ATLAS_EXIT_WITH_PARENT", "1")
        .stdin(Stdio::piped());

    // Release builds have no console, so stop Windows opening one for Python.
    // (In development Python shares the `tauri dev` terminal, so its logs show there.)
    #[cfg(windows)]
    if !cfg!(debug_assertions) {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn()
}

fn launch_backend() -> Backend {
    let started = free_port().and_then(|port| start_backend(port).map(|child| (port, child)));

    match started {
        Ok((port, child)) => Backend {
            url: Ok(format!("http://127.0.0.1:{port}")),
            process: Mutex::new(Some(child)),
        },
        Err(error) => {
            let message = format!("Could not start the Python backend in {}: {error}", backend_dir().display());
            eprintln!("{message}");
            Backend { url: Err(message), process: Mutex::new(None) }
        }
    }
}

fn stop_backend(backend: &Backend) {
    if let Some(mut child) = backend.process.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(launch_backend())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_url])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Normal exit: stop the backend straight away.
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_backend(&app.state::<Backend>());
        }
    });
}
