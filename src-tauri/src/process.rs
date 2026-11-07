//! Drain both pipes while supervising network commands, including their helpers.
use crate::git::Output;
use crate::settings::tr;
use std::io::Read;
use std::process::{Child, Command};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub fn isolate(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = cmd;
}

fn kill_tree(child: &mut Child) {
    // Killing only git leaves credential helpers / ssh alive, holding its pipes.
    #[cfg(unix)]
    let _ = Command::new("/bin/kill")
        .args(["-KILL", &format!("-{}", child.id())])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn network_output(mut child: Child, idle_limit: Duration) -> Result<Output, String> {
    let (tx, rx) = mpsc::channel();
    fn drain<R: Read + Send + 'static>(
        mut pipe: R,
        stderr: bool,
        tx: mpsc::Sender<(bool, std::io::Result<Vec<u8>>)>,
    ) {
        std::thread::spawn(move || {
            let mut buf = [0; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send((stderr, Ok(buf[..n].to_vec()))).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) => {
                        let _ = tx.send((stderr, Err(e)));
                        break;
                    }
                }
            }
        });
    }
    if let Some(pipe) = child.stdout.take() {
        drain(pipe, false, tx.clone());
    }
    if let Some(pipe) = child.stderr.take() {
        drain(pipe, true, tx.clone());
    }
    drop(tx);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut last_output = Instant::now();
    let mut status = None;
    let mut pipes_closed = false;
    loop {
        if !pipes_closed {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok((is_stderr, Ok(bytes))) => {
                    last_output = Instant::now();
                    if is_stderr {
                        stderr.extend(bytes);
                    } else {
                        stdout.extend(bytes);
                    }
                }
                Ok((_, Err(e))) => {
                    kill_tree(&mut child);
                    return Err(e.to_string());
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => pipes_closed = true,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        } else {
            std::thread::sleep(Duration::from_millis(50));
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(s) => status = s,
                Err(e) => {
                    kill_tree(&mut child);
                    return Err(e.to_string());
                }
            }
        }
        if pipes_closed {
            if let Some(status) = status {
                return Ok(Output {
                    code: status.code().unwrap_or(-1),
                    stdout,
                    stderr: String::from_utf8_lossy(&stderr).into_owned(),
                });
            }
        }
        if last_output.elapsed() >= idle_limit {
            kill_tree(&mut child);
            return Err(format!("{}\n{}", tr(
                "A Git hálózati művelet 120 másodperce nem adott kimenetet, ezért leállítottuk. Ellenőrizd a hálózatot és a hitelesítést. Push után frissítsd a remote állapotát, mielőtt újrapróbálod: a szerver már elfogadhatta a módosításokat.",
                "The Git network operation produced no output for 120 seconds and was stopped. Check your network and authentication. After a push, refresh remote status before retrying: the server may already have accepted the changes."
            ), String::from_utf8_lossy(&stderr)));
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    fn run(script: &str, timeout: Duration) -> Result<Output, String> {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        isolate(&mut cmd);
        network_output(cmd.spawn().unwrap(), timeout)
    }
    #[test]
    fn drains_both_pipes_and_preserves_failure() {
        let out = run(
            "head -c 200000 /dev/zero; head -c 200000 /dev/zero >&2; exit 7",
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(out.code, 7);
        assert_eq!(out.stdout.len(), 200000);
        assert_eq!(out.stderr.len(), 200000);
    }
    #[test]
    fn stops_silent_descendants_even_after_git_exits() {
        let started = Instant::now();
        assert!(run("sleep 30 & exit 0", Duration::from_millis(150)).is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn terminating_tree_closes_descendant_pipes() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "sleep 30 & wait"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        isolate(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.read_to_end(&mut bytes);
            let _ = tx.send(());
        });
        std::thread::sleep(Duration::from_millis(100));
        kill_tree(&mut child);
        rx.recv_timeout(Duration::from_secs(2))
            .expect("a descendant still holds the pipe open");
    }
    #[test]
    fn progress_resets_idle_deadline() {
        let out = run(
            "for i in 1 2 3 4 5; do echo progress >&2; sleep 0.2; done",
            Duration::from_millis(700),
        )
        .unwrap();
        assert_eq!(out.code, 0);
        assert_eq!(out.stderr.lines().count(), 5);
    }
}
